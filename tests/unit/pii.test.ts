import { describe, expect, it } from "vitest";
import { CASE_TYPES, COUNTIES, FORMS, NEEDS_REVIEW, OUTCOMES, TAGS } from "@/lib/domain";
import { PII_LABELS, describePersonalData, findPersonalData } from "@/lib/pii";
import type { PiiKind } from "@/lib/pii";
import { SAMPLE_CSV } from "@/lib/sample";

const kinds = (text: string): PiiKind[] => findPersonalData(text).map((f) => f.kind);
const titleCase = (text: string) => text.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

describe("findPersonalData: what it catches", () => {
  it.each([
    ["see 49D01-2401-SC-000123", "49D01-2401-SC-000123"],
    ["cause no. 45D05-2203-PO-12", "cause no. 45D05-2203-PO-12"],
    ["lowercase 49d01-2401-sc-000123 too", "49d01-2401-sc-000123"],
    ["SC-2024-00123 was refused", "SC-2024-00123"],
    ["24SC001234", "24SC001234"],
    ["case no. 123456", "case no. 123456"],
    ["docket #2024-1182", "docket #2024-1182"],
    ["ref 12345678", "12345678"],
  ])("a case number in %j", (text, match) => {
    expect(findPersonalData(text)).toEqual([{ kind: "case_number", match, index: text.indexOf(match) }]);
  });

  it.each(["call (317) 555-0142", "phone 317-555-0142", "317.555.0142", "3175550142", "+1 317 555 0142"])("a phone number in %j", (text) => {
    expect(kinds(text)).toEqual(["phone"]);
  });

  it.each(["email filer@example.com", "j.q.public+court@mail.example.org"])("an email address in %j", (text) => {
    expect(kinds(text)).toEqual(["email"]);
  });

  it.each(["SSN 123-45-6789 on the form", "ssn 123456789", "123456789", "social security number: 123456789"])("a Social Security number in %j", (text) => {
    expect(kinds(text)).toEqual(["ssn"]);
  });

  it.each([
    "lives at 123 Main St",
    "mail to 4521 N. Meridian Street, Apt 2",
    "1200 west washington blvd",
    "PO Box 1182",
    "served at 77 Oak Ave.",
  ])("a street address in %j", (text) => {
    expect(kinds(text)).toEqual(["address"]);
  });

  it.each([
    ["John Smith did not sign", "John Smith"],
    ["filed by Maria Garcia-Lopez", "Maria Garcia-Lopez"],
    ["Mary J. Watson called", "Mary J. Watson"],
    ["John McDonald signed for her", "John McDonald"],
    ["spoke with Mr. Nguyen", "Mr. Nguyen"],
    ["defendant Kowalski not served", "defendant Kowalski"],
    ["Judge Okafor's order", "Judge Okafor's"],
    ["Tenant O'Brien", "Tenant O'Brien"],
  ])("a name in %j", (text, match) => {
    expect(findPersonalData(text)).toEqual([{ kind: "name", match, index: text.indexOf(match) }]);
  });

  it.each([
    ["José García forgot to sign", "José García"],
    ["María López did not pay", "María López"],
    ["Zoë Müller unsigned", "Zoë Müller"],
    ["filed by Nuñez-Íñiguez Peña", "Nuñez-Íñiguez Peña"],
    ["spoke with Mr. Muñoz", "Mr. Muñoz"],
    ["defendant Żółkiewski not served", "defendant Żółkiewski"],
    ["Renée J. Côté called", "Renée J. Côté"],
    ["Åsa É. Öberg called", "Åsa É. Öberg"],
  ])("a name with a letter outside a to z in %j", (text, match) => {
    expect(findPersonalData(text)).toEqual([{ kind: "name", match, index: text.indexOf(match) }]);
  });

  it("a name whose accents are typed as separate combining marks", () => {
    const decomposed = "José García forgot to sign".normalize("NFD");
    expect(decomposed).not.toBe("José García forgot to sign");
    expect(findPersonalData(decomposed)).toEqual([{ kind: "name", match: "José García", index: 0 }]);
  });

  it.each([
    ["lives at 123 main street", "123 main street"],
    ["sent to 45 elm st", "45 elm st"],
    ["2 copies for 45 Elm Court", "45 Elm Court"],
    ["moved to 9 Peña Court", "9 Peña Court"],
  ])("a street address in %j, in lower case or after a joining word", (text, match) => {
    expect(findPersonalData(text)).toEqual([{ kind: "address", match, index: text.indexOf(match) }]);
  });

  it("a name next to a place name, and a role word followed by a name", () => {
    expect(kinds("Fort Wayne resident John Smith")).toEqual(["name"]);
    expect(kinds("Returned to filer Kowalski")).toEqual(["name"]);
    expect(kinds("South Bend Smith")).toEqual(["name"]);
  });

  it("reports several findings in order of position, without overlaps", () => {
    const text = "John Smith, 317-555-0142, john@example.com, case 49D01-2401-SC-000123";
    const findings = findPersonalData(text);
    expect(findings.map((f) => f.kind)).toEqual(["name", "phone", "email", "case_number"]);
    for (let i = 1; i < findings.length; i++) {
      expect(findings[i].index).toBeGreaterThanOrEqual(findings[i - 1].index + findings[i - 1].match.length);
    }
    for (const finding of findings) expect(text.slice(finding.index, finding.index + finding.match.length)).toBe(finding.match);
  });

  it("returns an empty array for empty text", () => {
    expect(findPersonalData("")).toEqual([]);
    expect(findPersonalData("   ")).toEqual([]);
  });
});

