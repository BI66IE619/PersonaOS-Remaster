"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MobileNav } from "@/components/mobile-nav";
import { Brand } from "@/components/brand";

/* Mirrors the mobile bar: Home stands alone, then the four destinations in the
   same order, then Mentor. The brand already links to /home, but a tab you can
   see and land on beats having to infer it from the wordmark. */
const LINKS = [
  { href: "/home", label: "Home" },
  { href: "/vitals", label: "Vitality" },
  { href: "/tasks", label: "Plan" },
  { href: "/notes", label: "Notes" },
  { href: "/money", label: "Money" },
  { href: "/mentor", label: "Mentor" },
] as const satisfies readonly { href: Route; label: string }[];

type NavLink = (typeof LINKS)[number];

function isCurrent(l: NavLink, current: string): boolean {
  return l.href === current;
}

/* The body page is a cutaway of Vitality, not a destination of its own, so it
   keeps Vitality lit. */
const ALSO: Record<string, NavLink["href"]> = { "/body": "/vitals" };

/* Rendered once from the root layout, not from each page. That is the whole
   trick behind the pill: the component keeps its React state across
   navigations, so the highlight has somewhere to slide from. Mounting it per
   page threw that away and every click looked like the pill slid in from the
   right, whichever direction you went. */
export function AppNav() {
  const pathname = usePathname();
  const route = (ALSO[pathname] ?? pathname) as string;
  const current = LINKS.some((l) => l.href === route) ? route : "";
  const listRef = useRef<HTMLDivElement>(null);
  /* One pill, translated between links, instead of a background per link: the
     highlight physically slides to its new home rather than blinking out in
     one place and in somewhere else. */
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const active = list.querySelector<HTMLElement>('[aria-current="page"]');
      /* Off the six tabs (the redirect, /body): leave the pill where it is
         rather than collapsing it. */
      if (!active) return;
      setPill({ x: active.offsetLeft, w: active.offsetWidth });
    };
    measure();
    /* One frame of slack so the browser commits the tab the pill is leaving,
       which is what turns the change into a transition instead of a jump. */
    const raf = requestAnimationFrame(measure);
    /* Font loading and zoom both move the target; the pill follows. */
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [current]);

  /* The splash is a title card, so it has no navigation at all. It used to
     render with only the wordmark suppressed, which left the tabs floating
     at the top of the screen — and because the wordmark was the only thing on
     the left of a justify-between, the list that remained slid over to sit in
     the corner on its own, which read as a stray fragment rather than as a
     deliberate absence. Nothing here is a valid destination before the hand-off
     anyway, so there is nothing useful to show. */
  if (pathname === "/") return null;

  return (
    <>
      <nav
        aria-label="Primary"
        className="mx-auto hidden w-full max-w-6xl items-center justify-between gap-4 px-4 pt-5 sm:flex sm:px-6"
      >
        <Link href="/home" data-nav-brand className="text-sm font-semibold tracking-tight">
          <Brand />
        </Link>
        <div ref={listRef} className="relative flex items-center gap-1">
          <span
            aria-hidden
            /* 140ms, and matched to --dur-page. The pill used to take 200ms,
               which put it finishing *after* the 160ms page fade it is
               accompanying, so on every tab the highlight was the last thing
               still moving — the interface appeared to keep working for a fifth
               of a second after it had already arrived. At the same length as the
               fade they land together, which is what makes it read as one
               movement instead of two. */
            className="pointer-events-none absolute top-0 left-0 h-full rounded-lg transition-all duration-[140ms] ease-out"
            style={{
              background: "#ffffff14",
              transform: pill ? `translateX(${pill.x}px)` : "none",
              width: pill ? pill.w : 0,
              opacity: pill ? 1 : 0,
            }}
          />
          {LINKS.map((l) => {
            const active = isCurrent(l, current);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className="relative rounded-lg px-3 py-1.5 text-sm transition-colors"
                style={{ color: active ? "var(--color-ink)" : "var(--color-ink-3)" }}
              >
                {l.label}
              </Link>
            );
          })}
          {/* Last in the row, and a form rather than a link. /auth/signout is
              POST-only on purpose — a GET would let any page sign the user out
              with an img tag — so it cannot be an <a href>. */}
          <form action="/auth/signout" method="post" className="ml-2">
            <button
              type="submit"
              className="rounded-lg px-3 py-1.5 text-sm text-ink-3 transition-colors hover:text-ink"
            >
              Sign out
            </button>
          </form>
        </div>
      </nav>

      <MobileNav current={current} />
    </>
  );
}
