// The three line drawings on the How it's used page. Plain inline SVG, 1.5px strokes, colored with the
// design tokens through CSS classes so they follow the theme.

import styles from "./how.module.css";

interface IllustrationProps {
  className?: string;
}

const frame = {
  viewBox: "0 0 240 150",
  fill: "none",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  role: "img",
} as const;

/** A clerk behind a counter, a monitor showing problem chips, and a returned filing on the counter. */
export function CounterIllustration({ className }: IllustrationProps) {
  return (
    <svg {...frame} className={className} aria-label="A clerk behind a counter. A monitor shows a row of problem labels, two of them selected. A returned filing lies on the counter.">
      <g className={styles.ink}>
        {/* counter */}
        <path d="M10 112h220M22 112v28M218 112v28" />
        {/* clerk */}
        <circle cx="178" cy="52" r="11" />
        <path d="M156 112V92a22 22 0 0 1 44 0v20" />
        {/* monitor */}
        <rect x="66" y="40" width="80" height="54" rx="3" />
        <path d="M106 94v18M92 112h28" />
        {/* problem chips on the screen */}
        <rect x="74" y="49" width="30" height="10" rx="5" />
        <rect x="108" y="64" width="30" height="10" rx="5" />
        {/* the filing */}
        <path d="M26 112V82h18l6 6v24" />
        <path d="M44 82v6h6M31 94h14M31 100h14M31 106h8" />
      </g>
      <g className={styles.primaryFill}>
        <rect x="108" y="49" width="30" height="10" rx="5" />
        <rect x="74" y="64" width="30" height="10" rx="5" />
      </g>
      <rect className={styles.primaryFill} x="74" y="80" width="24" height="8" rx="2" />
      <g className={styles.bad}>
        <circle cx="52" cy="76" r="7" />
        <path d="M49.5 73.5l5 5M54.5 73.5l-5 5" />
      </g>
    </svg>
  );
}

/** A court leader looking at a screen with a ranked bar chart. */
export function LeaderIllustration({ className }: IllustrationProps) {
  return (
    <svg {...frame} className={className} aria-label="A court leader looks at a large screen showing a ranked bar chart, longest bar first.">
      <g className={styles.ink}>
        <path d="M8 132h224" />
        {/* leader */}
        <circle cx="40" cy="66" r="12" />
        <path d="M16 132v-18a24 24 0 0 1 48 0v18" />
        {/* screen */}
        <rect x="84" y="20" width="142" height="92" rx="4" />
        <path d="M155 112v20M132 132h46" />
        {/* shorter bars */}
        <rect x="96" y="52" width="78" height="10" rx="1.5" />
        <rect x="96" y="70" width="54" height="10" rx="1.5" />
        <rect x="96" y="88" width="30" height="10" rx="1.5" />
      </g>
      <rect className={styles.primaryFill} x="96" y="34" width="104" height="10" rx="1.5" />
    </svg>
  );
}

/** A monthly line that is higher before a dashed "change" marker and lower after it. */
export function BeforeAfterIllustration({ className }: IllustrationProps) {
  return (
    <svg {...frame} className={className} aria-label="A line chart of monthly counts. The line is high before a dashed marker for the change, and lower after it.">
      <g className={styles.ink}>
        <path d="M28 18v106h196" />
        <path d="M44 48 64 40 84 52 104 44 144 86 164 94 184 90 204 100" />
      </g>
      <path className={styles.ink} d="M124 18v106" strokeDasharray="5 4" />
      <g className={styles.pointBefore}>
        <circle cx="44" cy="48" r="3.5" />
        <circle cx="64" cy="40" r="3.5" />
        <circle cx="84" cy="52" r="3.5" />
        <circle cx="104" cy="44" r="3.5" />
      </g>
      <g className={styles.pointAfter}>
        <circle cx="144" cy="86" r="3.5" />
        <circle cx="164" cy="94" r="3.5" />
        <circle cx="184" cy="90" r="3.5" />
        <circle cx="204" cy="100" r="3.5" />
      </g>
      <g className={styles.label}>
        <text x="74" y="142" textAnchor="middle">
          Before
        </text>
        <text x="174" y="142" textAnchor="middle">
          After
        </text>
        <text x="130" y="28">
          Change
        </text>
      </g>
    </svg>
  );
}
