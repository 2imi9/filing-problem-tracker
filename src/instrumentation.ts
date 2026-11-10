// Runs once when the server starts. Loading the config here means a half-configured environment stops
// the server with a clear message at startup, not on the first request: the process exits with status 1
// (see src/server/startup.ts), so it never listens with settings it could not read.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadConfigOrExit } = await import("@/server/startup");
    await loadConfigOrExit();
  }
}
