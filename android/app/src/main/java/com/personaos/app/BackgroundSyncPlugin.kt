package com.personaos.app

import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * Receives the session from the web layer and starts the background sync.
 *
 * The WebView holds the login in cookies, which the background has no access to, so
 * the app hands the tokens down once. Called on every app open, because the access
 * token expires hourly — each call overwrites with the current session.
 */
@CapacitorPlugin(name = "BackgroundSync")
class BackgroundSyncPlugin : Plugin() {

    @PluginMethod
    fun setSession(call: PluginCall) {
        val supabaseUrl = call.getString("supabaseUrl")
        val anonKey = call.getString("anonKey")
        val accessToken = call.getString("accessToken")
        val refreshToken = call.getString("refreshToken")
        val apiBase = call.getString("apiBase")
        if (supabaseUrl == null || anonKey == null || accessToken == null || refreshToken == null || apiBase == null) {
            call.reject("Missing session fields.")
            return
        }
        SessionStore.save(
            context,
            SessionStore.Session(supabaseUrl, anonKey, accessToken, refreshToken, apiBase),
        )
        HealthSyncScheduler.schedule(context)
        HealthSyncScheduler.kickOnce(context)
        call.resolve()
    }

    @PluginMethod
    fun clearSession(call: PluginCall) {
        SessionStore.clear(context)
        HealthSyncScheduler.cancel(context)
        call.resolve()
    }
}
