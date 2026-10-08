"use client";

import { useCallback } from "react";
import { removeSession, type SportSession } from "@/lib/sports";
import { useUndoDelete } from "@/components/session-undo";

/**
 * One-tap delete for a logged session, shared by the Home row and the Vitality
 * list.
 *
 * This used to be select-then-confirm, because a session exists nowhere else —
 * the form is five fields and there is no second copy. Undo removes that reason:
 * a mistake is now one tap back, so asking for confirmation first only trains
 * the tap into muscle memory and makes the safe action the slow one.
 *
 * The day is carried alongside the pending session so an undo offered at
 * midnight puts back a session on the day it belonged to rather than on the day
 * the strip happened to still be open.
 */
export function useSessionDelete(day: string) {
  const undo = useUndoDelete();

  /**
   * The row is looked up by id first, because the undo needs the whole session to
   * put back, and a caller holding nothing but an id would have to search again.
   */
  const remove = useCallback(
    (sessions: readonly SportSession[], id: string, label: string) => {
      const session = sessions.find((s) => s.id === id);
      if (!session) return;
      removeSession(id);
      undo.remove({ ...session, date: session.date || day }, label);
    },
    [day, undo],
  );

  return { remove, undo };
}

/**
 * The delete control, drawn the way every other destructive control in the app
 * is drawn: a bare cross, invisible until the row is hovered or the control is
 * focused, red on hover.
 *
 * It was a bordered, always-visible "Delete" button for a while, which was two
 * mistakes at once. It broke the pattern — habits, tasks, events, notes and
 * photos all use the bare cross — and it put a permanent control on every row,
 * so a day with three sessions showed three "Delete" labels competing with the
 * thing the reader came to look at. Hiding it until hover is what the rest of
 * the app already decided: the row is the content, and the control is not.
 *
 * It is still its own button rather than a tap target on the row, so a thumb
 * reading the row cannot throw the workout away by landing in the wrong place.
 * `focus-visible` carries the affordance for anyone not using a pointer, and
 * `group-focus-within` brings it back as soon as the row holds focus at all.
 */
export function SessionDeleteButton({ label, onDelete }: { label: string; onDelete: () => void }) {
  return (
    <button
      type="button"
      onClick={onDelete}
      aria-label={label}
      className="shrink-0 rounded px-1 text-[11px] text-ink-3 opacity-100 transition-opacity hover:text-[var(--color-low)] focus-visible:text-[var(--color-low)] md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100"
    >
      &#10005;
    </button>
  );
}
