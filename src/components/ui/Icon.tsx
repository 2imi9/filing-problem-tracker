// The app's icon set: small inline SVG line icons, drawn on a 24px grid with a 1.5px stroke.
//
//   <Icon name="tag" />                 decorative (hidden from screen readers); the usual case, next to text
//   <Icon name="alert" label="Error" /> meaningful on its own: rendered with role="img" and that name
//   <Icon name="chart" size={16} />     size in px, default 20
//
// The icon takes the text color (stroke="currentColor"). ICON_NAMES lists every name.
// Every icon carries the global class "icon" (it keeps its size inside a flex row). No inline styles are
// used, so a Content-Security-Policy without 'unsafe-inline' styles does not affect it.

import type { ReactNode } from "react";

const PATHS = {
  tag: (
    <>
      <path d="M3.5 12.6V5a1.5 1.5 0 0 1 1.5-1.5h7.6a1.5 1.5 0 0 1 1.06.44l6.4 6.4a1.5 1.5 0 0 1 0 2.12l-7.6 7.6a1.5 1.5 0 0 1-2.12 0l-6.4-6.4a1.5 1.5 0 0 1-.44-1.06Z" />
      <circle cx="8" cy="8" r="1.25" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15.5V4" />
      <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
      <path d="M4 15.5v3A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-3" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20h16" />
      <path d="M7 20v-7" />
      <path d="M12 20V5" />
      <path d="M17 20v-10" />
    </>
  ),
  trend: (
    <>
      <path d="M4 4v16h16" />
      <path d="m7.5 14.5 3.5-4 3 2.5 4.5-6" />
    </>
  ),
  table: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="1.5" />
      <path d="M4 10h16" />
      <path d="M4 14.5h16" />
      <path d="M10 10v9" />
    </>
  ),
  folder: <path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4.2l2 2.5H19A1.5 1.5 0 0 1 20.5 9.5V17A1.5 1.5 0 0 1 19 18.5H5A1.5 1.5 0 0 1 3.5 17V7Z" />,
  save: (
    <>
      <path d="M5.5 4h10.3L20 8.2V18.5A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4Z" />
      <path d="M8 4v5h7V4" />
      <path d="M8 20v-6h8v6" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="3.75" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.64 5.64l1.41 1.41M16.95 16.95l1.41 1.41M5.64 18.36l1.41-1.41M16.95 7.05l1.41-1.41" />
    </>
  ),
  moon: <path d="M20 14.2A8 8 0 0 1 9.8 4a8 8 0 1 0 10.2 10.2Z" />,
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c.6-3.5 3.4-5.5 7-5.5s6.4 2 7 5.5" />
    </>
  ),
  logout: (
    <>
      <path d="M10 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H10" />
      <path d="M14.5 8 19 12l-4.5 4" />
      <path d="M19 12H9.5" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  alert: (
    <>
      <path d="M12 4 2.8 19.5h18.4L12 4Z" />
      <path d="M12 10v4.5" />
      <path d="M12 17v.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <path d="M12 7.75v.01" />
    </>
  ),
  undo: (
    <>
      <path d="M8.5 5 4 9.5 8.5 14" />
      <path d="M4 9.5h10a5.5 5.5 0 0 1 0 11h-3" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 0 1-13.3 4.8" />
      <path d="M4.5 12a7.5 7.5 0 0 1 13.3-4.8" />
      <path d="M18.5 3.5v4h-4" />
      <path d="M5.5 20.5v-4h4" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V4.5h5V7" />
      <path d="M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.5h6.4a1.5 1.5 0 0 0 1.5-1.5l.8-12" />
      <path d="M10 11v5.5M14 11v5.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  edit: (
    <>
      <path d="m14.5 5.5 4 4L8.5 19.5H4.5v-4l10-10Z" />
      <path d="m12.5 7.5 4 4" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="1.5" />
      <path d="M15.5 8.5v-2.5A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  filter: <path d="M4 5.5h16l-6 7.5v5.5l-4 1.5v-7L4 5.5Z" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 5 5" />
    </>
  ),
  grip: (
    <>
      <path d="M9 6v.01M9 12v.01M9 18v.01" />
      <path d="M15 6v.01M15 12v.01M15 18v.01" />
    </>
  ),
  maximize: (
    <>
      <path d="M4.5 9.5v-5h5" />
      <path d="M19.5 14.5v5h-5" />
      <path d="M4.5 4.5 10 10M19.5 19.5 14 14" />
    </>
  ),
  minimize: (
    <>
      <path d="M10 5v5H5" />
      <path d="M14 19v-5h5" />
      <path d="M10 10 4.5 4.5M14 14l5.5 5.5" />
    </>
  ),
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  chevronUp: <path d="m6 14.5 6-6 6 6" />,
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  arrowDown: <path d="M12 5v14M6 13l6 6 6-6" />,
  arrowLeft: <path d="M19 12H5M11 6l-6 6 6 6" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export interface IconProps {
  name: IconName;
  /** Width and height in px. Default 20. */
  size?: number;
  /** Give a label only when the icon stands alone with no text next to it. */
  label?: string;
  className?: string;
}

export function Icon({ name, size = 20, label, className }: IconProps) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {PATHS[name]}
    </svg>
  );
}
