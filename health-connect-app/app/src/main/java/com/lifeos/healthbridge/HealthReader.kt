package com.lifeos.healthbridge

import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.ActiveMinutesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.RespiratoryRateRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * Turns Health Connect records into the daily rows and sessions the LifeOS
 * server accepts.
 *
 * Three decisions here are the reason the rest of the app is simple, and each
 * one is load-bearing:
 *
 * **One row per (day, origin), not one per day.** Samsung Health is not the only
 * app writing to Health Connect — the phone's own step counter and Google Fit
 * often are — and they disagree. Summing them double-counts a single walk. So
 * this emits one row per writing app and lets the server pick between them,
 * preferring Samsung Health. The alternative, picking a winner here, would mean
 * re-deciding the policy on the phone and again on the server.
 *
 * **Sleep is rolled up per night, keyed by the morning it ends.** A night's
 * stages straddle midnight, so assigning stages to their own local day would
 * file 90% of a night's sleep under the wrong date. Assigning the whole session
 * to its end day is what makes "last night's sleep" mean what a person means by
 * it. The row id is derived from the night for the same reason: the server
 * replaces a night wholesale rather than incrementing it, which is only correct
 * if the id is stable across re-reads of that night.
 *
 * **Per-session metrics come from records, not from the session.** An
 * ExerciseSessionRecord has no heart rate, calories or distance on it — those
 * live in the segment and lap lists, which on a modern library are just timing.
 * Rather than reach into those unstable shapes, calories and distance are summed
 * from the records that fall inside the session window, and heart rate comes
 * from an on-device aggregate over that same window. The honest caveat: a
 * calorie or distance record that happens to overlap a workout is attributed to
 * it, so a session's figures can include a few calories of sitting still. That is
 * a small, bounded error in exchange for using APIs that are stable across
 * library versions, which matters more for something the user will see in a
 * readiness score.
 */
class HealthReader(private val client: HealthConnectClient) {

    private val zone: ZoneId = ZoneId.systemDefault()

    /** Read failures are collected, not thrown. One denied permission should not
     *  discard the steps the app did manage to read. */
    data class ReadResult(val payload: Payload, val warnings: List<String>)

    private data class DayOrigin(val day: LocalDate, val origin: String)

    private class Acc {
        var steps: Long = 0
        var activeMin: Double = 0.0
        var activeKcal: Double = 0.0
        var updatedAt: Long = 0

        val restingHr = ArrayList<Double>()
        val hrv = ArrayList<Double>()
        val spo2 = ArrayList<Double>()
        val resp = ArrayList<Double>()

        var sleepStart: Instant? = null
        var sleepEnd: Instant? = null
        var sleepDeep = 0.0
        var sleepRem = 0.0
        var sleepLight = 0.0
        var sleepUnstaged = 0.0

        fun touch(instant: Instant) {
            val millis = instant.toEpochMilli()
            if (millis > updatedAt) updatedAt = millis
        }

        val hasAnything: Boolean
            get() = steps > 0 || activeMin > 0 || activeKcal > 0 ||
                restingHr.isNotEmpty() || hrv.isNotEmpty() ||
                spo2.isNotEmpty() || resp.isNotEmpty() ||
                sleepStart != null
    }

    suspend fun read(lookbackDays: Int): ReadResult {
        val today = LocalDate.now(zone)
        return readRange(today.minusDays((lookbackDays - 1).toLong()), today)
    }

