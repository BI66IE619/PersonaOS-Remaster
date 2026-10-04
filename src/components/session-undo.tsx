"use client";

import { useEffect, useRef, useState } from "react";
import { restoreSession, type SportSession } from "@/lib/sports";

/**
 * Undo for a deleted session.
 *
 * Deleting a session is a thing people do by accident more than on purpose: the
 * row is a wide tap target and the thing being lost exists nowhere else, since
 * the form that made it is five fields. Select-then-confirm solved that, at the
 * cost of two deliberate taps every time, which is why the two-tap dance is the
 * thing people get tired of.
 *
 * A delete you can take back is the better trade. The row is one tap, because
 * there is nothing left to protect against: the delete is already reversible, so
 * a confirmation in front of it only teaches the tap until it stops meaning
 * anything. A mis-tap is one more tap, not a retyped form.
 *
 * The undo lives here, outside the list, so it survives the row it refers to
 * disappearing. It times out on its own: an undo strip that never goes away is
 * just a confirmation dialog with extra steps, and holding the deleted session
 * in memory forever is not worth it.
 */

/** Long enough to notice and reach for, short enough not to be furniture. */
const UNDO_MS = 6000;

export type DeletedSession = { session: SportSession; label: string };

export function useUndoDelete() {
  const [pending, setPending] = useState<DeletedSession | null>(null);
  const timer = useRef<number>(0);

  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = 0;
    setPending(null);
  };

  /* The strip is dismissed on unmount, and the timeout cancelled with it, so
     navigating away mid-window does not fire a state update into a dead tree or
     leave a timer running against a store that has moved on. */
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const remove = (session: SportSession, label: string) => {
    if (timer.current) window.clearTimeout(timer.current);
    setPending({ session, label });
    timer.current = window.setTimeout(clear, UNDO_MS);
  };

  /** Puts the session back and drops the strip. */
  const undo = () => {
    if (pending) restoreSession(pending.session);
    clear();
  };

  return { pending, remove, undo, clear };
}

export function UndoBar({ label, onUndo, onDismiss }: { label: string; onUndo: () => void; onDismiss: () => void }) {
  return (
    <div
      className="mt-1.5 flex items-center justify-between gap-3 rounded-md border border-hairline bg-white/[0.06] px-3 py-2"
      /* Announced, because the delete is silent and without this a screen
         reader user has no idea anything happened or that it can be taken back. */
      role="status"
      aria-live="polite"
    >
      <span className="min-w-0 truncate text-[11px] text-ink-3">{label} deleted</span>
      <span className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onUndo}
          className="rounded-md border border-hairline px-2.5 py-1 text-[11px] text-ink transition-colors hover:border-[var(--color-accent)]"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss undo"
          className="rounded-md px-2 py-1 text-[11px] text-ink-3 transition-colors hover:text-ink-2"
        >
          Dismiss
        </button>
      </span>
    </div>
  );
}
