// The frame around every page: skip link, sidebar (desktop), header, main, footer and the bottom tab bar
// (under 820px). Mounted once in the root layout.
//
// The sign-in pages get the same header without navigation or account controls.
// Navigation shows only what the signed-in role can use; the server enforces the same rules.

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useData } from "@/components/data/DataProvider";
import { Icon } from "@/components/ui/Icon";
import { DemoFlag } from "./DemoFlag";
import { isSignInPath, navFor } from "./nav";
import type { NavItem } from "./nav";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";
import styles from "./AppShell.module.css";

export const APP_NAME = "Filing Problem Tracker";

const isCurrent = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

function NavLinks({ items, pathname, variant }: { items: readonly NavItem[]; pathname: string; variant: "side" | "tab" }) {
  return (
    <ul className={variant === "side" ? styles.sideList : styles.tabList}>
      {items.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            className={variant === "side" ? styles.sideLink : styles.tabLink}
            aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
          >
            <Icon name={item.icon} size={variant === "side" ? 20 : 22} />
            <span>{variant === "side" ? item.label : item.shortLabel}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { user, mode } = useData();
  const bare = isSignInPath(pathname);
  const items = !bare && user ? navFor(user.role) : [];

  return (
    <div className={bare ? styles.bareFrame : styles.frame}>
      <a className={styles.skip} href="#main">
        Skip to main content
      </a>

      {bare ? null : (
        <aside className={styles.sidebar}>
          <p className={styles.brand}>
            <span className={styles.brandName}>{APP_NAME}</span>
            <span className={styles.brandSub}>Indiana trial courts</span>
          </p>
          <nav aria-label="Main" aria-busy={user ? undefined : true}>
            <NavLinks items={items} pathname={pathname} variant="side" />
          </nav>
          <p className={styles.sideNote}>Sits next to Odyssey and e-filing and changes neither.</p>
        </aside>
      )}

      <div className={styles.column}>
        <header className={styles.header}>
          <p className={bare ? styles.headerBrandAlways : styles.headerBrand}>{APP_NAME}</p>
          {!bare && mode === "demo" ? <DemoFlag className={styles.flag} /> : null}
          <div className={styles.headerTools}>
            <ThemeToggle />
            {bare ? null : <UserMenu />}
          </div>
        </header>

        <main id="main" tabIndex={-1} className={bare ? styles.bareMain : styles.main}>
          {children}
        </main>

        <footer className={styles.footer}>
          <p>
            {mode === "demo" || bare
              ? "CS4535 AI for Impact, Team 1. Counties are real Indiana counties; in the prototype every number, entry, change and export row is invented for illustration. "
              : null}
            This tool does not give legal advice.
          </p>
        </footer>
      </div>

      {bare ? null : (
        <nav className={styles.tabbar} aria-label="Main">
          <NavLinks items={items} pathname={pathname} variant="tab" />
        </nav>
      )}
    </div>
  );
}
