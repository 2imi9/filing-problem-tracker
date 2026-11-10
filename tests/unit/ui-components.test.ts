// Markup checks for the shared UI kit: the accessibility wiring teammates rely on.
// Components are rendered to static HTML; no browser is involved.

import { createElement } from "react";
import type { FunctionComponent, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BeforeAfterIllustration, CounterIllustration, LeaderIllustration } from "@/app/how-it-works/illustrations";
import { DEMO_FLAG_TEXT, DemoFlag } from "@/components/shell/DemoFlag";
import { aiUseText, footerText } from "@/components/shell/footerText";
import { Mark } from "@/components/shell/Mark";
import { Page } from "@/components/shell/Page";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { Chip, ChipGroup, RemovableChip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorSummary } from "@/components/ui/ErrorSummary";
import { Checkbox, TextInput } from "@/components/ui/Field";
import { ICON_NAMES, Icon } from "@/components/ui/Icon";
import { OutcomePill, Pill, TagPill } from "@/components/ui/Pill";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";

const noop = () => undefined;
const html = renderToStaticMarkup;

/** createElement for a component whose `children` prop is required: the children go in as an argument. */
function withChildren<P extends { children: ReactNode }>(type: FunctionComponent<P>, props: Omit<P, "children">, children: ReactNode) {
  // Safe: React adds the third argument to the props as `children` before the component sees them.
  return createElement(type, props as P, children);
}

describe("Icon", () => {
  it("is hidden from screen readers unless it has a label", () => {
    expect(html(createElement(Icon, { name: "tag" }))).toContain('aria-hidden="true"');
    const labelled = html(createElement(Icon, { name: "alert", label: "Error" }));
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Error"');
    expect(labelled).not.toContain("aria-hidden");
  });

  it("draws every icon as a stroke on the 24px grid", () => {
    for (const name of ICON_NAMES) {
      const markup = html(createElement(Icon, { name }));
      expect(markup).toContain('viewBox="0 0 24 24"');
      expect(markup).toContain('stroke-width="1.5"');
      expect(markup).toMatch(/<(path|circle|rect)/);
    }
  });
});

describe("Chip", () => {
  it("is a toggle button that states whether it is pressed", () => {
    const off = html(withChildren(Chip, { pressed: false, onPressedChange: noop, shortcut: "1" }, "Missing signature"));
    expect(off).toContain('type="button"');
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain('aria-keyshortcuts="1"');
    expect(off).toContain("<kbd");
    // An empty box until it is pressed.
    expect(off).not.toContain("<svg");
    const on = html(withChildren(Chip, { pressed: true, onPressedChange: noop }, "Missing signature"));
    expect(on).toContain('aria-pressed="true"');
    // A tick, so the pressed state does not rely on color.
    expect(on).toContain("<svg");
  });

  it("draws a checkbox row by default and a radio row for an outcome", () => {
    const check = html(withChildren(Chip, { pressed: true, onPressedChange: noop }, "Wrong form"));
    expect(check).toMatch(/class="[^"]*check/);
    expect(check).not.toMatch(/class="[^"]*radio/);
    // A tone other than the default marks a choose-one row: a ring, not a tick.
    const radio = html(withChildren(Chip, { pressed: true, onPressedChange: noop, tone: "danger" }, "Rejected"));
    expect(radio).toMatch(/class="[^"]*radio/);
    expect(radio).toMatch(/class="[^"]*danger/);
    expect(radio).not.toContain("<svg");
    expect(radio).toContain('aria-pressed="true"');
    // The prop decides when it is given.
    expect(html(withChildren(Chip, { pressed: false, onPressedChange: noop, radio: true }, "Rejected"))).toMatch(/class="[^"]*radio/);
    expect(html(withChildren(Chip, { pressed: false, onPressedChange: noop, tone: "danger", radio: false }, "x"))).toMatch(/class="[^"]*check/);
  });

  it("keeps the key hint out of the chip's name", () => {
    const markup = html(withChildren(Chip, { pressed: false, onPressedChange: noop, shortcut: "3" }, "Wrong county or court"));
    expect(markup).toMatch(/<kbd[^>]*aria-hidden="true"[^>]*>3<\/kbd>/);
  });

  it("groups chips under a label and ties the error to the group", () => {
    const markup = html(withChildren(ChipGroup, { id: "tags", label: "What was wrong?", error: "Choose at least one problem." }, null));
    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-labelledby="tags-label"');
    expect(markup).toContain('aria-describedby="tags-error"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain("Choose at least one problem.");
  });

  it("names what a removable chip removes", () => {
    const markup = html(createElement(RemovableChip, { label: "County: Marion", onRemove: noop }));
    expect(markup).toContain("County: Marion");
    expect(markup).toContain("Remove filter");
  });
});

