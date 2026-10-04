"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { motion } from "framer-motion";
import { GLOW_R1_PX, GLOW_R2_PX, HALO, MARK_BOX_PX } from "@/components/splash-mark";

/**
 * The P travels, then the name completes itself.
 *
 * Two movements, in that order, because that is the order the word is read in.
 * The P is the first letter, so it is the thing that moves first; the rest of
 * the name then slides out to meet it rather than arriving with it. Sending the
 * whole lockup across as one piece would be tidier code and a worse moment —
 * it would read as a label being dragged into place, not a name being spelled.
 *
 * The destination is measured rather than guessed, but it is measured as a
 * position only. The mark lands at scale 1 in the nav's own text styling, so
 * the final frame is the nav's own rendering by construction instead of by
 * arithmetic — a rounding error in the measurement cannot leave a half-pixel
 * seam, because there is nothing left to line up. The start is the part that is
 * scaled up from there, and being approximate at the start is invisible in a
 * way that being approximate at the end would not be.
 *
 * The overlay is fixed and click-through, and it is only ever mounted when a
 * target exists. The mobile bar carries icons and no wordmark, so there is
 * nothing there to assemble, and a P flying to an empty corner would be
 * inventing a destination the app does not have.
 */

/* The splash sets the P at this size; the nav sets it at text-sm. The flight
   starts from the large one and lands on the small one. */
const START_PX = 34;
const NAV_PX = 14;

const EASE = [0.16, 1, 0.3, 1] as const;
const FLIGHT_S = 0.68;
/* The glow goes out before the letter goes anywhere.
 *
 * The title card's P is lit, and the P that arrives on Home is lit, so the light
 * is part of the letter for as long as the letter is standing still — and the
 * one thing that must not happen is the light travelling. A glowing letter
 * shrinking across the screen drags a coloured wake with it, the halo and the
 * shadow are sized in proportion to the glyph, and by the corner the thing
 * arriving is a different object from the one that left. So the light is faded
 * first, while the letter holds the centre of the screen, and the flight starts
 * on an unlit letter that is just a letter.
 *
 * The flight waits a shade longer than the fade rather than exactly as long, so
 * there is a frame of darkness before the movement — the two read as two events
 * in that order, and a movement that begins on the same frame the light reaches
 * zero reads as the light being left behind instead. */
const GLOW_FADE_S = 0.3;
const FLIGHT_DELAY_S = GLOW_FADE_S + 0.04;
/* The rest of the name starts as the P is still settling, so the two read as
   one gesture. Starting it after the flight would make it a second beat. */
const ASSEMBLE_AT = FLIGHT_DELAY_S + FLIGHT_S * 0.5;
const ASSEMBLE_S = 0.4;

type Target = { p: DOMRect; rest: DOMRect };

/** Read once, at mount. The nav is already on screen by the time this renders,
 *  and the mark never moves again afterwards, so there is nothing to observe
 *  and nothing to re-read. Measured in the state initialiser rather than in an
 *  effect: an effect would set this in a second render, which means a frame of
 *  the full-size P sitting in the middle of the screen before it flies. */
function measureTarget(): Target | null {
  const p = document.querySelector<HTMLElement>("[data-nav-brand] [data-brand-p]");
  const rest = document.querySelector<HTMLElement>("[data-nav-brand] [data-brand-rest]");
  if (!p || !rest) return null;
  return { p: p.getBoundingClientRect(), rest: rest.getBoundingClientRect() };
}

export function BrandMorph({ onDone }: { onDone: () => void }) {
  const [target] = useState(measureTarget);
  /* One attribute drives both halves of the light — the halo round the letter
     and the shadow inside it — and the stylesheet transitions them, because a
     registered custom property can be faded and an unregistered one cannot. */
  const [glow, setGlow] = useState<"on" | "off">("on");

  /* A frame, so the first frame this draws is a lit letter standing still, which
     is what the mark it is replacing was. Fading it on the same frame it appears
     would start the fade from nothing and put a dip in the light at the seam. */
  useEffect(() => {
    const raf = requestAnimationFrame(() => setGlow("off"));
    return () => cancelAnimationFrame(raf);
  }, []);

  /* Unreachable in practice: ColdStart checks for the mark before deciding to
     fly, and declines when the layout has no wordmark. Left as a guard because
     rendering the wrong thing here would be visible, and the pre-paint failsafe
     releases the panels if this ever returns null. */
  if (!target) return null;

  /* Scale up from the nav's own size, and place the enlarged mark so its centre
     lands in the middle of the screen. The transform origin is the top left, so
     the mark grows toward its own corner and the offset is measured from the
     same corner. */
  const s = START_PX / NAV_PX;
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const fromX = cx - (target.p.width * s) / 2 - target.p.left;
  const fromY = cy - (target.p.height * s) / 2 - target.p.top;

  /* The halo and the glow, at the size the title card drew them.
   *
   * Both are scaled down by the same factor as the letter, in local units, so
   * that at the first frame — the letter still enlarged, still centred — the
   * light around it is the same 64px of halo and the same 18px of shadow the
   * title card had, and the two marks are the same mark. A halo drawn at its
   * title-card size inside a block that is about to be scaled would arrive on
   * screen 2.4 times too wide, which is a coloured ring blooming out of a letter
   * that had not moved.
   *
   * The halo is centred on the same box the letter is placed by, which is the
   * nav P's own line box: this block has that same width and height, so the
   * middle of one is the middle of the other, and no font metric is needed
   * anywhere. */
  const halo = MARK_BOX_PX / s;
  const haloStyle: CSSProperties = {
    width: halo,
    height: halo,
    left: target.p.width / 2 - halo / 2,
    top: target.p.height / 2 - halo / 2,
    background: HALO,
    opacity: glow === "off" ? 0 : 1,
  };
  const glowStyle = {
    "--glow-r1": `${GLOW_R1_PX / s}px`,
    "--glow-r2": `${GLOW_R2_PX / s}px`,
  } as CSSProperties;

  return (
    <div
      className="pointer-events-none fixed inset-0 z-60"
      data-brand-morph
      data-glow-fade
      data-glow={glow}
      aria-hidden
    >
      <motion.div
        className="fixed text-sm font-semibold tracking-tight"
        style={{ left: target.p.left, top: target.p.top, transformOrigin: "top left" }}
        initial={{ x: fromX, y: fromY }}
        animate={{ x: 0, y: 0 }}
        transition={{ duration: FLIGHT_S, delay: FLIGHT_DELAY_S, ease: EASE }}
      >
        <motion.span
          className="relative block"
          style={{ transformOrigin: "top left" }}
          initial={{ scale: s }}
          animate={{ scale: 1 }}
          transition={{ duration: FLIGHT_S, delay: FLIGHT_DELAY_S, ease: EASE }}
        >
          <span aria-hidden className="absolute rounded-full" style={haloStyle} data-mark-halo />
          <span className="mark-glow relative" style={glowStyle} data-brand-p>
            P
          </span>
        </motion.span>
      </motion.div>

      <motion.div
        className="fixed text-sm font-semibold tracking-tight"
        style={{ left: target.rest.left, top: target.rest.top, transformOrigin: "top left" }}
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: ASSEMBLE_S, ease: EASE, delay: ASSEMBLE_AT }}
        onAnimationComplete={onDone}
      >
        <span data-brand-rest>ersonaOS</span>
      </motion.div>
    </div>
  );
}
