package com.personaos.app

import android.app.Activity
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.samsung.android.sdk.health.data.HealthDataService
import com.samsung.android.sdk.health.data.HealthDataStore
import com.samsung.android.sdk.health.data.permission.AccessType
import com.samsung.android.sdk.health.data.permission.Permission
import com.samsung.android.sdk.health.data.request.DataTypes
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Samsung Health, as a Capacitor plugin. The reading lives in HealthReaders, shared
 * with the background worker; this is the bridge and the permission flow.
 *
 * The device must have Samsung Health's "Developer Mode for Data Read" on until the
 * app is registered with Samsung, or every call fails with an authorization error.
 */
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
                call.resolve(HealthReaders.samsungHealth(context, from, to))
            } catch (e: Exception) {
                call.reject("Samsung read failed: ${e.message}")
            }
        }
    }
}
