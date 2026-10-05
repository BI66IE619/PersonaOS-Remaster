package com.personaos.app

import android.app.Activity
import android.content.Intent
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * Reads Health Connect and hands the result to JavaScript.
 *
 * The reading is here, in the native layer, because Health Connect is not reachable
 * from a WebView. The posting is not: the data goes back to JS, which POSTs it to
 * /api/health/ingest with the session the WebView already holds. That split keeps the
 * authentication in one place — there is no second token to mint, store or refresh —
 * and it is what the ingest route was written for.
 *
 * All three methods are on the plugin rather than in JS: availability, the permission
 * screen, and the read. JS decides when to call them.
 *
 * The window is passed in as two day keys and interpreted in the phone's own timezone,
 * because a "day" of steps is a local-calendar day, not a UTC one.
 */
/** One night's totals, accumulated across every sleep session that ended on the
 *  same local day. */
private class SleepAggregate {
    var totalSec = 0L
    var deepSec = 0L
    var remSec = 0L
    var lightSec = 0L
    var start: Instant? = null
    var end: Instant? = null
}

@CapacitorPlugin(name = "HealthConnect")
class HealthConnectPlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** The read permissions this app asks for, matching the manifest declarations.
     *  Reading one type without its permission throws, so the two lists are kept
     *  side by side and must not drift. */
    private val permissions: Set<String> = setOf(
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.getReadPermission(HeartRateRecord::class),
        HealthPermission.getReadPermission(RestingHeartRateRecord::class),
        HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
        HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class),
        HealthPermission.getReadPermission(DistanceRecord::class),
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class),
        HealthPermission.getReadPermission(OxygenSaturationRecord::class),
    )

    private fun client(): HealthConnectClient = HealthConnectClient.getOrCreate(context)

    /** "available" | "updateRequired" | "notSupported" — JS uses this to decide
     *  whether to offer the connect button at all. */
    @PluginMethod
    fun checkAvailability(call: PluginCall) {
        val status = HealthConnectClient.getSdkStatus(context)
        val ret = JSObject()
        ret.put(
            "status",
            when (status) {
                HealthConnectClient.SDK_AVAILABLE -> "available"
                HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "updateRequired"
                else -> "notSupported"
            },
        )
        call.resolve(ret)
    }

    /** Reads the granted set without opening any UI, so the app can tell "not asked
     *  yet" from "asked and refused" and only show the permission screen when it
     *  will actually change something. */
    @PluginMethod
    fun checkHealthPermissions(call: PluginCall) {
        if (HealthConnectClient.getSdkStatus(context) != HealthConnectClient.SDK_AVAILABLE) {
            val ret = JSObject()
            ret.put("complete", false)
            ret.put("missing", JSArray(listOf("unavailable")))
            call.resolve(ret)
            return
        }
        scope.launch {
            try {
                val granted = client().permissionController.getGrantedPermissions()
                val missing = permissions - granted
                val ret = JSObject()
                ret.put("complete", missing.isEmpty())
                ret.put("missing", JSArray(missing.toList()))
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("Could not read permissions: ${e.message}")
            }
        }
    }

    /** Opens the Health Connect permission screen. Resolves with the granted set. */
    @PluginMethod
    fun requestHealthPermissions(call: PluginCall) {
        if (HealthConnectClient.getSdkStatus(context) != HealthConnectClient.SDK_AVAILABLE) {
            call.reject("Health Connect is not available on this device.")
            return
        }
        val contract = PermissionController.createRequestPermissionResultContract()
        val intent = contract.createIntent(context, permissions)
        startActivityForResult(call, intent, "permissionsResult")
    }

    @ActivityCallback
    private fun permissionsResult(call: PluginCall, result: ActivityResult) {
        if (result.resultCode != Activity.RESULT_OK) {
            call.reject("Permission request was dismissed.")
            return
        }
        scope.launch {
            try {
                val granted = client().permissionController.getGrantedPermissions()
                val missing = permissions - granted
                val ret = JSObject()
                ret.put("granted", granted.size)
                ret.put("complete", missing.isEmpty())
                ret.put("missing", JSArray(missing.toList()))
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("Could not read permissions: ${e.message}")
            }
        }
    }

    /**
     * Reads a window and returns { daily: [...], sessions: [...] } shaped exactly like
     * the /api/health/ingest body. `from` and `to` are YYYY-MM-DD, inclusive.
     */
    @PluginMethod
    fun readHealth(call: PluginCall) {
        val from = call.getString("from")
        val to = call.getString("to")
        if (from == null || to == null) {
            call.reject("from and to (YYYY-MM-DD) are required.")
            return
        }
        if (HealthConnectClient.getSdkStatus(context) != HealthConnectClient.SDK_AVAILABLE) {
            call.reject("Health Connect is not available on this device.")
            return
        }

        scope.launch {
            try {
                val zone = ZoneId.systemDefault()
                val out = readInternal(from, to, zone)
                call.resolve(out)
            } catch (e: Exception) {
                call.reject("Read failed: ${e.message}")
            }
        }
    }

    private suspend fun readInternal(from: String, to: String, zone: ZoneId): JSObject {
        val client = client()
        val today = LocalDate.now(zone)
        val startDate = LocalDate.parse(from)
        val endDate = LocalDate.parse(to)

        val daily = JSArray()
        val sessions = JSArray()
        /* Anything that failed to read, surfaced to the app so a silent null is
           never mistaken for "no data". */
        val debug = JSArray()

        /* Sleep is read once for the whole window and bucketed by the day each night
           ended on — the night you wake up on is the day the sleep belongs to. A
           per-day read misses a night that starts before midnight, because a day's
           range begins at 00:00 and the session that matters mostly began the evening
           before. */
        val sleepByDay = HashMap<LocalDate, SleepAggregate>()
        try {
            val nights = client.readRecords(
                ReadRecordsRequest(
                    recordType = SleepSessionRecord::class,
                    timeRangeFilter = TimeRangeFilter.between(
                        startDate.minusDays(1).atStartOfDay(zone).toInstant(),
                        endDate.plusDays(1).atStartOfDay(zone).toInstant(),
                    ),
                ),
            ).records
            for (night in nights) {
                val wakeDay = night.endTime.atZone(zone).toLocalDate()
                val agg = sleepByDay.getOrPut(wakeDay) { SleepAggregate() }
                agg.totalSec += night.endTime.epochSecond - night.startTime.epochSecond
                if (agg.start == null || night.startTime < agg.start!!) agg.start = night.startTime
                if (agg.end == null || night.endTime > agg.end!!) agg.end = night.endTime
                for (stage in night.stages) {
                    val sec = stage.endTime.epochSecond - stage.startTime.epochSecond
                    when (stage.stage) {
                        SleepSessionRecord.STAGE_TYPE_DEEP -> agg.deepSec += sec
                        SleepSessionRecord.STAGE_TYPE_REM -> agg.remSec += sec
                        SleepSessionRecord.STAGE_TYPE_LIGHT -> agg.lightSec += sec
                    }
                }
            }
        } catch (e: Exception) {
            debug.put("sleep: ${e.message}")
        }

        /* One row per local day, filled from a per-day aggregate. Aggregating a day at
           a time is more queries than one range aggregate, but a day is the unit the
           table stores and the only one that can be computed without the phone's
           timezone being applied on the server. */
        var day = startDate
        while (!day.isAfter(endDate)) {
            val dayStart = day.atStartOfDay(zone).toInstant()
            val dayEnd = day.plusDays(1).atStartOfDay(zone).toInstant()
            val range = TimeRangeFilter.between(dayStart, dayEnd)

            val row = JSObject()
            row.put("recordId", "hc-daily-$day")
            row.put("day", day.toString())
            row.put("origin", "health-connect")
            row.put("updatedAt", Instant.now().toString())

            /* Each metric is its own aggregate call. One combined request means a
               single unsupported or ungranted metric blanks the whole day, and the
               day still counts as "synced", which is exactly the failure that looks
               like nothing happened. Separate calls cost a few more queries and
               isolate the damage, and the catch names what failed. */
            try {
                client.aggregate(AggregateRequest(setOf(StepsRecord.COUNT_TOTAL), range))[StepsRecord.COUNT_TOTAL]
                    ?.let { row.put("steps", it) }
            } catch (e: Exception) {
                debug.put("$day steps: ${e.message}")
            }
            try {
                client.aggregate(AggregateRequest(setOf(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL), range))[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]
                    ?.let { row.put("activeKcal", it.inKilocalories) }
            } catch (e: Exception) {
                debug.put("$day activeKcal: ${e.message}")
            }
            try {
                client.aggregate(AggregateRequest(setOf(TotalCaloriesBurnedRecord.ENERGY_TOTAL), range))[TotalCaloriesBurnedRecord.ENERGY_TOTAL]
                    ?.let { row.put("totalKcal", it.inKilocalories) }
            } catch (e: Exception) {
                debug.put("$day totalKcal: ${e.message}")
            }
            try {
                client.aggregate(AggregateRequest(setOf(DistanceRecord.DISTANCE_TOTAL), range))[DistanceRecord.DISTANCE_TOTAL]
                    ?.let { row.put("distanceM", it.inMeters) }
            } catch (e: Exception) {
                debug.put("$day distanceM: ${e.message}")
            }
            try {
                client.aggregate(AggregateRequest(setOf(RestingHeartRateRecord.BPM_AVG), range))[RestingHeartRateRecord.BPM_AVG]
                    ?.let { row.put("restingHr", it.toInt()) }
            } catch (e: Exception) {
                debug.put("$day restingHr: ${e.message}")
            }

            /* HRV and SpO2 have no aggregate metric in this client, so they are read
               as records and averaged. HRV RMSSD feeds the readiness baseline, so a
               day without it cannot be scored at all. */
            try {
                val hrv = client.readRecords(
                    ReadRecordsRequest(
                        recordType = HeartRateVariabilityRmssdRecord::class,
                        timeRangeFilter = range,
                    ),
                ).records
                if (hrv.isNotEmpty()) {
                    row.put("hrvRmssd", hrv.sumOf { it.heartRateVariabilityMillis } / hrv.size)
                }
            } catch (e: Exception) {
                debug.put("$day hrv: ${e.message}")
            }
            try {
                val spo2 = client.readRecords(
                    ReadRecordsRequest(
                        recordType = OxygenSaturationRecord::class,
                        timeRangeFilter = range,
                    ),
                ).records
                if (spo2.isNotEmpty()) {
                    row.put("spo2", spo2.sumOf { it.percentage.value } / spo2.size)
                }
            } catch (e: Exception) {
                debug.put("$day spo2: ${e.message}")
            }

            /* Sleep, from the whole-window bucket built above. */
            sleepByDay[day]?.let { sleep ->
                if (sleep.totalSec > 0) {
                    row.put("sleepTotalMin", sleep.totalSec / 60)
                    if (sleep.deepSec > 0) row.put("sleepDeepMin", sleep.deepSec / 60)
                    if (sleep.remSec > 0) row.put("sleepRemMin", sleep.remSec / 60)
                    if (sleep.lightSec > 0) row.put("sleepLightMin", sleep.lightSec / 60)
                }
                sleep.start?.let { row.put("sleepStartUtc", it.toString()) }
                sleep.end?.let { row.put("sleepEndUtc", it.toString()) }
            }

            daily.put(row)
            day = day.plusDays(1)
        }

        /* Exercise sessions across the whole window, newest last. */
        val exercise = client.readRecords(
            ReadRecordsRequest(
                recordType = ExerciseSessionRecord::class,
                timeRangeFilter = TimeRangeFilter.between(
                    startDate.atStartOfDay(zone).toInstant(),
                    endDate.plusDays(1).atStartOfDay(zone).toInstant(),
                ),
            ),
        ).records
        for (s in exercise) {
            val row = JSObject()
            row.put("recordId", "hc-ex-${s.metadata.id}")
            row.put("day", s.startTime.atZone(zone).toLocalDate().toString())
            row.put("origin", "health-connect")
            row.put("activity", exerciseName(s.exerciseType))
            row.put("startedAtUtc", s.startTime.toString())
            row.put("durationMin", ((s.endTime.epochSecond - s.startTime.epochSecond) / 60).coerceAtLeast(1))
            row.put("updatedAt", Instant.now().toString())

            try {
                val agg = client.aggregate(
                    AggregateRequest(
                        metrics = setOf(
                            ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL,
                            DistanceRecord.DISTANCE_TOTAL,
                            HeartRateRecord.BPM_AVG,
                            HeartRateRecord.BPM_MAX,
                        ),
                        timeRangeFilter = TimeRangeFilter.between(s.startTime, s.endTime),
                    ),
                )
                agg[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]
                    ?.let { row.put("energyKcal", it.inKilocalories) }
                agg[DistanceRecord.DISTANCE_TOTAL]?.let { row.put("distanceM", it.inMeters) }
                agg[HeartRateRecord.BPM_AVG]?.let { row.put("avgHr", it.toInt()) }
                agg[HeartRateRecord.BPM_MAX]?.let { row.put("maxHr", it.toInt()) }
            } catch (e: Exception) {
                debug.put("session ${s.metadata.id}: ${e.message}")
            }
            sessions.put(row)
        }

        val ret = JSObject()
        ret.put("daily", daily)
        ret.put("sessions", sessions)
        if (debug.length() > 0) ret.put("debug", debug)
        /* Unused but proves the field is present if a future caller needs it. */
        ret.put("today", today.toString())
        return ret
    }

    /** Health Connect's exercise type as the word the app's sport matcher expects.
     *  Only the sports the survey offers are named; anything else reads as a generic
     *  workout, which the server then ignores rather than filing under the wrong sport. */
    private fun exerciseName(type: Int): String = when (type) {
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING,
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL -> "Running"
        ExerciseSessionRecord.EXERCISE_TYPE_WALKING -> "Walking"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING,
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY -> "Cycling"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL,
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER -> "Swimming"
        ExerciseSessionRecord.EXERCISE_TYPE_ROWING,
        ExerciseSessionRecord.EXERCISE_TYPE_ROWING_MACHINE -> "Rowing"
        ExerciseSessionRecord.EXERCISE_TYPE_BASKETBALL -> "Basketball"
        ExerciseSessionRecord.EXERCISE_TYPE_SOCCER -> "Soccer"
        ExerciseSessionRecord.EXERCISE_TYPE_TENNIS -> "Tennis"
        ExerciseSessionRecord.EXERCISE_TYPE_VOLLEYBALL -> "Volleyball"
        ExerciseSessionRecord.EXERCISE_TYPE_HIKING -> "Hiking"
        ExerciseSessionRecord.EXERCISE_TYPE_YOGA -> "Yoga"
        ExerciseSessionRecord.EXERCISE_TYPE_MARTIAL_ARTS -> "Martial arts"
        ExerciseSessionRecord.EXERCISE_TYPE_ROCK_CLIMBING -> "Rock climbing"
        else -> "Exercise"
    }
}
