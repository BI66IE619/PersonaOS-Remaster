"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useIsNativeApp } from "@/lib/native-auth";
import { syncHealthConnect, syncSamsungSleep } from "@/lib/health-native";

/**
 * The only control for Health Connect, and it renders only inside the phone app.
 *
 * Reads a month, posts it, refreshes the server render. The first tap opens the
 * Health Connect permission screen; later taps just sync. There is no separate
 * "connect" step because there is nothing to connect to until a permission is
 * granted, and asking up front would be a screen before the user has asked for
 * anything.
 */
export function HealthConnectCard() {
  const native = useIsNativeApp();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /* On the web this is a pointless button — Health Connect does not exist there. */
  if (!native) return null;

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);

    /* Two sources on purpose: Health Connect has steps, calories and workouts but no
       sleep, and Samsung Health has sleep but is not what Health Connect reads. */
    const activity = await syncHealthConnect(30);
    const sleep = await syncSamsungSleep(30);
    setBusy(false);

    const parts: string[] = [];
    parts.push(
      activity.ok
        ? `Activity: ${activity.daily} day${activity.daily === 1 ? "" : "s"}, ${activity.sessions} workout${activity.sessions === 1 ? "" : "s"}.`
        : `Activity failed: ${activity.error}`,
    );
    parts.push(
      sleep.ok
        ? `Sleep: ${sleep.daily} night${sleep.daily === 1 ? "" : "s"}.`
        : `Sleep failed: ${sleep.error}`,
    );
    if (activity.ok && activity.probe) {
      parts.push(`Health Connect: ${JSON.stringify(activity.probe)}`);
    }
    setMessage(parts.join("  •  "));

    /* The data lands on the server, so the server render has to run again. */
    router.refresh();
  };

  return (
    <section className="panel p-5 lg:col-span-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="label-xs">Health Connect</span>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="rounded-lg border border-hairline-strong bg-raised px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-inset disabled:opacity-50"
        >
          {busy ? "Syncing…" : "Sync health"}
        </button>
      </div>
      <p className="mt-2 text-xs text-ink-3">
        Pulls steps, sleep, heart rate and workouts from your watch. The first tap asks
        Health Connect for permission.
      </p>
      {message ? (
        <p className="mt-2 text-xs text-ink-2" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
