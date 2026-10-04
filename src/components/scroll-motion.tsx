"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/** Everything the app reveals on scroll, without any component having to ask.
 *  A panel opts in by existing; anything can opt in explicitly with
 *  data-reveal. Nested matches collapse to the outermost so a panel inside a
 *  revealed section does not animate twice. */
const REVEAL = "[data-reveal], .panel";

/**
 * Scroll-driven motion, in one place and one observer.
 *
 * Two rules, both about not costing anything:
 *
 * Only elements that start below the fold are animated. Anything already on
 * screen is left completely alone, so first paint is never delayed and nothing
 * is ever hidden while the observer gets around to it. The rise therefore costs
 * a composite when you scroll to it, not a blank frame when the page loads.
 *
 * The observer is one-shot per element. Once shown, an element is unobserved
 * and never measured again, so scrolling back up and down costs nothing at all.
 */
export function ScrollMotion() {
  const pathname = usePathname();
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    /* Panels waiting to be promoted to their own compositor layer, handed out
       one per idle callback. Setting this on everything at once, in one frame,
       is itself a dropped-frames burst: it is the same expensive work, just moved
       from the moment of scrolling to the moment of loading. An idle callback
       runs when the main thread is otherwise idle, so the textures get built
       where nothing is waiting on them. */
    const pending: HTMLElement[] = [];
    let pumping = false;
    const idle =
      (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
        .requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 48));
    const pump = () => {
      const el = pending.shift();
      if (el && el.isConnected) el.dataset.queued = "";
      pumping = pending.length > 0;
      if (pumping) idle(pump);
    };
    const promote = (el: HTMLElement) => {
      pending.push(el);
      if (!pumping) {
        pumping = true;
        idle(pump);
      }
    };

    /* One observer for the lifetime of the effect. Earlier this was torn down
       and rebuilt on each pass, which orphaned anything already queued: it kept
       its hidden state but lost its observer, so it could never be revealed. A
       pass now only ever adds to the set, and never touches an element that is
       already queued or already shown. */
    const io = new IntersectionObserver(
      (entries) => {
        let n = 0;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          /* Cascading left to right across a row. Capped at four and spaced
             60ms apart: at the previous spacing six panels were still
             mid-animation at once, and that is what cost the frames. */
          el.style.setProperty("--reveal-delay", `${Math.min(n++, 3) * 60}ms`);
          el.dataset.shown = "";
          io.unobserve(el);
        }
      },
      { rootMargin: "0px 0px -6% 0px", threshold: 0.01 },
    );

    const start = () => {
      const found = Array.from(document.querySelectorAll<HTMLElement>(REVEAL));
      const all = new Set(found);
      const fold = window.innerHeight * 0.92;
      /* Measured in one pass, then written in another.
         This used to read and write per element: getBoundingClientRect, set
         data-reveal, getBoundingClientRect, set data-reveal. Every write
         invalidates the layout the next read depends on, so the browser
         recomputed the geometry of the whole page once per panel instead of
         once per pass. On a page with a dozen panels that is the 100-160ms task
         blocking the frame a navigation was trying to paint into — measured, not
         assumed, and the reason a tab took most of a second to respond when the
         work involved was only a few hundred microseconds of real logic. */
      const plan: { el: HTMLElement; queue: boolean }[] = [];
      for (const el of found) {
        /* Outermost matches only, so a panel inside a revealed section does not
           animate twice. */
        if (el.parentElement && all.has(el.parentElement)) continue;
        if (el.hasAttribute("data-shown")) continue;
        const top = el.getBoundingClientRect().top;
        if (top < fold) continue;
        plan.push({ el, queue: !el.hasAttribute("data-queued") && top < window.innerHeight * 2.5 });
      }
      for (const { el, queue } of plan) {
        /* Only set the hidden state the first time. Re-setting it would restart
           a transition that is already running, and re-hiding a panel that is
           halfway in looks like a flicker. */
        if (!el.hasAttribute("data-reveal")) el.dataset.reveal = "";
        /* observe() on something already observed is a no-op, which is what
           makes a repeated pass safe. It has to be repeated at all: under
           StrictMode the effect runs, is torn down, and runs again, and the
           second pass is the only thing that re-attaches the observer to the
           panels the first pass queued. Deciding what to observe by whether the
           element already carries data-reveal strands them, hidden forever. */
        io.observe(el);
        /* Promoted while still off screen, but only once the panel is within
           about two and a half screens of the fold. Anything further down is
           left for a later pass, so a long page does not build a layer for
           every panel on the page up front. */
        if (queue) promote(el);
      }
    };

    start();

    /* Panels move after this first pass, because most of them read localStorage
       and only find out their real height once hydrated. A panel measured while
       it was still short can end up below the fold having been treated as
       visible, and would then never animate. So the pass is repeated once
       things have settled, and again whenever the page changes height. */
    const settle = window.setTimeout(start, 600);
    let pendingResize = 0;
    const ro = new ResizeObserver(() => {
      if (pendingResize) return;
      pendingResize = window.setTimeout(() => {
        pendingResize = 0;
        start();
      }, 200);
    });
    ro.observe(document.body);

    return () => {
      window.clearTimeout(settle);
      if (pendingResize) window.clearTimeout(pendingResize);
      ro.disconnect();
      io.disconnect();
    };
  }, [pathname]);

  useEffect(() => {
    const el = bar.current;
    if (!el) return;

    /* The scrollable height is measured only when it can have changed. Reading
       scrollHeight inside a scroll handler would force a layout on every frame,
       which is the single easiest way to make a scroll listener stutter. */
    let max = 0;
    const measure = () => {
      max = document.documentElement.scrollHeight - window.innerHeight;
    };
    measure();

    let raf = 0;
    const paint = () => {
      raf = 0;
      const p = max > 8 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      el.style.transform = `scaleX(${p.toFixed(4)})`;
      el.style.opacity = p > 0.002 ? "1" : "0";
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };

    const ro = new ResizeObserver(() => {
      measure();
      schedule();
    });
    ro.observe(document.body);

    paint();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [pathname]);

  return <div ref={bar} className="progress-hairline" aria-hidden />;
}
