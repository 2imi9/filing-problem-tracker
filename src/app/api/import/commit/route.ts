import { ZodError } from "zod";
import type { ApiRowFindings, ImportCommitResponse } from "@/lib/api";
import { MAX_CSV_ROWS } from "@/lib/csv";
import { NEEDS_REVIEW } from "@/lib/domain";
import { describePersonalData, findPersonalData } from "@/lib/pii";
import { ImportCommitInput, parseImportRow } from "@/lib/schemas";
import type { ImportRow } from "@/lib/schemas";
import { audit } from "@/server/audit";
import { requireSession } from "@/server/auth/session";
import { appToday } from "@/server/clock";
import { HttpError, handle } from "@/server/http";
import { enforceRateLimit } from "@/server/ratelimit";
import { getRepository } from "@/server/repo";

const MAX_REPORTED = 50;

// Saves the reviewed rows as one batch. Nothing from the preview is trusted: every row is validated
// again, every reason is checked for personal data again, and the repository applies the county rule.
// The batch name is stored too, so it gets the same personal data check as a reason.
// If any row fails, nothing is saved.
export const POST = handle(async ({ json }) => {
  const session = await requireSession(["clerk", "admin"]);
  await enforceRateLimit(session.id, "mutation");
  const body = ImportCommitInput.parse(await json());
  if (body.rows.length > MAX_CSV_ROWS) {
    throw new HttpError(413, `At most ${MAX_CSV_ROWS.toLocaleString("en-US")} rows can be added at once.`);
  }

  const nameFindings = findPersonalData(body.batchName ?? "");
  if (nameFindings.length > 0) {
    throw new HttpError(422, `The batch name: ${describePersonalData(nameFindings)} Nothing was added.`, { code: "personal_data", details: { findings: nameFindings } });
  }

  const today = appToday();
  const rows: ImportRow[] = [];
  const issues: ZodError["issues"] = [];
  const flagged: ApiRowFindings[] = [];
  body.rows.forEach((raw, index) => {
    try {
      const row = parseImportRow(raw, today);
      const findings = findPersonalData(row.reason);
      if (findings.length > 0) flagged.push({ row: index, findings });
      rows.push(row);
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      for (const issue of error.issues) issues.push({ ...issue, path: ["rows", index, ...issue.path] });
    }
  });
  if (issues.length > 0) throw new ZodError(issues);
  if (flagged.length > 0) {
    const message =
      flagged.length === 1
        ? "1 row has a reason that looks like it contains personal data. Nothing was added."
        : `${flagged.length} rows have reasons that look like they contain personal data. Nothing was added.`;
    throw new HttpError(422, message, { code: "personal_data", details: { rows: flagged.slice(0, MAX_REPORTED) } });
  }

  const batchName = body.batchName || `Import ${today}`;
  const repo = await getRepository(session);
  const result: ImportCommitResponse = await repo.createFlags(rows, batchName);
  await audit(session, "import.commit", "import_batch", result.batchId, {
    rows: result.inserted,
    needsReview: rows.filter((row) => row.tags.includes(NEEDS_REVIEW)).length,
  });
  return Response.json(result, { status: 201 });
});
