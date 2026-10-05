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

    const push = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data.session;
        if (!session) return;
        await bg().setSession({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
          anonKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          apiBase: window.location.origin,
        });
      } catch {
        /* The button still works; the worker just won't have a token until next open. */
      }
    };

    void push();
    const { data } = supabase.auth.onAuthStateChange(() => {
      void push();
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return null;
}
