package com.lifeos.healthbridge

import android.content.Intent
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.RespiratoryRateRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

/**
 * The whole interface: three buttons and a log.
 *
 * Built in code rather than from a layout file, and deliberately not Compose.
 * This app is a settings box that pushes a JSON blob — it has no state to
 * recompose and nothing that benefits from a declarative UI. Layout XML would be
 * one more file to keep in sync; Compose would be a compiler plugin, a runtime
 * and a large dependency tree for a screen that never changes shape.
 */
class MainActivity : ComponentActivity() {

    private val permissions = setOf(
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(HeartRateRecord::class),
        HealthPermission.getReadPermission(RestingHeartRateRecord::class),
        HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class),
        HealthPermission.getReadPermission(OxygenSaturationRecord::class),
        HealthPermission.getReadPermission(RespiratoryRateRecord::class),
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
        HealthPermission.getReadPermission(DistanceRecord::class),
    )

    private lateinit var settings: Settings
    private var client: HealthConnectClient? = null

    private lateinit var statusView: TextView
    private lateinit var logView: TextView
    private lateinit var serverField: EditText
    private lateinit var tokenField: EditText
    private lateinit var lookbackField: EditText
    private lateinit var syncButton: Button

    private val permissionLauncher = registerForActivityResult(
        PermissionController.createRequestPermissionResultContract(),
    ) { granted ->
        appendLog("Granted ${granted.size} of ${permissions.size} permissions.")
        refreshStatus()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        settings = Settings(this)

        when (HealthConnectClient.getSdkStatus(this)) {
            HealthConnectClient.SDK_AVAILABLE ->
                client = HealthConnectClient.getOrCreate(this)

            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> {
                /* The Health Connect provider is installed but too old for this
                   library. There is nothing this app can do but say so. */
            }
            else -> Unit
        }

        setContentView(buildUi())
        loadSettings()
        refreshStatus()
    }

    override fun onResume() {
        super.onResume()
        if (::statusView.isInitialized) refreshStatus()
    }

    // ---- UI -------------------------------------------------------------

    private fun buildUi(): View {
        val pad = (16 * resources.displayMetrics.density).toInt()

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }

        statusView = TextView(this).apply {
            textSize = 15f
            setPadding(0, 0, 0, pad)
        }
        column.addView(statusView)

        column.addView(
            Button(this).apply {
                text = getString(R.string.grant_permissions)
                setOnClickListener { requestPermissions() }
            },
        )

        column.addView(
            Button(this).apply {
                text = getString(R.string.open_hc_settings)
                setOnClickListener { openHealthConnectSettings() }
            },
        )

        column.addView(View(this).apply { minimumHeight = pad })

        column.addView(label("LifeOS server URL"))
        serverField = EditText(this).apply {
            hint = "https://your-app.vercel.app"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setSingleLine()
        }
        column.addView(serverField)

        column.addView(label("Supabase access token"))
        tokenField = EditText(this).apply {
            hint = "Paste the access_token from the Supabase session"
            /* Hidden because it is a credential, and because a token pasted in
               an office should not end up in a screenshot. */
            inputType =
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            setSingleLine()
        }
        column.addView(tokenField)

        column.addView(label("Days to read"))
        lookbackField = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER
            setSingleLine()
        }
        column.addView(lookbackField)

        syncButton = Button(this).apply {
            text = getString(R.string.sync_now)
            setOnClickListener { startSync() }
        }
        column.addView(syncButton)

        column.addView(View(this).apply { minimumHeight = pad })

        logView = TextView(this).apply {
            textSize = 12f
            gravity = Gravity.START
            setPadding(0, pad, 0, 0)
        }
        column.addView(logView)

        return ScrollView(this).apply { addView(column) }
    }

    private fun label(text: String): TextView = TextView(this).apply {
        this.text = text
        textSize = 13f
        setPadding(0, pad(), 0, 0)
    }

    private fun pad(): Int = (8 * resources.displayMetrics.density).toInt()

    // ---- Settings -------------------------------------------------------

    private fun loadSettings() {
        serverField.setText(settings.serverUrl)
        tokenField.setText(settings.accessToken)
        lookbackField.setText(settings.lookbackDays.toString())
    }

    private fun saveSettings() {
        settings.serverUrl = serverField.text.toString()
        settings.accessToken = tokenField.text.toString()
        settings.lookbackDays = lookbackField.text.toString().toIntOrNull() ?: 14
    }

    // ---- Health Connect -------------------------------------------------

    private fun requestPermissions() {
        val hc = client
        if (hc == null) {
            appendLog("Health Connect is not available on this device.")
            return
        }
        permissionLauncher.launch(permissions)
    }

    /** Opens Health Connect's settings page, which is where a user goes when the
     *  system dialog will not appear again because they picked "don't ask
     *  again" — a state the contract callback reports as simply "not granted". */
    private fun openHealthConnectSettings() {
        val intent = Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { startActivity(intent) }.onFailure {
            appendLog("Could not open Health Connect settings.")
        }
    }

    private fun refreshStatus() {
        val hc = client ?: run {
            statusView.text = when (HealthConnectClient.getSdkStatus(this)) {
                HealthConnectClient.SDK_UNAVAILABLE ->
                    "Health Connect is not installed. Install Samsung Health " +
                        "or Google Health Services and reopen this app."

                HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED ->
                    "Health Connect is installed but needs updating. Update it " +
                        "from the Play Store, then reopen this app."

                else -> "Health Connect is not available."
            }
            syncButton.isEnabled = false
            return
        }

        lifecycleScope.launch {
            val granted = hc.permissionController.getGrantedPermissions()
            val missing = permissions - granted

            statusView.text = if (missing.isEmpty()) {
                "Health Connect ready — all ${permissions.size} permissions granted."
            } else {
                "Health Connect ready. ${missing.size} permission(s) not yet " +
                    "granted; data will be partial until they are."
            }
            /* Syncable with partial permissions. A user who granted sleep but
               not blood oxygen still gets the readiness inputs they did allow,
               and the server marks the rest null. Refusing to sync at all would
               mean the app is useless until every single permission is granted,
               which is a good way to never get used. */
            syncButton.isEnabled = granted.isNotEmpty()
        }
    }

    // ---- Sync ------------------------------------------------------------

    private fun startSync() {
        saveSettings()

        if (!settings.isConfigured) {
            appendLog("Set the server URL and access token first.")
            return
        }
        val hc = client ?: run {
            appendLog("Health Connect is not available on this device.")
            return
        }

        syncButton.isEnabled = false
        appendLog("Reading Health Connect…")

        lifecycleScope.launch {
            try {
                val result = HealthReader(hc).read(settings.lookbackDays)

                for (warning in result.warnings) {
                    appendLog("warning: $warning")
                }

                if (result.payload.isEmpty) {
                    appendLog("Nothing in Health Connect for the last " +
                        "${settings.lookbackDays} days. Is Samsung Health " +
                        "syncing to Health Connect?")
                    return@launch
                }

                appendLog("Sending ${result.payload.summary()}…")

                val response = SyncClient.post(
                    settings.ingestUrl(),
                    settings.accessToken,
                    result.payload,
                )

                if (response.status in 200..299) {
                    appendLog("Synced. Server said: ${response.body}")
                } else if (response.status == 401) {
                    appendLog("401 — access token rejected. It expires about an " +
                        "hour; paste a fresh one from Supabase.")
                } else {
                    appendLog("Sync failed (${response.status}): ${response.body}")
                }
            } catch (e: Exception) {
                appendLog("Sync error: ${e.message ?: e::class.java.simpleName}")
            } finally {
                refreshStatus()
            }
        }
    }

    private fun appendLog(line: String) {
        if (!::logView.isInitialized) return
        logView.text = buildString {
            append(line)
            append('\n')
            append(logView.text)
        }
    }
}