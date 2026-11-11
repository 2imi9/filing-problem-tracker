import { Icon } from "@/components/ui";
import styles from "./panels.module.css";

interface FilterTagProps {
  /** The filter in words, for example "Marion County". */
  label: string;
  onRemove: () => void;
}

/**
 * An active filter on the dashboard or on a workspace panel: plain text followed by a small remove
 * mark. It is one button, and pressing it removes the filter. Its name ends in "Remove filter".
 */
export function FilterTag({ label, onRemove }: FilterTagProps) {
  return (
    <button type="button" className={styles.filterTag} onClick={onRemove}>
      <span>{label}</span>
      <Icon name="close" size={14} />
      <span className="visually-hidden">Remove filter</span>
    </button>
  );
}
