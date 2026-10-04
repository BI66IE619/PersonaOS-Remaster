"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Mark, loaderOffset } from "@/components/splash-mark";
import { markColdEntry } from "@/lib/cold-entry";

/**
 * The opening. Just the P, held steady, then handed to Home.
 *
 * It used to carry the wordmark too, and that turned out to be the thing worth
 * removing. The brand assembles itself on the other side: the P travels to the
 * corner and "ersonaOS" slides out to meet it. A wordmark centred here would
 * have to vanish so the same word could reappear in the corner, and that
 * disappear-and-reappear is exactly the seam this is meant to not have. With the
 * wordmark only ever appearing at its destination, the P is the one continuous
 * element across the whole hand-off, and the eye has a single thing to follow.
 *
 * So it does not fade out either. It holds, and the same P is already standing
 * in the same spot on the other side of the navigation, so the swap is invisible
 * and the movement that follows belongs to one letter rather than to a crossfade.
 *
 * "Already standing in the same spot" is a claim about two documents, and it used
 * to be an aspiration rather than a fact: nothing carried the P across, and the
 * page it arrived at had none until React had mounted. It does now — the mark
 * below is drawn from shared numbers by both sides of the navigation, and the
 * cold start draws it again before anything runs. See splash-mark.tsx.
 *
 * The hold is skipped entirely under prefers-reduced-motion: the global CSS
 * rule collapses CSS animation but not a JS-driven one, so this has to opt out
 * itself rather than rely on the stylesheet.
 */
export function Splash() {
  const reduced = useReducedMotion();
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (reduced) {
      /* No flag, because no intro follows. Leaving one behind would authorise a
         hand-off that is never going to consume it. */
      window.location.replace("/home");
      return;
    }
    /* A hard navigation, not router.replace, and the difference is the whole
       reason this works. Holding the panels back has to happen before the first
       paint of the page that follows, and the only code that runs before that
       paint is the pre-paint script in the root layout — which a client-side
       navigation never re-runs, because the layout is not re-rendered. Routing
       in-app would land on a fully painted page and then hide the panels behind
       it, which is the one-frame flash the script exists to prevent.

       location.replace rather than assign, so the title card is still replaced in
       history and the back button does not walk into it. */
    const leave = setTimeout(() => setLeaving(true), 750);
    const go = setTimeout(() => {
      markColdEntry();
      window.location.replace("/home");
    }, 950);
    return () => {
      clearTimeout(leave);
      clearTimeout(go);
    };
  }, [reduced]);

  return (
    <div className="fixed inset-0">
      {/* The P, and only the P, in the middle of the screen. It used to share a
          centred column with the loader line, which is what lifted it 12.5px off
          the centre — and the flight on the other side of the navigation centres
          the letter properly, so the hand-off was quietly moving the P 12.5px as
          it changed documents. A letter that hops is not travelling, so the two
          are now positioned independently and agree by construction. */}
      <motion.div
        initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="absolute inset-0 flex items-center justify-center"
      >
        <Mark kind="splash" />
      </motion.div>

      {/* A loader rather than a wordmark. The line is indeterminate, so it reads
          as work still happening and not as a progress bar pretending to know how
          much is left. Its offset is the one the column used to produce, kept
          here rather than recomputed so it cannot drift from where it was. */}
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: leaving ? 0.45 : 1 }}
        transition={{ duration: 0.5, delay: leaving ? 0 : 0.3 }}
        style={loaderOffset()}
        className="absolute inset-x-0 top-1/2 mx-auto h-px w-16 overflow-hidden rounded-full bg-white/10"
      >
        <motion.span
          className="block h-full w-1/2 rounded-full"
          style={{ background: "linear-gradient(90deg, transparent, var(--color-accent))" }}
          animate={{ x: ["-100%", "200%"] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
        />
      </motion.span>

      {/* Announced, then moved past, so a screen reader is not left on a page
          that is about to disappear under it. */}
      <span className="sr-only" role="status">
        Loading PersonaOS
      </span>
    </div>
  );
}
