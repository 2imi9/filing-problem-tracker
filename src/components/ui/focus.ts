// Where keyboard focus goes when the control that had it is about to leave the page.
//
// A button that removes itself when used (a toast's Undo, a filter chip, a form's Cancel) would leave
// focus on <body>: a screen reader loses its place and the next Tab starts from the top of the page.
// The page that owns the control names a better landing place where it has one; these helpers are for
// the cases where the best stable place is the main region itself.

/** Moves focus to the page's main region (`<main id="main" tabIndex={-1}>` in the shell). Browser only. */
export function focusMain(): void {
  document.getElementById("main")?.focus({ preventScroll: true });
}

/** Call just before `container` is removed: if focus is inside it, focus moves to the main region. */
export function releaseFocusFrom(container: Element | null): void {
  if (container && container.contains(document.activeElement)) focusMain();
}

/**
 * Where focus goes after the button at place `index` in `list` removed itself (a filter chip): the
 * button that is at that place now, else the last one left, else null when the list is empty or gone.
 */
export function buttonAfterRemoval(list: Element | null, index: number): HTMLButtonElement | null {
  const buttons = list ? list.querySelectorAll<HTMLButtonElement>("button") : [];
  return buttons[index] ?? buttons[buttons.length - 1] ?? null;
}
