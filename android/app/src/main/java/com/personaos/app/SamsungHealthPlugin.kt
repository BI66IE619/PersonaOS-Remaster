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
import com.samsung.android.sdk.health.data.data.entries.SleepSession
import com.samsung.android.sdk.health.data.permission.AccessType
import com.samsung.android.sdk.health.data.permission.Permission
import com.samsung.android.sdk.health.data.request.DataType
import com.samsung.android.sdk.health.data.request.DataTypes
import com.samsung.android.sdk.health.data.request.InstantTimeFilter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * Sleep from Samsung Health, via the Samsung Health Data SDK.
 *
 * Health Connect cannot see Samsung Health's sleep — Samsung does not publish it
 * there — so this reads it from Samsung Health directly. It exists for exactly one
 * data type: sleep. Steps, calories and workouts already arrive through Health
 * Connect, and Samsung exposes no HRV or resting-heart-rate type at all, so there
 * is nothing else to gain here.
 *
 * Setup on the device: Samsung Health developer mode must be enabled and the app
 * verified with Samsung, or the permission request fails before any read. See
 * developer.samsung.com/health/data.
 */
@CapacitorPlugin(name = "SamsungHealth")
class SamsungHealthPlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** Only sleep. Every extra type is another permission to justify and another
     *  way for the request to be refused. */
    private val permissions: Set<Permission> =
        setOf(Permission.of(DataTypes.SLEEP, AccessType.READ))

    private fun store(): HealthDataStore = HealthDataService.getStore(context)

    @PluginMethod
    fun checkSamsungPermissions(call: PluginCall) {
        scope.launch {
            try {
                val granted = store().getGrantedPermissions(permissions)
                val ret = JSObject()
                ret.put("complete", granted.containsAll(permissions))
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
                /* The SDK shows its own permission screen from this call and
                   resolves with the set actually granted. */
                val granted = store().requestPermissions(permissions, activity)
                val ret = JSObject()
                ret.put("complete", granted.containsAll(permissions))
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("Permission request failed: ${e.message}")
            }
        }
    }

    /** Reads sleep for a day window and returns { daily: [...] } shaped for
     *  /api/health/ingest. One row per night, attributed to the morning it ended. */
    @PluginMethod
    fun readSamsungSleep(call: PluginCall) {
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

                /* Sleep is an interval type, so it is asked for by instant range. The
                   builder is obtained from the data type itself. */
                val startInstant = startDate.atStartOfDay(zone).toInstant()
                val endInstant = endDate.plusDays(1).atStartOfDay(zone).toInstant()
                val request = DataTypes.SLEEP.readDataRequestBuilder
                    .setInstantTimeFilter(InstantTimeFilter.of(startInstant, endInstant, true, true))
                    .build()
                val response = store().readData(request)

                /* A SLEEP row is a night summary; its sessions live in the SESSIONS
                   field. Flatten them all and bucket by the morning they ended on. */
                val nights: List<HealthDataPoint> = response.dataList ?: emptyList()
                val sessions = nights.flatMap { dp ->
                    dp.getValueOrDefault(DataType.SleepType.SESSIONS, emptyList<SleepSession>())
                }

                /* Bucket each night by the local day it ended on. */
                data class Agg(
                    var totalSec: Long = 0,
                    var deep: Long = 0,
                    var rem: Long = 0,
                    var light: Long = 0,
                    var start: Instant? = null,
                    var end: Instant? = null,
                )

                val byDay = HashMap<LocalDate, Agg>()
                for (s in sessions) {
                    val wakeDay = s.endTime.atZone(zone).toLocalDate()
                    val agg = byDay.getOrPut(wakeDay) { Agg() }
                    agg.totalSec += s.duration.seconds
                    if (agg.start == null || s.startTime < agg.start!!) agg.start = s.startTime
                    if (agg.end == null || s.endTime > agg.end!!) agg.end = s.endTime
                    for (stage in s.stages ?: emptyList()) {
                        val sec = stage.endTime.epochSecond - stage.startTime.epochSecond
                        when (stage.stage) {
                            DataType.SleepType.StageType.DEEP -> agg.deep += sec
                            DataType.SleepType.StageType.REM -> agg.rem += sec
                            DataType.SleepType.StageType.LIGHT -> agg.light += sec
                            else -> {}
                        }
                    }
                }

                val daily = JSArray()
                for ((day, agg) in byDay) {
                    if (agg.totalSec <= 0) continue
                    val row = JSObject()
                    row.put("recordId", "shs-sleep-$day")
                    row.put("day", day.toString())
                    row.put("origin", "com.samsung.shealth")
                    row.put("updatedAt", Instant.now().toString())
                    row.put("sleepTotalMin", agg.totalSec / 60)
                    if (agg.deep > 0) row.put("sleepDeepMin", agg.deep / 60)
                    if (agg.rem > 0) row.put("sleepRemMin", agg.rem / 60)
                    if (agg.light > 0) row.put("sleepLightMin", agg.light / 60)
                    agg.start?.let { row.put("sleepStartUtc", it.toString()) }
                    agg.end?.let { row.put("sleepEndUtc", it.toString()) }
                    daily.put(row)
                }

                val ret = JSObject()
                ret.put("daily", daily)
                ret.put("sessions", JSArray())
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("Sleep read failed: ${e.message}")
            }
        }
    }
}
