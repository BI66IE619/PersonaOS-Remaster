import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The Android shell.
 *
 * This app has no offline bundle — it is server-rendered Next.js with API routes,
 * auth cookies and a database, so the APK cannot carry a static copy of it. Instead
 * the WebView loads the deployed site (server.url below), and the phone is a window
 * onto the same app the browser already serves. Everything that syncs does so
 * through the server, not through the shell.
 *
 * webDir only has to exist for `cap sync` to copy something; because server.url is
 * set, the shipped assets are never loaded. It points at `public` so there is no
 * second folder to keep in step.
 *
 * After changing server.url, run `npx cap sync android` before rebuilding.
 */
const config: CapacitorConfig = {
  appId: "com.personaos.app",
  appName: "PersonaOS",
  webDir: "public",
  server: {
    url: "https://persona-os-nine.vercel.app",
    androidScheme: "https",
  },
};

export default config;
