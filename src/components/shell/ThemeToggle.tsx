// The light / dark switch at the right end of the tab bar (on the sign-in pages, which have no tab bar,
// at the right end of the footer). One button: its label says what pressing it will do.

"use client";

import { useSyncExternalStore } from "react";
import { IconButton } from "@/components/ui/Button";
import { currentTheme, setTheme, subscribeToTheme } from "./theme";
import type { Theme } from "./theme";

// The server cannot know the theme, so it renders the light label; the browser corrects it on hydration.
const serverTheme = (): Theme => "light";

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeToTheme, currentTheme, serverTheme);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return <IconButton icon={next === "dark" ? "moon" : "sun"} label={`Switch to ${next} theme`} onClick={() => setTheme(next)} />;
}
