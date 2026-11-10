import { describe, expect, it } from "vitest";
import { SAMPLE_TODAY } from "@/lib/sample";
import { addMonths, daysInMonth, formatDate, isIsoDate, isMonth, monthLabel, monthOf, monthShort, monthsBetween, todayIso } from "@/lib/time";

describe("time helpers", () => {
  it("todayIso is the sample data's today in demo mode, whatever the clock says", () => {
    expect(todayIso("demo", new Date("2031-03-04T10:00:00Z"))).toBe(SAMPLE_TODAY);
    expect(SAMPLE_TODAY).toBe("2026-10-30");
  });

  it("todayIso is the Indianapolis calendar day otherwise", () => {
    expect(todayIso("supabase", new Date("2027-02-10T15:00:00Z"))).toBe("2027-02-10");
    // 03:30 UTC is still the evening before in Indianapolis (UTC-5 in winter, UTC-4 in summer).
    expect(todayIso("supabase", new Date("2027-02-10T03:30:00Z"))).toBe("2027-02-09");
    expect(todayIso("supabase", new Date("2027-07-01T03:30:00Z"))).toBe("2027-06-30");
    expect(todayIso("supabase", new Date("2027-07-01T04:30:00Z"))).toBe("2027-07-01");
  });

  it("isIsoDate accepts real calendar dates only", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-04-31")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-00-10")).toBe(false);
    expect(isIsoDate("2026-1-5")).toBe(false);
    expect(isIsoDate("09/02/2026")).toBe(false);
    expect(isIsoDate("2026-09-02T00:00:00Z")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });

  it("daysInMonth knows leap years", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(2026, 9)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("month helpers", () => {
    expect(isMonth("2026-06")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("2026-6")).toBe(false);
    expect(monthOf("2026-06-15")).toBe("2026-06");
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-06", -12)).toBe("2025-06");
    expect(addMonths("2026-06", 0)).toBe("2026-06");
    expect(monthsBetween("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monthsBetween("2026-03", "2026-03")).toEqual(["2026-03"]);
    expect(monthsBetween("2026-04", "2026-03")).toEqual([]);
    expect(monthShort("2026-06")).toBe("Jun");
    expect(monthLabel("2026-06")).toBe("Jun 2026");
    expect(formatDate("2026-06-01")).toBe("Jun 1, 2026");
    expect(formatDate("2026-12-25")).toBe("Dec 25, 2026");
  });
});
