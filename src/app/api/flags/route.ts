import { describePersonalData, findPersonalData } from "@/lib/pii";
import { parseNewFlagInput } from "@/lib/schemas";
import { audit } from "@/server/audit";
import { requireSession } from "@/server/auth/session";
import { appToday } from "@/server/clock";
import { HttpError, handle } from "@/server/http";
import { enforceRateLimit } from "@/server/ratelimit";
import { getRepository } from "@/server/repo";

// Every flag the caller may see, without notes or raw reasons.
export const GET = handle(async () => {
  const session = await requireSession();
  const repo = await getRepository(session);
  return repo.listFlags();
});

// Tags one filing. A note that looks like it holds personal data is refused with 422 and the findings.
export const POST = handle(async ({ json }) => {
  const session = await requireSession(["clerk", "admin"]);
  await enforceRateLimit(session.id, "mutation");
  const input = parseNewFlagInput(await json(), appToday());
  if (input.note) {
    const findings = findPersonalData(input.note);
    if (findings.length > 0) {
      throw new HttpError(422, describePersonalData(findings), { code: "personal_data", details: { findings } });
    }
  }
  const repo = await getRepository(session);
  const flag = await repo.createFlag(input);
  await audit(session, "flag.create", "flag", flag.id, {
    county: flag.county,
    caseType: flag.caseType,
    problems: flag.tags.length,
    hasNote: flag.note !== null,
  });
  return Response.json(flag, { status: 201 });
});
