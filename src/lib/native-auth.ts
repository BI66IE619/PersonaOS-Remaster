"use client";

import { useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Google sign-in inside the Android app.
 *
 * The web flow cannot work here. Tapping the button posts to /auth/signin, which
 * redirects to Google — and Google refuses to run inside an embedded WebView, so
 * the redirect leaves the app and completes in the phone's browser. The session
 * cookie is then written into Chrome, while the app's WebView keeps its own empty
 * cookie jar and stays signed out. Two browsers, two sessions.
 *
 * So the app does it deliberately the other way round:
 *
 *   1. Ask Supabase for the Google URL, but do not follow it (skipBrowserRedirect).
 *      The PKCE verifier is stored by the Supabase client — in this WebView, which
 *      is exactly where it needs to be for step 4.
 *   2. Open that URL in the system browser, where Google is happy to run.
 *   3. Supabase redirects back to a custom scheme, com.personaos.app://login-callback,
 *      which Android routes into this app (see the intent-filter in the manifest).
 *   4. Exchange the returned code here, in the WebView, so the session lands in the
 *      app's own cookie jar. Then the caller reloads and the server sees a session.
 *
 * The scheme is duplicated in three places on purpose and they must all agree: this
 * constant, the AndroidManifest intent-filter, and the Redirect URLs list in Supabase.
 */

/** Must match the intent-filter in android/app/src/main/AndroidManifest.xml. */
export const NATIVE_REDIRECT = "com.personaos.app://login-callback";

/** True only when running inside the Capacitor shell, never on the web. Read from
 *  the injected bridge rather than importing @capacitor/core, so the web bundle
 *  never pulls the native plugins in. */
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() ?? false;
}

/** Nothing ever changes native-ness, so there is nothing to subscribe to. */
const noopSubscribe = () => () => {};
const serverSnapshot = () => false;

/**
 * Reactive native-ness for a component, without setting state in an effect.
 *
 * The server snapshot is false and so is the first client render, which keeps the
 * server-rendered markup and the hydration in agreement; once the Capacitor
 * bridge is present the store reports true and the component re-renders. Using
 * useSyncExternalStore rather than useEffect+setState is what keeps this a read
 * of an external system, which is what it actually is.
 */
export function useIsNativeApp(): boolean {
  return useSyncExternalStore(noopSubscribe, isNativeApp, serverSnapshot);
}

export type NativeSignInResult = { ok: boolean; cancelled?: boolean; error?: string };

export async function signInWithGoogleNative(): Promise<NativeSignInResult> {
  const supabase = createClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: NATIVE_REDIRECT, skipBrowserRedirect: true },
  });
  if (error || !data?.url) return { ok: false, error: "Could not start sign-in." };

  const [{ App }, { Browser }] = await Promise.all([
    import("@capacitor/app"),
    import("@capacitor/browser"),
  ]);

  const authUrl = data.url;

  return await new Promise<NativeSignInResult>((resolve) => {
    let settled = false;
    const handles: { remove: () => Promise<void> }[] = [];

    const finish = async (result: NativeSignInResult) => {
      if (settled) return;
      settled = true;
      for (const h of handles) {
        try {
          await h.remove();
        } catch {
          /* already gone */
        }
      }
      try {
        await Browser.close();
      } catch {
        /* already closed */
      }
      resolve(result);
    };

    const start = async () => {
      const urlHandle = await App.addListener("appUrlOpen", async ({ url }) => {
        if (!url || !url.startsWith(NATIVE_REDIRECT)) return;
        const code = new URL(url).searchParams.get("code");
        if (!code) return void finish({ ok: false, error: "No code was returned." });
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) return void finish({ ok: false, error: exchangeError.message });
        return void finish({ ok: true });
      });

      /* The browser closing without a deep link means the user backed out. The
         short delay lets a deep link that arrives just before the close win the
         race, rather than being reported as a cancel. */
      const browserHandle = await Browser.addListener("browserFinished", () => {
        setTimeout(() => void finish({ ok: false, cancelled: true }), 700);
      });

      handles.push(urlHandle, browserHandle);
      await Browser.open({ url: authUrl }).catch(() =>
        finish({ ok: false, error: "Could not open Google." }),
      );
    };

    void start();
  });
}
