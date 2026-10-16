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
 * Reads both sources and posts them to /api/health/ingest, so the app stays current
 * while it is closed — the point being that you can be on a computer, with the phone
 * in a pocket, and still see the day.
 *
 * It posts with its own long-lived ingest token, NOT the Supabase session. That is
 * the fix for the phone being logged out: the worker used to authenticate by
 * refreshing the session, which meant the phone had two things refreshing one
 * rotating login — the WebView while the app was open and the worker while it was
 * closed. Whichever refreshed last invalidated the other, the WebView then failed
 * and signed out, and the worker lost its credential too. The ingest token is
 * neither the login nor rotating, so the worker cannot touch the session at all.
 *
 * Failures return retry, not success, so a phone that was offline or hit a server
 * blip is tried again at the next window rather than silently skipped. A rejected
 * token is the exception: it is dropped, not retried, so the next app open mints a
 * new one instead of the worker spinning on a credential that will never work.
 */
class HealthSyncWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val ingest = SessionStore.loadIngest(applicationContext) ?: return Result.success()

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

        return when (post("${ingest.apiBase}/api/health/ingest", ingest.token, body.toString())) {
            in 200..299 -> Result.success()
            401, 403 -> {
                /* Retired or revoked. Drop it so the next app open mints another,
                   rather than the worker retrying a token that will never work. */
                SessionStore.clearIngest(applicationContext)
                Result.success()
            }
            else -> Result.retry()
        }
    }

    private fun appendAll(target: JSONArray, source: JSONArray?) {
        if (source == null) return
        for (i in 0 until source.length()) target.put(source.get(i))
    }

    /** The response code, or 0 when the request could not be made at all. */
    private fun post(urlString: String, token: String, body: String): Int {
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
            code
        } catch (_: Exception) {
            0
        }
    }
}
