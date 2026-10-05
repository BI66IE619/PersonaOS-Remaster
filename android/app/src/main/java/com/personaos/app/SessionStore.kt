package com.personaos.app

import android.content.Context

/**
 * The login the background worker uses.
 *
 * There is no WebView cookie jar in the background, so the app hands its Supabase
 * tokens down once, and the worker uses them to POST to the ingest route with a
 * bearer token — the path that route already supports for a native caller.
 *
 * Stored in plain SharedPreferences. That is the app's own private storage, not
 * readable by other apps without root; the usual hardening would be
 * EncryptedSharedPreferences, which is worth adding if this ever ships further than
 * one phone.
 */
object SessionStore {
    private const val PREFS = "personaos-session"

    data class Session(
        val supabaseUrl: String,
        val anonKey: String,
        val accessToken: String,
        val refreshToken: String,
        val apiBase: String,
    )

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun save(context: Context, session: Session) {
        prefs(context).edit()
            .putString("supabaseUrl", session.supabaseUrl)
            .putString("anonKey", session.anonKey)
            .putString("accessToken", session.accessToken)
            .putString("refreshToken", session.refreshToken)
            .putString("apiBase", session.apiBase)
            .apply()
    }

    fun load(context: Context): Session? {
        val p = prefs(context)
        val url = p.getString("supabaseUrl", null) ?: return null
        val anon = p.getString("anonKey", null) ?: return null
        val access = p.getString("accessToken", null) ?: return null
        val refresh = p.getString("refreshToken", null) ?: return null
        val api = p.getString("apiBase", null) ?: return null
        return Session(url, anon, access, refresh, api)
    }

    fun clear(context: Context) {
        prefs(context).edit().clear().apply()
    }
}
