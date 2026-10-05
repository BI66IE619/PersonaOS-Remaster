package com.personaos.app

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate

/**
 * The background sync.
 *
 * Reads both sources and posts them to /api/health/ingest with a bearer token, so
 * the app stays current while it is closed — the point being that you can be on a
 * computer, with the phone in a pocket, and still see the day.
 *
 * It refreshes the access token first rather than trusting the one handed over on
 * app open, which is an hour old at best. WorkManager gives no guarantee of when
 * this runs, so "assume fresh" is not available.
 *
 * Failures return retry, not success, so a phone that was offline or a token refresh
 * that hit a blip is tried again at the next window rather than silently skipped.
 */
class HealthSyncWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val stored = SessionStore.load(applicationContext) ?: return Result.success()
        val session = refresh(stored)
        if (session == null) {
            /* No usable login. Not a retry: nothing changes until the app is opened
               and a fresh session is handed down. */
            return Result.success()
        }

        val to = LocalDate.now().toString()
        val from = LocalDate.now().minusDays(29).toString()

        val daily = JSONArray()
        val sessions = JSONArray()

        try {
            val hc = HealthReaders.healthConnect(applicationContext, from, to)
            appendAll(daily, hc.optJSONArray("daily"))
            appendAll(sessions, hc.optJSONArray("sessions"))
        } catch (_: Exception) {
            /* Left out; the Samsung read and the next run try again. */
        }

        try {
            val samsung = HealthReaders.samsungHealth(applicationContext, from, to)
            appendAll(daily, samsung.optJSONArray("daily"))
            appendAll(sessions, samsung.optJSONArray("sessions"))
        } catch (_: Exception) {
            /* Samsung often needs the app in the foreground; tolerated. */
        }

        if (daily.length() == 0 && sessions.length() == 0) return Result.retry()

        val body = JSONObject()
            .put("daily", daily)
            .put("sessions", sessions)

        return if (post("${session.apiBase}/api/health/ingest", session.accessToken, body.toString())) {
            Result.success()
        } else {
            Result.retry()
        }
    }

    private fun appendAll(target: JSONArray, source: JSONArray?) {
        if (source == null) return
        for (i in 0 until source.length()) target.put(source.get(i))
    }

    /** Exchanges the refresh token for a fresh access token. */
    private fun refresh(session: SessionStore.Session): SessionStore.Session? {
        return try {
            val url = URL("${session.supabaseUrl}/auth/v1/token?grant_type=refresh_token")
            val conn = url.openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("apikey", session.anonKey)
            conn.setRequestProperty("Content-Type", "application/json")
            conn.connectTimeout = 15_000
            conn.readTimeout = 15_000
            conn.doOutput = true
            conn.outputStream.use {
                it.write(JSONObject().put("refresh_token", session.refreshToken).toString().toByteArray())
            }
            if (conn.responseCode !in 200..299) return null
            val text = conn.inputStream.bufferedReader().use { it.readText() }
            val obj = JSONObject(text)
            val access = obj.getString("access_token")
            val refresh = obj.optString("refresh_token", session.refreshToken)
            val updated = session.copy(accessToken = access, refreshToken = refresh)
            SessionStore.save(applicationContext, updated)
            updated
        } catch (_: Exception) {
            null
        }
    }

    private fun post(urlString: String, token: String, body: String): Boolean {
        return try {
            val conn = URL(urlString).openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.setRequestProperty("Content-Type", "application/json")
            conn.connectTimeout = 15_000
            conn.readTimeout = 20_000
            conn.doOutput = true
            conn.outputStream.use { it.write(body.toByteArray()) }
            val code = conn.responseCode
            conn.disconnect()
            code in 200..299
        } catch (_: Exception) {
            false
        }
    }
}
