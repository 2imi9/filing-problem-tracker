import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError } from "@/server/config";
import { loadConfigOrExit } from "@/server/startup";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadConfigOrExit", () => {
  it("does nothing more when the configuration loads", async () => {
    const exit = vi.fn();
    const printed = vi.spyOn(console, "error").mockImplementation(() => {});
    await loadConfigOrExit(async () => ({}), exit);
    expect(exit).not.toHaveBeenCalled();
    expect(printed).not.toHaveBeenCalled();
    // The real loader, in the test environment (demo mode, nothing set).
    await loadConfigOrExit(undefined, exit);
    expect(exit).not.toHaveBeenCalled();
  });

  it("prints the reason and ends the process with status 1 when the configuration is not usable", async () => {
    const exit = vi.fn();
    const printed = vi.spyOn(console, "error").mockImplementation(() => {});
    await loadConfigOrExit(async () => {
      throw new ConfigError("DEMO_COOKIE_SECRET must be at least 32 characters.");
    }, exit);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(printed.mock.calls[0][0]).toBe("Configuration error: DEMO_COOKIE_SECRET must be at least 32 characters.");
    // The message only: no stack trace, and none of the environment's values.
    expect(printed.mock.calls.flat().join("\n")).not.toMatch(/\bat \S+ \(/);
  });
});
