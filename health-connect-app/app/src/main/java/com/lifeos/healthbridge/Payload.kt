package com.lifeos.healthbridge

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

/**
 * The wire shape of POST /api/health/ingest.
 *
 * Hand-written against the server's Zod schema rather than generated from it,
 * which means this file and src/app/api/health/ingest/route.ts have to be read
 * together. If a field is renamed on one side it will be silently dropped on
 * the other — the schema allows null for almost every measurement, so a
 * misspelled key is not an error, it is a row of nulls. Every name below is
 * spelled the way the Zod object spells it.
 *
 * Nullable fields are written as JSON null rather than omitted. Same schema
 * either way; being explicit means a missing measurement is visibly null
 * instead of an absent key, which is one fewer thing to distinguish "the watch
 * said zero" from "we did not ask".
 */
data class DailyRow(
    val recordId: String,
    val day: String,
    val origin: String,
    val steps: Long?,
    val activeMin: Double?,
    val restingHr: Double?,
    val hrvRmssd: Double?,
    val spo2: Double?,
    val respiratoryRate: Double?,
    val sleepTotalMin: Double?,
    val sleepDeepMin: Double?,
    val sleepRemMin: Double?,
    val sleepLightMin: Double?,
    val sleepStartUtc: String?,
    val sleepEndUtc: String?,
    val activeKcal: Double?,
    val updatedAt: Long,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("recordId", recordId)
        put("day", day)
        put("origin", origin)
        put("steps", steps?.let { JSONObject.wrap(it) } ?: JSONObject.NULL)
        put("activeMin", activeMin?.let { JSONObject.wrap(it) } ?: JSONObject.NULL)
        put("restingHr", restingHr?.let { JSONObject.wrap(it) } ?: JSONObject.NULL)
        put("hrvRmssd", hrvRmssd?.let { JSONObject.wrap(it) } ?: JSONObject.NULL)
        put("spo2", spo2?.let { JSONObject.wrap(it) } ?: JSONObject.NULL)
        put("respiratoryRate", respiratoryRate?.let { JSONObject.wrap(it) } ?: JSONObject.NULL)
        put("sleepTotalMin", sleepTotalMin?.let { JSONObject.wrap(it) } ?: JSONObject.NULL)
        put("sleepDeepMin", sleepDeepMin?.let { JSONObject.wrap(it) } ?: JSONObject.NULL)
        put("sleepRemMin", sleepRemMin?.let { JSONObject.wrap(it) } ?: JSONObject.NULL)
        put("sleepLightMin", sleepLightMin?.let { JSONObject.wrap(it) } ?: JSONObject.NULL)
        put("sleepStartUtc", sleepStartUtc ?: JSONObject.NULL)
        put("sleepEndUtc", sleepEndUtc ?: JSONObject.NULL)
        put("activeKcal", activeKcal?.let { JSONObject.wrap(it) } ?: JSONObject.NULL)
        put("updatedAt", updatedAt)
    }
}

data class SessionRow(
    val recordId: String,
    val day: String,
    val origin: String,
    val activity: String,
    val startedAtUtc: String,
    val durationMin: Double,
    val activeMin: Double?,
    val energyKcal: Double?,
    val distanceM: Double?,
    val avgHr: Double?,
    val maxHr: Double?,
    val updatedAt: Long,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("recordId", recordId)
        put("day", day)
        put("origin", origin)
        put("activity", activity)
        put("startedAtUtc", startedAtUtc)
        put("durationMin", durationMin)
        put("activeMin", activeMin?.let { JSONObject.wrap(it) } ?: JSONObject.NULL)
        put("energyKcal", energyKcal?.let { JSONObject.wrap(it) } ?: JSONObject.NULL)
        put("distanceM", distanceM?.let { JSONObject.wrap(it) } ?: JSONObject.NULL)
        put("avgHr", avgHr?.let { JSONObject.wrap(it) } ?: JSONObject.NULL)
        put("maxHr", maxHr?.let { JSONObject.wrap(it) } ?: JSONObject.NULL)
        put("updatedAt", updatedAt)
    }
}

data class Payload(val daily: List<DailyRow>, val sessions: List<SessionRow>) {

    fun toJson(): JSONObject = JSONObject().apply {
        put("daily", JSONArray().apply { daily.forEach { put(it.toJson()) } })
        put("sessions", JSONArray().apply { sessions.forEach { put(it.toJson()) } })
    }

    val isEmpty: Boolean get() = daily.isEmpty() && sessions.isEmpty()

    /**
     * One line for the app's log pane, sized so it is readable on a phone
     * screen. The counts matter more than the bytes: "sent 14 daily, 6 sessions"
     * is the difference between working and silently syncing nothing.
     */
    fun summary(): String = "daily=${daily.size} sessions=${sessions.size}"
}

/** Instant -> the ISO-8601 string the server's `new Date(...)` expects. */
fun Instant.toIso(): String = toString()