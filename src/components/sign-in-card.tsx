"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Mark, loaderOffset } from "@/components/splash-mark";
import { signInWithGoogleNative, useIsNativeApp } from "@/lib/native-auth";

/**
 * The signed-out face of "/", and the only page in the app that renders without
 * a session.
 *
 * It reuses the splash's mark rather than drawing a second one. The two documents
 * are adjacent — Google returns to /auth/callback and then hands off to /home —
 * and two independently drawn letters is how you end up with a P that changes
 * weight or brightness across a navigation. One component, shared numbers.
 *
 * The loader is on for the whole time, not for the first 750ms, because here it
 * means something different. On the splash it meant work was happening; here the
 * button is pressed and the browser is on its way to Google, which is genuinely
 * indefinite and can take as long as the user takes to choose an account. A
 * spinner that stopped while they were still deciding would look broken.
 *
 * The split into two components is only to say clearly that there is no
 * navigation in the signed-out path. Anyone reading the effect that used to be
 * here should know it is gone rather than moved.
 */
export function SignInCard({ message }: { message?: string }) {
  /* Nothing to do on success: the callback sets the session and redirects to
     /home, so the browser only comes back here signed out.

     An earlier version of this redirected to "/" after 100ms to escape a stale
     session. That was unconditional, which made it reload the page it was already
     on, forever — the card re-mounted and re-armed the timer on every pass, so the
     Google button could never be clicked. It has to be conditioned on an actual
     session being present, which means asking rather than assuming. */
  return <SignInCardBody message={message} />;
}

function SignInCardBody({ message }: { message?: string }) {
  /* Whether this is the Android shell rather than a browser. The store reports
     false through hydration and true once Capacitor's bridge is present, so the
     server-rendered form and the first client render agree. */
  const native = useIsNativeApp();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /* Only reached in the app. On success the session is now in this WebView's
     cookies, so a full navigation lets the server see it and render /home. */
  const onGoogle = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const result = await signInWithGoogleNative();
    if (result.ok) {
      window.location.replace("/home");
      return;
    }
    setBusy(false);
    if (!result.cancelled) setProblem(result.error ?? "Sign-in failed.");
  };

  const shown = problem ?? message;

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center px-6">
      <motion.div
        initial={{ opacity: 0, y: 10, filter: "blur(6px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center"
      >
        <Mark kind="splash" />
      </motion.div>

      {native ? (
        /* In the app, a form post would leave for Google in the system browser and
           strand the session there. This runs the deep-link flow instead — see
           @/lib/native-auth. */
        <button
          type="button"
          onClick={() => void onGoogle()}
          disabled={busy}
          className="mt-8 rounded-lg border border-white/12 bg-white/[0.06] px-6 py-2.5 text-sm font-medium text-[var(--color-ink)] transition-colors hover:bg-white/[0.1] disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Continue with Google"}
        </button>
      ) : (
        /* A form post, not a client fetch. A form works with JavaScript disabled
           and, more to the point here, survives the redirect to Google without the
           verifier cookie depending on anything having hydrated first. */
        <form action="/auth/signin" method="post" className="mt-8">
          <button
            type="submit"
            className="rounded-lg border border-white/12 bg-white/[0.06] px-6 py-2.5 text-sm font-medium text-[var(--color-ink)] transition-colors hover:bg-white/[0.1]"
          >
            Continue with Google
          </button>
        </form>
      )}

      {/* Only when EMAIL_SIGNIN is on, which is a local testing setup rather than
          a product decision. The automated suites cannot click through a Google
          consent screen, so this is how they get a real session — see
          app/auth/password/route.ts. The form posts to a route that 404s when the
          flag is off, so leaving it in the markup would be a visible button that
          fails; the condition is what keeps the two in step. */}
      {process.env.NEXT_PUBLIC_EMAIL_SIGNIN === "1" ? (
        <form action="/auth/password" method="post" className="mt-4 flex flex-col gap-2">
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            aria-label="Email"
            className="rounded-lg border border-white/12 bg-white/[0.04] px-3 py-2 text-sm text-[var(--color-ink)]"
          />
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            aria-label="Password"
            className="rounded-lg border border-white/12 bg-white/[0.04] px-3 py-2 text-sm text-[var(--color-ink)]"
          />
          <button
            type="submit"
            className="rounded-lg border border-white/12 px-3 py-2 text-sm text-[var(--color-ink-2)] transition-colors hover:bg-white/[0.1]"
          >
            Sign in
          </button>
        </form>
      ) : null}

      {shown ? (
        <p role="alert" className="mt-4 max-w-xs text-center text-sm text-[var(--color-ink-3)]">
          {shown}
        </p>
      ) : (
        <p className="mt-4 text-sm text-[var(--color-ink-3)]">
          Your day, decoded against your own baseline.
        </p>
      )}

      <motion.span
        aria-hidden
        style={loaderOffset()}
        className="absolute inset-x-0 top-1/2 mx-auto mt-24 h-px w-16 overflow-hidden rounded-full bg-white/10"
      >
        <motion.span
          className="block h-full w-1/2 rounded-full"
          style={{ background: "linear-gradient(90deg, transparent, var(--color-accent))" }}
          animate={{ x: ["-100%", "200%"] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
        />
      </motion.span>

      <span className="sr-only" role="status">
        Signing in to PersonaOS
      </span>
    </div>
  );
}