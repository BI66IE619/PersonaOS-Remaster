import type { CSSProperties } from "react";

/**
 * The P, and the two documents that have to agree about it.
 *
 * The opening does not cross-fade into the app. It holds a letter in the middle
 * of the screen, replaces the document, and the letter is still there on the
 * other side — then it travels to the corner. Nothing about that survives a
 * navigation: `location.replace` throws the DOM away, and a new document has no
 * memory of the last one. So the one thing that can be continuous is the pixels,
 * which means both documents have to draw the same mark from the same numbers.
 *
 * That is what this file is. The title card renders it; the cold start renders
 * it again before React has done anything; and BrandMorph draws the same mark a
 * third time, scaled down from the same box. The geometry is declared once
 * because describing it three times is how a 12px letter ends up 12px apart at
 * the seam, and the seam is the entire effect.
 *
 * The one thing that is *not* shared is where the mark goes. That is measured
 * from the nav on arrival, so the last frame of the flight is the nav's own
 * rendering by construction rather than by arithmetic.
 */

/** The box the halo is drawn in, and the letter centred in it. The title card
 *  draws it at this size; the flight draws it at this size divided by the
 *  mark's scale, which lands it on the same 64px of screen at the start. */
export const MARK_BOX_PX = 64;

/** The two radii of the glow, at the size the title card draws it. The flight
 *  divides both by the mark's scale, and that division is not a refinement: a
 *  transform scales a shadow with the letter, so a glow left at 18px on a 14px
 *  letter is three times too wide by the time that letter has been scaled up to
 *  the size it travels from. Same light, both ends. */
export const GLOW_R1_PX = 18;
export const GLOW_R2_PX = 44;

/** The halo. Shared so the wash of colour around the letter is one value rather
 *  than two that happen to look alike. */
export const HALO = "radial-gradient(circle, color-mix(in oklab, var(--color-accent) 26%, transparent) 0%, transparent 70%)";

/**
 * The mark, as the title card draws it.
 *
 * Centred by its parent, and that is the whole of its positioning. The title
 * card used to hold the P in a column with the loader line underneath it, which
 * pushed the letter 12.5px above the middle of the screen — and 12.5px is exactly
 * how far the flight then moved it, because the flight centres the letter
 * properly. So the two halves of the hand-off disagreed about where the middle
 * of the screen was, and the letter hopped as it changed documents. The loader
 * keeps its place; the letter now has the centre to itself.
 *
 * Both are positioned by their line box rather than by their ink, which is what
 * makes them agree without anyone measuring a font. Centring a line box puts the
 * ink in the same relative place whatever the line height is — the half-leading
 * and the descent below the baseline shift together and cancel — so a 34px
 * letter in a 34px line box and a 14px letter in a 20px one land their ink on the
 * same pixel when their line boxes do. The flight relies on exactly that.
 */
/** Which letter this is, because the two are in the document at the same time.
 *
 *  The standing mark belongs to the layout, so it is in the title card's markup
 *  too — hidden, but present, and indistinguishable from the title card's own
 *  letter if they share a hook. They are drawn from the same numbers, which
 *  makes a selector that cannot tell them apart worse than useless: it would
 *  quietly answer a question about one of them with the other. */
export type MarkKind = "splash" | "stand";

export function Mark({ kind = "stand", className = "" }: { kind?: MarkKind; className?: string }) {
  return (
    <div className={`relative flex h-16 w-16 items-center justify-center ${className}`}>
      <span
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{ background: HALO }}
        data-mark-halo
      />
      <span
        className="mark-glow relative text-[34px] leading-none font-semibold tracking-tight"
        {...(kind === "splash" ? { "data-splash-p": true } : { "data-stand-p": true })}
      >
        P
      </span>
    </div>
  );
}

/** Where the loader line sits, in px below the middle of the screen. It is the
 *  position the column used to compute — 64px of mark, a 24px gap and a 1px
 *  line, centred as a stack — and it is written down rather than recomputed
 *  because the mark is no longer in the same flow, and a loader that moved
 *  would be the one part of the title card nobody asked to change. */
export const LOADER_OFFSET_PX = 43.5;

/** Applied as the independent `translate` property rather than as a Tailwind
 *  arbitrary value, for two reasons: the number stays in this file, where the
 *  reasoning above is, and `translate` composes with — rather than competes
 *  with — any `transform` framer-motion writes on the same element. */
export const loaderOffset = (): CSSProperties => ({ translate: `0 ${LOADER_OFFSET_PX}px` });