    suspend fun readRange(from: LocalDate, to: LocalDate): ReadResult {
        val warnings = ArrayList<String>()
        val buckets = LinkedHashMap<DayOrigin, Acc>()

        fun bucket(day: LocalDate, origin: String): Acc =
            buckets.getOrPut(DayOrigin(day, origin)) { Acc() }

        val startOfFirstDay = from.atStartOfDay(zone).toInstant()
        val startOfDayAfterLast = to.plusDays(1).atStartOfDay(zone).toInstant()

        /* Sleep is read a day earlier than the requested window. A session that
           ends at 06:00 on the first day starts on the day before it, and the
           day's sleep must not vanish because the window starts at midnight. */
        val sleepFrom = from.minusDays(1).atStartOfDay(zone).toInstant()

        guarded(warnings, "steps") {
            client.readRecords(
                StepsRecord::class,
                TimeRangeFilter.between(startOfFirstDay, startOfDayAfterLast),
            )
        }.forEach { rec ->
            val acc = bucket(dayOf(rec.startTime), rec.metadata.dataOrigin.packageName)
            acc.steps += rec.count
            acc.touch(rec.metadata.lastModifiedTime)
        }

        guarded(warnings, "active minutes") {
            client.readRecords(
                ActiveMinutesBurnedRecord::class,
                TimeRangeFilter.between(startOfFirstDay, startOfDayAfterLast),
            )
        }.forEach { rec ->
            val acc = bucket(dayOf(rec.startTime), rec.metadata.dataOrigin.packageName)
            acc.activeMin += rec.activeDuration.toMillis() / 60_000.0
            acc.touch(rec.metadata.lastModifiedTime)
        }

        guarded(warnings, "active calories") {
            client.readRecords(
                ActiveCaloriesBurnedRecord::class,
                TimeRangeFilter.between(startOfFirstDay, startOfDayAfterLast),
            )
        }.forEach { rec ->
            val acc = bucket(dayOf(rec.startTime), rec.metadata.dataOrigin.packageName)
            acc.activeKcal += rec.energy.kilocalories
            acc.touch(rec.metadata.lastModifiedTime)
        }

        /* Instantaneous readings are averaged within the day rather than summed
           or last-taken. A watch that samples resting HR every few minutes gives
           a dozen readings that are all estimates of one underlying number, so
           the mean is the honest summary and the last sample is mostly an
           artefact of when the sync ran. */
        guarded(warnings, "resting heart rate") {
            client.readRecords(
                RestingHeartRateRecord::class,
                TimeRangeFilter.between(startOfFirstDay, startOfDayAfterLast),
            )
        }.forEach { rec ->
            val acc = bucket(dayOf(rec.time), rec.metadata.dataOrigin.packageName)
            acc.restingHr += rec.beatsPerMinute.toDouble()
            acc.touch(rec.metadata.lastModifiedTime)
        }

        /* RMSSD in milliseconds. Samsung Health reports RMSSD and the server's
           readiness baseline is built on RMSSD, so this is passed through
           untouched rather than converted from SDNN. */
        guarded(warnings, "HRV") {
            client.readRecords(
                HeartRateVariabilityRmssdRecord::class,
                TimeRangeFilter.between(startOfFirstDay, startOfDayAfterLast),
            )
        }.forEach { rec ->
            val acc = bucket(dayOf(rec.time), rec.metadata.dataOrigin.packageName)
            acc.hrv += rec.heartRateVariabilityMillis
            acc.touch(rec.metadata.lastModifiedTime)
        }

        guarded(warnings, "blood oxygen") {
            client.readRecords(
                OxygenSaturationRecord::class,
                TimeRangeFilter.between(startOfFirstDay, startOfDayAfterLast),
            )
        }.forEach { rec ->
            val acc = bucket(dayOf(rec.time), rec.metadata.dataOrigin.packageName)
            acc.spo2 += rec.percentage.value
            acc.touch(rec.metadata.lastModifiedTime)
        }

        guarded(warnings, "respiratory rate") {
            client.readRecords(
                RespiratoryRateRecord::class,
                TimeRangeFilter.between(startOfFirstDay, startOfDayAfterLast),
            )
        }.forEach { rec ->
            val acc = bucket(dayOf(rec.time), rec.metadata.dataOrigin.packageName)
            acc.resp += rec.respiratoryRate
            acc.touch(rec.metadata.lastModifiedTime)
        }

        guarded(warnings, "sleep") {
            client.readRecords(
                SleepSessionRecord::class,
                TimeRangeFilter.between(sleepFrom, startOfDayAfterLast),
            )
        }.forEach { rec ->
            val origin = rec.metadata.dataOrigin.packageName
            val acc = bucket(dayOf(rec.endTime), origin)

            acc.sleepStart = minOf(acc.sleepStart ?: rec.startTime, rec.startTime)
            acc.sleepEnd = maxOf(acc.sleepEnd ?: rec.endTime, rec.endTime)

            if (rec.stages.isEmpty()) {
                /* No stage data at all. The duration is still a real
                   measurement of the sleep session, but without a stage
                   breakdown the server treats the night as incomplete for
                   readiness — which is the correct reading of a night it cannot
                   score. Better than reporting a confident-looking 0 deep. */
                acc.sleepUnstaged += minutes(rec.startTime, rec.endTime)
            } else {
                for (stage in rec.stages) {
                    val mins = minutes(stage.startTime, stage.endTime)
                    when (stage.stage) {
                        SleepSessionRecord.STAGE_TYPE_DEEP -> acc.sleepDeep += mins
                        SleepSessionRecord.STAGE_TYPE_REM -> acc.sleepRem += mins
                        /* STAGE_TYPE_SLEEPING is "asleep, stage not recorded",
                           which is light sleep with better data missing. Filing
                           it as light keeps the total honest and lets deep/rem
                           mean what they say. */
                        SleepSessionRecord.STAGE_TYPE_LIGHT,
                        SleepSessionRecord.STAGE_TYPE_SLEEPING -> acc.sleepLight += mins
                        /* Awake, in bed, out of bed, unknown: part of the night,
                           but not sleep. They still widen the window above. */
                        else -> Unit
                    }
                }
            }
            acc.touch(rec.metadata.lastModifiedTime)
        }

        val daily = buckets.entries
            .filter { it.value.hasAnything }
            .map { (key, acc) ->
                val staged = acc.sleepDeep + acc.sleepRem + acc.sleepLight
                DailyRow(
                    recordId = "hc:${key.day}:${key.origin}",
                    day = key.day.toString(),
                    origin = key.origin,
                    steps = acc.steps.takeIf { it > 0 },
                    activeMin = acc.activeMin.round1().takeIf { it > 0 },
                    restingHr = acc.restingHr.mean()?.round1(),
                    hrvRmssd = acc.hrv.mean()?.round1(),
                    spo2 = acc.spo2.mean()?.round1(),
                    respiratoryRate = acc.resp.mean()?.round1(),
                    sleepTotalMin = (if (staged > 0) staged else acc.sleepUnstaged)
                        .round1()
                        .takeIf { it > 0 },
                    sleepDeepMin = acc.sleepDeep.round1().takeIf { it > 0 },
                    sleepRemMin = acc.sleepRem.round1().takeIf { it > 0 },
                    sleepLightMin = acc.sleepLight.round1().takeIf { it > 0 },
                    sleepStartUtc = acc.sleepStart?.toIso(),
                    sleepEndUtc = acc.sleepEnd?.toIso(),
                    activeKcal = acc.activeKcal.round1().takeIf { it > 0 },
                    updatedAt = acc.updatedAt,
                )
            }

        val sessions = readSessions(from, to, warnings)

        return ReadResult(Payload(daily, sessions), warnings)
    }

