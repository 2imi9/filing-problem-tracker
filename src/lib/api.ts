// The shapes the HTTP API sends back, shared by the route handlers and the client. Types only.

import type { AppMode, CaseType, County, FlagTag, Form, SessionUser } from "./domain";
import type { RejectedRow } from "./csv";
import type { PiiFinding } from "./pii";

export type ApiErrorCode =
  | "bad_request"
  | "invalid_json"
  | "invalid_input"
  | "invalid_csv"
  | "unauthorized"
  | "forbidden"
  | "bad_origin"
  | "not_found"
  | "conflict"
  | "payload_too_large"
  | "unsupported_media_type"
  | "unprocessable"
  | "personal_data"
  | "rate_limited"
  | "not_implemented"
  | "unavailable"
  | "internal";

export interface ApiIssue {
  /** Dotted path to the field, for example "tags" or "rows.3.date". */
  path: string;
  message: string;
}

/** Personal data found in one row of an import commit. `row` is the index in the `rows` array sent. */
export interface ApiRowFindings {
  row: number;
  findings: PiiFinding[];
}

/** Every error response has this body. `message` is plain language and safe to show. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    /** Also sent as the x-request-id header. Quote it when reporting a problem. */
    requestId: string;
    /** With `invalid_input`: which fields were refused. */
    issues?: ApiIssue[];
    /** With `personal_data` on a note: what was found. */
    findings?: PiiFinding[];
    /** With `personal_data` on an import commit: what was found, by row. */
    rows?: ApiRowFindings[];
  };
}

/** GET /api/health */
export interface HealthResponse {
  ok: true;
  mode: AppMode;
  /** True when AI features are switched on. */
  ai: boolean;
  /** The name of the configured model when AI is on, so the page can say which model it is. Null when AI is off. */
  aiModel: string | null;
  /** Server time, ISO. */
  time: string;
}

/** GET /api/me */
export interface MeResponse {
  user: SessionUser;
  mode: AppMode;
  ai: boolean;
  /** The name of the configured model when AI is on, otherwise null. */
  aiModel: string | null;
  /** The app's today, YYYY-MM-DD. In demo mode this is the sample data's fixed today. */
  today: string;
}

/** POST /api/demo/login */
export interface DemoLoginResponse {
  user: SessionUser;
}

/** DELETE routes, restore, logout and reset. */
export interface OkResponse {
  ok: true;
}

export type Confidence = "high" | "medium" | "low";
export type ClassifierSource = "ai" | "rules";

/** One accepted row of an import preview. Send these back (as ImportRow) to commit. */
export interface ImportPreviewRow {
  /** Position among the file's data rows, starting at 1. */
  line: number;
  date: string;
  county: County;
  caseType: CaseType;
  form: Form;
  reason: string;
  tags: FlagTag[];
  confidence: Confidence;
  source: ClassifierSource;
}

/** POST /api/import/preview. Nothing has been saved. */
export interface ImportPreviewResponse {
  rows: ImportPreviewRow[];
  rejected: RejectedRow[];
  summary: {
    /** Data rows in the file. */
    read: number;
    accepted: number;
    /** Accepted rows that got at least one problem. */
    sorted: number;
    /** Accepted rows marked Needs review. */
    needsReview: number;
    rejected: number;
  };
  /** Which classifier answered. `aiAvailable` is false when no API key is configured. */
  classifier: { used: ClassifierSource; aiAvailable: boolean };
}

/** POST /api/import/commit */
export interface ImportCommitResponse {
  batchId: string;
  inserted: number;
}
