"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { BrandMorph } from "@/components/brand-morph";
import { Mark } from "@/components/splash-mark";
import { takeColdEntry } from "@/lib/cold-entry";

/**
 * The cold start, and only the cold start.
 *
 * The P stands still, its glow leaves, the P travels to the corner, the name
 * completes itself, and the panels arrive — in that order, because the panels
 * fading up while a letter is still moving would put the payoff in front of the
 * thing earning it.
 *
 * The standing still is the part that has to happen before React exists. The
 * title card ends in a hard navigation, so the P it was holding does not survive
 * to be carried; whatever the next document paints first is what the reader sees
 * in the frame the previous one disappears. So this renders the mark in the
 * server-rendered markup and lets one attribute decide whether it is on screen —
 * and it is the same attribute that already holds the panels, because the two
 * questions have the same answer: is this a launch that is entitled to a letter?
 *
 * Three stages, and only ever one of them at a time. "prepaint" is the letter
 * standing where the title card left it, which is the state the flight takes over
 * from; "flight" is the letter travelling; "idle" is everything else, which is
 * most page loads, and renders nothing at all. The handover is a single state
 * change, so there is never a frame with two letters or a frame with none.
 *
 * The panels are already being held back by the time this mounts. The script in
 * the root layout hid them before the first paint, because an effect is a frame
 * too late and a frame of visible panels before they vanish is worse than no
 * animation. So there is nothing here to set up: this spends the flag, holds the
 * letter, flies it, and drops one attribute.
 *
 * That single attribute is deliberately the whole cleanup. The flag is consumed
 * rather than merely read, which is what makes the in-app case work — the launch
 * that authorised the intro spends it, so arriving later from Notes or Vitality
 * finds nothing waiting, flies nothing, and holds nothing back. Nothing has to
 * know which way you came.
 *
 * Reduced motion is opted out here as well as in the script. The script declines
 * to hide anything in that case, so there would be nothing to release; the flag
 * is still consumed, because a launch that will not be rewarded should not leave
 * a claim behind for a later one to honour.
 *
 * Rendered by the root layout beside the nav rather than wrapped around a page.
 * Wrapping the page is the obvious place for it and it is wrong: it shifts
 * React's useId values between the server render and hydration, and framer-motion
 * derives its SVG gradient ids from those, so the radial ring and every
 * sparkline reported a hydration mismatch. It belongs with the nav anyway — the
 * brand is app chrome, and this mounts once with the layout that owns the corner
 * the P is flying to.
 */
type Stage = "prepaint" | "flight" | "idle";

