import { sparkline } from "@/lib/stats";
import styles from "./charts.module.css";

const WIDTH = 96;
const HEIGHT = 28;
const PAD = 4;

interface SparklineProps {
  values: readonly number[];
  /** A text alternative. Leave it out when the same figures are printed next to the sparkline. */
  label?: string;
}

/** A small line of monthly counts with a dot on the latest. The scale starts at zero. */
export function Sparkline({ values, label }: SparklineProps) {
  const points = sparkline(values, WIDTH, HEIGHT, PAD);
  if (points === "") return null;
  const last = points.slice(points.lastIndexOf(" ") + 1).split(",");
  const accessible = label ? ({ role: "img", "aria-label": label } as const) : ({ "aria-hidden": true } as const);
  return (
    <svg className={styles.spark} width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} focusable="false" {...accessible}>
      {label ? <title>{label}</title> : null}
      <line className={styles.sparkBase} x1={PAD} x2={WIDTH - PAD} y1={HEIGHT - PAD} y2={HEIGHT - PAD} />
      <polyline className={styles.sparkLine} points={points} />
      <circle className={styles.sparkDot} cx={last[0]} cy={last[1]} r="3" />
    </svg>
  );
}
