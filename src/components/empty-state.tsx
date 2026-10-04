import type { ReactNode } from "react";

/**
 * The one shape for a panel with nothing in it yet.
 *
 * A blank rectangle tells you nothing and asks nothing. Every one of these used
 * to be a line of grey text — "No habits yet.", "Nothing open." — which states
 * the fact and stops there: it does not say what the panel is for, what will
 * make it fill up, or where to start. So the same three lines appear every time,
 * tuned to the panel, and the middle one names the single action that fills it.
 *
 * The action is optional and is a link rather than a control, because an empty
 * state is a dead end that the reader has to get out of themselves. Almost every
 * one of them is "go and do the thing on another screen", and pretending the
 * panel can do it for you would be a lie.
 */
export function EmptyState({
  title,
  detail,
  action,
}: {
  /** What this panel is for, in the reader's terms rather than the app's. */
  title: string;
  /** The one thing that fills it, said concretely enough to act on. */
  detail: string;
  action?: { label: string; href?: string; onClick?: () => void };
}) {
  /* A link when the empty state lives somewhere else, a button when the way out
     is right here — clearing a search is a button's job, and a link to an
     anchor would only scroll the page without clearing anything. */
  const className =
    "mt-2.5 inline-flex items-center gap-1 text-[11px] text-ink-2 transition-colors hover:text-ink";

  return (
    /* An inset tile, not a dashed outline. The dashed box was the only dashed
       thing in the app and read as a different material from the glass around
       it; `tile` is the same inset card the real rows use, so an empty panel
       looks like the panel minus its contents rather than like a placeholder.
       `data-empty` is the hook the tests locate on, so restyling this can never
       quietly break them — the same reasoning as `data-reveal` on the panels. */
    <div data-empty className="mt-3 rounded-[10px] border border-[#ffffff14] bg-[#ffffff0a] px-3.5 py-4">
      <p className="text-xs leading-relaxed text-ink-2">{title}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{detail}</p>
      {action?.onClick ? (
        <button type="button" onClick={action.onClick} className={className}>
          {action.label}
        </button>
      ) : action?.href ? (
        <a href={action.href} className={className}>
          {action.label}
          <span aria-hidden>&rsaquo;</span>
        </a>
      ) : null}
    </div>
  );
}

/** A shorter variant for a row inside a panel, where a full block is too much. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-[11px] leading-relaxed text-ink-3">{children}</p>;
}
