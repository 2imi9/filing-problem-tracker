import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

// Per-request state, so the request log line can name the user without every handler passing it along.

interface RequestContext {
  requestId: string;
  userId: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn);
}

/** Records who is making the current request. Does nothing outside a request handled by `handle()`. */
export function noteRequestUser(userId: string): void {
  const context = storage.getStore();
  if (context) context.userId = userId;
}

/** The id of the request being handled, or null outside one. */
export function currentRequestId(): string | null {
  return storage.getStore()?.requestId ?? null;
}
