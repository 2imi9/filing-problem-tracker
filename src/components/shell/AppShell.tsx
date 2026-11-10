// The frame around every page, top to bottom: skip link, the navy header band, the tab bar that pins to
// the top of the window while the page scrolls, main, footer. Mounted once in the root layout.
//
// The tab bar is the navigation (<nav aria-label="Main">). Each tab carries its position among the pages
// this role can open, in a circle; the account menu and the theme switch sit at its right end.
// Navigation shows only what the signed-in role can use; the server enforces the same rules.
// The sign-in pages get the same header and footer and no tabs.

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { apiFetch } from "@/components/data/apiClient";
import { useData } from "@/components/data/DataProvider";
import { Icon } from "@/components/ui/Icon";
import type { HealthResponse } from "@/lib/api";
import type { AppMode } from "@/lib/domain";
import { DemoFlag } from "./DemoFlag";
import { aiUseText, footerText } from "./footerText";
import { Mark } from "./Mark";
import { isSignInPath, navFor } from "./nav";
import type { NavItem } from "./nav";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";
import styles from "./AppShell.module.css";

export const APP_NAME = "Filing Problem Tracker";
export const APP_INTRO = "See why court filings from people without lawyers get rejected, and whether fixes work.";

// A transparent 1px image. Phones are given this in place of the header picture, which is hidden there.
const NO_PICTURE = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

const isCurrent = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** What the shell needs to know about the server: the mode it runs in and whether AI features are on. */
interface ServerFacts {
  mode: AppMode;
  ai: boolean;
}

/**
 * The sign-in pages load no account data, so there the shell asks the public health check. The answer
 * only decides which notices show: the prototype line, the made-up-data sentence and the AI sentence.
 */
