"use client";

import { FORMS, NEEDS_REVIEW, TAGS, formsFor, isCaseType, isCounty, isFlagTag, isForm, isTag, CASE_TYPES } from "@/lib/domain";
import type { ChangeEvent, County } from "@/lib/domain";
import { RANKED_DIMENSIONS } from "@/lib/panels";
import type { PanelSpec } from "@/lib/panels";
import { HEAT_TAGS_DEFAULT, HEAT_TAGS_MAX } from "@/lib/schemas";
import type { Filters } from "@/lib/schemas";
import { isMonth, monthLabel } from "@/lib/time";
import { Button, Checkbox, Select } from "@/components/ui";
import { DIMENSION_NAMES, editFilters, filterKeysFor, filtersOf, removeChip, retitle } from "./model";
import styles from "./workspace.module.css";

interface FilterChipEditorProps {
  spec: PanelSpec;
  /** Every change, for titles and for the change this panel already points at. */
  events: readonly ChangeEvent[];
  /** The changes offered in the "Change to check" list. */
  offeredEvents: readonly ChangeEvent[];
  /** The counties the viewer has data for. */
  counties: readonly County[];
  /** The months there is data for, oldest first. */
  months: readonly string[];
  /** Called with the edited panel after every change. */
  onChange: (next: PanelSpec) => void;
  onDone: () => void;
}

const LIMIT_CHOICES = [3, 5, 10];
const HEAT_CHOICES = Array.from({ length: HEAT_TAGS_MAX - 2 }, (_, i) => i + 3).filter((count) => count !== HEAT_TAGS_DEFAULT);

/** "Top N" options: the usual choices, plus the panel's own value when it is not one of them. */
function topOptions(choices: readonly number[], current: number | undefined) {
  const counts = current === undefined || choices.includes(current) ? choices : [...choices, current];
  return [...counts].sort((a, b) => a - b).map((count) => ({ value: String(count), label: `Top ${count}` }));
}

/**
 * The controls behind a panel's filter chips. Every change is applied at once to that one panel, here in
 * the browser: the panel recomputes from the records already loaded and nothing is sent to the server
 * or to the AI.
 */
