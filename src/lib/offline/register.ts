import { OFFLINE_CACHE_PREFIX, OFFLINE_MESSAGE, type OfflineStatus } from "./protocol";
import { translate, TranslatableError, type Message } from "../i18n/messages";
import { getLocale, subscribeLocale } from "../i18n/preference";

const UPDATE_CHECK_INTERVAL = 60_000;
const DISMISSED_UPDATE_KEY = "baque-facil-dismissed-update";

type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function ask(worker: ServiceWorker, action: "status" | "repair" | "refresh-check" | "activate-refresh" | "activate-update" = "status"): Promise<OfflineStatus> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => finish(new Error("Offline check timed out")), action === "repair" ? 60_000 : 8_000);
    function finish(value: OfflineStatus | Error) {
      clearTimeout(timeout);
      channel.port1.close();
      if (value instanceof Error) reject(value);
      else resolve(value);
    }
    channel.port1.onmessage = ({ data }) => {
      if (data?.type !== OFFLINE_MESSAGE || data.error || typeof data.ready !== "boolean") {
        finish(new Error("Offline check unavailable"));
      } else finish(data as OfflineStatus);
    };
    try {
      worker.postMessage({ type: OFFLINE_MESSAGE, action }, [channel.port2]);
    } catch {
      finish(new Error("Offline worker unavailable"));
    }
  });
}

function waitForWorker(worker: ServiceWorker, requireActivation = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("Offline download timed out")), 90_000);
    function finish(error?: Error) {
      clearTimeout(timeout);
      worker.removeEventListener("statechange", check);
      if (error) reject(error);
      else resolve();
    }
    function check() {
      if (worker.state === "activated" || (!requireActivation && worker.state === "installed")) finish();
      else if (worker.state === "redundant") finish(new Error("Offline download failed"));
    }
    worker.addEventListener("statechange", check);
    check();
  });
}

async function checkDownloadServer() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    // Neither endpoint is precached. Check real connectivity before removing files.
    const options = { cache: "no-store", signal: controller.signal } as const;
    const report = await fetch(`/offline-build.json?refresh=${Date.now()}`, options);
    if (!report.ok) throw new Error("Offline download server unavailable");
    const build = await report.json();
    if (typeof build.release !== "string" || !Array.isArray(build.files) || !build.files.length) throw new Error("Invalid offline build");
    const worker = await fetch("/sw.js", options);
    if (!worker.ok || !/javascript/.test(worker.headers.get("content-type") ?? "")) throw new Error("Offline worker unavailable");
    await worker.arrayBuffer();
  } finally {
    clearTimeout(timeout);
  }
}