    /**
     * One row per ExerciseSessionRecord, keyed by Health Connect's own record id
     * so a re-read of the same workout replaces it rather than duplicating it.
     *
     * Calories and distance are read once for the whole window and then matched
     * to sessions in memory. The obvious alternative — a query per session —
     * turns a fortnight of daily training into dozens of round trips to the
     * Health Connect provider, which on some devices is a binder call each.
     */
    private suspend fun readSessions(
        from: LocalDate,
        to: LocalDate,
        warnings: MutableList<String>,
    ): List<SessionRow> {
        val windowStart = from.atStartOfDay(zone).toInstant()
        val windowEnd = to.plusDays(1).atStartOfDay(zone).toInstant()

        val sessions = guarded(warnings, "exercise sessions") {
            client.readRecords(
                ExerciseSessionRecord::class,
                TimeRangeFilter.between(windowStart, windowEnd),
            )
        }
        if (sessions.isEmpty()) return emptyList()

        val calories = guarded(warnings, "calories for sessions") {
            client.readRecords(
                ActiveCaloriesBurnedRecord::class,
                TimeRangeFilter.between(windowStart, windowEnd),
            )
        }
        val distances = guarded(warnings, "distance for sessions") {
            client.readRecords(
                DistanceRecord::class,
                TimeRangeFilter.between(windowStart, windowEnd),
            )
        }

        return sessions.map { rec ->
            val start = rec.startTime
            val end = rec.endTime

            val kcal = calories
                .filter { it.startTime >= start && it.endTime <= end }
                .sumOf { it.energy.kilocalories }
            val meters = distances
                .filter { it.startTime >= start && it.endTime <= end }
                .sumOf { it.distance.meters }

            val (avgHr, maxHr) = heartRateOver(start, end)

            /* Health Connect reports the type as an Int constant, and the
               library's constant-to-name maps are marked for internal use, so
               the session's own title is used when it has one. A watch that
               records "Morning Run" gives a readable label; otherwise the
             generic fallback is honest about not knowing rather than inventing
               a type it did not verify. */
            val activity = rec.title?.takeIf { it.isNotBlank() } ?: "workout"

            val durationMin = minutes(start, end).coerceAtLeast(1.0)

            SessionRow(
                recordId = rec.metadata.id,
                day = dayOf(start).toString(),
                origin = rec.metadata.dataOrigin.packageName,
                activity = activity,
                startedAtUtc = start.toIso(),
                durationMin = durationMin,
                /* Health Connect's active-duration metric is not exposed
                   consistently across library versions, and for a single
                   workout the wall-clock span and the active span are the same
                   number unless the session contains pauses. Using the elapsed
                   time is the boring option that is right almost always. */
                activeMin = durationMin,
                energyKcal = kcal.round1().takeIf { it > 0 },
                distanceM = meters.round1().takeIf { it > 0 },
                avgHr = avgHr?.round1(),
                maxHr = maxHr?.round1(),
                updatedAt = rec.metadata.lastModifiedTime.toEpochMilli(),
            )
        }
    }

