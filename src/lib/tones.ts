import type { Band, Tone } from "./types";

export const TONE_COLOR: Record<Tone, string> = {
  good: "var(--color-good)",
  mid: "var(--color-mid)",
  low: "var(--color-low)",
  neutral: "var(--color-ink-2)",
};

export const TONE_TEXT: Record<Tone, string> = {
  good: "text-[var(--color-good)]",
  mid: "text-[var(--color-mid)]",
  low: "text-[var(--color-low)]",
  neutral: "text-[var(--color-ink-2)]",
};

export const STAGE_COLOR: Record<string, string> = {
  deep: "var(--color-stage-deep)",
  rem: "var(--color-stage-rem)",
  light: "var(--color-stage-light)",
  awake: "var(--color-stage-awake)",
};

export const STAGE_LABEL: Record<string, string> = {
  deep: "Deep",
  rem: "REM",
  light: "Light",
  awake: "Awake",
};

export function bandColor(band: Band) {
  return band === "high"
    ? "var(--color-good)"
    : band === "mid"
      ? "var(--color-mid)"
      : "var(--color-low)";
}
