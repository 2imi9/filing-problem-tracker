import type { ImportPreviewResponse, ImportPreviewRow } from "@/lib/api";
import { checkCsvRows, rowsFromCsv } from "@/lib/csv";
import { NEEDS_REVIEW } from "@/lib/domain";
import { ImportPreviewInput } from "@/lib/schemas";
import { classifyReasons } from "@/server/ai/classify";
import { requireSession } from "@/server/auth/session";
import { appToday } from "@/server/clock";
import { AI_ENABLED } from "@/server/config";
import { HttpError, handle } from "@/server/http";
import { enforceRateLimit } from "@/server/ratelimit";

// With AI on, sorting a large export takes several Claude requests under a shared 60 second deadline.
export const maxDuration = 90;

// Reads a pasted or uploaded export and shows what would be added. Nothing is saved.
// Rows that fail a check (unknown county, bad date, personal data in the reason, another county for a
// clerk) come back in `rejected` with the reason, and are never classified or sent to the AI.
export const POST = handle(async ({ json }): Promise<ImportPreviewResponse> => {
  const session = await requireSession(["clerk", "admin"]);
  await enforceRateLimit(session.id, "mutation");
  const body = ImportPreviewInput.parse(await json());

  if (session.role === "clerk" && !session.county) throw new HttpError(403, "Your account has no county assigned.");
  const parsed = rowsFromCsv(body.csv);
  if (!parsed.ok) throw new HttpError(400, parsed.error, { code: "invalid_csv" });
  const { accepted, rejected } = checkCsvRows(parsed.rows, {
    todayIso: appToday(),
    onlyCounty: session.role === "clerk" ? session.county : null,
  });

  const useAi = body.useAi === true && AI_ENABLED;
  if (useAi) await enforceRateLimit(session.id, "ai");
  const results = await classifyReasons(
    accepted.map((row) => ({ id: String(row.line), reason: row.reason })),
    { useAi },
  );
  const byId = new Map(results.map((result) => [result.id, result]));

  const rows: ImportPreviewRow[] = accepted.map((row) => {
    const result = byId.get(String(row.line));
    // A row the classifier did not answer goes to a person.
    return result
      ? { ...row, tags: result.tags, confidence: result.confidence, source: result.source }
      : { ...row, tags: [NEEDS_REVIEW], confidence: "low", source: "rules" };
  });
  const needsReview = rows.filter((row) => row.tags.includes(NEEDS_REVIEW)).length;

  return {
    rows,
    rejected,
    summary: {
      read: parsed.rows.length,
      accepted: rows.length,
      sorted: rows.length - needsReview,
      needsReview,
      rejected: rejected.length,
    },
    classifier: { used: rows.some((row) => row.source === "ai") ? "ai" : "rules", aiAvailable: AI_ENABLED },
  };
});
