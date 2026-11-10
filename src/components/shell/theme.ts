// Light and dark themes. The system preference applies until the person uses the toggle; the choice is
// kept in localStorage and set as data-theme on <html>.

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "fpt-theme";
const THEME_EVENT = "fpt-theme-change";

/**
 * Runs in <head> before the first paint, so a saved choice never flashes the other theme.
 * It is a fixed string with no values from the request. If the Content-Security-Policy lists script
 * hashes, this script's SHA-256 must be on the list.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

/** The theme on screen right now. Browser only. */
export function currentTheme(): Theme {
  const chosen = document.documentElement.getAttribute("data-theme");
  if (chosen === "light" || chosen === "dark") return chosen;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Applies and remembers a theme. */
export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be blocked (private mode, policy). The theme still applies for this visit.
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Calls `onChange` when the theme changes, by the toggle or by the system. Returns the unsubscribe. */
export function subscribeToTheme(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  window.addEventListener(THEME_EVENT, onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener(THEME_EVENT, onChange);
  };
}