describe("fields", () => {
  it("ties label, hint and error to a text input", () => {
    const markup = html(
      createElement(TextInput, { id: "note", label: "Note", value: "", onChange: noop, hint: "No names.", error: "Remove the phone number." }),
    );
    expect(markup).toContain('<label for="note"');
    expect(markup).toContain('id="note"');
    expect(markup).toContain('aria-describedby="note-hint note-error"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('id="note-error"');
  });

  it("leaves a valid input unmarked", () => {
    const markup = html(createElement(TextInput, { id: "note", label: "Note", value: "", onChange: noop }));
    expect(markup).not.toContain("aria-invalid");
    expect(markup).not.toContain("aria-describedby");
  });

  it("renders select options from strings or pairs, with an optional first blank option", () => {
    const markup = html(
      createElement(Select, {
        id: "county",
        label: "County",
        value: "",
        onChange: noop,
        placeholder: "All counties",
        options: ["Marion", { value: "lake", label: "Lake" }],
      }),
    );
    expect(markup).toContain('<label for="county"');
    expect(markup).toMatch(/<option value="" selected="">All counties<\/option>/);
    expect(markup).toContain('<option value="Marion">Marion</option>');
    expect(markup).toContain('<option value="lake">Lake</option>');
  });

  it("labels a checkbox and ties its hint to it", () => {
    const markup = html(createElement(Checkbox, { id: "ai", label: "Use AI sorting", checked: false, onChange: noop, hint: "Off on this server.", disabled: true }));
    expect(markup).toContain('<label for="ai"');
    expect(markup).toContain('aria-describedby="ai-hint"');
    expect(markup).toContain("disabled");
  });
});

describe("ErrorSummary", () => {
  it("renders nothing without errors", () => {
    expect(html(createElement(ErrorSummary, { errors: [] }))).toBe("");
  });

  it("is a focusable alert that links each error to its field", () => {
    const markup = html(
      createElement(ErrorSummary, {
        errors: [{ message: "Choose at least one problem.", fieldId: "log-tags" }, { message: "Not saved. Try again." }],
      }),
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('tabindex="-1"');
    expect(markup).toContain("There are 2 problems");
    expect(markup).toContain('<a href="#log-tags">Choose at least one problem.</a>');
    expect(markup).toContain("<li>Not saved. Try again.</li>");
  });

  it("counts one problem in the singular", () => {
    expect(html(createElement(ErrorSummary, { errors: [{ message: "Enter the filing date." }] }))).toContain("There is a problem");
  });
});

describe("status components", () => {
  it("always prints the outcome and the problem as text", () => {
    expect(html(createElement(OutcomePill, { outcome: "Fixed at counter" }))).toContain("Fixed at counter");
    expect(html(createElement(TagPill, { tag: "Needs review" }))).toContain("Needs review");
  });

  it.each([
    ["Fixed at counter", "Pass"],
    ["Returned to fix", "Fix"],
    ["Rejected", "Reject"],
  ] as const)("shows %s as the short word %s and keeps the full name for screen readers", (outcome, word) => {
    const markup = html(createElement(OutcomePill, { outcome }));
    expect(markup).toContain(`>${word}<span class="visually-hidden"> (${outcome})</span>`);
    expect(markup).toContain(`title="${outcome}"`);
    // An unseen copy of the longest word holds the width, so the dots line up down a list. It is not read out.
    expect(markup).toMatch(/aria-hidden="true"[^>]*>Reject<\/span>/);
  });

  it("prints any other status as plain text", () => {
    const markup = html(withChildren(Pill, { tone: "warning" }, "Low"));
    expect(markup).toMatch(/^<span class="[^"]*">Low<\/span>$/);
  });

  it("announces a live alert as an alert for errors and a status otherwise", () => {
    expect(html(createElement(Alert, { tone: "error", live: true }, "Could not load."))).toContain('role="alert"');
    expect(html(createElement(Alert, { tone: "success", live: true }, "Added 9 rows."))).toContain('role="status"');
    expect(html(createElement(Alert, { tone: "warning" }, "Check the note."))).not.toContain("role=");
  });

  it("keeps a spinner's label for screen readers when it is hidden from view", () => {
    const markup = html(createElement(Spinner, { label: "Saving", hideLabel: true, announce: true }));
    expect(markup).toContain('role="status"');
    expect(markup).toContain("Saving");
  });

  it("shows an empty state's title and explanation, as text with no picture", () => {
    const markup = html(createElement(EmptyState, { title: "No entries yet", icon: "tag" }, "Entries you save appear here."));
    expect(markup).toContain("No entries yet");
    expect(markup).toContain("Entries you save appear here.");
    expect(markup).not.toContain("<svg");
    // Not a heading: it must not disturb the page outline.
    expect(markup).not.toMatch(/<h[1-6]/);
  });
});

describe("page building blocks", () => {
  it("gives a page exactly one h1, for screen readers, and draws the intro", () => {
    const markup = html(withChildren(Page, { title: "Tag a filing", intro: "Pick what was wrong and save." }, "content"));
    expect(markup.match(/<h1/g)).toHaveLength(1);
    // The highlighted tab names the page on screen, so the title is not drawn a second time.
    expect(markup).toContain('<h1 class="visually-hidden">Tag a filing</h1>');
    expect(markup).toMatch(/<p class="intro [^"]*">Pick what was wrong and save.<\/p>/);
    expect(markup.indexOf("<h1")).toBeLessThan(markup.indexOf("Pick what was wrong"));
  });

  it("keeps the h1 when a page has no intro", () => {
    const markup = html(withChildren(Page, { title: "Admin" }, "content"));
    expect(markup).toContain('<h1 class="visually-hidden">Admin</h1>');
    expect(markup).not.toContain("<p");
  });

  it("names a titled card by its heading, at the level asked for", () => {
    const markup = html(withChildren(Card, { title: "Recent entries", headingLevel: 3 }, "content"));
    expect(markup).toMatch(/<section[^>]* aria-labelledby="([^"]+)"/);
    expect(markup).toMatch(/<h3 id="[^"]+"[^>]*>Recent entries<\/h3>/);
    expect(html(withChildren(Card, {}, "content"))).not.toContain("<section");
  });

  it("draws a card as a ruled section, and as a box only when asked", () => {
    const plain = html(withChildren(Card, { title: "Recent entries" }, "content"));
    expect(plain).toMatch(/class="[^"]*ruled/);
    expect(plain).not.toMatch(/class="[^"]*boxed/);
    const boxed = html(withChildren(Card, { title: "Tag a filing problem", boxed: true }, "content"));
    expect(boxed).toMatch(/class="[^"]*boxed/);
    expect(boxed).not.toMatch(/class="[^"]*ruled/);
    // Without a heading there is nothing for a rule to sit over.
    expect(html(withChildren(Card, {}, "content"))).not.toMatch(/class="[^"]*ruled/);
  });

  it("uses the demo notice wording from the spec", () => {
    expect(DEMO_FLAG_TEXT).toBe("Prototype. All data is made up.");
    expect(html(createElement(DemoFlag))).toContain("Prototype. All data is made up.");
  });

  it("draws the courthouse mark as decoration", () => {
    const markup = html(createElement(Mark));
    expect(markup).toContain('viewBox="0 0 32 32"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain("style=");
  });

  it("says in the footer that the data is made up only where it is", () => {
    expect(footerText(true)).toBe(
      "Student prototype for CS4535 AI for Impact, Team 1. Not affiliated with the Indiana courts. Counties are real; every number and entry is made up. This tool does not give legal advice.",
    );
    expect(footerText(false)).toBe("Student prototype for CS4535 AI for Impact, Team 1. Not affiliated with the Indiana courts. This tool does not give legal advice.");
  });

  it("says in the footer which features use AI, with the model's name, and that numbers are counted by code", () => {
    expect(aiUseText(false, "any-model")).toBe("AI use: none on this copy. Import sorts with keyword rules, and every number is counted by code.");
    const on = aiUseText(true, "example-model-1");
    expect(on).toMatch(/^AI use: the example-model-1 model /);
    for (const feature of ["Import", "dashboard summary", "workspace"]) expect(on).toContain(feature);
    expect(on).toContain("every number is counted by code");
    // The browser is not told the model's name. Without it the features are still named.
    const unnamed = aiUseText(true);
    expect(unnamed).toMatch(/^AI use: an AI model /);
    for (const feature of ["Import", "dashboard summary", "workspace"]) expect(unnamed).toContain(feature);
  });

  it("describes each line illustration for screen readers and uses no inline styles", () => {
    for (const Illustration of [CounterIllustration, LeaderIllustration, BeforeAfterIllustration]) {
      const markup = html(createElement(Illustration));
      expect(markup).toContain('role="img"');
      expect(markup).toMatch(/aria-label="[^"]{40,}"/);
      expect(markup).toContain('stroke-width="1.5"');
      expect(markup).not.toContain("style=");
    }
  });
});