    /**
     * Average and max heart rate over a window, computed by Health Connect
     * itself.
     *
     * Aggregating rather than reading the raw samples is the point: a two-hour
     * ride at one sample per second is seven thousand records, and the phone
     * does not need any of them individually. The platform walks them on the
     * other side of a binder and returns two numbers.
     */
    private suspend fun heartRateOver(
        start: Instant,
        end: Instant,
    ): Pair<Double?, Double?> = try {
        val result = client.aggregate(
            AggregateRequest(
                metrics = setOf(HeartRateRecord.BPM_AVG, HeartRateRecord.BPM_MAX),
                timeRangeFilter = TimeRangeFilter.between(start, end),
            ),
        )
        // AggregationResult is keyed by a star-projected metric type, so the
        // Long comes back as Any.
        val avg = (result[HeartRateRecord.BPM_AVG] as? Long)?.toDouble()
        val max = (result[HeartRateRecord.BPM_MAX] as? Long)?.toDouble()
        avg to max
    } catch (_: Exception) {
        /* No heart rate recorded for this window, or the provider declined. The
           session is still worth keeping without it. */
        null to null
    }

    private fun dayOf(instant: Instant): LocalDate =
        instant.atZone(zone).toLocalDate()

    private fun minutes(from: Instant, to: Instant): Double =
        Duration.between(from, to).toMillis() / 60_000.0

    /**
     * Runs one record read, turning a failure into a warning and an empty list.
     *
     * Health Connect throws per record type when a permission is missing, when
     * the type is unsupported on the device, or when the provider is missing
     * entirely. Any of those should cost the user one metric, not the sync.
     */
    private suspend fun <T> guarded(
        warnings: MutableList<String>,
        label: String,
        block: suspend () -> List<T>,
    ): List<T> = try {
        block()
    } catch (e: Exception) {
        warnings += "$label unavailable (${e.message ?: e::class.java.simpleName})"
        emptyList()
    }
}

private fun List<Double>.mean(): Double? =
    if (isEmpty()) null else sum() / size

/** Trim the float noise that averages accumulate, so equal readings sent on
 *  two syncs compare equal rather than fighting over which is newer. */
private fun Double.round1(): Double = Math.round(this * 10.0) / 10.0