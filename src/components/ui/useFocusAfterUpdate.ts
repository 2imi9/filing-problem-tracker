// Gives keyboard focus a landing place when the control that had it removes or replaces itself.
//
//   const focusAfterUpdate = useFocusAfterUpdate();
//   <Button onClick={() => { setEditing(false); focusAfterUpdate(() => editButton.current); }}>Done</Button>
//
// Call it in the same handler that makes the change. `find` runs after React has drawn that change, so
// it can return an element that did not exist before (a form's first field) or one that took the place
// of the removed control (the next chip in a list). Returning null leaves focus alone.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Find = () => HTMLElement | null | undefined;

export function useFocusAfterUpdate(): (find: Find) => void {
  const pending = useRef<Find | null>(null);
  const [, redraw] = useState(0);

  // No dependency list: the request is picked up by whichever draw comes next.
  useEffect(() => {
    const find = pending.current;
    if (!find) return;
    pending.current = null;
    find()?.focus();
  });

  return useCallback((find: Find) => {
    pending.current = find;
    redraw((count) => count + 1);
  }, []);
}
