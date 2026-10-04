"use client";

import { useEffect, useRef } from "react";

type Particle = {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  a: number;
  phase: number;
};

/**
 * The ambient layer the glass panels sit against: a few dozen slow white motes
 * drifting upward, plus the soft white bloom in CSS behind them.
 *
 * Deliberately not scroll-linked. A canvas of ~60 arcs is a fraction of the cost
 * of a backdrop-filter, and it composites once per frame regardless of how many
 * panels are on screen.
 */
export function AmbientParticles() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const count = Math.min(90, Math.round((w * h) / 9_000));
    const parts: Particle[] = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.6 + Math.random() * 2.1,
      vx: (Math.random() - 0.5) * 0.14,
      vy: -(0.05 + Math.random() * 0.16),
      a: 0.08 + Math.random() * 0.26,
      phase: Math.random() * Math.PI * 2,
    }));

    let raf = 0;
    let t = 0;

    const frame = () => {
      ctx.clearRect(0, 0, w, h);
      t += 0.006;
      for (const p of parts) {
        if (!reduced) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.y < -8) {
            p.y = h + 8;
            p.x = Math.random() * w;
          }
          if (p.x < -8) p.x = w + 8;
          if (p.x > w + 8) p.x = -8;
        }
        const twinkle = reduced ? 1 : 0.62 + 0.38 * Math.sin(t * 1.7 + p.phase);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${(p.a * twinkle).toFixed(3)})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 -z-10" />;
}
