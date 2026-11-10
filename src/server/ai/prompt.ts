import "server-only";
// Helpers for putting untrusted text into a prompt as data.

/**
 * A named block holding JSON: <name>...</name>. Angle brackets inside the JSON are written as escapes,
 * so nothing in the data can close the block or open another one.
 */
export function dataBlock(name: string, value: unknown): string {
  const json = JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  return `<${name}>\n${json}\n</${name}>`;
}
