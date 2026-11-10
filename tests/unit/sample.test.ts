import { describe, expect, it } from "vitest";
import { CASES, COUNTIES, OUTCOMES, TAGS, formMatchesCaseType } from "@/lib/domain";
import { checkCsvRows, rowsFromCsv } from "@/lib/csv";
import { findPersonalData } from "@/lib/pii";
import { DEMO_USERS, DEMO_USER_IDS, SAMPLE_CSV, SAMPLE_EVENTS, SAMPLE_TODAY, demoUserById, makeSampleRecords, sampleCsv } from "@/lib/sample";
import { ChangeEventInput } from "@/lib/schemas";
import { countTags, rank } from "@/lib/stats";

describe("sample data generator", () => {
  const records = makeSampleRecords();

  it("makes 900 records, the same every time", () => {
    expect(records).toHaveLength(900);
    expect(makeSampleRecords()).toEqual(records);
    expect(new Set(records.map((r) => r.id)).size).toBe(900);
  });

  it("reproduces the prototype's numbers (seed 4535, same order of random draws)", () => {
    // These counts were read from the prototype's own script, run in Indiana time.
    expect(countTags(records)).toEqual({
      "Missing required details": 284,
      "Missing signature": 249,
      "Wrong county or court": 159,
      "Missing addresses for service": 153,
      "Wrong form": 141,
      "Not verified or notarized": 138,
      "Missing fee or fee waiver": 122,
      "Pages missing or unreadable": 80,
      "Citation not found or wrong": 72,
    });
    expect(rank(countTags(records), 900).slice(0, 3).map((r) => r.label)).toEqual([
      "Missing required details",
      "Missing signature",
      "Wrong county or court",
    ]);
    expect(records.filter((r) => r.county === "Marion")).toHaveLength(284);
    expect(records.filter((r) => r.outcome === "Rejected")).toHaveLength(387);
    expect(records.filter((r) => r.outcome === "Returned to fix")).toHaveLength(337);
    expect(records.filter((r) => r.outcome === "Fixed at counter")).toHaveLength(176);
    expect(records.filter((r) => r.tags.length > 1)).toHaveLength(403);
    expect(records[0]).toMatchObject({ id: "s0", date: "2026-05-08", source: "sample" });
  });

  it("does not depend on the machine's time zone", () => {
    const saved = process.env.TZ;
    try {
      const dates = ["UTC", "Asia/Tokyo", "America/Los_Angeles"].map((zone) => {
        process.env.TZ = zone;
        return makeSampleRecords().map((r) => r.date).join(",");
      });
      expect(dates[1]).toBe(dates[0]);
      expect(dates[2]).toBe(dates[0]);
      expect(dates[0]).toBe(records.map((r) => r.date).join(","));
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });

  it("uses only reference values, valid dates in range, and one to three distinct problems", () => {
    for (const r of records) {
      expect(COUNTIES).toContain(r.county);
      expect(Object.keys(CASES)).toContain(r.caseType);
      expect(formMatchesCaseType(r.form, r.caseType)).toBe(true);
      expect(OUTCOMES).toContain(r.outcome);
      expect(r.tags.length).toBeGreaterThanOrEqual(1);
      expect(r.tags.length).toBeLessThanOrEqual(3);
      expect(new Set(r.tags).size).toBe(r.tags.length);
      for (const tag of r.tags) expect(TAGS).toContain(tag);
      expect(r.date >= "2026-01-01" && r.date <= "2026-10-28").toBe(true);
      expect(r.date <= SAMPLE_TODAY).toBe(true);
    }
  });

  it("holds no free text and no author", () => {
    for (const r of records) {
      expect(r.note).toBeNull();
      expect(r.reason).toBeNull();
      expect(r.createdBy).toBeNull();
      expect(r.batchId).toBeNull();
    }
  });
});

describe("sample change events", () => {
  it("are three valid change events with stable ids", () => {
    expect(SAMPLE_EVENTS.map((e) => e.id)).toEqual(["sc-form", "po-guide", "fam-kiosk"]);
    for (const event of SAMPLE_EVENTS) {
      expect(ChangeEventInput.safeParse(event).success).toBe(true);
      expect(event.date <= SAMPLE_TODAY).toBe(true);
    }
  });

  it("have names and descriptions the personal data check lets through", () => {
    for (const event of SAMPLE_EVENTS) {
      expect(findPersonalData(event.name)).toEqual([]);
      expect(findPersonalData(event.description)).toEqual([]);
    }
  });
});

describe("sample CSV", () => {
  it("is the prototype's ten-row export and every row passes the checks", () => {
    const parsed = rowsFromCsv(SAMPLE_CSV);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toHaveLength(10);
    const { accepted, rejected } = checkCsvRows(parsed.rows, { todayIso: SAMPLE_TODAY });
    expect(rejected).toEqual([]);
    expect(accepted).toHaveLength(10);
    expect(accepted[2].form).toBe("Petition for dissolution, with children");
  });

  it("can be written for one county, so a clerk's example is accepted", () => {
    const parsed = rowsFromCsv(sampleCsv("Lake"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(new Set(parsed.rows.map((r) => r.county))).toEqual(new Set(["Lake"]));
    expect(checkCsvRows(parsed.rows, { todayIso: SAMPLE_TODAY, onlyCounty: "Lake" }).rejected).toEqual([]);
  });
});

describe("demo users", () => {
  it("are a Marion clerk, a Lake clerk, a leader and an admin with fixed ids", () => {
    expect(DEMO_USERS.map((u) => [u.id, u.role, u.county])).toEqual([
      ["demo-clerk-marion", "clerk", "Marion"],
      ["demo-clerk-lake", "clerk", "Lake"],
      ["demo-leader", "leader", null],
      ["demo-admin", "admin", null],
    ]);
    expect(DEMO_USER_IDS).toEqual(["demo-clerk-marion", "demo-clerk-lake", "demo-leader", "demo-admin"]);
  });

  it("demoUserById returns a plain session user, or null", () => {
    expect(demoUserById("demo-clerk-lake")).toEqual({ id: "demo-clerk-lake", email: "clerk.lake@demo.invalid", role: "clerk", county: "Lake" });
    expect(demoUserById("someone-else")).toBeNull();
  });
});
