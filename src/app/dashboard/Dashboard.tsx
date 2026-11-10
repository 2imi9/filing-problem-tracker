"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CASE_TYPES, TAGS, isCaseType, isCounty, isTag } from "@/lib/domain";
import type { Tag } from "@/lib/domain";
import { computePanel, filterChips, monthChoices } from "@/lib/panels";
import { isMonth, monthLabel } from "@/lib/time";
import { DataGate, useLoadedData } from "@/components/data/DataProvider";
import { FilterTag } from "@/components/panels/FilterTag";
import { Panel } from "@/components/panels/Panel";
import { dashboardPanels, normalizeDashboardFilters } from "@/components/panels/dashboardSpecs";
import type { DashboardFilters } from "@/components/panels/dashboardSpecs";
import { summaryRequest } from "@/components/panels/summaryReply";
import { Button, Card, EmptyState, Select, buttonAfterRemoval, useFocusAfterUpdate } from "@/components/ui";
import { countiesIn, eventsFor } from "@/components/workspace/model";
import { AiSummary } from "./AiSummary";
import styles from "./dashboard.module.css";

/** The leader's view: a row of filters and a fixed set of panels, all computed from the same records. */
export function Dashboard() {
  return (
    <DataGate>
      <LoadedDashboard />
    </DataGate>
  );
}

/**
 * True once the page has scrolled far enough that the filters are pinned under the tab bar. The mark
 * sits where the filters start; when it has gone under the bar, they are pinned. Only then do the
 * filters get a hairline under them, so at rest they are a plain row with no box.
 */
function usePinned() {
  const mark = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    const node = mark.current;
    if (!node) return;
    const bar = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tabbar-height")) || 53;
    // Read on scroll only, and only once the page has scrolled: a full-page capture or a print moves
    // the viewport without scrolling, and must show the filters as they are at rest.
    const read = () => setPinned(window.scrollY > 0 && node.getBoundingClientRect().top < bar);
    const first = window.requestAnimationFrame(read);
    window.addEventListener("scroll", read, { passive: true });
    return () => {
      window.cancelAnimationFrame(first);
      window.removeEventListener("scroll", read);
    };
  }, []);
  return { mark, pinned };
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
  // A removed filter and "Clear all filters" take themselves off the page: focus needs somewhere to land.
  const filterFields = useRef<HTMLDivElement>(null);
  const chipList = useRef<HTMLUListElement>(null);
  const focusAfterUpdate = useFocusAfterUpdate();
  const firstFilter = () => filterFields.current?.querySelector<HTMLElement>("select");
  const event = specs.event;
  const { mark, pinned } = usePinned();
  const summary = summaryRequest(filters, event?.id ?? null, tag);

  return (
    <div className={styles.dashboard}>
      <div ref={mark} className={styles.pinMark} aria-hidden="true" />
      <section className={styles.filterBar} aria-label="Filters" data-pinned={pinned}>
        <div ref={filterFields} className={styles.filterFields}>
          {counties.length > 1 ? (
            <Select
              label="County"
              value={filters.county ?? ""}
              placeholder="All counties"
              options={counties}
              onChange={(value) => setFilters({ ...filters, county: isCounty(value) ? value : undefined })}
            />
          ) : null}
          <Select
            label="Case type"
            value={filters.caseType ?? ""}
            placeholder="All case types"
            options={CASE_TYPES}
            onChange={(value) => setFilters({ ...filters, caseType: isCaseType(value) ? value : undefined })}
          />
          <Select
            label="From"
            value={filters.fromMonth ?? ""}
            placeholder="First month"
            options={monthOptions}
            onChange={(value) => setFilters({ ...filters, fromMonth: isMonth(value) ? value : undefined })}
          />
          <Select
            label="To"
            value={filters.toMonth ?? ""}
            placeholder="Latest month"
            options={monthOptions}
            onChange={(value) => setFilters({ ...filters, toMonth: isMonth(value) ? value : undefined })}
          />
        </div>
        <div className={styles.filterState}>
          <p className={styles.filterCount} role="status">
            <span className="num">{headline.total.toLocaleString("en-US")}</span> flagged {headline.total === 1 ? "filing" : "filings"}: {headline.scope}
          </p>
          {chips.length > 0 ? (
            <>
              <ul ref={chipList} className={styles.chipList} aria-label="Active filters">
                {chips.map((chip, place) => (
                  <li key={chip.key}>
                    <FilterTag
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
        </div>
        {user.role === "clerk" && user.county ? (
          <p className={styles.scopeNote}>You see {user.county} County only. A clerk&apos;s dashboard covers the filings of their own county.</p>
        ) : null}
      </section>

      {ai ? <AiSummary request={summary} scope={headline.scope} enabled /> : null}

      {/* The four key numbers: one row under a rule. Its heading and its sentence are for screen readers; the row says both in view. */}
      <Panel spec={specs.kpi} records={records} events={events} todayIso={todayIso} viewerCounty={viewerCounty} look="bare" />

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
          look="boxed"
          toolbar={
            <div className={styles.changeFields}>
              <Select
                label="Change to check"
                value={event.id}
                options={offered.map((e) => ({ value: e.id, label: e.name }))}
                onChange={(value) => {
                  setEventId(value);
                  setTag(null);
                }}
              />
              <Select label="Problem to follow" value={tag ?? event.tag} options={TAGS} onChange={(value) => setTag(isTag(value) ? value : null)} />
            </div>
          }
          note={`This panel follows the county and case type of the change (${event.county} County, ${event.caseType}), not the filters at the top.`}
        />
      ) : (
        <Card title="Before and after a change">
          <EmptyState title="No changes have been recorded yet" compact>
            When an administrator records a change, such as a revised form or a new guide, this panel compares the months before it with the months after.
          </EmptyState>
        </Card>
      )}

      {/* With AI switched off the summary is one quiet line, after everything the page does show. */}
      {ai ? null : <AiSummary request={summary} scope={headline.scope} enabled={false} />}
    </div>
  );
}
