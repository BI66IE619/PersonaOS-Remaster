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
 * Six hours rather than the fifteen-minute minimum: the inputs are a night's sleep
 * and a day's steps, neither of which changes meaningfully faster, and a tighter
 * interval is battery and quota spent for nothing. `UPDATE` rather than `KEEP` so a
 * changed interval or constraints takes effect on the next app open.
 */
object HealthSyncScheduler {
    private const val WORK_NAME = "personaos-health-sync"

    private val connected = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()

    fun schedule(context: Context) {
        val request = PeriodicWorkRequestBuilder<HealthSyncWorker>(6, TimeUnit.HOURS)
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