describe("findPersonalData: what it must leave alone", () => {
  const vocabulary = [
    ...COUNTIES,
    ...COUNTIES.map((county) => `${county} County`),
    ...COUNTIES.map((county) => `Filed in ${county} County Superior Court`),
    ...CASE_TYPES,
    ...FORMS,
    ...TAGS,
    ...OUTCOMES,
    NEEDS_REVIEW,
    ...FORMS.map(titleCase),
    ...TAGS.map(titleCase),
    ...CASE_TYPES.map(titleCase),
    ...OUTCOMES.map(titleCase),
  ];

  it.each(vocabulary)("reference value %j", (text) => {
    expect(findPersonalData(text)).toEqual([]);
  });

  it("every reference value written in capitals", () => {
    for (const text of vocabulary) expect(findPersonalData(text.toUpperCase())).toEqual([]);
  });

  it.each(SAMPLE_CSV.split("\n"))("sample export line %j", (line) => {
    expect(findPersonalData(line)).toEqual([]);
  });

  it.each([
    "St. Joseph County Small Claims",
    "Marion Superior Court, Small Claims Division",
    "Missing Signature On Page 2",
    "Filed on 2026-09-02, returned 2026-09-05",
    "June 1, 2026",
    "Returned on Monday, October 5",
    "page 2 of the small claims court form",
    "page 3 missing / scan unreadable",
    "needs 2 copies and a $157 filing fee",
    "used the 2019 version of the form",
    "IC 34-28-2-1 not cited",
    "Ind. Trial Rule 4.1",
    "called filer at the counter - will bring in tomorrow",
    "Notary Public stamp missing",
    "Self-Help Center gave the wrong packet",
    "Fee Waiver form not attached",
    "Income Verification missing",
    "Proof Of Service not filed",
    "Tenant Answer filed without signature",
    "Petitioner did not sign",
    "Defendant address is missing",
    "defendant lives in Marion",
    "3 pages blank",
    "form CCS-1 rev 2",
    "The Clerk returned it",
    "E-filing rejected twice",
    "Odyssey shows no fee",
    "Verified Petition not notarized",
    "Child Support Worksheet missing",
    "Sample change: Marion County small claims court adds a clearer signature box",
    "Most common problems: Marion, Small claims",
    "NO SIGNATURE ON PAGE 2. RETURNED TO FILER.",
  ])("everyday clerk text %j", (text) => {
    expect(findPersonalData(text)).toEqual([]);
  });

  it.each([
    "Filed 2 days late in wrong court",
    "10 days before court date, no fee paid",
    "2 weeks before court",
    "3 days late for court",
    "filed 14 days after the court date",
    "sent 2 copies to the wrong court",
  ])("a number and the word court in one sentence: %j", (text) => {
    expect(findPersonalData(text)).toEqual([]);
  });

  it.each(["Returned to filer. Forgot page 2.", "Missing signature of landlord. Refused at counter.", "Not signed by tenant. Returned.", "Sent back to petitioner. Unsigned."])(
    "a role word that ends a sentence: %j",
    (text) => {
      expect(findPersonalData(text)).toEqual([]);
    },
  );

  it.each(["Should have been filed in Fort Wayne", "South Bend", "Crown Point", "West Lafayette", "belongs in Terre Haute, not here", "Filed in Fort  Wayne by mistake"])(
    "an Indiana place name of two words: %j",
    (text) => {
      expect(findPersonalData(text)).toEqual([]);
    },
  );

  it("does not read a date as a phone number, a Social Security number or a case number", () => {
    expect(findPersonalData("2026-09-02")).toEqual([]);
    expect(findPersonalData("between 2026-01-01 and 2026-10-28")).toEqual([]);
  });

  it("does not read St. Joseph as a street", () => {
    expect(findPersonalData("moved 2 filings to St. Joseph")).toEqual([]);
    expect(findPersonalData("3 from the old St. Joseph form")).toEqual([]);
  });

  it("does not read one capitalized word as a name", () => {
    expect(findPersonalData("Returned. Unsigned. Bring tomorrow.")).toEqual([]);
    expect(findPersonalData("Filed in Porter instead")).toEqual([]);
  });
});

describe("describePersonalData", () => {
  it("is empty when there is nothing to describe", () => {
    expect(describePersonalData([])).toBe("");
  });

  it("names one kind", () => {
    expect(describePersonalData(findPersonalData("call 317-555-0142"))).toBe(
      "This looks like it contains a phone number. The tracker does not store anything that identifies a person.",
    );
  });

  it("names several kinds once each, in a fixed order", () => {
    const findings = findPersonalData("John Smith and Jane Jones, 317-555-0142, case 49D01-2401-SC-000123");
    expect(describePersonalData(findings)).toBe(
      "This looks like it contains a case number, a phone number and a person's name. The tracker does not store anything that identifies a person.",
    );
  });

  it("has a label for every kind", () => {
    expect(Object.keys(PII_LABELS).sort()).toEqual(["address", "case_number", "email", "name", "phone", "ssn"]);
  });
});
