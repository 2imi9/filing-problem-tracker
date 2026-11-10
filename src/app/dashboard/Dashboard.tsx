"use client";

import { useMemo, useRef, useState } from "react";
import { CASE_TYPES, TAGS, isCaseType, isCounty, isTag } from "@/lib/domain";
import type { Tag } from "@/lib/domain";
import { computePanel, filterChips, monthChoices } from "@/lib/panels";
import { isMonth, monthLabel } from "@/lib/time";
import { DataGate, useLoadedData } from "@/components/data/DataProvider";
import { Panel } from "@/components/panels/Panel";
import { dashboardPanels, normalizeDashboardFilters } from "@/components/panels/dashboardSpecs";
import type { DashboardFilters } from "@/components/panels/dashboardSpecs";
import { summaryRequest } from "@/components/panels/summaryReply";
import { Button, EmptyState, RemovableChip, Select, buttonAfterRemoval, useFocusAfterUpdate } from "@/components/ui";
import { countiesIn, eventsFor } from "@/components/workspace/model";
import { AiSummary } from "./AiSummary";
import styles from "./dashboard.module.css";

/** The leader's view: a filter bar and a fixed set of panels, all computed from the same records. */
export function Dashboard() {
  return (
    <DataGate>
      <LoadedDashboard />
    </DataGate>
  );
}

function LoadedDashboard() {
  const { records, events, user, todayIso, ai } = useLoadedData();
  const [filters, setFilterState] = useState<DashboardFilters>({});
  const [eventId, setEventId] = useState<string | null>(null);
  const [tag, setTag] = useState<Tag | null>(null);

  const counties = useMemo(() => countiesIn(records), [records]);
  const monthOptions = useMemo(() => monthChoices(records, todayIso).map((month) => ({ value: month, label: monthLabel(month) })), [records, todayIso]);
  // The changes offered in the before/after panel. Panels still get every change, to look one up by id.
  const offered = useMemo(() => eventsFor(user, events), [user, events]);
  const specs = useMemo(() => dashboardPanels({ filters, eventId, tag }, offered), [filters, eventId, tag, offered]);
  // The same computation the key numbers panel runs, used here only to say how many filings match.
  const viewerCounty = user.role === "clerk" ? user.county : null;
  const headline = useMemo(() => computePanel(specs.kpi, records, events, todayIso, { county: viewerCounty }), [specs.kpi, records, events, todayIso, viewerCounty]);
  const chips = filterChips(filters);
  const setFilters = (next: DashboardFilters) => setFilterState(normalizeDashboardFilters(next));
  // A removed chip and "Clear all filters" take themselves off the page: focus needs somewhere to land.
  const filterFields = useRef<HTMLDivElement>(null);
  const chipList = useRef<HTMLUListElement>(null);
  const focusAfterUpdate = useFocusAfterUpdate();
  const firstFilter = () => filterFields.current?.querySelector<HTMLElement>("select");
  const event = specs.event;

  return (
    <div className={styles.dashboard}>
      <section className={styles.filterBar} aria-label="Filters">
        <div ref={filterFields} className={styles.filterFields}>
          {counties.length > 1 ? (
            <Select
              compact
              label="County"
              value={filters.county ?? ""}
              placeholder="All counties"
              options={counties}
              onChange={(value) => setFilters({ ...filters, county: isCounty(value) ? value : undefined })}
            />
          ) : null}
          <Select
            compact
            label="Case type"
            value={filters.caseType ?? ""}
            placeholder="All case types"
            options={CASE_TYPES}
            onChange={(value) => setFilters({ ...filters, caseType: isCaseType(value) ? value : undefined })}
          />
          <Select
            compact
            label="From"
            value={filters.fromMonth ?? ""}
            placeholder="First month"
            options={monthOptions}
            onChange={(value) => setFilters({ ...filters, fromMonth: isMonth(value) ? value : undefined })}
          />
          <Select
            compact
            label="To"
            value={filters.toMonth ?? ""}
            placeholder="Latest month"
            options={monthOptions}
            onChange={(value) => setFilters({ ...filters, toMonth: isMonth(value) ? value : undefined })}
          />
        </div>
        <div className={styles.filterState}>
          {chips.length > 0 ? (
            <>
              <ul ref={chipList} className={styles.chipList} aria-label="Active filters">
                {chips.map((chip, place) => (
                  <li key={chip.key}>
                    <RemovableChip
                      label={chip.label}
                      onRemove={() => {
                        setFilters({ ...filters, [chip.key]: undefined });
                        focusAfterUpdate(() => buttonAfterRemoval(chipList.current, place) ?? firstFilter());
                      }}
                    />
                  </li>
                ))}
              </ul>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setFilters({});
                  focusAfterUpdate(firstFilter);
                }}
              >
                Clear all filters
              </Button>
            </>
          ) : null}
          <p className={styles.filterCount} role="status">
            <span className="num">{headline.total.toLocaleString("en-US")}</span> flagged {headline.total === 1 ? "filing" : "filings"}: {headline.scope}
          </p>
        </div>
        {user.role === "clerk" && user.county ? (
          <p className={styles.scopeNote}>You see {user.county} County only. A clerk&apos;s dashboard covers the filings of their own county.</p>
        ) : null}
      </section>

      <AiSummary request={summaryRequest(filters, event?.id ?? null, tag)} scope={headline.scope} enabled={ai} />

      <Panel spec={specs.kpi} records={records} events={events} todayIso={todayIso} viewerCounty={viewerCounty} />

      <div className={styles.split}>
        <Panel spec={specs.problems} records={records} events={events} todayIso={todayIso} viewerCounty={viewerCounty} />
        <Panel spec={specs.outcomes} records={records} events={events} todayIso={todayIso} viewerCounty={viewerCounty} />
      </div>

      <Panel
        spec={specs.heat}
        records={records}
        events={events}
        todayIso={todayIso}
        viewerCounty={viewerCounty}
        note="Number of flagged filings with each problem. The columns are the most common problems under the filters above."
      />

      <Panel spec={specs.forms} records={records} events={events} todayIso={todayIso} viewerCounty={viewerCounty} />

      {specs.beforeAfter && event ? (
        <Panel
          spec={specs.beforeAfter}
          records={records}
          events={events}
          todayIso={todayIso}
          viewerCounty={viewerCounty}
          toolbar={
            <div className={styles.changeFields}>
              <Select
                compact
                label="Change to check"
                value={event.id}
                options={offered.map((e) => ({ value: e.id, label: e.name }))}
                onChange={(value) => {
                  setEventId(value);
                  setTag(null);
                }}
              />
              <Select
                compact
                label="Problem to follow"
                value={tag ?? event.tag}
                options={TAGS}
                onChange={(value) => setTag(isTag(value) ? value : null)}
              />
              <p className={styles.changeNote}>
                This panel follows the county and case type of the change ({event.county} County, {event.caseType}), not the filters at the top.
              </p>
            </div>
          }
        />
      ) : (
        <section className={styles.emptyPanel} aria-labelledby="no-changes-title">
          <h2 id="no-changes-title">Before and after a change</h2>
          <EmptyState title="No changes have been recorded yet" compact>
            When an administrator records a change, such as a revised form or a new guide, this panel compares the months before it with the months after.
          </EmptyState>
        </section>
      )}
    </div>
  );
}
