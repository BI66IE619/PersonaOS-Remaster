package com.lifeos.healthbridge

import android.content.Context
import android.content.SharedPreferences

/**
 * The three things this app cannot know for itself: where the LifeOS server is,
 * who the user is, and how far back to read.
 *
 * SharedPreferences rather than a database because there is one row of settings
 * and it is read on the main thread during onCreate. A DataStore or a Room
 * database would add a dependency and a coroutine to store three strings.
 *
 * The access token is stored here in plain text, which is not what an app
 * holding long-lived credentials should do. This one holds a token that can read
 * only the user's own health rows and push only the user's own health rows, it
 * is a personal build with no distribution channel, and the alternative
 * (EncryptedSharedPreferences, or a Keystore-wrapped key) is worth adding if
 * this is ever shipped rather than sideloaded. It is called out in the README
 * rather than left for someone to discover.
 */
class Settings(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("lifeos.healthbridge", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = prefs.getString(KEY_SERVER_URL, "") ?: ""
        set(value) = prefs.edit().putString(KEY_SERVER_URL, value.trim()).apply()

    var accessToken: String
        get() = prefs.getString(KEY_ACCESS_TOKEN, "") ?: ""
        set(value) = prefs.edit().putString(KEY_ACCESS_TOKEN, value.trim()).apply()

    /**
     * How many days back to read.
     *
     * Fourteen by default because that is long enough to establish a readiness
     * baseline — the web app needs more than a couple of days before it trusts
     * real numbers over the mock provider — and short enough that a first sync
     * does not pull a year of minute-level step records across the wire.
     */
    var lookbackDays: Int
        get() = prefs.getInt(KEY_LOOKBACK_DAYS, 14)
        set(value) = prefs.edit().putInt(KEY_LOOKBACK_DAYS, value.coerceIn(1, 365)).apply()

    val isConfigured: Boolean
        get() = serverUrl.startsWith("http") && accessToken.isNotEmpty()

    /** The ingest endpoint, so the user pastes the site root and not the full path. */
    fun ingestUrl(): String {
        val trimmed = serverUrl.trimEnd('/')
        return if (trimmed.endsWith("/api/health/ingest")) {
            trimmed
        } else {
            "$trimmed/api/health/ingest"
        }
    }

    private companion object {
        const val KEY_SERVER_URL = "server_url"
        const val KEY_ACCESS_TOKEN = "access_token"
        const val KEY_LOOKBACK_DAYS = "lookback_days"
    }
}