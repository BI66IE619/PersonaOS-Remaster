/**
 * The brand, as one piece.
 *
 * "PersonaOS" already contains its own logo, so the P is not decoration
 * bolted beside a wordmark — it is the first letter of it. Splitting it out
 * here is what lets the intro assemble the name in the corner: the same two
 * spans, in the same order, that render the resting nav, are what the P is
 * flying and what slides out to meet it.
 *
 * It deliberately adds no font size, weight, or colour of its own. Both the nav
 * and the flying overlay inherit those from their parent, so a mark at
 * `text-sm` and the same mark at `text-[34px]` are the same shape at two
 * scales. That is what makes the handover between them a movement rather than a
 * redraw, and it is why neither of those sizes is written down here.
 */
export function Brand({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline whitespace-nowrap ${className}`}>
      <span data-brand-p>P</span>
      <span data-brand-rest>ersonaOS</span>
    </span>
  );
}
