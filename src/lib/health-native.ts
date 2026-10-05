"use client";

import { registerPlugin } from "@capacitor/core";
import { addDays, dayKey } from "@/lib/dates";

/**
 * Health Connect, driven from the web layer.
 *
 * The reading happens in a native Capacitor plugin, because Health Connect is not
 * reachable from a WebView. The posting does not: the plugin hands the data back
 * here, and this posts it to /api/health/ingest with the session cookie the WebView
 * already holds. One authentication path, no second token to mint or refresh.
 *
 * The shape the plugin returns is the shape the ingest route accepts, so there is no
 * mapping between them to drift.
 */
export type HealthPayload = {
  daily: Record<string, unknown>[];
  sessions: Record<string, unknown>[];
};

interface HealthConnectPlugin {
  checkAvailability(): Promise<{ status: "available" | "updateRequired" | "notSupported" }>;
  checkHealthPermissions(): Promise<{ complete: boolean; missing: string[] }>;
  requestHealthPermissions(): Promise<{ granted: number; complete: boolean; missing: string[] }>;
  readHealth(options: { from: string; to: string }): Promise<HealthPayload>;
}

/* Registered lazily at call time rather than at module load, so the web bundle
   never touches the bridge until it is actually in the app. */
let plugin: HealthConnectPlugin | null = null;
function health(): HealthConnectPlugin {
  if (!plugin) plugin = registerPlugin<HealthConnectPlugin>("HealthConnect");
  return plugin;
}

export function healthConnectAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() ?? false;
}

export type HealthSyncResult =
  | { ok: true; daily: number; sessions: number }
  | { ok: false; needsPermission?: boolean; error: string };

/**
 * Asks for permission if needed, reads a window, and posts it.
 *
 * One entry point for both the first run and later syncs: it checks what is already
 * granted, only opens the permission screen when something is missing, then reads and
 * posts. `days` counts back inclusively from today, in the phone's local calendar.
 */
export async function syncHealthConnect(days = 30): Promise<HealthSyncResult> {
  if (!healthConnectAvailable()) {
    return { ok: false, error: "Health Connect is only available in the phone app." };
  }
  try {
    const availability = await health().checkAvailability();
    if (availability.status !== "available") {
      return {
        ok: false,
        error:
          availability.status === "updateRequired"
            ? "Health Connect needs an update on this device."
            : "Health Connect is not available on this device.",
      };
    }

    const granted = await health().checkHealthPermissions();
    if (!granted.complete) {
      const asked = await health().requestHealthPermissions();
      if (!asked.complete) {
        return {
          ok: false,
          needsPermission: true,
          error: `Still missing: ${asked.missing.join(", ")}. Grant them in Health Connect and try again.`,
        };
      }
    }

    const to = dayKey(new Date());
    const from = addDays(to, -(days - 1));
    const data = await health().readHealth({ from, to });

    const res = await fetch("/api/health/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ daily: data.daily, sessions: data.sessions }),
    });
    if (!res.ok) {
      return { ok: false, error: "The server rejected the health data." };
    }
    const body = (await res.json().catch(() => ({}))) as { daily?: number; sessions?: number };
    return {
      ok: true,
      daily: body.daily ?? data.daily.length,
      sessions: body.sessions ?? data.sessions.length,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Health sync failed." };
  }
}
