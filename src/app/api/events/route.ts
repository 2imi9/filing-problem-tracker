import { describePersonalData, findPersonalData } from "@/lib/pii";
import { parseChangeEventInput } from "@/lib/schemas";
import { audit } from "@/server/audit";
import { requireSession } from "@/server/auth/session";
import { appToday } from "@/server/clock";
import { HttpError, handle } from "@/server/http";
import { enforceRateLimit } from "@/server/ratelimit";
import { getRepository } from "@/server/repo";

// The changes the before/after panel can measure. Every signed-in user can read them.
export const GET = handle(async () => {
  const session = await requireSession();
  const repo = await getRepository(session);
  return repo.listEvents();
});

// Adds a change, or replaces the one with the given id. Admins only.
//
// Every signed-in person reads a change's name and description, so identifiers are refused here: a case
// number, a phone number, an email address, a Social Security number or a street address. The "looks
// like a person's name" pattern is left to the form's warning, because the names of programs, forms and
// places ("Self Help Kiosk") look the same to it and belong in a change.
export const POST = handle(async ({ json }) => {
  const session = await requireSession(["admin"]);
  await enforceRateLimit(session.id, "mutation");
  const input = parseChangeEventInput(await json(), appToday());
  const findings = findPersonalData(`${input.name}\n${input.description}`).filter((finding) => finding.kind !== "name");
  if (findings.length > 0) {
    throw new HttpError(422, describePersonalData(findings), { code: "personal_data", details: { findings } });
  }
  const repo = await getRepository(session);
  const event = await repo.upsertEvent(input);
  await audit(session, "event.save", "event", event.id, {
    county: event.county,
    caseType: event.caseType,
    tag: event.tag,
    date: event.date,
    replaced: input.id !== undefined,
  });
  return Response.json(event, { status: input.id === undefined ? 201 : 200 });
});
