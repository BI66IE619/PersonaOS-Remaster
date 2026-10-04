"use client";

/**
 * The last boundary, for a failure in the root layout itself.
 *
 * error.tsx cannot catch this: it renders inside the layout, so a layout that
 * throws has nowhere for the segment boundary to appear. Next therefore falls
 * back to its built-in page, which is the anonymous "contact the owner" screen
 * with no digest and no retry — the one failure mode where there is nothing at
 * all to report.
 *
 * So this replaces <html> and <body> itself, which is why it is the only file
 * here that is not allowed to use the app's own shell, layout, fonts, or any
 * client component. Anything imported here is re-evaluated from scratch when the
 * root segment fails, and reaching for something that might be part of the
 * failure is how a recovery page becomes a second failure. Plain elements and
 * inline styles only.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 20,
          background: "#07080a",
          color: "#a9b0ba",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          textAlign: "center",
          padding: 24,
        }}
      >
        <p style={{ fontSize: 14 }}>PersonaOS could not start.</p>

        <button
          type="button"
          onClick={reset}
          style={{
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.06)",
            color: "#f2f4f7",
            borderRadius: 8,
            padding: "10px 20px",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Reload
        </button>

        {error.digest ? (
          <p style={{ fontSize: 11, opacity: 0.7, maxWidth: 320, lineHeight: 1.6 }}>
            If this keeps happening, quote this reference:{" "}
            <code style={{ color: "#e4e7ec" }}>{error.digest}</code>
          </p>
        ) : null}
      </body>
    </html>
  );
}