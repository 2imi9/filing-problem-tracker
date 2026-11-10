// Buttons and button-styled links.
//
//   <Button onClick={...}>Clear</Button>                    secondary (outlined), the default
//   <Button variant="accent" type="submit">Save tags</Button>  the ONE main action of a view
//   <Button variant="primary">Sort into categories</Button> navy, for other important actions
//   <Button variant="ghost" icon="refresh">Refresh</Button> quiet, for toolbars
//   <Button variant="danger">Delete</Button>
//   <Button loading>Save tags</Button>                      shows a spinner, sets aria-busy, ignores clicks
//   <Button size="sm">...</Button>                          36px tall for dense toolbars (still 44px wide tap area on touch)
//   <IconButton icon="close" label="Close panel" />         icon only; `label` is required and becomes aria-label and tooltip
//   <LinkButton href="/dashboard" variant="primary">Open the dashboard</LinkButton>
//
// Button passes every other prop to <button> and defaults type to "button" (not "submit").
// All sizes are at least 44px tall on touch screens.

"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import styles from "./Button.module.css";

export type ButtonVariant = "secondary" | "primary" | "accent" | "ghost" | "danger";
export type ButtonSize = "md" | "sm";

interface Shared {
  /** Default "secondary". Use "accent" for the single main action of a view and nowhere else. */
  variant?: ButtonVariant;
  /** Default "md" (44px). "sm" is 36px on pointer devices. */
  size?: ButtonSize;
  /** An icon before the text. */
  icon?: IconName;
  /** Stretch to the width of the container. */
  block?: boolean;
}

export interface ButtonProps extends Shared, ButtonHTMLAttributes<HTMLButtonElement> {
  /** Shows a spinner and blocks clicks while true. */
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

function classes(variant: ButtonVariant, size: ButtonSize, block: boolean | undefined, extra?: string): string {
  return [styles.button, styles[variant], styles[size], block ? styles.block : "", extra ?? ""].filter(Boolean).join(" ");
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  block,
  loading = false,
  className,
  children,
  type = "button",
  onClick,
  ref,
  "aria-disabled": ariaDisabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={classes(variant, size, block, className)}
      aria-busy={loading || undefined}
      // A loading button stays focusable (so focus is not lost) but does nothing.
      aria-disabled={loading || ariaDisabled}
      onClick={loading ? (event) => event.preventDefault() : onClick}
    >
      {loading ? <span className={styles.spin} aria-hidden="true" /> : icon ? <Icon name={icon} size={18} /> : null}
      <span>{children}</span>
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  icon: IconName;
  /** Required: what the button does. Read by screen readers and shown as a tooltip. */
  label: string;
  /** Default "ghost". */
  variant?: ButtonVariant;
  /** Default "md" (44px square). "sm" is 36px on pointer devices. */
  size?: ButtonSize;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({ icon, label, variant = "ghost", size = "md", className, type = "button", ref, ...rest }: IconButtonProps) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={[classes(variant, size, false, className), styles.iconOnly].join(" ")}
    >
      <Icon name={icon} size={size === "sm" ? 18 : 20} />
    </button>
  );
}

export interface LinkButtonProps extends Shared {
  href: string;
  children: ReactNode;
  className?: string;
}

/** A link that looks like a button. Use for navigation; use Button for actions. */
export function LinkButton({ href, variant = "secondary", size = "md", icon, block, className, children }: LinkButtonProps) {
  return (
    <Link href={href} className={classes(variant, size, block, className)}>
      {icon ? <Icon name={icon} size={18} /> : null}
      <span>{children}</span>
    </Link>
  );
}