export function initOfflineStatus(root: HTMLElement) {
  const message = root.querySelector<HTMLElement>("[data-offline-message]")!;
  const updateButton = root.querySelector<HTMLButtonElement>("[data-offline-update]")!;
  const updatePrompt = root.querySelector<HTMLElement>("[data-offline-update-prompt]")!;
  const acceptUpdate = root.querySelector<HTMLButtonElement>("[data-offline-update-accept]")!;
  const laterUpdate = root.querySelector<HTMLButtonElement>("[data-offline-update-later]")!;
  const promptError = root.querySelector<HTMLElement>("[data-offline-update-error]")!;
  const retry = root.querySelector<HTMLButtonElement>("[data-offline-retry]")!;
  const install = root.querySelector<HTMLButtonElement>("[data-offline-install]")!;
  const ios = root.querySelector<HTMLElement>("[data-offline-ios]")!;
  const settings = document.querySelector<HTMLElement>("[data-offline-settings]");
  const refreshButton = settings?.querySelector<HTMLButtonElement>("[data-offline-refresh]");
  const refreshMessage = settings?.querySelector<HTMLElement>("[data-offline-refresh-message]");
  const supported = "serviceWorker" in navigator && window.isSecureContext;
  let registration: ServiceWorkerRegistration | undefined;
  let failed = false;
  let busy = false;
  let refreshing = false;
  let resetIncomplete = false;
  let recoveryMessage: Message | undefined;
  let updateError: Message | undefined;
  let footerMessage: Message = "Preparing offline access…";
  let refreshId = 0;
  let lastCheck = 0;
  let pendingRelease: string | undefined;
  let dismissedRelease: string | undefined;
  let focusBeforePrompt: HTMLElement | null = null;
  try { dismissedRelease = sessionStorage.getItem(DISMISSED_UPDATE_KEY) ?? undefined; } catch { /* Dismissal still works for this page when storage is unavailable. */ }
  let installPrompt: InstallPrompt | undefined;
  const observed = new WeakSet<ServiceWorker>();
  root.hidden = false;

  function renderMessages() {
    const text = translate(getLocale(), updateError ?? footerMessage);
    if (message.textContent !== text) message.textContent = text;
    updateButton.disabled = refreshing || busy || Boolean(registration?.installing);
    acceptUpdate.disabled = updateButton.disabled;
    acceptUpdate.textContent = translate(getLocale(), refreshing ? "Updating…" : "Refresh to update");
    laterUpdate.disabled = refreshing;
    promptError.hidden = !updateError;
    promptError.textContent = updateError ? translate(getLocale(), updateError) : "";
    if (refreshButton) {
      refreshButton.disabled = refreshing || busy || Boolean(registration?.installing) || !navigator.onLine || !supported;
      refreshButton.textContent = translate(getLocale(), refreshing ? "Refreshing…" : "Refresh offline app");
    }
    if (refreshMessage) {
      const key = !supported ? "Offline access unavailable in this browser" : !navigator.onLine && !refreshing ? "Connect to the internet to refresh the offline app." : recoveryMessage;
      refreshMessage.textContent = key ? translate(getLocale(), key) : "";
    }
  }

  function show(state: string, text: Message, canRetry = false) {
    footerMessage = text;
    root.dataset.state = state;
    renderMessages();
    retry.hidden = !canRetry;
    retry.disabled = busy;
    updateButton.hidden = state !== "update-ready";
    const promptVisible = (state === "update-ready" || state === "updating") && Boolean(pendingRelease) && pendingRelease !== dismissedRelease;
    if (promptVisible && updatePrompt.hidden) {
      focusBeforePrompt = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    // A non-modal prompt leaves focus and ongoing playback/editing alone.
    updatePrompt.hidden = !promptVisible;
  }

  if (settings) settings.hidden = false;
  subscribeLocale(() => { renderMessages(); void refresh(); });
  const url = new URL(location.href);
  if (url.searchParams.has("offline-refreshed")) {
    recoveryMessage = "Offline app refreshed.";
    const disclosure = settings?.closest("details");
    if (disclosure) disclosure.open = true;
    url.searchParams.delete("offline-refreshed");
    history.replaceState(null, "", url);
  }
  if (!supported) {
    show("unavailable", "Offline access unavailable in this browser");
    return;
  }

  async function refresh() {
    if (!supported || refreshing) return;
    const id = ++refreshId;
    if (resetIncomplete) {
      root.dataset.ready = "false";
      show("incomplete", "Offline download incomplete");
      return;
    }
    const controller = navigator.serviceWorker.controller;
    const active = controller ?? registration?.active;
    const waiting = registration?.waiting;
    const [current, next] = await Promise.all([
      active ? ask(active).catch(() => undefined) : undefined,
      waiting ? ask(waiting).catch(() => undefined) : undefined,
    ]);
    if (id !== refreshId || refreshing) return;
    root.dataset.release = current?.release ?? "";
    root.dataset.ready = String(Boolean(controller && current?.ready));
    if (next?.ready) {
      pendingRelease = next.release;
      show("update-ready", navigator.onLine ? "Update saved · reload to use the latest version" : "Offline · update saved · ready to reload");
    } else if (current?.ready && controller) {
      const text = navigator.onLine ? "Ready for offline use" : "Offline · using saved rhythms";
      show(failed ? "update-failed" : "ready", failed ? { key: "{status} · update couldn’t download", values: { status: translate(getLocale(), text) } } : text, failed && navigator.onLine);
    } else if (registration?.installing || busy) {
      show("downloading", "Preparing offline access…");
    } else if (current?.ready) {
      show("saved", "Offline files saved · ready on your next visit");
    } else {
      show("incomplete", navigator.onLine ? "Offline download incomplete" : "Connect to finish offline setup", navigator.onLine);
    }
  }

  function observe(worker: ServiceWorker | null) {
    if (!worker || observed.has(worker)) return;
    observed.add(worker);
    worker.addEventListener("statechange", () => {
      if (worker.state === "redundant" && !registration?.waiting) failed = true;
      if (worker.state === "installed" || worker.state === "activated") failed = false;
      void refresh();
    });
  }

  async function check(force = false) {
    if (!registration || busy || refreshing || resetIncomplete) return;
    if (!navigator.onLine || (!force && Date.now() - lastCheck < UPDATE_CHECK_INTERVAL)) {
      await refresh();
      return;
    }
    lastCheck = Date.now();
    busy = true;
    failed = false;
    void refresh();
    try {
      await registration.update();
      const active = navigator.serviceWorker.controller ?? registration.active;
      if (active && !registration.waiting && !(await ask(active)).ready) await ask(active, "repair");
    } catch {
      failed = true;
    } finally {
      busy = false;
      await refresh();
    }
  }

  async function register() {
    if (refreshing || resetIncomplete) return;
    show("downloading", "Preparing offline access…");
    try {
      const existing = await navigator.serviceWorker.getRegistration("/");
      const previous = existing?.active ?? existing?.waiting ?? existing?.installing;
      // Keep a recovery worker's URL: switching it back would stage a redundant update.
      const script = previous && new URL(previous.scriptURL).pathname === "/sw.js" ? previous.scriptURL : "/sw.js";
      registration = await navigator.serviceWorker.register(script, { scope: "/", updateViaCache: "none" });
      registration.addEventListener("updatefound", () => {
        observe(registration!.installing);
        void refresh();
      });
      observe(registration.installing);
      observe(registration.waiting);
      observe(registration.active);
      await refresh();
      if (!registration.installing) await check();
    } catch {
      failed = true;
      show("incomplete", navigator.onLine ? "Offline download incomplete" : "Connect to finish offline setup", navigator.onLine);
    }
  }

  function hasWorker() {
    return registration?.active || registration?.waiting || registration?.installing;
  }

  async function applyUpdate() {
    if (refreshing || busy || registration?.installing) return;
    const waiting = registration?.waiting;
    updateError = undefined;
    if (!waiting) {
      await refresh();
      return;
    }
    refreshing = true;
    ++refreshId;
    show("updating", "Updating…");
    let reloading = false;
    try {
      const state = await ask(waiting, "refresh-check");
      if (state.windows !== 1) throw new TranslatableError("Close other Baque Fácil tabs or windows, then try again.");
      if (!state.ready) throw new Error("Offline update incomplete");
      // Recheck completeness and open windows inside the waiting worker before
      // activation. Use the already saved release, even without a connection.
      await ask(waiting, "activate-update");
      await waitForWorker(waiting, true);
      reloading = true;
      location.reload();
    } catch (error) {
      updateError = error instanceof TranslatableError ? error.translation
        : "Couldn’t apply the update. Try again, or close all app tabs and reopen.";
    } finally {
      if (!reloading) {
        refreshing = false;
        await refresh();
      }
    }
  }
  updateButton.addEventListener("click", () => { void applyUpdate(); });
  acceptUpdate.addEventListener("click", () => { void applyUpdate(); });
  function dismissUpdate() {
    if (refreshing || !pendingRelease) return;
    dismissedRelease = pendingRelease;
    try { sessionStorage.setItem(DISMISSED_UPDATE_KEY, dismissedRelease); } catch { /* Keep the in-memory dismissal. */ }
    const restoreFocus = updatePrompt.contains(document.activeElement);
    updatePrompt.hidden = true;
    if (restoreFocus) (focusBeforePrompt?.isConnected ? focusBeforePrompt : updateButton).focus({ preventScroll: true });
  }
  laterUpdate.addEventListener("click", dismissUpdate);
  updatePrompt.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismissUpdate();
    }
  });

  refreshButton?.addEventListener("click", async () => {
    if (refreshing || !navigator.onLine) return;
    if (busy || registration?.installing) {
      recoveryMessage = "Wait for the current download to finish, then try again.";
      renderMessages();
      return;
    }
    refreshing = true;
    ++refreshId;
    updateError = undefined;
    recoveryMessage = "Checking the connection…";
    show("downloading", "Refreshing offline app…");
    let reloading = false;
    try {
      const current = await navigator.serviceWorker.getRegistration("/");
      const worker = navigator.serviceWorker.controller ?? current?.active;
      async function checkOtherTabs() {
        if (!worker) return;
        const state = await ask(worker, "refresh-check");
        if (state.windows !== 1) throw new TranslatableError("Close other Baque Fácil tabs or windows, then try again.");
      }
      await checkOtherTabs();
      await checkDownloadServer();
      await checkOtherTabs();
      if (current?.installing) throw new TranslatableError("Wait for the current download to finish, then try again.");
      // This explicit recovery action affects only this app's worker and caches.
      // It never clears preferences, or reloads another tab with unsaved work.
      if (current && !await current.unregister()) throw new Error("Offline reset unavailable");
      resetIncomplete = true;
      registration = undefined;
      await Promise.all((await caches.keys()).filter((name) => name.startsWith(OFFLINE_CACHE_PREFIX)).map((name) => caches.delete(name)));
      recoveryMessage = "Downloading a fresh copy… This page will reload when it’s ready.";
      renderMessages();
      // A distinct script URL forces a new install even while this page still
      // holds the old, unregistered worker alive. Every asset is downloaded again.
      registration = await navigator.serviceWorker.register(`/sw.js?refresh=${crypto.randomUUID()}`, { scope: "/", updateViaCache: "none" });
      const fresh = registration.installing ?? registration.waiting ?? registration.active;
      if (!fresh) throw new Error("Offline worker unavailable");
      await waitForWorker(fresh);
      if (!(await ask(fresh, "activate-refresh")).ready) throw new Error("Offline download incomplete");
      await waitForWorker(fresh, true);
      const destination = new URL(location.href);
      destination.searchParams.set("offline-refreshed", "1");
      destination.hash = "settings";
      reloading = true;
      location.replace(destination);
    } catch (error) {
      recoveryMessage = error instanceof TranslatableError ? error.translation : resetIncomplete
        ? "The refresh didn’t finish. Stay online and try again."
        : "Couldn’t reach the download server. Your saved app is unchanged. Try again when you’re connected.";
    } finally {
      if (!reloading) {
        refreshing = false;
        renderMessages();
        await refresh();
      }
    }
  });
  retry.addEventListener("click", () => { void (hasWorker() ? check(true) : register()); });
  window.addEventListener("online", () => { renderMessages(); void (hasWorker() ? check(true) : register()); });
  window.addEventListener("offline", () => { renderMessages(); void refresh(); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void check();
  });
  window.addEventListener("focus", () => { void check(); });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) void check(true);
  });
  // An app left open in the foreground must discover deployments too.
  setInterval(() => { if (!document.hidden) void check(); }, UPDATE_CHECK_INTERVAL);
  navigator.serviceWorker.addEventListener("controllerchange", () => { void refresh(); });
  navigator.serviceWorker.addEventListener("message", ({ data }) => {
    if (data?.type === OFFLINE_MESSAGE) void refresh();
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event as InstallPrompt;
    install.hidden = false;
  });
  install.addEventListener("click", async () => {
    const prompt = installPrompt;
    if (!prompt) return;
    install.hidden = true;
    installPrompt = undefined;
    try { await prompt.prompt(); await prompt.userChoice; } catch { /* Browser owns install availability. */ }
  });
  window.addEventListener("appinstalled", () => { install.hidden = true; ios.hidden = true; });
  const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  ios.hidden = !isIos || Boolean(standalone);
  void register();
}
