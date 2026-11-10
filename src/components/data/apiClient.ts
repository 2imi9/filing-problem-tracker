// The one way client components talk to the app's own HTTP API.
//
//   const flags = await apiFetch<LeanFlag[]>("/api/flags");
//   const saved = await apiFetch<FlagRecord>("/api/flags", { method: "POST", body: input });
//   await apiFetch<OkResponse>(`/api/flags/${id}`, { method: "DELETE" });
//
// `body` is any JSON value; it is serialized and sent with the JSON content type.
// A response that is not 2xx throws ApiError, which carries the server's plain-language message and the
// rest of the error body (code, issues, findings, rows, requestId). A request that never reaches the
// server (offline, DNS) or runs past the deadline of an AbortSignal.timeout() throws ApiError with status 0
// and code "network". A request the caller aborted rethrows the AbortError.
// errorMessage(error) turns anything caught into a sentence that is safe to show.

import type { ApiErrorBody, ApiErrorCode, ApiIssue, ApiRowFindings } from "@/lib/api";
import type { PiiFinding } from "@/lib/pii";

export type ClientErrorCode = ApiErrorCode | "network" | "bad_response";

export class ApiError extends Error {
  /** HTTP status, or 0 when the request did not reach the server. */
  readonly status: number;
  readonly code: ClientErrorCode;
  /** Quote this when reporting a problem. Null when the server sent none. */
  readonly requestId: string | null;
  /** With code "invalid_input": which fields were refused. */
  readonly issues: ApiIssue[];
  /** With code "personal_data" on a note: what was found. */
  readonly findings: PiiFinding[];
  /** With code "personal_data" on an import: what was found, by row index. */
  readonly rows: ApiRowFindings[];
  /** With status 429: seconds to wait, when the server said. */
  readonly retryAfterSeconds: number | null;

  constructor(
    status: number,
    code: ClientErrorCode,
    message: string,
    extra: { requestId?: string | null; issues?: ApiIssue[]; findings?: PiiFinding[]; rows?: ApiRowFindings[]; retryAfterSeconds?: number | null } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = extra.requestId ?? null;
    this.issues = extra.issues ?? [];
    this.findings = extra.findings ?? [];
    this.rows = extra.rows ?? [];
    this.retryAfterSeconds = extra.retryAfterSeconds ?? null;
  }
}

export interface ApiFetchOptions {
  /** Default "GET". */
  method?: "GET" | "POST" | "DELETE";
  /** A JSON value to send. */
  body?: unknown;
  signal?: AbortSignal;
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const error = (value as { error: unknown }).error;
  return typeof error === "object" && error !== null && "message" in error && "code" in error;
}

const FALLBACK_MESSAGES: Record<number, string> = {
  401: "You are signed out. Sign in to continue.",
  403: "Your role does not allow this.",
  404: "That was not found.",
  413: "That is too large to send.",
  429: "Too many requests. Wait a moment and try again.",
};

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { method = "GET", body, signal } = options;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      signal,
      credentials: "same-origin",
      cache: "no-store",
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    if (cause instanceof DOMException && cause.name === "TimeoutError") {
      throw new ApiError(0, "network", "The server took too long to answer. Check the connection and try again.");
    }
    throw new ApiError(0, "network", "Could not reach the server. Check the connection and try again.");
  }

  let parsed: unknown = null;
  let readable = true;
  try {
    const text = await response.text();
    parsed = text === "" ? null : JSON.parse(text);
  } catch {
    readable = false;
  }

  if (response.ok) {
    if (!readable) throw new ApiError(response.status, "bad_response", "The server sent a reply that could not be read. Try again.");
    return parsed as T;
  }

  const retryAfter = Number(response.headers.get("retry-after"));
  const retryAfterSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null;
  if (isErrorBody(parsed)) {
    const { error } = parsed;
    throw new ApiError(response.status, error.code, error.message, {
      requestId: error.requestId,
      issues: error.issues,
      findings: error.findings,
      rows: error.rows,
      retryAfterSeconds,
    });
  }
  throw new ApiError(response.status, "bad_response", FALLBACK_MESSAGES[response.status] ?? "The server could not do that. Try again.", {
    requestId: response.headers.get("x-request-id"),
    retryAfterSeconds,
  });
}

/** A sentence that is safe to show for anything caught around an apiFetch call. */
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Try again.";
}
