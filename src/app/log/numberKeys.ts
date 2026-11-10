// Whether the 1 to 9 keys choose problems on Tag a filing. On unless the person turns it off; the choice
// is kept in this browser's localStorage. A single-key shortcut has to be something a person can switch
// off: speech input and a stray keypress both type characters nobody meant as a command.

export const NUMBER_KEYS_STORAGE_KEY = "fpt-number-keys";
const NUMBER_KEYS_EVENT = "fpt-number-keys-change";

/** Whether the number keys are on. Browser only. */
export function numberKeysOn(): boolean {
  try {
    return window.localStorage.getItem(NUMBER_KEYS_STORAGE_KEY) !== "off";
  } catch {
    // Storage can be blocked (private mode, policy). The keys stay on, as they are by default.
    return true;
  }
}

/** Turns the number keys on or off and remembers the choice. */
export function setNumberKeys(on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(NUMBER_KEYS_STORAGE_KEY);
    else window.localStorage.setItem(NUMBER_KEYS_STORAGE_KEY, "off");
  } catch {
    // With storage blocked the choice cannot be kept, so the keys stay on and the checkbox stays checked.
  }
  window.dispatchEvent(new Event(NUMBER_KEYS_EVENT));
}

/** Calls `onChange` when the choice changes, here or in another tab. Returns the unsubscribe. */
export function subscribeToNumberKeys(onChange: () => void): () => void {
  window.addEventListener(NUMBER_KEYS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(NUMBER_KEYS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
