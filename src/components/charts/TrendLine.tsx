"use client";

import { monthShort } from "@/lib/time";
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
  /** A dashed vertical line at a date, such as the day a change took effect. */
  marker?: { date: string; label: string } | null;
  /** A shorter chart for small panels. */
  compact?: boolean;
}

const INITIAL_WIDTH = 640;
const MIN_WIDTH = 260;
const MARGIN = { left: 40, right: 12, top: 34, bottom: 42 };
/** Room a month label needs, in pixels. */
const LABEL_WIDTH = 44;
/** Counts are printed above the points when each month has at least this much room. */
const VALUE_LABEL_MIN_SLOT = 30;

/**
 * Monthly counts as a line with a marker on every month. It is drawn at the element's real width so
 * the text is never scaled down. Screen readers get `summary`; the exact numbers are in the panel's
 * table view.
 */
export function TrendLine({ points, max, summary, seriesLabel, openLabel, marker, compact = false }: TrendLineProps) {
  const [ref, measured] = useElementWidth<HTMLDivElement>(INITIAL_WIDTH);
  const width = Math.max(MIN_WIDTH, measured);
  const height = compact ? 170 : 250;
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
  const showValues = points.length > 0 && box.width / points.length >= VALUE_LABEL_MIN_SLOT;
  const markerX = marker ? dateX(marker.date, months, box) : null;
  const anyOpen = points.some((point) => point.open);
  const baseline = box.top + box.height;

  return (
    <figure className={styles.trend}>
      <div ref={ref} className={styles.trendPlot}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary} focusable="false">
          {ticks.map((tick) => {
            const y = valueY(tick, top, box);
            return (
              <g key={tick}>
                <line className={tick === 0 ? styles.axisLine : styles.gridLine} x1={box.left} x2={box.left + box.width} y1={y} y2={y} />
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
                  <tspan x={point.x} dy="15">
                    {point.month.slice(0, 4)}
                  </tspan>
                ) : null}
              </text>
            ) : null,
          )}
          {markerX !== null && marker ? (
            <g>
              <line className={styles.markerLine} x1={markerX} x2={markerX} y1={box.top - 18} y2={baseline} />
              <text
                className={styles.markerText}
                x={markerX > box.left + box.width / 2 ? markerX - 6 : markerX + 6}
                y={box.top - 22}
                textAnchor={markerX > box.left + box.width / 2 ? "end" : "start"}
              >
                {marker.label}
              </text>
            </g>
          ) : null}
          {placed.slice(1).map((point, i) => {
            const from = placed[i];
            return (
              <line
                key={point.month}
                className={from.open || point.open ? styles.seriesOpen : styles.series}
                x1={from.x}
                y1={from.y}
                x2={point.x}
                y2={point.y}
              />
            );
          })}
          {placed.map((point) => (
            <g key={point.month}>
              <circle className={point.open ? styles.pointOpen : styles.point} cx={point.x} cy={point.y} r="4" />
              {showValues ? (
                <text className={styles.valueText} x={point.x} y={point.y - 9} textAnchor="middle">
                  {point.count.toLocaleString("en-US")}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      </div>
      <figcaption className={styles.legend}>
        <span className={styles.legendItem}>
          <svg width="28" height="12" viewBox="0 0 28 12" aria-hidden="true" focusable="false">
            <line className={styles.series} x1="1" x2="27" y1="6" y2="6" />
            <circle className={styles.point} cx="14" cy="6" r="4" />
          </svg>
          {seriesLabel}
        </span>
        {anyOpen && openLabel ? (
          <span className={styles.legendItem}>
            <svg width="28" height="12" viewBox="0 0 28 12" aria-hidden="true" focusable="false">
              <line className={styles.seriesOpen} x1="1" x2="27" y1="6" y2="6" />
              <circle className={styles.pointOpen} cx="14" cy="6" r="4" />
            </svg>
            {openLabel}
          </span>
        ) : null}
        {markerX !== null && marker ? (
          <span className={styles.legendItem}>
            <svg width="28" height="12" viewBox="0 0 28 12" aria-hidden="true" focusable="false">
              <line className={styles.markerLine} x1="14" x2="14" y1="0" y2="12" />
            </svg>
            Date of the change
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
