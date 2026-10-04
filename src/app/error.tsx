"use client";

import { useEffect } from "react";

/**
 * Catches a render failure inside a route segment and shows something better than
 * Next's default page.
 *
 * There was no boundary here at all, which is why a failure during the first
 * authenticated arrival at /home produced the stock "contact the owner" screen.
 * That page is deliberately anonymous: it renders no message, no stack, and no
 * identifier, so an error there is unreportable and unreproducible. Anyone hitting
 * it learns nothing except that something broke.
 *
 * Two things are recovered here. The digest is Next's correlation id for the
 * server-side error, and it is the one string that ties what the reader saw to
 * what the terminal printed — without it the two cannot be matched up. The reset
 * button is the other: a boundary that cannot be retried from is a dead end even
 * when the failure was transient, which is a real category here.
 *
 * The message is logged rather than rendered. Rendered, it would put internal
 * detail on screen for anyone who reaches this; in the console, it is there for
 * whoever is already debugging. The error object survives to the client in
 * development only, so the console line is blank in production by design and the
 * digest is the whole of what there is to report.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route error]", error.digest ?? "", error);
  }, [error]);

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 text-center">
      <p className="text-sm text-ink-3">Something went wrong on this screen.</p>

      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-lg border border-white/12 bg-white/[0.06] px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-white/[0.1]"
      >
        Try again
      </button>

      {error.digest ? (
        <p className="mt-6 max-w-xs text-[11px] leading-relaxed text-ink-3/70">
          If this keeps happening, quote this reference:{" "}
          <code className="text-ink-2">{error.digest}</code>
        </p>
      ) : null}
    </div>
  );
}