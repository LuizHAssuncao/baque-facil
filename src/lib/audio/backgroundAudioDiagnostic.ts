import { translate, type Message } from "../i18n/messages";
import { getLocale, subscribeLocale } from "../i18n/preference";

const BASE_TEMPO = 120;
const LOG_KEY = "baque-background-audio-diagnostic-v1";

type AudioSession = { type: string };

// One complete bar. All four hits are already in the buffer; no timers schedule sound.
export function createDiagnosticBeat(context: BaseAudioContext): AudioBuffer {
  const rate = context.sampleRate;
  const buffer = context.createBuffer(1, rate * 2, rate);
  const data = buffer.getChannelData(0);
  const hitFrames = Math.round(rate * 0.07);
  for (let beat = 0; beat < 4; beat += 1) {
    const offset = Math.round(beat * rate * 0.5);
    const frequency = beat === 0 ? 1320 : 880;
    for (let frame = 0; frame < hitFrames; frame += 1) {
      const time = frame / rate;
      const attack = Math.min(1, time / 0.002);
      const decay = (1 - frame / (hitFrames - 1)) ** 3;
      data[offset + frame] = 0.45 * attack * decay * Math.sin(2 * Math.PI * frequency * time);
    }
  }
  return buffer;
}

export function initBackgroundAudioDiagnostic(root: HTMLElement): void {
  const t = (message: Message) => translate(getLocale(), message);
  const find = <T extends HTMLElement>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing diagnostic control: ${selector}`);
    return element;
  };
  const start = find<HTMLButtonElement>("[data-start]");
  const stop = find<HTMLButtonElement>("[data-stop]");
  const status = find("[data-status]");
  const engine = find("[data-engine]");
  const sessionStatus = find("[data-session]");
  const clock = find("[data-clock]");
  const backgroundStatus = find("[data-background]");
  const tempo = find<HTMLInputElement>("#diagnostic-tempo");
  const tempoLabel = find<HTMLOutputElement>("[data-tempo-label]");
  const result = find<HTMLSelectElement>("#diagnostic-result");
  const report = find<HTMLTextAreaElement>("#diagnostic-log");
  const copyStatus = find("[data-copy-status]");
  const audioSession = (navigator as Navigator & { audioSession?: AudioSession }).audioSession;
  const originalSessionType = audioSession?.type;
  let context: AudioContext | null = null;
  let source: AudioBufferSourceNode | null = null;
  let starting = false;
  let frame = 0;
  let idleMessage: Message = "Ready. Tap Start beat, then listen while switching apps or locking the phone.";
  let sessionMessage: Message = audioSession ? "Available; requested when you start" : "Audio Session API unavailable";
  let backgroundMessage: Message = "No check yet";
  let copyMessage: Message = "Logs stay in this tab. Nothing is sent automatically.";
  let background: { context: AudioContext; wallTime: number; audioTime: number } | null = null;
  let entries: string[] = [];
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(LOG_KEY) ?? "[]");
    if (Array.isArray(saved)) entries = saved.filter((entry) => typeof entry === "string").slice(-60);
  } catch { /* Storage is optional, including in private browsing. */ }

  function updateReport(): void {
    report.value = [
      "Baque Fácil background audio diagnostic v1",
      `Page: ${location.href}`,
      `Browser: ${navigator.userAgent}`,
      `Audio session: ${translate("en-CA", sessionMessage)}`,
      `Tempo: ${tempo.value} BPM`,
      `Listening result: ${result.value}`,
      "Audio clock readings are not proof of audible playback.",
      "", ...entries,
    ].join("\n");
  }

  function log(message: string): void {
    const state = context ? `${context.state}, audio ${context.currentTime.toFixed(3)}s` : "no context";
    entries.push(`${new Date().toISOString()} | ${document.visibilityState} | ${state} | ${message}`);
    entries = entries.slice(-60);
    try { sessionStorage.setItem(LOG_KEY, JSON.stringify(entries)); } catch { /* Optional. */ }
    updateReport();
  }

  function update(): void {
    const running = context?.state === "running" && source !== null;
    engine.textContent = t(context?.state ?? "Not started");
    sessionStatus.textContent = t(sessionMessage);
    backgroundStatus.textContent = t(backgroundMessage);
    copyStatus.textContent = t(copyMessage);
    clock.textContent = `${(context?.currentTime ?? 0).toFixed(1)} s`;
    start.disabled = starting || running || typeof AudioContext === "undefined";
    start.textContent = t(context && source && !running ? "Resume beat" : "Start beat");
    stop.disabled = context === null;
    status.textContent = t(starting ? "Starting…" : running
      ? { key: "Playing at {tempo} BPM. Listen for gaps when the four beats repeat.", values: { tempo: tempo.value } }
      : context && source ? { key: "Audio engine is {state}. Tap Resume beat to try again.", values: { state: t(context.state) } } : idleMessage);
  }

  function requestPlaybackSession(): void {
    if (!audioSession) {
      sessionMessage = "Audio Session API unavailable";
      log("Playback audio session unavailable; this browser cannot test the Safari setting.");
      return;
    }
    try {
      audioSession.type = "playback";
      sessionMessage = audioSession.type === "playback"
        ? "playback (accepted)" : { key: "Requested playback; reported {type}", values: { type: audioSession.type } };
      log(`Audio session requested playback; reported ${audioSession.type}.`);
    } catch (error) {
      sessionMessage = "Playback request failed";
      log(`Audio session request failed: ${String(error)}`);
    }
  }

  function stopBeat(message: Message = "Stopped. Tap Start beat for another test."): void {
    background = null;
    if (source) {
      source.stop();
      source.disconnect();
      source = null;
    }
    const previous = context;
    log("Stop requested.");
    context = null;
    starting = false;
    idleMessage = message;
    if (previous && previous.state !== "closed") {
      void previous.close().catch((error) => log(`Audio context close failed: ${String(error)}`));
    }
    if (audioSession && originalSessionType !== undefined) {
      try {
        audioSession.type = originalSessionType;
        sessionMessage = { key: "{type} (inactive)", values: { type: audioSession.type } };
      } catch (error) { log(`Audio session reset failed: ${String(error)}`); }
    }
    update();
    updateReport();
  }

  async function startBeat(): Promise<void> {
    if (starting || (context?.state === "running" && source)) return;
    starting = true;
    requestPlaybackSession();
    let requested: AudioContext | null = null;
    try {
      if (!context || context.state === "closed") {
        context = new AudioContext();
        const created = context;
        created.addEventListener("statechange", () => {
          log(`AudioContext state changed to ${created.state}.`);
          update();
        });
        source = context.createBufferSource();
        source.buffer = createDiagnosticBeat(context);
        source.loop = true;
        source.playbackRate.value = Number(tempo.value) / BASE_TEMPO;
        source.connect(context.destination);
        source.start();
        log(`Loop started: 4 beats, 2-second buffer, ${context.sampleRate} Hz, ${tempo.value} BPM.`);
      } else {
        log("User requested Resume.");
      }
      requested = context;
      // Resume is called directly inside the tap handler, before any await.
      const resumed = requested.resume();
      update();
      await resumed;
      if (context !== requested) return; // Stop may have been tapped while resume was pending.
      starting = false;
      log("Start/Resume request completed.");
      update();
    } catch (error) {
      if (requested && context !== requested) return;
      log(`Start failed: ${String(error)}`);
      stopBeat("Could not start audio. Tap Start beat to retry; see the diagnostic log.");
    }
  }

  function checkBackground(): void {
    log(`Visibility changed to ${document.visibilityState}.`);
    if (document.hidden) {
      if (context && source && !background) {
        background = { context, wallTime: Date.now(), audioTime: context.currentTime };
      }
    } else if (background) {
      if (background.context === context) {
        const wall = (Date.now() - background.wallTime) / 1000;
        const audio = context.currentTime - background.audioTime;
        const message = `Away ${wall.toFixed(1)} s; audio clock advanced ${audio.toFixed(1)} s.`;
        backgroundMessage = { key: "Away {wall} s; audio clock advanced {audio} s.", values: { wall: wall.toFixed(1), audio: audio.toFixed(1) } };
        log(`${message} Listening is needed to confirm uninterrupted sound.`);
      }
      background = null;
    }
    // Do not resume here: doing so would hide a failed background-playback test.
    update();
  }

  function refreshClock(): void {
    clock.textContent = `${(context?.currentTime ?? 0).toFixed(1)} s`;
    frame = requestAnimationFrame(refreshClock);
  }

  start.addEventListener("click", () => { void startBeat(); });
  stop.addEventListener("click", () => stopBeat());
  tempo.addEventListener("input", () => {
    tempoLabel.value = `${tempo.value} BPM`;
    if (source && context) {
      source.playbackRate.setValueAtTime(Number(tempo.value) / BASE_TEMPO, context.currentTime);
    }
    update();
  });
  tempo.addEventListener("change", () => log(`Tempo changed to ${tempo.value} BPM.`));
  result.addEventListener("change", () => log(`Listening result: ${result.value}.`));
  find<HTMLButtonElement>("[data-copy]").addEventListener("click", async () => {
    updateReport();
    try {
      await navigator.clipboard.writeText(report.value);
      copyMessage = "Report copied. Paste it into our conversation.";
    } catch {
      find<HTMLDetailsElement>("details").open = true;
      report.focus();
      report.select();
      copyMessage = "Copy unavailable. Select and copy the report below.";
    }
    update();
  });
  document.addEventListener("visibilitychange", checkBackground);
  window.addEventListener("pagehide", (event) => {
    log(`Page hidden/unloaded (cached: ${event.persisted}).`);
    stopBeat("Page navigation stopped audio. Tap Start beat for another test.");
    cancelAnimationFrame(frame);
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      log("Page restored from browser cache; playback remains stopped.");
      cancelAnimationFrame(frame);
      refreshClock();
    }
  });
  subscribeLocale(() => { update(); updateReport(); });
  if (typeof AudioContext === "undefined") idleMessage = "This browser does not support Web Audio.";
  log("Page loaded. Playback requires a tap; earlier log entries may be from a previous load.");
  update();
  refreshClock();
}
