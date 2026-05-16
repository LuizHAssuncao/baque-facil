const TEXT_ENTRY_SELECTOR = "input, select, textarea, [contenteditable]";

function isShortcutActivationKey(event: KeyboardEvent) {
  return event.key === "Enter" || event.key === " " || event.code === "Space";
}

export function shouldIgnoreKeyboardShortcut(event: KeyboardEvent) {
  const { target } = event;

  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable || target.closest(TEXT_ENTRY_SELECTOR)) {
    return true;
  }

  const button = target.closest("button");
  if (button) {
    return isShortcutActivationKey(event);
  }

  const link = target.closest("a[href]");
  if (link) {
    return event.key === "Enter";
  }

  return false;
}

export function blurPointerActivatedButton(target: EventTarget | null, detail: number) {
  if (detail === 0 || !(target instanceof Element)) {
    return;
  }

  const button = target.closest("button");
  if (button instanceof HTMLButtonElement) {
    button.blur();
  }
}
