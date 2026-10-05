package com.personaos.app

import android.app.Activity
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.samsung.android.sdk.health.data.HealthDataService
import com.samsung.android.sdk.health.data.HealthDataStore
import com.samsung.android.sdk.health.data.data.HealthDataPoint
import com.samsung.android.sdk.health.data.data.entries.ExerciseSession
import com.samsung.android.sdk.health.data.data.entries.SleepSession
import com.samsung.android.sdk.health.data.permission.AccessType
import com.samsung.android.sdk.health.data.permission.Permission
import com.samsung.android.sdk.health.data.request.DataType
import com.samsung.android.sdk.health.data.request.DataTypes
import com.samsung.android.sdk.health.data.request.InstantTimeFilter
import com.samsung.android.sdk.health.data.request.LocalDateFilter
import com.samsung.android.sdk.health.data.request.LocalDateGroup
import com.samsung.android.sdk.health.data.request.LocalDateGroupUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * Health data from Samsung Health, via the Samsung Health Data SDK.
 *
 * This exists because Health Connect is a dead end on a Samsung phone: Samsung
 * Health publishes only steps and active calories to it, and never sleep, HRV or
 * resting heart rate. Reading from Samsung Health directly is the only way to get
 * those, and sleep in particular is what the readiness score needs.
 *
 * Five types, and the reason for each:
 *   - SLEEP        the night, with stages — the one Health Connect cannot provide
 *   - STEPS        daily totals (Health Connect's were sparse)
 *   - ACTIVITY_SUMMARY  active calories, for the day's burn
 *   - HEART_RATE   the day's minimum, used as a resting-heart-rate proxy
 *   - EXERCISE     workouts
 *
 * Steps and calories are not readable as rows — Samsung stores them as totals — so
 * they are aggregated grouped by day. Sleep, heart rate and exercise are read.
 *
 * The device must have Samsung Health's "Developer Mode for Data Read" on until the
 * app is registered with Samsung, or every call fails with an authorization error.
 */
/** One night's sleep totals, summed across every session that ended on the same
 *  local day. */
private class ShsSleepAgg {
    var totalSec = 0L
    var deepSec = 0L
    var remSec = 0L
    var lightSec = 0L
    var start: Instant? = null
    var end: Instant? = null
}

@CapacitorPlugin(name = "SamsungHealth")
class SamsungHealthPlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val permissions: Set<Permission> = setOf(
        Permission.of(DataTypes.SLEEP, AccessType.READ),
        Permission.of(DataTypes.STEPS, AccessType.READ),
        Permission.of(DataTypes.ACTIVITY_SUMMARY, AccessType.READ),
        Permission.of(DataTypes.HEART_RATE, AccessType.READ),
        Permission.of(DataTypes.EXERCISE, AccessType.READ),
    )

    private fun store(): HealthDataStore = HealthDataService.getStore(context)

    @PluginMethod
    fun checkSamsungPermissions(call: PluginCall) {
        scope.launch {
            try {
                val granted = store().getGrantedPermissions(permissions)
                val ret = JSObject()
                ret.put("complete", granted.containsAll(permissions))
                ret.put("granted", granted.size)
                ret.put("wanted", permissions.size)
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("Samsung Health not available: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun requestSamsungPermissions(call: PluginCall) {
        val activity: Activity = activity ?: run {
            call.reject("No activity.")
            return
        }
        scope.launch {
            try {
                val granted = store().requestPermissions(permissions, activity)
                val ret = JSObject()
                ret.put("complete", granted.containsAll(permissions))
                ret.put("granted", granted.size)
                ret.put("wanted", permissions.size)
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("Permission request failed: ${e.message}")
            }
        }
    }

    /**
     * Reads the window and returns { daily: [...], sessions: [...] } shaped for
     * /api/health/ingest. One daily row per local day — steps, active calories,
     * resting-HR proxy and sleep together — plus one session row per workout.
     */
    @PluginMethod
    fun readSamsung(call: PluginCall) {
        val from = call.getString("from")
        val to = call.getString("to")
        if (from == null || to == null) {
            call.reject("from and to (YYYY-MM-DD) are required.")
            return
        }
        scope.launch {
            try {
                val zone = ZoneId.systemDefault()
                val startDate = LocalDate.parse(from)
                val endDate = LocalDate.parse(to)
                val dayFilter = LocalDateFilter.of(startDate, endDate, true, true)
                val dayGroup = LocalDateGroup.of(LocalDateGroupUnit.DAILY, 1)

                val rows = HashMap<LocalDate, JSObject>()
                val debug = JSArray()

                fun rowFor(day: LocalDate): JSObject = rows.getOrPut(day) {
                    JSObject().apply {
                        put("recordId", "shs-$day")
                        put("day", day.toString())
                        put("origin", "com.samsung.shealth")
                        put("updatedAt", Instant.now().toString())
                    }
                }

                /* Steps: a daily total, so aggregated grouped by day rather than read. */
                try {
                    val request = DataType.StepsType.TOTAL.requestBuilder
                        .setLocalTimeFilterWithGroup(
                            dayFilter.toLocalTimeFilter(),
                            dayGroup.toLocalTimeGroup(),
                        )
                        .build()
                    for (a in store().aggregateData(request).dataList ?: emptyList()) {
                        rowFor(a.startTime.atZone(zone).toLocalDate()).put("steps", a.value)
                    }
                } catch (e: Exception) {
                    debug.put("steps: ${e.message}")
                }

                /* Active calories, same shape. */
                try {
                    val request = DataType.ActivitySummaryType.TOTAL_ACTIVE_CALORIES_BURNED.requestBuilder
                        .setLocalTimeFilterWithGroup(
                            dayFilter.toLocalTimeFilter(),
                            dayGroup.toLocalTimeGroup(),
                        )
                        .build()
                    for (a in store().aggregateData(request).dataList ?: emptyList()) {
                        val kcal = (a.value as? Number)?.toDouble()
                        if (kcal != null) rowFor(a.startTime.atZone(zone).toLocalDate()).put("activeKcal", kcal)
                    }
                } catch (e: Exception) {
                    debug.put("activeKcal: ${e.message}")
                }

                /* Samsung exposes no resting-heart-rate value, so the day's minimum
                   heart rate is used as the closest available proxy. */
                try {
                    val request = DataType.HeartRateType.MIN.requestBuilder
                        .setLocalDateFilterWithGroup(dayFilter, dayGroup)
                        .build()
                    for (a in store().aggregateData(request).dataList ?: emptyList()) {
                        val bpm = (a.value as? Number)?.toInt()
                        if (bpm != null && bpm > 0) rowFor(a.startTime.atZone(zone).toLocalDate()).put("restingHr", bpm)
                    }
                } catch (e: Exception) {
                    debug.put("restingHr: ${e.message}")
                }

                /* Sleep: one interval per night, attributed to the morning it ended. */
                try {
                    val startInstant = startDate.atStartOfDay(zone).toInstant()
                    val endInstant = endDate.plusDays(1).atStartOfDay(zone).toInstant()
                    val request = DataTypes.SLEEP.readDataRequestBuilder
                        .setInstantTimeFilter(InstantTimeFilter.of(startInstant, endInstant, true, true))
                        .build()
                    val nights: List<HealthDataPoint> = store().readData(request).dataList ?: emptyList()
                    /* Accumulated per wake day, not written per session: a day can hold
                       more than one sleep session (a nap, or a night split across
                       midnight), and overwriting made the total depend on whichever
                       session came last. */
                    val sleepByDay = HashMap<LocalDate, ShsSleepAgg>()
                    for (dp in nights) {
                        val list = dp.getValueOrDefault(DataType.SleepType.SESSIONS, emptyList<SleepSession>())
                        for (s in list) {
                            val wakeDay = s.endTime.atZone(zone).toLocalDate()
                            val agg = sleepByDay.getOrPut(wakeDay) { ShsSleepAgg() }
                            agg.totalSec += s.duration.seconds
                            if (agg.start == null || s.startTime < agg.start!!) agg.start = s.startTime
                            if (agg.end == null || s.endTime > agg.end!!) agg.end = s.endTime
                            for (stage in s.stages ?: emptyList()) {
                                val sec = stage.endTime.epochSecond - stage.startTime.epochSecond
                                when (stage.stage) {
                                    DataType.SleepType.StageType.DEEP -> agg.deepSec += sec
                                    DataType.SleepType.StageType.REM -> agg.remSec += sec
                                    DataType.SleepType.StageType.LIGHT -> agg.lightSec += sec
                                    else -> {}
                                }
                            }
                        }
                    }
                    for ((day, agg) in sleepByDay) {
                        val row = rowFor(day)
                        if (agg.totalSec > 0) row.put("sleepTotalMin", agg.totalSec / 60)
                        if (agg.deepSec > 0) row.put("sleepDeepMin", agg.deepSec / 60)
                        if (agg.remSec > 0) row.put("sleepRemMin", agg.remSec / 60)
                        if (agg.lightSec > 0) row.put("sleepLightMin", agg.lightSec / 60)
                        agg.start?.let { row.put("sleepStartUtc", it.toString()) }
                        agg.end?.let { row.put("sleepEndUtc", it.toString()) }
                    }
                } catch (e: Exception) {
                    debug.put("sleep: ${e.message}")
                }

                /* Exercise sessions across the window. */
                val sessions = JSArray()
                try {
                    val startInstant = startDate.atStartOfDay(zone).toInstant()
                    val endInstant = endDate.plusDays(1).atStartOfDay(zone).toInstant()
                    val request = DataTypes.EXERCISE.readDataRequestBuilder
                        .setInstantTimeFilter(InstantTimeFilter.of(startInstant, endInstant, true, true))
                        .build()
                    val exercises: List<HealthDataPoint> = store().readData(request).dataList ?: emptyList()
                    for (dp in exercises) {
                        val list = dp.getValueOrDefault(DataType.ExerciseType.SESSIONS, emptyList<ExerciseSession>())
                        for (s in list) {
                            val row = JSObject()
                            row.put("recordId", "shs-ex-${s.startTime.epochSecond}-${s.duration.seconds}")
                            row.put("day", s.startTime.atZone(zone).toLocalDate().toString())
                            row.put("origin", "com.samsung.shealth")
                            row.put("activity", s.customTitle?.takeIf { it.isNotBlank() } ?: "Exercise")
                            row.put("startedAtUtc", s.startTime.toString())
                            row.put("durationMin", (s.duration.seconds / 60).coerceAtLeast(1))
                            row.put("energyKcal", s.calories.toDouble())
                            s.distance?.let { row.put("distanceM", it.toDouble()) }
                            s.meanHeartRate?.let { row.put("avgHr", it.toInt()) }
                            s.maxHeartRate?.let { row.put("maxHr", it.toInt()) }
                            row.put("updatedAt", Instant.now().toString())
                            sessions.put(row)
                        }
                    }
                } catch (e: Exception) {
                    debug.put("exercise: ${e.message}")
                }

                val daily = JSArray()
                for (row in rows.values) daily.put(row)

                val ret = JSObject()
                ret.put("daily", daily)
                ret.put("sessions", sessions)
                if (debug.length() > 0) ret.put("debug", debug)
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("Samsung read failed: ${e.message}")
            }
        }
    }
}