export function FilterChipEditor({ spec, events, offeredEvents, counties, months, onChange, onDone }: FilterChipEditorProps) {
  const keys = filterKeysFor(spec.type);
  const filters = filtersOf(spec);
  const setFilters = (next: Filters) => onChange(editFilters(spec, next, events));
  const monthOptions = months.map((month) => ({ value: month, label: monthLabel(month) }));

  return (
    <fieldset className={styles.editor}>
      <legend className={styles.editorLegend}>Settings for this panel</legend>
      <div className={styles.editorFields}>
        {spec.type === "ranked" ? (
          <>
            <Select
              compact
              label="Rank by"
              value={spec.params.dimension}
              options={RANKED_DIMENSIONS.map((dimension) => ({ value: dimension, label: DIMENSION_NAMES[dimension] }))}
              onChange={(value) => {
                const dimension = RANKED_DIMENSIONS.find((d) => d === value);
                if (dimension) onChange(retitle(spec, { ...spec, params: { ...spec.params, dimension } }, events));
              }}
            />
            <Select
              compact
              label="Rows shown"
              value={spec.params.limit === undefined ? "" : String(spec.params.limit)}
              placeholder="All"
              options={topOptions(LIMIT_CHOICES, spec.params.limit)}
              onChange={(value) => {
                if (value === "") onChange(removeChip(spec, "limit", events));
                else onChange(retitle(spec, { ...spec, params: { ...spec.params, limit: Number(value) } }, events));
              }}
            />
          </>
        ) : null}

        {spec.type === "heat" ? (
          <Select
            compact
            label="Problem columns"
            value={spec.params.maxTags === undefined || spec.params.maxTags === HEAT_TAGS_DEFAULT ? "" : String(spec.params.maxTags)}
            placeholder={`Top ${HEAT_TAGS_DEFAULT}`}
            options={topOptions(HEAT_CHOICES, spec.params.maxTags === HEAT_TAGS_DEFAULT ? undefined : spec.params.maxTags)}
            onChange={(value) => {
              if (value === "") onChange(removeChip(spec, "maxTags", events));
              else onChange(retitle(spec, { ...spec, params: { ...spec.params, maxTags: Number(value) } }, events));
            }}
          />
        ) : null}

        {spec.type === "before_after" ? (
          <>
            <Select
              compact
              label="Change to check"
              value={spec.params.eventId}
              options={[
                ...(offeredEvents.some((event) => event.id === spec.params.eventId)
                  ? []
                  : [{ value: spec.params.eventId, label: events.find((event) => event.id === spec.params.eventId)?.name ?? "Change not found" }]),
                ...offeredEvents.map((event) => ({ value: event.id, label: event.name })),
              ]}
              onChange={(eventId) => {
                // A new change brings its own problem, so the problem picked for the old one is dropped.
                if (eventId !== spec.params.eventId) onChange(retitle(spec, { ...spec, params: { eventId } }, events));
              }}
            />
            <Select
              compact
              label="Problem to follow"
              value={spec.params.tag ?? events.find((event) => event.id === spec.params.eventId)?.tag ?? ""}
              options={TAGS}
              onChange={(value) => {
                if (isTag(value)) onChange(retitle(spec, { ...spec, params: { eventId: spec.params.eventId, tag: value } }, events));
              }}
            />
          </>
        ) : null}

        {keys.includes("county") && counties.length > 1 ? (
          <Select
            compact
            label="County"
            value={filters.county ?? ""}
            placeholder="All counties"
            options={counties}
            onChange={(value) => setFilters({ ...filters, county: isCounty(value) ? value : undefined })}
          />
        ) : null}
        {keys.includes("caseType") ? (
          <Select
            compact
            label="Case type"
            value={filters.caseType ?? ""}
            placeholder="All case types"
            options={CASE_TYPES}
            onChange={(value) => setFilters({ ...filters, caseType: isCaseType(value) ? value : undefined })}
          />
        ) : null}
        {keys.includes("form") ? (
          <Select
            compact
            label="Form"
            value={filters.form ?? ""}
            placeholder="All forms"
            options={filters.caseType ? formsFor(filters.caseType) : FORMS}
            onChange={(value) => setFilters({ ...filters, form: isForm(value) ? value : undefined })}
          />
        ) : null}
        {keys.includes("tag") ? (
          <Select
            compact
            label="Problem"
            value={filters.tag ?? ""}
            placeholder="All problems"
            options={[...TAGS, NEEDS_REVIEW]}
            onChange={(value) => setFilters({ ...filters, tag: isFlagTag(value) ? value : undefined })}
          />
        ) : null}
        {keys.includes("fromMonth") ? (
          <Select
            compact
            label="From"
            value={filters.fromMonth ?? ""}
            placeholder="First month"
            options={monthOptions}
            onChange={(value) => setFilters({ ...filters, fromMonth: isMonth(value) ? value : undefined })}
          />
        ) : null}
        {keys.includes("toMonth") ? (
          <Select
            compact
            label="Through"
            value={filters.toMonth ?? ""}
            placeholder="Latest month"
            options={monthOptions}
            onChange={(value) => setFilters({ ...filters, toMonth: isMonth(value) ? value : undefined })}
          />
        ) : null}
      </div>

      {spec.type === "compare_counties" ? (
        <div className={styles.editorCounties} role="group" aria-label="Counties to compare">
          <p className={styles.editorGroupLabel}>Counties to compare (at least two)</p>
          <div className={styles.editorChecks}>
            {[...new Set([...counties, ...spec.params.counties])].map((county) => {
              const checked = spec.params.counties.includes(county);
              return (
                <Checkbox
                  key={county}
                  label={county}
                  checked={checked}
                  disabled={checked && spec.params.counties.length <= 2}
                  onChange={(on) => {
                    const next = on ? [...spec.params.counties, county] : spec.params.counties.filter((c) => c !== county);
                    onChange(retitle(spec, { ...spec, params: { ...spec.params, counties: next } }, events));
                  }}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      <div className={styles.editorFoot}>
        <p className={styles.editorNote}>Changes apply to this panel only and stay on this page.</p>
        <Button size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </fieldset>
  );
}