export function ColdStart() {
  const reduced = useReducedMotion();
  const [stage, setStage] = useState<Stage>("prepaint");
  /* The flag is spent, not read, and under StrictMode this effect runs, is torn
     down, and runs again. A plain "have I claimed it" guard would be wrong: the
     teardown cancels the scheduled frame, and the second pass would return
     without scheduling another, so the flight would be cancelled and never
     restarted. So the verdict is cached and the work is not. The flag is claimed
     once, and both passes go on to schedule a frame — the teardown discards one
     and the next pass puts a fresh one in its place. */
  const verdict = useRef<boolean | null>(null);
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (verdict.current === null) verdict.current = takeColdEntry();
    /* Both ways out of here release the hold in the same tick, because a page
       that was hidden and never revealed is the one failure mode with no way
       back. They differ only in whether there was ever a letter standing on it.
       The letter is not decided in this effect at all — the pre-paint attribute
       it is gated on is already the authority, and this is what takes the
       markup out of the document once that authority has said no. Removing it in
       this tick would be a synchronous setState in the effect body, so it waits a
       frame, during which the mark is `display: none` like it has been all along. */
    const decline = () => {
      delete document.documentElement.dataset.intro;
      const idle = requestAnimationFrame(() => setStage("idle"));
      return () => cancelAnimationFrame(idle);
    };
    /* The pre-paint script in the head already declined reduced motion, so this
       cannot normally be reached — but it is a second, independent decision
       about the same thing, and if the two ever disagree the hold must still be
       released. The flag is still spent either way, because a launch that will
       not be rewarded should not leave a claim behind for a later one. */
    if (!verdict.current || reduced) return decline();
    /* The mobile bar is icons with no wordmark, so there is no corner to send
       the P to. The element is still in the document there, merely collapsed to
       nothing, so this asks whether it has width rather than whether it exists —
       a presence test would find a target nobody can see, hold the panels for a
       flight with nowhere to land, and leave the reader with an empty page. The
       head script declines below the same width without measuring, so this is
       normally a belt-and-braces check rather than the one that does the work. */
    const mark = document.querySelector<HTMLElement>("[data-nav-brand] [data-brand-p]");
    if (!mark || mark.getBoundingClientRect().width === 0) return decline();
    /* One frame, so the frame the script held back is painted before the flight
       begins. Starting immediately would have the P leave in the very frame the
       panels were hidden in, and the two happening together reads as the page
       flinching rather than as a title card handing over.

       The same frame is also what the standing mark needs: it is the letter in
       the position the title card left it, lit, so the change to "flight" is a
       change of who is drawing it and not a change of where it is. */
    const raf = requestAnimationFrame(() => setStage("flight"));
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  /* Released by renaming the attribute rather than deleting it. The transition
     on the panels lives in the rule that the attribute selects, so deleting it
     in the same tick would take the transition with it and the arrival would pop
     instead of fading. Renaming to "done" keeps the rule matching — the selector
     is on the attribute, not on its value — for exactly as long as the last
     panel needs, which is the 180ms furthest delay plus the 300ms duration, and
     then it is removed outright.

     The wait is a timer rather than a transitionend listener on purpose. The
     panels are siblings under one root, and the furthest one is the one that
     decides, so listening for the first panel to finish would clear the
     attribute while three others were still moving. The pre-paint script's
     three-second failsafe stays as the backstop for the case this never runs at
     all: a launch that claimed the flag but never mounted, such as a
     navigation away mid-flight.

     The flight itself is held rather than dropped here, and this is the fix for
     the name blinking out at the end of the sequence. Renaming the attribute to
     "done" is what fades the nav's own wordmark back in, and it needs 240ms to
     get there; unmounting the overlay on the same tick removed the only other
     copy, so the corner was empty for the length of the whole settle timer
     before the real one arrived. The two are drawn in the same place at the same
     size by construction — the flight lands on the nav's own rendering — so
     holding the overlay across the brand's fade costs nothing visible and closes
     the gap.

      The duration is read from the element instead of written here, because this
      is a number the stylesheet owns. Duplicating it would let the two drift, and
      a hold that came up short would reopen the very gap it exists to close.

      The stage ends with the flight rather than going back to the standing mark:
      the letter is the nav's business now, and a mark that reappeared behind the
      revealed page would be a 34px P in the middle of a dashboard. */
  const land = useCallback(() => {
    const brand = document.querySelector<HTMLElement>("[data-nav-brand]");
    const fadeMs = brand
      ? (Number.parseFloat(getComputedStyle(brand).transitionDuration) || 0) * 1000
      : 0;
    document.documentElement.dataset.intro = "done";
    const handover = setTimeout(() => setStage("idle"), fadeMs);
    const settle = setTimeout(() => {
      delete document.documentElement.dataset.intro;
    }, 600);
    cleanup.current = () => {
      clearTimeout(handover);
      clearTimeout(settle);
    };
  }, []);

  useEffect(() => () => cleanup.current?.(), []);

  if (stage === "flight") return <BrandMorph onDone={land} />;
  if (stage === "idle") return null;

  /* The letter, standing where the title card left it. Server-rendered, and held
     by [data-intro] rather than by anything decided here: this runs after the
     first paint, which is the frame the mark has to already be in. Decorative,
     so it is out of the accessibility tree — the nav's own wordmark is the one
     the reader is meant to have. */
  return (
    <div
      aria-hidden
      data-splash-prepaint
      className="pointer-events-none fixed inset-0 z-60 flex items-center justify-center"
    >
      <Mark />
    </div>
  );
}
