package com.personaos.app

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.samsung.android.sdk.health.data.HealthDataService
import com.samsung.android.sdk.health.data.data.HealthDataPoint
import com.samsung.android.sdk.health.data.data.entries.ExerciseSession
import com.samsung.android.sdk.health.data.data.entries.SleepSession
import com.samsung.android.sdk.health.data.request.DataType
import com.samsung.android.sdk.health.data.request.DataTypes
import com.samsung.android.sdk.health.data.request.InstantTimeFilter
import com.samsung.android.sdk.health.data.request.LocalDateFilter
import com.samsung.android.sdk.health.data.request.LocalDateGroup
import com.samsung.android.sdk.health.data.request.LocalDateGroupUnit
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * The two health readers, kept out of the Capacitor plugins so the background worker
 * can call exactly the same code the Sync button does.
 *
 * Both return { daily: [...], sessions: [...] } shaped for /api/health/ingest, so the
 * worker only has to concatenate them and post.
 */
object HealthReaders {

    /** One night's sleep totals, summed across every session ending the same day. */
    private class SleepAgg {
        var totalSec = 0L
        var deepSec = 0L
        var remSec = 0L
        var lightSec = 0L
        var start: Instant? = null
        var end: Instant? = null
    }

    suspend fun healthConnect(context: Context, from: String, to: String): JSObject {
        val client = HealthConnectClient.getOrCreate(context)
        val zone = ZoneId.systemDefault()
        val today = LocalDate.now(zone)
        val startDate = LocalDate.parse(from)
        val endDate = LocalDate.parse(to)

        val daily = JSArray()
        val sessions = JSArray()
        val debug = JSArray()

        /* Sleep read once for the window, bucketed by the morning it ended. */
        val sleepByDay = HashMap<LocalDate, SleepAgg>()
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
                val agg = sleepByDay.getOrPut(wakeDay) { SleepAgg() }
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
                client.aggregate(AggregateRequest(setOf(RestingHeartRateRecord.BPM_AVG), range))[RestingHeartRateRecord.BPM_AVG]
                    ?.let { row.put("restingHr", it.toInt()) }
            } catch (e: Exception) {
                debug.put("$day restingHr: ${e.message}")
            }

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

        try {
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
                sessions.put(row)
            }
        } catch (e: Exception) {
            debug.put("exercise: ${e.message}")
        }

        val ret = JSObject()
        ret.put("daily", daily)
        ret.put("sessions", sessions)
        if (debug.length() > 0) ret.put("debug", debug)
        ret.put("today", today.toString())
        return ret
    }

    suspend fun samsungHealth(context: Context, from: String, to: String): JSObject {
        val store = HealthDataService.getStore(context)
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

        try {
            val request = DataType.StepsType.TOTAL.requestBuilder
                .setLocalTimeFilterWithGroup(dayFilter.toLocalTimeFilter(), dayGroup.toLocalTimeGroup())
                .build()
            for (a in store.aggregateData(request).dataList ?: emptyList()) {
                rowFor(a.startTime.atZone(zone).toLocalDate()).put("steps", a.value)
            }
        } catch (e: Exception) {
            debug.put("steps: ${e.message}")
        }

        try {
            val request = DataType.ActivitySummaryType.TOTAL_ACTIVE_CALORIES_BURNED.requestBuilder
                .setLocalTimeFilterWithGroup(dayFilter.toLocalTimeFilter(), dayGroup.toLocalTimeGroup())
                .build()
            for (a in store.aggregateData(request).dataList ?: emptyList()) {
                (a.value as? Number)?.toDouble()?.let {
                    rowFor(a.startTime.atZone(zone).toLocalDate()).put("activeKcal", it)
                }
            }
        } catch (e: Exception) {
            debug.put("activeKcal: ${e.message}")
        }

        try {
            val request = DataType.HeartRateType.MIN.requestBuilder
                .setLocalDateFilterWithGroup(dayFilter, dayGroup)
                .build()
            for (a in store.aggregateData(request).dataList ?: emptyList()) {
                val bpm = (a.value as? Number)?.toInt()
                if (bpm != null && bpm > 0) rowFor(a.startTime.atZone(zone).toLocalDate()).put("restingHr", bpm)
            }
        } catch (e: Exception) {
            debug.put("restingHr: ${e.message}")
        }

        try {
            val startInstant = startDate.atStartOfDay(zone).toInstant()
            val endInstant = endDate.plusDays(1).atStartOfDay(zone).toInstant()
            val request = DataTypes.SLEEP.readDataRequestBuilder
                .setInstantTimeFilter(InstantTimeFilter.of(startInstant, endInstant, true, true))
                .build()
            val nights: List<HealthDataPoint> = store.readData(request).dataList ?: emptyList()
            val sleepByDay = HashMap<LocalDate, SleepAgg>()
            for (dp in nights) {
                val list = dp.getValueOrDefault(DataType.SleepType.SESSIONS, emptyList<SleepSession>())
                for (s in list) {
                    val wakeDay = s.endTime.atZone(zone).toLocalDate()
                    val agg = sleepByDay.getOrPut(wakeDay) { SleepAgg() }
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

        val sessions = JSArray()
        try {
            val startInstant = startDate.atStartOfDay(zone).toInstant()
            val endInstant = endDate.plusDays(1).atStartOfDay(zone).toInstant()
            val request = DataTypes.EXERCISE.readDataRequestBuilder
                .setInstantTimeFilter(InstantTimeFilter.of(startInstant, endInstant, true, true))
                .build()
            val exercises: List<HealthDataPoint> = store.readData(request).dataList ?: emptyList()
            for (dp in exercises) {
                for (s in dp.getValueOrDefault(DataType.ExerciseType.SESSIONS, emptyList<ExerciseSession>())) {
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
        return ret
    }

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
