import Link from "next/link";
import type { Route } from "next";
import { House, HeartPulse, ListTodo, NotebookPen, Sparkles, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type MobileLink = {
  href: Route;
  label: string;
  icon: LucideIcon;
  also?: readonly string[];
};

const LINKS = [
  { href: "/vitals", label: "Vitality", icon: HeartPulse },
  { href: "/tasks", label: "Plan", icon: ListTodo },
  { href: "/notes", label: "Notes", icon: NotebookPen },
  { href: "/money", label: "Money", icon: Wallet },
] as const satisfies readonly MobileLink[];

function isCurrent(l: MobileLink, current: string): boolean {
  if (l.href === current) return true;
  return "also" in l && (l.also as readonly string[]).includes(current);
}

/**
 * The only frosted surface in the app. Everything else earns its depth from the
 * particle field instead, because a backdrop-filter has to be recomposited on
 * every scroll frame and the panels scroll. This bar does not — it is pinned, so
 * the cost is one blur of a strip that never moves.
 *
 * Three pieces rather than one row: the home button and the mentor button are
 * circular and stand apart from the four, so the destinations never read as a
 * single crowded row. Mentor is separate from the pill for a second reason — it
 * is the one tab that talks, and grouping it with the four places you go to
 * look at things would imply it is the same kind of place.
 */
export function MobileNav({ current }: { current: string }) {
  return (
    <nav
      aria-label="Primary"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center pb-[max(var(--nav-gap),env(safe-area-inset-bottom))] sm:hidden"
    >
      <div className="pointer-events-auto flex items-center gap-2.5">
        <Link
          href="/home"
          aria-label="Home"
          aria-current={current === "/home" ? "page" : undefined}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 transition-colors"
          style={{
            background: "linear-gradient(180deg, #ffffff24 0%, #ffffff10 100%)",
            backdropFilter: "blur(var(--blur-glass))",
            boxShadow: "inset 0 1px 0 0 #ffffff33, 0 10px 30px -14px #000000e6",
            color: current === "/home" ? "var(--color-ink)" : "var(--color-ink-3)",
          }}
        >
          <House size={19} strokeWidth={2} aria-hidden />
        </Link>

        <div
          className="flex items-center gap-0.5 rounded-full border border-white/25 p-1"
          style={{
            background: "linear-gradient(180deg, #ffffff24 0%, #ffffff10 100%)",
            backdropFilter: "blur(var(--blur-glass))",
            boxShadow: "inset 0 1px 0 0 #ffffff33, 0 10px 30px -14px #000000e6",
          }}
        >
          {LINKS.map((l) => {
            const active = isCurrent(l, current);
            const Icon = l.icon;
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-label={l.label}
                aria-current={active ? "page" : undefined}
                className="flex h-9 w-9 items-center justify-center rounded-full transition-colors"
                style={{
                  background: active ? "#ffffff1f" : "transparent",
                  color: active ? "var(--color-ink)" : "var(--color-ink-3)",
                }}
              >
                <Icon size={18} strokeWidth={2} aria-hidden />
              </Link>
            );
          })}
        </div>

        <Link
          href="/mentor"
          aria-label="Mentor"
          aria-current={current === "/mentor" ? "page" : undefined}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 transition-colors"
          style={{
            background: "linear-gradient(180deg, #ffffff24 0%, #ffffff10 100%)",
            backdropFilter: "blur(var(--blur-glass))",
            boxShadow: "inset 0 1px 0 0 #ffffff33, 0 10px 30px -14px #000000e6",
            color: current === "/mentor" ? "var(--color-ink)" : "var(--color-ink-3)",
          }}
        >
          <Sparkles size={19} strokeWidth={2} aria-hidden />
        </Link>
      </div>
    </nav>
  );
}
