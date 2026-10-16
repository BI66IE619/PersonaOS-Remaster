"use client";

import { useEffect } from "react";
import { registerPlugin } from "@capacitor/core";
import { createClient } from "@/lib/supabase/client";

interface BackgroundSyncPlugin {
  setSession(options: {
    supabaseUrl: string;
    anonKey: string;
    accessToken: string;
    refreshToken: string;
    apiBase: string;
  }): Promise<void>;
  getSession(): Promise<{ accessToken?: string; refreshToken?: string }>;
  clearSession(): Promise<void>;
  setIngestToken(options: { apiBase: string; token: string }): Promise<void>;
  getIngestToken(): Promise<{ token?: string }>;
}

let plugin: BackgroundSyncPlugin | null = null;
function bg(): BackgroundSyncPlugin {
  if (!plugin) plugin = registerPlugin<BackgroundSyncPlugin>("BackgroundSync");
  return plugin;
}

function isNative(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() ?? false;
}

/**
 * Hands the phone's background worker what it needs, and keeps the WebView's login
 * restorable.
 *
 * Two separate things, deliberately. The Supabase session is stored so the WebView
 * can be restored when Android drops its cookies — the worker does not use it. What
 * the worker uses is a token minted just for it at /api/health/token, stored apart
 * from the login so the worker can never refresh, and rotate, the session the
 * WebView holds. Sharing one rotating login between the two was what logged the
 * phone out: whichever refreshed last killed the other's copy.
 *
 * The session push runs on every app open and after every auth change, because the
 * access token expires hourly. The ingest token is minted once and only re-minted
 * when it is missing (the worker drops it on a 401) or on a fresh sign-in, which may
 * be a different account.
 *
 * Renders nothing. On the web it does nothing at all — there is no worker.
 */
export function NativeBackgroundSync() {
  useEffect(() => {
    if (!isNative()) return;
    const supabase = createClient();

    const RESTORE_FLAG = "personaos:session-restored";

    const push = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          /* Signed in: keep the native copy current for the restore below. */
          sessionStorage.removeItem(RESTORE_FLAG);
          await bg().setSession({
            supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
            anonKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token,
            apiBase: window.location.origin,
          });
          return;
        }

        /* Signed out in the WebView, but the worker still holds tokens. Android's
           WebView does not reliably keep the Supabase cookies across a full close,
           so without this you are sent to Google on every launch. Restore from the
           native copy instead. The flag stops a reload loop if that also fails. */
        if (sessionStorage.getItem(RESTORE_FLAG)) return;
        const stored = await bg().getSession();
        if (!stored?.accessToken || !stored?.refreshToken) return;
        const { error } = await supabase.auth.setSession({
          access_token: stored.accessToken,
          refresh_token: stored.refreshToken,
        });
        if (!error) {
          sessionStorage.setItem(RESTORE_FLAG, "1");
          window.location.reload();
        }
      } catch {
        /* The button still works; the worker just won't have a token until next open. */
      }
    };

    /** Give the worker its own credential, unless it already has one. */
    const mintIngest = async (force: boolean) => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) return;
        if (!force) {
          const existing = await bg().getIngestToken().catch(() => null);
          if (existing?.token) return;
        }
        const res = await fetch("/api/health/token", { method: "POST" });
        if (!res.ok) return;
        const body = (await res.json().catch(() => null)) as { token?: string } | null;
        if (body?.token) {
          await bg().setIngestToken({ apiBase: window.location.origin, token: body.token });
        }
      } catch {
        /* The worker starts without a token this open; the next one mints one. */
      }
    };

    void push();
    void mintIngest(false);
    const { data } = supabase.auth.onAuthStateChange((event) => {
      /* An explicit sign-out has to clear the native copy too, or the restore below
         would sign the user straight back in on the next launch. It also drops the
         worker's token, since that credential belonged to the account signing out. */
      if (event === "SIGNED_OUT") {
        void bg().clearSession().catch(() => {});
        return;
      }
      void push();
      /* A fresh sign-in may be a different account, whose worker token is not this
         device's; mint a new one for whoever is now signed in. */
      if (event === "SIGNED_IN") void mintIngest(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return null;
}
