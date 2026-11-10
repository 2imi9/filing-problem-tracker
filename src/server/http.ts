import "server-only";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import type { ApiErrorBody, ApiErrorCode, ApiIssue } from "@/lib/api";
import { APP_ORIGIN, LIMITS } from "./config";
import { runWithRequestContext } from "./requestContext";

const DEFAULT_CODES: Record<number, ApiErrorCode> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "payload_too_large",
  415: "unsupported_media_type",
  422: "unprocessable",
  429: "rate_limited",
  501: "not_implemented",
  503: "unavailable",
};

export interface HttpErrorOptions {
  code?: ApiErrorCode;
  /** Extra fields for the error body, for example `{ findings }`. Must be safe to show the caller. */
  details?: Record<string, unknown>;
  /** Extra response headers, for example `Retry-After`. */
  headers?: Record<string, string>;
}

/** An error with an HTTP status and a message that is safe to show the caller. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: Record<string, unknown> | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(status: number, message: string, options: HttpErrorOptions = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = options.code ?? DEFAULT_CODES[status] ?? "internal";
    this.details = options.details;
    this.headers = options.headers;
  }
}

export interface HandlerContext<P> {
  request: Request;
  requestId: string;
  /** The route's dynamic segments, already awaited. */
  params: P;
  /** The query string. */
  query: URLSearchParams;
  /** The JSON body. Throws HttpError 415, 413 or 400 when it is not usable. Validate the result with Zod. */
  json(): Promise<unknown>;
}

export interface HandleOptions {
  /**
   * State-changing requests (anything but GET, HEAD and OPTIONS) must come from the app's own origin.
   * Set to false only for endpoints called by other programs with their own credentials, such as /api/mcp.
   */
  checkOrigin?: boolean;
}

export type RouteHandler<P> = (request: Request, context: { params: Promise<P> }) => Promise<Response>;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Refuses a request that a browser sent from another site. Browsers attach Origin to every
 * state-changing request; a request with neither Origin nor Sec-Fetch-Site did not come from a browser
 * page and carries no ambient cookies worth forging.
 */
export function assertSameOrigin(request: Request): void {
  const refuse = () => new HttpError(403, "This request came from another site and was refused.", { code: "bad_origin" });
  const origin = request.headers.get("origin");
  if (origin === null) {
    const site = request.headers.get("sec-fetch-site");
    if (site !== null && site !== "same-origin" && site !== "none") throw refuse();
    return;
  }
  if (APP_ORIGIN) {
    if (origin !== APP_ORIGIN) throw refuse();
    return;
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw refuse();
  }
  const ownHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  if (originHost !== ownHost) throw refuse();
}

async function readJson(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "Send the request body as JSON (Content-Type: application/json).");
  }
  const tooLarge = () => new HttpError(413, "The request is too large.");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > LIMITS.maxBodyBytes) throw tooLarge();
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > LIMITS.maxBodyBytes) throw tooLarge();
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "The request body is not valid JSON.", { code: "invalid_json" });
  }
}

function errorBody(code: ApiErrorCode, message: string, requestId: string, details?: Record<string, unknown>): ApiErrorBody {
  return { error: { ...details, code, message, requestId } };
}

function toErrorResponse(error: unknown, requestId: string): Response {
  if (error instanceof HttpError) {
    return Response.json(errorBody(error.code, error.message, requestId, error.details), {
      status: error.status,
      headers: error.headers,
    });
  }
  if (error instanceof ZodError) {
    // Paths and messages only. The rejected values are never echoed back or logged.
    const issues: ApiIssue[] = error.issues.slice(0, 50).map((issue) => ({ path: issue.path.join("."), message: issue.message }));
    return Response.json(errorBody("invalid_input", "Some of the information sent is not valid.", requestId, { issues }), { status: 400 });
  }
  return Response.json(errorBody("internal", "Something went wrong on the server. Nothing was saved.", requestId), { status: 500 });
}

/**
 * Wraps a route handler. It assigns a request id, refuses cross-site state-changing requests, gives the
 * handler a JSON body reader, turns a returned value into a JSON response, maps ZodError to 400 and
 * HttpError to its status, answers anything else with a generic 500, and logs one JSON line per request:
 * {requestId, method, route, userId, status, ms}. Stack traces are logged, never returned.
 *
 * The handler may return a Response, or any JSON value (sent with status 200).
 */
export function handle<P = object>(fn: (context: HandlerContext<P>) => Promise<unknown>, options: HandleOptions = {}): RouteHandler<P> {
  return async (request, routeContext) => {
    // Touch the request first: reading it is what marks the route as request-time for the framework.
    const method = request.method;
    const url = new URL(request.url);
    const started = performance.now();
    const requestId = randomUUID();
    const state = { requestId, userId: null as string | null };

    let response: Response;
    let failure: unknown = null;
    try {
      response = await runWithRequestContext(state, async () => {
        if (options.checkOrigin !== false && !SAFE_METHODS.has(method)) assertSameOrigin(request);
        const params = await routeContext.params;
        const result = await fn({ request, requestId, params, query: url.searchParams, json: () => readJson(request) });
        return result instanceof Response ? result : Response.json(result ?? null);
      });
    } catch (error) {
      response = toErrorResponse(error, requestId);
      if (response.status >= 500) failure = error;
    }

    const headers = new Headers(response.headers);
    headers.set("x-request-id", requestId);
    if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
    const out = new Response(response.body, { status: response.status, statusText: response.statusText, headers });

    const line: Record<string, unknown> = {
      requestId,
      method,
      route: url.pathname,
      userId: state.userId,
      status: out.status,
      ms: Math.round(performance.now() - started),
    };
    if (failure !== null) {
      line.error = failure instanceof Error ? { name: failure.name, message: failure.message, stack: failure.stack } : { message: String(failure) };
      console.error(JSON.stringify(line));
    } else {
      console.log(JSON.stringify(line));
    }
    return out;
  };
}