function useSignInPageFacts(bare: boolean): ServerFacts | null {
  const [facts, setFacts] = useState<ServerFacts | null>(null);
  useEffect(() => {
    if (!bare) return;
    let cancelled = false;
    apiFetch<HealthResponse>("/api/health")
      .then((health) => {
        if (!cancelled) setFacts({ mode: health.mode, ai: health.ai });
      })
      // Not known: the notices that depend on it stay off.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bare]);
  return facts;
}

/**
 * Changing page while scrolled past the header keeps the tab bar at the top of the window and starts
 * the new page at its first line, instead of going back up to the header. Arriving fresh, or changing
 * page with the header still in view, leaves the scroll position alone. Back and Forward are left to
 * the browser, which restores where the person was.
 */
function useKeepTabBarPinned(pathname: string, header: { current: HTMLElement | null }): void {
  const lastScroll = useRef(0);
  const viaHistory = useRef(false);
  const shownPath = useRef(pathname);

  useEffect(() => {
    // The router may reset the scroll position in the same commit as the page change. Scroll events are
    // delivered a frame later, so this still holds where the person was when the page changed.
    const onScroll = () => {
      lastScroll.current = window.scrollY;
    };
    const onHistory = () => {
      viaHistory.current = true;
    };
    // A click (or Enter on a link) starts an ordinary page change, not a Back or Forward.
    const onClick = () => {
      viaHistory.current = false;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("popstate", onHistory);
    window.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("popstate", onHistory);
      window.removeEventListener("click", onClick, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (shownPath.current === pathname) return;
    shownPath.current = pathname;
    if (viaHistory.current) {
      viaHistory.current = false;
      return;
    }
    const barTop = header.current?.offsetHeight ?? 0;
    if (barTop > 0 && Math.max(lastScroll.current, window.scrollY) > barTop) {
      window.scrollTo({ top: barTop, behavior: "instant" });
      lastScroll.current = barTop;
    }
  }, [pathname, header]);
}

/** How far the row of tabs can still be scrolled each way. */
interface MoreTabs {
  left: boolean;
  right: boolean;
}

// Room kept clear at each end of the row for the "more tabs" arrows.
const ARROW_WIDTH = 28;

// The arrows are not for the keyboard: pressing one must not take focus from where it is.
const keepFocus = (event: MouseEvent) => event.preventDefault();

function Tabs({ items, pathname }: { items: readonly NavItem[]; pathname: string }) {
  const listRef = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState<MoreTabs>({ left: false, right: false });

  // On a narrow screen the tabs do not all fit and the row scrolls sideways. An arrow at an end of the
  // row shows that there are more tabs that way.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const left = list.scrollLeft > 1;
      const right = list.scrollLeft + list.clientWidth < list.scrollWidth - 1;
      setMore((previous) => (previous.left === left && previous.right === right ? previous : { left, right }));
    };
    measure();
    list.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => {
      list.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [items]);

  // Brings a tab fully into view inside the row, clear of the arrows (never by scrolling the page).
  const reveal = (tab: Element) => {
    const list = listRef.current;
    if (!list) return;
    const row = list.getBoundingClientRect();
    const box = tab.getBoundingClientRect();
    if (box.left < row.left + ARROW_WIDTH) list.scrollLeft -= row.left + ARROW_WIDTH - box.left;
    else if (box.right > row.right - ARROW_WIDTH) list.scrollLeft += box.right - (row.right - ARROW_WIDTH);
  };

  // The current tab is in view when the page opens and when it changes.
  useEffect(() => {
    const current = listRef.current?.querySelector('[aria-current="page"]');
    if (current) reveal(current);
  }, [pathname, items]);

  const scrollTabs = (direction: -1 | 1) => {
    const list = listRef.current;
    if (!list) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollBy({ left: direction * Math.max(120, list.clientWidth - 2 * ARROW_WIDTH), behavior: calm ? "instant" : "smooth" });
  };

  return (
    <div className={styles.tabsRow}>
      {/* A browser leaves a tab that is half in view where it is when it takes keyboard focus. */}
      <ul className={styles.tabs} ref={listRef} onFocus={(event) => reveal(event.target)}>
        {items.map((item, index) => (
          <li key={item.href}>
            {/* scroll={false}: useKeepTabBarPinned decides where the new page starts. */}
            <Link href={item.href} scroll={false} className={styles.tab} aria-current={isCurrent(pathname, item.href) ? "page" : undefined}>
              {/* The position is for the eye. A screen reader already says "2 of 5" for the list item. */}
              <span className={styles.number} aria-hidden="true">
                {index + 1}
              </span>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
      {/* For pointer and touch only. Keyboard and screen reader users reach every tab in the list itself,
          and the row scrolls to the tab that has focus. */}
      {more.left ? (
        <button type="button" className={`${styles.more} ${styles.moreLeft}`} tabIndex={-1} aria-hidden="true" onMouseDown={keepFocus} onClick={() => scrollTabs(-1)}>
          <Icon name="chevronLeft" size={18} />
        </button>
      ) : null}
      {more.right ? (
        <button type="button" className={`${styles.more} ${styles.moreRight}`} tabIndex={-1} aria-hidden="true" onMouseDown={keepFocus} onClick={() => scrollTabs(1)}>
          <Icon name="chevronRight" size={18} />
        </button>
      ) : null}
    </div>
  );
}

export interface AppShellProps {
  children: ReactNode;
  /**
   * The footer's sentence about AI use, when the caller can say more than the shell can. The shell knows
   * whether AI is on but not which model is configured; a caller that knows (a Server Component reading
   * the server's settings) passes the sentence from aiUseText(enabled, model) here and it is shown as given.
   */
  aiUse?: ReactNode;
}

export function AppShell({ children, aiUse }: AppShellProps) {
  const pathname = usePathname() ?? "/";
  const { user, mode, ai } = useData();
  const bare = isSignInPath(pathname);
  const signInFacts = useSignInPageFacts(bare);
  // Null until the server has answered. Signed in, the mode and the AI switch arrive together with the account.
  const facts: ServerFacts | null = bare ? signInFacts : mode ? { mode, ai } : null;
  const demo = facts?.mode === "demo";
  const aiSentence = aiUse ?? (facts ? aiUseText(facts.ai) : null);
  const role = !bare && user ? user.role : null;
  const items = useMemo(() => (role ? navFor(role) : []), [role]);
  const headerRef = useRef<HTMLElement>(null);
  useKeepTabBarPinned(pathname, headerRef);

  return (
    <div className={styles.frame}>
      <a className={styles.skip} href="#main">
        Skip to main content
      </a>

      <header ref={headerRef}>
        <div className={styles.hero}>
          <picture>
            <source media="(max-width: 640px)" srcSet={NO_PICTURE} />
            {/* A fixed file from /public, shown as a backdrop. Phones get the empty image above and never fetch it. */}
            <img className={styles.heroPicture} src="/brand/courthouse-ascii-hero.jpg" alt="" width={1280} height={560} decoding="async" />
          </picture>
          <div className={`wrap ${styles.heroIn}`}>
            {demo ? <DemoFlag className={styles.heroFlag} /> : null}
            <p className={styles.title}>
              <Mark className={styles.mark} />
              {APP_NAME}
            </p>
            <p className={styles.lede}>{APP_INTRO}</p>
          </div>
        </div>
        {bare ? (
          <div className={styles.bar}>
            <div className={`wrap ${styles.barIn}`}>
              <div className={styles.tools}>
                <ThemeToggle />
              </div>
            </div>
          </div>
        ) : null}
      </header>

      {bare ? null : (
        <nav className={`${styles.bar} ${styles.pinned}`} aria-label="Main" aria-busy={user ? undefined : true}>
          <div className={`wrap ${styles.barIn}`}>
            <Tabs items={items} pathname={pathname} />
            <div className={styles.tools}>
              <ThemeToggle />
              <UserMenu />
            </div>
          </div>
        </nav>
      )}

      <main id="main" tabIndex={-1} className={bare ? styles.bareMain : styles.main}>
        {children}
      </main>

      <footer className={styles.footer}>
        <p className={`wrap ${styles.footerText}`}>
          {footerText(demo)}
          {aiSentence ? <> {aiSentence}</> : null}
        </p>
      </footer>
    </div>
  );
}
