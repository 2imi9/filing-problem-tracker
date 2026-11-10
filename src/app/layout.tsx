import type { Metadata, Viewport } from "next";
import { io } from "next/cache";
import localFont from "next/font/local";
import { Suspense } from "react";
import { DataProvider } from "@/components/data/DataProvider";
import { AppShell } from "@/components/shell/AppShell";
import { aiUseText } from "@/components/shell/footerText";
import { THEME_INIT_SCRIPT } from "@/components/shell/theme";
import { ToastProvider } from "@/components/ui/Toast";
import { AI_ENABLED, AI_MODEL } from "@/server/config";
import "./globals.css";

// Fonts are self-hosted so a build needs no network. Each sets a CSS variable that globals.css maps to
// --font-heading, --font-body and --font-mono.
const garamond = localFont({
  src: "../fonts/eb-garamond-latin-wght-normal.woff2",
  weight: "400 800",
  style: "normal",
  variable: "--font-eb-garamond",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});

const lato = localFont({
  src: [
    { path: "../fonts/lato-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../fonts/lato-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-lato",
  display: "swap",
  adjustFontFallback: "Arial",
});

const plexMono = localFont({
  src: [
    { path: "../fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: { default: "Filing Problem Tracker", template: "%s | Filing Problem Tracker" },
  description:
    "A tool for Indiana trial courts: clerks tag what was wrong with a rejected filing from an unrepresented party, and court leaders see which problems are most common.",
  // An internal tool: keep it out of search results.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  // The navy of the header band, which is what sits under the browser's own bar in both themes.
  themeColor: "#172554",
};

// The footer says which features use AI and names the model. Only the running server knows both (the
// settings can differ from the ones the app was built with), so this is left out of the prerendered page
// and filled in for each request: io() never resolves during a prerender.
async function AiUse() {
  await io();
  return aiUseText(AI_ENABLED, AI_MODEL);
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the script below may set data-theme before React hydrates.
    <html lang="en" className={`${garamond.variable} ${lato.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <DataProvider>
          <ToastProvider>
            <AppShell
              aiUse={
                <Suspense fallback={null}>
                  <AiUse />
                </Suspense>
              }
            >
              {children}
            </AppShell>
          </ToastProvider>
        </DataProvider>
      </body>
    </html>
  );
}
