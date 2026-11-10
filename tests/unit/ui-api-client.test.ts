import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, errorMessage } from "@/components/data/apiClient";

function stubFetch(response: Response | Error) {
  const mock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("Expected the request to fail.");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch deadlines", () => {
  it("reports a request that ran past its deadline as a network error with a plain message", async () => {
    stubFetch(new DOMException("The operation timed out.", "TimeoutError"));
    const error = await caught(apiFetch("/api/flags", { signal: AbortSignal.timeout(20_000) }));
    expect(error.status).toBe(0);
    expect(error.code).toBe("network");
    expect(error.message).toBe("The server took too long to answer. Check the connection and try again.");
  });

  it("passes the caller's signal to fetch, and rethrows the caller's own abort untouched", async () => {
    const mock = stubFetch(new DOMException("Aborted.", "AbortError"));
    const controller = new AbortController();
    await expect(apiFetch("/api/flags", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(mock.mock.calls[0][1]?.signal).toBe(controller.signal);
  });
});

describe("apiFetch", () => {
  it("returns the parsed body of a successful response", async () => {
    const mock = stubFetch(Response.json([{ id: "s0" }]));
    await expect(apiFetch<{ id: string }[]>("/api/flags")).resolves.toEqual([{ id: "s0" }]);
    const [path, init] = mock.mock.calls[0];
    expect(path).toBe("/api/flags");
    expect(init?.method).toBe("GET");
    expect(init?.credentials).toBe("same-origin");
    expect(init?.body).toBeUndefined();
  });

  it("sends a body as JSON", async () => {
    const mock = stubFetch(Response.json({ ok: true }, { status: 201 }));
    await apiFetch("/api/flags", { method: "POST", body: { tags: ["Wrong form"] } });
    const init = mock.mock.calls[0][1];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"tags":["Wrong form"]}');
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("turns the API's error body into an ApiError with its details", async () => {
    stubFetch(
      Response.json(
        {
          error: {
            code: "personal_data",
            message: "This looks like it contains a phone number.",
            requestId: "req-1",
            findings: [{ kind: "phone", match: "317-555-0142", index: 5 }],
          },
        },
        { status: 422 },
      ),
    );
    const error = await caught(apiFetch("/api/flags", { method: "POST", body: {} }));
    expect(error.status).toBe(422);
    expect(error.code).toBe("personal_data");
    expect(error.message).toBe("This looks like it contains a phone number.");
    expect(error.requestId).toBe("req-1");
    expect(error.findings).toEqual([{ kind: "phone", match: "317-555-0142", index: 5 }]);
    expect(error.issues).toEqual([]);
    expect(errorMessage(error)).toBe("This looks like it contains a phone number.");
  });

  it("carries field issues and the wait time of a rate limit", async () => {
    stubFetch(
      Response.json(
        { error: { code: "rate_limited", message: "Too many requests. Try again in 7 seconds.", requestId: "req-2" } },
        { status: 429, headers: { "Retry-After": "7" } },
      ),
    );
    const limited = await caught(apiFetch("/api/flags", { method: "POST", body: {} }));
    expect(limited.retryAfterSeconds).toBe(7);

    stubFetch(
      Response.json(
        { error: { code: "invalid_input", message: "Some of the information sent is not valid.", requestId: "req-3", issues: [{ path: "rows.3.date", message: "Use a real date in the form YYYY-MM-DD." }] } },
        { status: 400 },
      ),
    );
    const invalid = await caught(apiFetch("/api/import/commit", { method: "POST", body: {} }));
    expect(invalid.issues).toEqual([{ path: "rows.3.date", message: "Use a real date in the form YYYY-MM-DD." }]);
  });

  it("gives a plain message when an error response is not the API's own shape", async () => {
    stubFetch(new Response("<html>Bad gateway</html>", { status: 502 }));
    const gateway = await caught(apiFetch("/api/flags"));
    expect(gateway.status).toBe(502);
    expect(gateway.code).toBe("bad_response");
    expect(gateway.message).toBe("The server could not do that. Try again.");

    stubFetch(new Response("", { status: 401 }));
    const signedOut = await caught(apiFetch("/api/me"));
    expect(signedOut.status).toBe(401);
    expect(signedOut.message).toBe("You are signed out. Sign in to continue.");
  });

  it("reports a request that never reached the server as status 0", async () => {
    stubFetch(new TypeError("fetch failed"));
    const error = await caught(apiFetch("/api/flags"));
    expect(error.status).toBe(0);
    expect(error.code).toBe("network");
    expect(error.message).toBe("Could not reach the server. Check the connection and try again.");
  });

  it("lets an aborted request surface as an abort, not as a network error", async () => {
    stubFetch(new DOMException("The operation was aborted.", "AbortError"));
    await expect(apiFetch("/api/flags")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("refuses a successful response whose body is not JSON", async () => {
    stubFetch(new Response("not json", { status: 200 }));
    const error = await caught(apiFetch("/api/flags"));
    expect(error.code).toBe("bad_response");
  });
});

describe("errorMessage", () => {
  it("never shows the text of an unexpected error", () => {
    expect(errorMessage(new Error("ECONNRESET at socket 0x1f"))).toBe("Something went wrong. Try again.");
    expect(errorMessage("boom")).toBe("Something went wrong. Try again.");
  });
});
