"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";

/**
 * A row that logs something when it is dragged across.
 *
 * The whole row is also a real button that does the same thing, which is what
 * makes it usable at all: a drag is not something a keyboard or a screen reader
 * can do, so the gesture is the fast path and the button is the accessible one.
 * Nothing here is swipe-only.
 *
 * Vertical drags are left alone. The row sets `touch-action: pan-y`, so the
 * browser still owns vertical scrolling and only hands us horizontal movement,
 * and a drag that reads as vertical before it reads as horizontal is abandoned
 * rather than fought over.
 */
export function SwipeRow({
  label,
  hint,
  disabled = false,
  onSwipeRight,
  onSwipeLeft,
  children,
}: {
  /** Used for the button's accessible name, e.g. "Log a set of Bench press". */
  label: string;
  /** Announced alongside the label so the current count is not visual-only. */
  hint?: string;
  disabled?: boolean;
  /** Fired when dragged far enough to the right. */
  onSwipeRight?: () => void;
  /** Fired when dragged far enough to the left. */
  onSwipeLeft?: () => void;
  children: ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; decided: boolean; pointer: number } | null>(null);
  const axis = useRef<"none" | "h" | "v">("none");
  /* Set once a drag is recognised, so the click the browser fires afterwards is
     ignored. Without this a swipe that logs a set is followed by a click that
     logs a second one, and a drag that was too short to count logs one anyway. */
  const wasDrag = useRef(false);
  const width = useRef(0);
  /* The distance travelled right now, kept beside the state rather than read out
     of it. A fast flick can deliver the last move and the release in one go, and
     then the state has not caught up and the gesture would be thrown away. */
  const dxRef = useRef(0);

  /* How far the drag has to go. A share of the row rather than a fixed distance,
     so it feels the same on a phone and a desktop, but not so short on a wide
     row that a stray nudge counts. */
  const threshold = () => Math.max(56, Math.min(120, width.current * 0.28));

  const settle = useCallback(() => {
    dxRef.current = 0;
    setDx(0);
    setDragging(false);
    start.current = null;
    axis.current = "none";
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return;
    width.current = e.currentTarget.getBoundingClientRect().width;
    start.current = { x: e.clientX, y: e.clientY, decided: false, pointer: e.pointerId };
    axis.current = "none";
    wasDrag.current = false;
    dxRef.current = 0;
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s || s.pointer !== e.pointerId) return;

    const rawX = e.clientX - s.x;
    const rawY = e.clientY - s.y;

    if (!s.decided) {
      /* 6px of slop, so a tap that jitters is still a tap. */
      if (Math.abs(rawX) < 6 && Math.abs(rawY) < 6) return;
      s.decided = true;
      wasDrag.current = true;
      axis.current = Math.abs(rawX) > Math.abs(rawY) ? "h" : "v";
      if (axis.current === "v") {
        setDragging(false);
        start.current = null;
        return;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
    }

    if (axis.current !== "h") return;
    /* The card tracks the finger one to one, capped at its own width, which is as
       far as there is anything to reveal. An earlier version added resistance
       past the threshold, which meant the row stopped following the finger just
       before it was about to count — so dragging further did nothing visible and
       the gesture felt broken exactly when it was about to work. */
    const limit = width.current || 320;
    const next = Math.max(-limit * 0.5, Math.min(rawX, limit * 0.92));
    dxRef.current = next;
    setDx(next);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s || s.pointer !== e.pointerId) return;
    const travelled = dxRef.current;
    const past = Math.abs(travelled) >= threshold();
    const vertical = axis.current === "v";
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    settle();
    if (vertical || !past) return;
    if (travelled > 0) onSwipeRight?.();
    else onSwipeLeft?.();
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    if (start.current?.pointer === e.pointerId) {
      wasDrag.current = true;
      settle();
    }
  };

  const onClick = (e: React.MouseEvent) => {
    /* The drag has already had its say. */
    if (wasDrag.current) {
      wasDrag.current = false;
      return;
    }
    /* Only keyboard and assistive activation gets through. A tap is deliberately
       not a log: the drag is how you log, and a tap is what you get by accident
       when you meant to drag — which is how sets appeared that nobody meant to
       add. `detail` is 0 for a real activation from Enter, Space or a screen
       reader, and at least 1 for a hardware click, which is what tells them apart.
       Removing the tap outright would have taken the only path a keyboard or a
       screen reader has, so the gesture stays the pointer path rather than the
       only path. */
    if (e.detail !== 0) return;
    if (disabled) return;
    onSwipeRight?.();
  };

  const rightward = dx > 0;
  const fraction = Math.min(1, Math.abs(dx) / (threshold() || 1));

  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      aria-label={hint ? `${label}. ${hint}` : label}
      disabled={disabled}
      style={{ touchAction: "pan-y" }}
      /* Opted out of the global press scale: this element's own width is read at
         pointerdown to work out the drag threshold, so anything that resizes it
         under the finger would make the gesture disagree with what it measured. */
      data-drag-row
      className="relative block w-full select-none overflow-hidden rounded-xl text-left disabled:cursor-not-allowed disabled:opacity-50"
    >
      {/* Sits underneath, revealed as the row slides off it. Only the mark for
          the direction being dragged is rendered, so neither glyph is left
          sitting invisibly in the row's text at rest. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-between px-4"
      >
        {/* No pop-in here: the inline opacity below is the tick fading in with
            the drag, and a filled animation would take opacity over from it. */}
        <span
          className="num text-xs font-medium text-[var(--color-accent)]"
          style={{ opacity: fraction }}
        >
          {dragging && rightward ? "✓" : null}
        </span>
        <span
          className="num text-xs font-medium text-[var(--color-low)]"
          style={{ opacity: fraction }}
        >
          {dragging && !rightward ? "−" : null}
        </span>
      </span>

      <span
        className="relative block bg-[var(--color-raised)] will-change-transform"
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? "none" : "transform 180ms ease-out",
        }}
      >
        {children}
      </span>
    </button>
  );
}
