"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Mark } from "@/components/splash-mark";

/**
 * The phone's half of the cold start.
 *
 * The desktop intro hands the P to the wordmark in the nav corner. The phone has no
 * wordmark — its bar is icons — so there is nowhere to fly to. Rather than drop the
 * intro there, this keeps the P the splash left on screen, waits a beat so the
 * change of document is invisible, then lets it dissolve while the page behind it
 * arrives. Same letter, same seam, same hand-off; only the destination differs,
 * because the phone does not have one.
 *
 * The exit is a scale-down and fade rather than a travel, which is the honest
 * version of the desktop gesture without a corner to travel to: the letter leaves
 * the centre of the screen instead of pretending to land somewhere it cannot.
 */
const HOLD_MS = 120;
const EXIT_S = 0.38;
const EASE = [0.16, 1, 0.3, 1] as const;

export function MobileIntro({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    /* One beat of the lit letter standing still, exactly as the splash left it. */
    const hold = setTimeout(() => setLeaving(true), HOLD_MS);
    return () => clearTimeout(hold);
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-60 flex items-center justify-center"
      data-mobile-intro
    >
      <motion.div
        /* initial={false}: the letter is already on screen, drawn by the pre-paint
           mark, so it must start at full size rather than fade up from nothing. */
        initial={false}
        animate={
          leaving
            ? { opacity: 0, scale: 0.86, y: -8, filter: "blur(2px)" }
            : { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }
        }
        transition={{ duration: EXIT_S, ease: EASE }}
        onAnimationComplete={() => {
          if (leaving) onDone();
        }}
      >
        <Mark kind="stand" />
      </motion.div>
    </div>
  );
}
