"use client";

import { monthLabel, monthShort } from "@/lib/time";
import { axisMax, axisTicks, dateX, labelStep, slotX, valueY } from "./geometry";
import type { PlotBox } from "./geometry";
import { useElementWidth } from "./useElementWidth";
import styles from "./charts.module.css";

export interface TrendLinePoint {
  /** YYYY-MM */
  month: string;
  count: number;
  /** Drawn as an open ring: a month that is not over, or one left out of an average. */
  open: boolean;
}

interface TrendLineProps {
  points: readonly TrendLinePoint[];
  /** The largest count, for the scale. */
  max: number;
  /** The text alternative: one sentence saying what the line shows. */
  summary: string;
  /** Legend text for the line, for example "Flagged filings per month". */
  seriesLabel: string;
  /** Legend text for open rings. Needed when any point is open. */
  openLabel?: string;
  /** A dashed vertical line at a date, such as the day a change took effect. `label` is the word printed beside it; `title` is its tooltip. */
  marker?: { date: string; label: string; title?: string } | null;
  /** A shorter chart for small panels. */
  compact?: boolean;
}

const INITIAL_WIDTH = 640;
/** The narrowest the chart is drawn. A 320px screen leaves it 246px, and it must fit: a plot that scrolls
 * sideways cannot be reached by keyboard. */
const MIN_WIDTH = 240;
/** The width the demo's chart is drawn at, and how far the picture may grow past it. */
const DESIGN_WIDTH = 760;
const MAX_SCALE = 1.3;
/** The demo's chart: 240 tall, 40 left for the scale, 16 right and top. The bottom also holds the year under a month. */
const MARGIN = { left: 40, right: 16, top: 16, bottom: 42 };
/** Room a month label needs, in pixels. */
const LABEL_WIDTH = 44;

/**
 * Monthly counts as a line with a marker on every month: solid grid lines, no fill under the line, and
 * the change marker drawn over the grid. It is drawn at the element's real width, so the text is never
 * scaled down; in a wide panel the whole picture grows a little. Screen readers get `summary`; the exact numbers are in the panel's table view, and each
 * point names its month and count when the pointer rests on it.
 */
export function TrendLine({ points, max, summary, seriesLabel, openLabel, marker, compact = false }: TrendLineProps) {
  const [ref, measured] = useElementWidth<HTMLDivElement>(INITIAL_WIDTH);
  const outer = Math.max(MIN_WIDTH, measured);
  // The demo draws 760 units wide and lets the picture grow with the page. Here it grows too, up to
  // 1.3 times, and never shrinks: below 760px one unit is one pixel and the text keeps its size.
  const scale = Math.min(MAX_SCALE, Math.max(1, outer / DESIGN_WIDTH));
  const width = Math.round(outer / scale);
  const height = compact ? 170 : 240;
  const box: PlotBox = {
    left: MARGIN.left,
    top: MARGIN.top,
    width: width - MARGIN.left - MARGIN.right,
    height: height - MARGIN.top - MARGIN.bottom,
  };
  const top = axisMax(max);
  const ticks = axisTicks(top);
  const months = points.map((point) => point.month);
  const placed = points.map((point, i) => ({ ...point, x: slotX(i, points.length, box), y: valueY(point.count, top, box) }));
  const step = labelStep(points.length, box.width, LABEL_WIDTH);
  const markerX = marker ? dateX(marker.date, months, box) : null;
  const anyOpen = points.some((point) => point.open);
  const baseline = box.top + box.height;
  /** The word beside the marker sits on the side with more room. */
  const markerLeft = markerX !== null && markerX > box.left + box.width - 64;

  return (
    <figure className={styles.trend}>
      <div ref={ref} className={styles.trendPlot}>
        <svg width={outer} height={Math.round(height * scale)} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary} focusable="false">
          {ticks.map((tick) => {
            const y = valueY(tick, top, box);
            return (
              <g key={tick}>
                <line className={styles.gridLine} x1={box.left} x2={box.left + box.width} y1={y} y2={y} />
                <text className={styles.axisText} x={box.left - 8} y={y} dy="0.32em" textAnchor="end">
                  {tick.toLocaleString("en-US")}
                </text>
              </g>
            );
          })}
          {placed.map((point, i) =>
            i % step === 0 ? (
              <text key={point.month} className={styles.axisText} x={point.x} y={baseline + 18} textAnchor="middle">
                {monthShort(point.month)}
                {i === 0 || point.month.endsWith("-01") ? (
                  <tspan x={point.x} dy="14">
                    {point.month.slice(0, 4)}
                  </tspan>
                ) : null}
              </text>
            ) : null,
          )}
          {/* After the grid, so the marker is drawn over it; before the line, so the line stays whole. */}
          {markerX !== null && marker ? (
            <g>
              {marker.title ? <title>{marker.title}</title> : null}
              <line className={styles.markerLine} x1={markerX} x2={markerX} y1={box.top} y2={baseline} />
              <text className={styles.markerText} x={markerLeft ? markerX - 6 : markerX + 6} y={box.top + 10} textAnchor={markerLeft ? "end" : "start"}>
                {marker.label}
              </text>
            </g>
          ) : null}
          <polyline className={styles.series} points={placed.map((point) => `${point.x},${point.y}`).join(" ")} />
          {placed.map((point) => (
            <circle key={point.month} className={point.open ? styles.pointOpen : styles.point} cx={point.x} cy={point.y} r={point.open ? 5 : 3.5}>
              <title>
                {monthLabel(point.month)}: {point.count.toLocaleString("en-US")}
                {point.open && openLabel ? ` (${openLabel.toLowerCase()})` : ""}
              </title>
            </circle>
          ))}
        </svg>
      </div>
      <figcaption className={styles.legend}>
        <span className={styles.legendItem}>
          <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true" focusable="false">
            <line className={styles.series} x1="0" x2="16" y1="6" y2="6" />
          </svg>
          {seriesLabel}
        </span>
        {anyOpen && openLabel ? (
          <span className={styles.legendItem}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
              <circle className={styles.pointOpen} cx="7" cy="7" r="5" />
            </svg>
            {openLabel}
          </span>
        ) : null}
        {markerX !== null && marker ? (
          <span className={styles.legendItem}>
            <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true" focusable="false">
              <line className={styles.markerLine} x1="0" x2="16" y1="6" y2="6" />
            </svg>
            Date of the change
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
