import "server-only";

// Run once from src/instrumentation.ts when the Node server starts.
//
// Next only logs an error thrown while the server is being prepared: the process keeps the port, reports
// itself ready and answers every request with a bare 500. A server that cannot read its settings must
// not look healthy to whatever started it, so a configuration error ends the process here.

/** Loads the configuration. On failure prints the reason and ends the process with status 1. */
export async function loadConfigOrExit(
  load: () => Promise<unknown> = () => import("./config"),
  exit: (code: number) => void = (code) => process.exit(code),
): Promise<void> {
  try {
    await load();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("The server did not start. Fix the setting above and start it again.");
    exit(1);
  }
}
