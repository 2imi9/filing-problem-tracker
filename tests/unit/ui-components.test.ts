// Markup checks for the shared UI kit: the accessibility wiring teammates rely on.
// Components are rendered to static HTML; no browser is involved.

import { createElement } from "react";
import type { FunctionComponent, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BeforeAfterIllustration, CounterIllustration, LeaderIllustration } from "@/app/how-it-works/illustrations";
import { DEMO_FLAG_TEXT, DemoFlag } from "@/components/shell/DemoFlag";
import { Page } from "@/components/shell/Page";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { Chip, ChipGroup, RemovableChip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorSummary } from "@/components/ui/ErrorSummary";
import { Checkbox, TextInput } from "@/components/ui/Field";
import { ICON_NAMES, Icon } from "@/components/ui/Icon";
import { OutcomePill, TagPill } from "@/components/ui/Pill";
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
    const on = html(withChildren(Chip, { pressed: true, onPressedChange: noop }, "Missing signature"));
    expect(on).toContain('aria-pressed="true"');
    // A check mark, so the pressed state does not rely on color.
    expect(on).toContain("<svg");
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

  it("shows an empty state's title and explanation", () => {
    const markup = html(createElement(EmptyState, { title: "No entries yet" }, "Entries you save appear here."));
    expect(markup).toContain("No entries yet");
    expect(markup).toContain("Entries you save appear here.");
  });
});

describe("page building blocks", () => {
  it("gives a page exactly one h1, with the intro under it", () => {
    const markup = html(withChildren(Page, { title: "Tag a filing", intro: "Pick what was wrong and save." }, "content"));
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain("<h1>Tag a filing</h1>");
    expect(markup).toContain("Pick what was wrong and save.");
  });

  it("names a titled card by its heading, at the level asked for", () => {
    const markup = html(withChildren(Card, { title: "Recent entries", headingLevel: 3 }, "content"));
    expect(markup).toMatch(/<section[^>]* aria-labelledby="([^"]+)"/);
    expect(markup).toMatch(/<h3 id="[^"]+"[^>]*>Recent entries<\/h3>/);
    expect(html(withChildren(Card, {}, "content"))).not.toContain("<section");
  });

  it("uses the demo notice wording from the spec", () => {
    expect(DEMO_FLAG_TEXT).toBe("Prototype. All data is made up.");
    expect(html(createElement(DemoFlag))).toContain("Prototype. All data is made up.");
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
