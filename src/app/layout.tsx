import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import { AmbientParticles } from "@/components/ambient-particles";
import { AppNav } from "@/components/app-nav";
import { DayRollover } from "@/components/day-rollover";
import { PageFade } from "@/components/page-fade";
import { ColdStart } from "@/components/cold-start";
import { COLD_ENTRY_PROBE } from "@/lib/cold-entry";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PersonaOS",
  description:
    "Your day, decoded against your own baseline. One verdict, not thirty charts.",
  applicationName: "PersonaOS",
  appleWebApp: { capable: true, title: "PersonaOS", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#07080a",
  colorScheme: "dark",
};

/**
 * Holds the panels back until the P has landed, decided before first paint.
 *
 * It has to run before the first paint rather than in an effect, because an
 * effect is too late: the page would paint once with every panel visible and
 * then hide them, and that one-frame flash is more noticeable than the animation
 * it precedes.
 *
 * It runs in the head rather than at the end of the body, and that move is the
 * fix for a flash the body version could not prevent. The document arrives as a
 * stream, and a trailing script is parsed *after* the panels above it, which is
 * long enough for the browser to paint them. The hold was therefore arriving too
 * late to hide anything: the page showed, the panels were pulled out of it, and
 * only then did the P fly. From the head there is no body to have painted yet.
 *
 * The trade is that the target cannot be found from here, because the nav has
 * not been parsed. So the question the script asks is not "is there a brand to
 * fly to" but "is this a launch that is entitled to one" — sessionStorage, the
 * motion preference, and the width at which the desktop nav exists. All three are
 * known before the body exists, and all three are what the decision actually
 * turns on. 640px is the same `sm` the nav is written in, so on a phone this
 * declines without measuring anything and the panels are never hidden at all;
 * on a desktop it proceeds. The brand is still checked for real, in ColdStart,
 * before anything flies.
 *
 * The removal is armed in the same breath as the hiding, and that is the point.
 * Everything visible about the cold start is undone by dropping one attribute,
 * so a React tree that never mounts, a flight that never reports, or a thrown
 * callback all cost an abrupt arrival at worst. None of them can leave a reader
 * looking at an empty page.
 *
 * The only thing written here is one attribute on the root element, and the
 * stagger lives in CSS rather than in inline styles, precisely so that React
 * finds nothing it did not render when it hydrates. The root element carries
 * suppressHydrationWarning for the attribute itself.
 *
 * @see {@link file://./../lib/cold-entry.ts} for the flag this reads.
 */
/* The whole probe lives in lib/cold-entry.ts, which owns both the window and the
   two keys it checks. It used to be assembled here from the sessionStorage key,
   which meant the flags could drift apart: the file that decides whether the
   reader sees the intro and the file that sets it were two places holding the same
   constant, and a mismatch between them would either hide the animation or hold
   the panels back on a page that had no letter to release them. */
const COLD_START = COLD_ENTRY_PROBE;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <head />
        <body className="flex min-h-full flex-col">
          {/* See COLD_START for what this decides and why it has to happen before
              the first paint.

              next/script rather than a raw <script> tag, and this was a real bug
              rather than a warning to silence: React never executes a script tag that
              a component rendered, so the probe worked on the server-rendered HTML
              and did nothing on any client-side navigation — meaning an in-app return
              to Home played the intro without ever having held the letters back.

              In the body rather than the head because that is where next/script
              belongs; with `beforeInteractive` Next injects it before hydration, which
              is what the attribute on <html> needs. */}
          <Script id="cold-entry-probe" strategy="beforeInteractive">
            {COLD_START}
          </Script>
          <AmbientParticles />
          <AppNav />
          {/* A sibling of the page, never a wrapper around it, and that is a
              correctness constraint rather than a preference. Wrapping the page
              shifts React's useId values between the server render and hydration,
              and framer-motion builds its SVG gradient ids from those — so the
              radial ring and every sparkline reported an attribute mismatch on
              Home and nothing else. The intro belongs here anyway: the brand is app
              chrome like the nav, and it mounts once with the layout that owns the
              corner it flies to. */}
          <ColdStart />
          <DayRollover />
          {/* Here rather than in PageShell, because only this survives a
              navigation. Inside a page it was remounted every time, and a remount
              is a first render, so the fade could never play at all. */}
          <PageFade className="flex-1">{children}</PageFade>
        </body>
      </html>
  );
}
