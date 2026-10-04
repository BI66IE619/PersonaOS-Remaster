"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Eases out the flash on a page change.
 *
 * There are two things on screen at once while a route loads: the page you are
 * leaving and the one arriving. The inner content swaps the instant the payload
 * lands, so the arrival is instantaneous and the departure vanishes in the same
 * frame — which reads as a flicker rather than as speed, however quick the
 * navigation actually was.
 *
 * Fading the arriving page up is the cheapest fix for that specific problem. It
 * is opacity alone, so the compositor runs it without asking the main thread for
 * a layout, and it cannot cost a frame on a page that was about to paint anyway.
 *
 * Two details keep it from becoming a bug:
 *
 * The fade is a CSS animation with a fill mode, not a transitioned opacity. An
 * animation that has finished holds its end value on its own, so a dropped
 * timer or a throttled background tab cannot leave the page stuck at a low
 * opacity — the worst outcome here is a page that never gets brighter, and the
 * animation makes that impossible.
 *
 * The first render is skipped. The server render has to be the real page, not a
 * transparent one, and there is no navigation to ease out of anyway.
 *
 * Deliberately not a skeleton and not a spinner. Both say "something is wrong
 * with this page", and nothing is: the data is already here in localStorage,
 * which is why the wait is short enough that dressing it up would be theatre.
 */
export function PageFade({ children, className }: { children: React.ReactNode; className: string }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || first.current) {
      first.current = false;
      return;
    }

    /* An animation only plays when the property it is attached to *changes*, so
       a second navigation would find the attribute still set from the first and
       play nothing. Clearing it first is what makes every page change fade
       rather than only the first one. */
    el.removeAttribute("data-entering");
    /* One frame, so the removal is committed before it is put back. Without
       this the browser coalesces both writes into no change at all, and the
       animation does not restart. */
    const raf = window.requestAnimationFrame(() => {
      if (!el.isConnected) return;
      el.dataset.entering = "";
    });

    /* Taken off when the fade is over, which is what arms the next navigation.
       If this never fires the page is still fully opaque anyway — the animation
       fills forwards — so a missed event costs a repeat fade, never a dim page. */
    const done = () => el.removeAttribute("data-entering");
    el.addEventListener("animationend", done);

    return () => {
      window.cancelAnimationFrame(raf);
      el.removeEventListener("animationend", done);
    };
  }, [pathname]);

  return (
    <div ref={ref} className={className} data-page-fade>
      {children}
    </div>
  );
}
