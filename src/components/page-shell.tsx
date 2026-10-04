"use client";

import type { ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";
import { ScrollMotion } from "@/components/scroll-motion";

/**
 * The nav and the page fade both live in the root layout, not here. They used to
 * sit in this shell, which meant every page mounted its own copy: the nav threw
 * away the sliding highlight's position on each navigation, and the fade
 * remounted before it could ever play, because its own first-render guard read
 * every new page as a first load.
 *
 * pb-nav clears the floating mobile bar by its real footprint rather than a
 * guessed constant, so the gap stays a hair's width on a phone with a home
 * indicator and on one without. Desktop keeps pb-20: its nav is in flow.
 *
 * `fill` is for a page that owns the viewport rather than scrolling with the
 * rest of the app — currently just the mentor chat, whose messages scroll inside
 * themselves and whose composer stays put.
 *
 * The height it needs cannot be written down. It is the viewport less whatever
 * the chrome costs, and the chrome is three different things: the desktop nav is
 * in flow and about 52px, the mobile bar is fixed and clears through pb-nav, and
 * pb-nav itself is a calc() of a home indicator. Guessing any of them left the
 * page draggable by a few pixels — the exact feel of a page that should not
 * scroll at all — and an empty chat and a long one were wrong by different
 * amounts, so no single constant could have been right.
 *
 * So it measures. What is above the box is read as its offset from the top of
 * the viewport, which is the nav's real height however it turns out to be
 * rendered, and its own bottom padding is read from the cascade rather than
 * assumed, so it is always the padding that is actually applied at this width.
 * The difference is the height, and the box is a flex column afterwards, which
 * is what gives the chat's scroller something definite to scroll inside.
 *
 * Stretching was the first attempt and cannot work here: the page is `min-h-full`
 * rather than `h-full`, so a long conversation grows the document to fit itself
 * and every flex child in the chain is handed that taller box to divide. The
 * scroller then has nothing to be smaller than, which is the bug this replaced.
 *
 * A layout effect, not a passive one, because the height has to be in place
 * before the first paint. Set afterwards, the page would arrive already
 * scrollable and then stop being — a visible correction, and the one thing a
 * full-height page cannot afford. The height is written straight to the node
 * rather than held in state, since nothing here re-renders on it and a state
 * round trip would only invite a second pass over the same number.
 */
export function PageShell({
  children,
  fill = false,
}: {
  children: ReactNode;
  fill?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!fill || !el) return;

    const fit = () => {
      const top = el.getBoundingClientRect().top;
      const padBottom = parseFloat(getComputedStyle(el).paddingBottom) || 0;
      el.style.height = `${Math.max(0, document.documentElement.clientHeight - top - padBottom)}px`;
    };

    fit();

    /* Re-measured rather than assumed, because the two inputs move for reasons
       this cannot see: the nav is content, so it changes with the font and the
       safe area, and the padding changes at the `sm` boundary. Observing the
       box catches both, and converges — writing the height does not move the
       top edge, so the second pass computes the same number and stops. */
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener("resize", fit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [fill]);

  return (
    <div
      ref={ref}
      data-page-shell
      data-fill={fill ? "" : undefined}
      className={
        fill
          ? "mx-auto flex w-full max-w-6xl flex-col px-4 pb-nav sm:px-6 sm:pb-20"
          : "mx-auto w-full max-w-6xl px-4 pb-nav sm:px-6 sm:pb-20"
      }
    >
      <ScrollMotion />
      {children}
    </div>
  );
}
