"use client";

import { useEffect, useId } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import { bandFor } from "@/lib/scoring";
import { bandColor } from "@/lib/tones";

type Size = "hero" | "lg" | "sm";

const GEOMETRY: Record<Size, { px: number; stroke: number; font: string }> = {
  hero: { px: 168, stroke: 9, font: "text-5xl" },
  lg: { px: 72, stroke: 6, font: "text-lg" },
  sm: { px: 48, stroke: 5, font: "text-sm" },
};

/** Headroom for the drop-shadow. Without it the glow is clipped by the SVG
    viewport and reads as a pasted-on halo. */
const GLOW_PAD = 20;

export function RadialStat({
  value,
  max = 100,
  size = "hero",
  suffix = "",
  caption,
  ariaLabel,
}: {
  value: number;
  max?: number;
  size?: Size;
  suffix?: string;
  caption?: string;
  ariaLabel?: string;
}) {
  const { px, stroke, font } = GEOMETRY[size];
  const reduced = useReducedMotion();
  const uid = useId().replace(/:/g, "");

  const box = px + GLOW_PAD * 2;
  const r = px / 2 - stroke / 2 - 2;
  const c = 2 * Math.PI * r;
  const target = Math.max(0, Math.min(1, value / max));

  // The glow matches the band, so the colour is the value — twice over.
  const glow = bandColor(bandFor(target * max));

  const motionValue = useMotionValue(0);
  const display = useTransform(motionValue, (v) => Math.round(v));

  useEffect(() => {
    if (reduced) {
      motionValue.set(value);
      return;
    }
    const controls = animate(motionValue, value, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => controls.stop();
  }, [value, motionValue, reduced]);

  const offset = c * (1 - target);

  return (
    <div
      className="relative shrink-0"
      style={{ width: px, height: px }}
      role="img"
      aria-label={ariaLabel ?? `${value}${suffix}`}
    >
      <svg
        width={box}
        height={box}
        viewBox={`0 0 ${box} ${box}`}
        className="-rotate-90 overflow-visible"
        style={{ margin: -GLOW_PAD }}
      >
        <defs>
          {/* The stroke gradient IS the value — red through amber to green. */}
          <linearGradient id={`grad-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-low)" />
            <stop offset="52%" stopColor="var(--color-mid)" />
            <stop offset="100%" stopColor="var(--color-good)" />
          </linearGradient>
        </defs>
        <circle
          cx={box / 2}
          cy={box / 2}
          r={r}
          fill="none"
          stroke="#ffffff1a"
          strokeWidth={stroke}
        />
        <motion.circle
          cx={box / 2}
          cy={box / 2}
          r={r}
          fill="none"
          stroke={`url(#grad-${uid})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          animate={{ strokeDashoffset: offset }}
          initial={{ strokeDashoffset: c }}
          transition={{ duration: reduced ? 0 : 0.9, ease: [0.16, 1, 0.3, 1] }}
          style={{ filter: `drop-shadow(0 0 5px ${glow})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className={`num font-semibold tracking-tight ${font}`}>
          <motion.span>{display}</motion.span>
          <span className="text-ink-3 text-2xl ml-0.5 align-super">{suffix}</span>
        </div>
        {caption ? <div className="label-xs mt-1.5">{caption}</div> : null}
      </div>
    </div>
  );
}
