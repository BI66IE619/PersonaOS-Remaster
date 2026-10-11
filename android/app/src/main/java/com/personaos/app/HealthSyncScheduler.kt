package com.personaos.app

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * Schedules the periodic health sync.
 *
 * Fifteen minutes, which is WorkManager's floor for periodic work — as close to
 * "constantly" as Android allows without a foreground service and the permanent
 * notification that comes with it. The cost is real: the phone wakes, reads both
 * health sources and posts on every window, so this trades battery for freshness on
 * purpose. It is still best-effort — Doze and the CONNECTED constraint defer a run,
 * and nothing syncs while the phone is idle or offline. `UPDATE` rather than `KEEP`
 * so a changed interval or constraints takes effect on the next app open.
 */
object HealthSyncScheduler {
    private const val WORK_NAME = "personaos-health-sync"

    private val connected = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

    fun schedule(context: Context) {
        val request = PeriodicWorkRequestBuilder<HealthSyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(connected)
            .build()
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    /**
     * One run shortly after the app is opened.
     *
     * The periodic job's first execution is a full interval away, which makes the
     * background sync impossible to confirm on the same day. This fires once, a
     * minute after the app is opened, so a sync has actually happened by the time
     * the phone is put down. `KEEP` so opening the app repeatedly does not queue a
     * pile of them.
     */
    fun kickOnce(context: Context) {
        val request = OneTimeWorkRequestBuilder<HealthSyncWorker>()
            .setConstraints(connected)
            .setInitialDelay(1, TimeUnit.MINUTES)
            .build()
        WorkManager.getInstance(context)
            .enqueueUniqueWork("$WORK_NAME-once", ExistingWorkPolicy.KEEP, request)
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
    }
}
