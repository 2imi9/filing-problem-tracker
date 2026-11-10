"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import styles from "./how.module.css";

const STILL = "/media/courthouse_leaves_still.png";
const LOOP = "/media/courthouse_leaves_loop.mp4";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeToMotion(onChange: () => void): () => void {
  const media = window.matchMedia(REDUCED_MOTION);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const prefersReducedMotion = () => window.matchMedia(REDUCED_MOTION).matches;
// The server cannot know the preference, so it sends the still image only. The loop is added in the
// browser, and only when motion has not been turned down.
const reducedMotionOnServer = () => true;

/**
 * The page header: the courthouse photograph with the page title over it. Where motion is welcome the
 * photograph is replaced by a short silent loop of the same scene, with a pause button. The loop stops
 * while it is scrolled out of view.
 */
export function CourthouseHero({ children }: { children: ReactNode }) {
  const reduced = useSyncExternalStore(subscribeToMotion, prefersReducedMotion, reducedMotionOnServer);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(true);
  const rootRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || reduced) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.1 });
    observer.observe(root);
    return () => observer.disconnect();
  }, [reduced]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused || !inView) {
      video.pause();
      return;
    }
    // Browsers only start a video on their own when it is muted.
    video.muted = true;
    // If the browser refuses to start it, show the control as paused so it can be started by hand.
    video.play().catch(() => setPaused(true));
  }, [paused, inView, reduced]);

  return (
    <header ref={rootRef} className={styles.hero}>
      <Image
        className={styles.media}
        src={STILL}
        alt="A stone county courthouse with a clock tower, seen between tree branches."
        fill
        sizes="(min-width: 820px) calc(100vw - 240px), 100vw"
        loading="eager"
        fetchPriority="high"
      />
      {reduced ? null : (
        <video ref={videoRef} className={styles.media} src={LOOP} poster={STILL} autoPlay muted loop playsInline preload="metadata" aria-hidden="true" tabIndex={-1} />
      )}
      <div className={styles.scrim} />
      <div className={styles.heroText}>{children}</div>
      <div className={styles.heroFoot}>
        <p className={styles.credit}>Photo: credit to be added</p>
        {reduced ? null : (
          <button type="button" className={styles.pause} onClick={() => setPaused((value) => !value)}>
            <Icon name={paused ? "play" : "pause"} size={18} />
            <span>{paused ? "Play video" : "Pause video"}</span>
          </button>
        )}
      </div>
    </header>
  );
}
