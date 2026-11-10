/** A new id for a workspace panel. Call it from event handlers only, never while rendering. */
export function newPanelId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `p-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
