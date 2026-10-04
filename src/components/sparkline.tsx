"use client";

import { useId } from "react";

/**
 * Hand-rolled SVG rather than Recharts: sparklines are decorative weight on
 * this page and a charting library would be dead weight here. Recharts earns
 * its place on the Trends page instead.
 */
export function Sparkline({
  points,
  mean,
  color = "var(--color-accent)",
  height = 40,
  ariaLabel,
}: {
  points: { value: number }[];
  mean: number;
  color?: string;
  height?: number;
  ariaLabel?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const W = 100;
  const H = height;
  const pad = 3;

  if (points.length < 2) {
    return <div style={{ height: H }} />;
  }

  const values = points.map((p) => p.value);
  const min = Math.min(...values, mean);
  const max = Math.max(...values, mean);
  const span = max - min || 1;

  const x = (i: number) => pad + (i / (points.length - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - ((v - min) / span) * (H - pad * 2);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.value).toFixed(2)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(2)},${H - pad} L${x(0).toFixed(2)},${H - pad} Z`;
  const last = points[points.length - 1];
  const meanY = y(mean);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ height: H, width: "100%" }}
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id={`spark-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>

      <path d={area} fill={`url(#spark-${uid})`} />

      {/* Your own 30-day mean — the line everything is judged against. */}
      <line
        x1={0}
        x2={W}
        y1={meanY}
        y2={meanY}
        stroke="var(--color-ink-3)"
        strokeWidth="1"
        strokeDasharray="2 2"
        strokeOpacity="0.75"
        vectorEffect="non-scaling-stroke"
      />

      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />

      {/* Glow lives on the last point only, never the whole line. */}
      <circle cx={x(points.length - 1)} cy={y(last.value)} r="2.4" fill={color} />
      <circle
        cx={x(points.length - 1)}
        cy={y(last.value)}
        r="5"
        fill={color}
        opacity="0.28"
      />
    </svg>
  );
}
