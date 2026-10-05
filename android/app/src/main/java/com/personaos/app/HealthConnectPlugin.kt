package com.personaos.app

import android.app.Activity
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
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

/**
 * Health Connect, as a Capacitor plugin. The reading itself lives in HealthReaders,
 * shared with the background worker; this is just the bridge and the permission flow.
 */
@CapacitorPlugin(name = "HealthConnect")
class HealthConnectPlugin : Plugin() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val permissions: Set<String> = setOf(
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.getReadPermission(HeartRateRecord::class),
        HealthPermission.getReadPermission(RestingHeartRateRecord::class),
        HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
        HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class),
        HealthPermission.getReadPermission(DistanceRecord::class),
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
    )

    private fun client(): HealthConnectClient = HealthConnectClient.getOrCreate(context)

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
                call.resolve(HealthReaders.healthConnect(context, from, to))
            } catch (e: Exception) {
                call.reject("Read failed: ${e.message}")
            }
        }
    }
}
