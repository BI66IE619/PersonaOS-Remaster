"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Don't even ask more than this often. The server enforces the real gap (30
 * minutes by default); this only stops switching tabs from firing a request every
 * time the window regains focus.
 */
const MIN_ASK_MS = 5 * 60 * 1000;

/**
 * Pulls finance once per app open, on whatever device opens it.
 *
 * SimpleFIN is a pull, not a push — the only way a transaction arrives is for
 * something to go and ask — so this is what replaces pressing the button. It mounts
 * with the root layout, which is mounted once per full load and never remounts on a
 * client-side navigation, so "on mount" is genuinely "when you opened the app", not
 * "every time you changed tab". It also fires when the app returns to the
 * foreground, which is how a phone that never fully reloads the WebView still
 * syncs.
 *
 * The server's own lastSyncedAt gate is the real throttle: an open inside the
 * window comes back "too soon" and costs nothing but a database read. This asks;
 * the server decides. Only a pull that actually happened refreshes the screen.
 */
export function FinanceAutoSync() {
  const router = useRouter();
  const lastAsk = useRef(0);
  const inFlight = useRef(false);

  const ask = useCallback(async () => {
    if (inFlight.current) return;
    if (Date.now() - lastAsk.current < MIN_ASK_MS) return;
    lastAsk.current = Date.now();
    inFlight.current = true;
    try {
      const res = await fetch("/api/finance/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      /* 401 when signed out, and the route's 429/502 when SimpleFIN refuses. Neither
         is worth surfacing here — the Money screen's own button reports a failure a
         person asked for. */
      if (!res.ok) return;
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; skipped?: string }
        | null;
      /* "too soon" (ok, but skipped) and "no bank linked" (not ok) have nothing to
         re-render. A real pull may have moved balances as well as added rows, so it
         refreshes even when no new transaction came in. */
      if (body?.ok && !body.skipped) router.refresh();
    } catch {
      /* Offline. The next open tries again. */
    } finally {
      inFlight.current = false;
    }
  }, [router]);

  useEffect(() => {
    void ask();
    const onVisible = () => {
      if (document.visibilityState === "visible") void ask();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [ask]);

  return null;
}
