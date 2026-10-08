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
 * Hands the signed-in session to the native background worker.
 *
 * The background has no cookie jar, so the worker authenticates with a bearer token
 * it stores. This runs on every app open and after every auth change, because the
 * access token expires hourly and the worker needs a fresh one to start from.
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
          /* Signed in: keep the native copy current for the worker. */
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

    void push();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      /* An explicit sign-out has to clear the native copy too, or the restore below
         would sign the user straight back in on the next launch. */
      if (event === "SIGNED_OUT") {
        void bg().clearSession().catch(() => {});
        return;
      }
      void push();
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return null;
}
