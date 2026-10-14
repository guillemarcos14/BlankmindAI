package com.blanknfc.app

import android.content.Intent
import android.nfc.NfcAdapter
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.lifecycleScope
import androidx.navigation.compose.rememberNavController
import com.blanknfc.app.data.SessionManager
import com.blanknfc.app.data.FocusSchedule
import com.blanknfc.app.service.BlankSchedule
import com.blanknfc.app.ui.navigation.NavGraph
import com.blanknfc.app.ui.navigation.Routes
import com.blanknfc.app.ui.theme.BlankTheme
import com.blanknfc.app.util.NfcHelper
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

class MainActivity : ComponentActivity() {

    private val sessionManager: SessionManager
        get() = BlankApp.get(this).container.sessionManager
    private val purchaseStore
        get() = BlankApp.get(this).container.purchaseStore
    private val healthConnectStore
        get() = BlankApp.get(this).container.healthConnectStore
    private val onboardingSyncStore
        get() = BlankApp.get(this).container.onboardingSyncStore
    private val referralStore
        get() = BlankApp.get(this).container.referralStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Handle NFC intent that launched the activity
        if (intent != null) {
            handleDeepLinkIntent(intent)
            handleNfcIntent(intent)
        }

        setContent {
            BlankTheme {
                val setupComplete by sessionManager.setupComplete.collectAsState()
                val navController = rememberNavController()

                val startDestination = if (setupComplete) Routes.HOME else Routes.SETUP

                NavGraph(
                    navController = navController,
                    sessionManager = sessionManager,
                    purchaseStore = purchaseStore,
                    healthConnectStore = healthConnectStore,
                    onboardingSyncStore = onboardingSyncStore,
                    referralStore = referralStore,
                    startDestination = startDestination
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        NfcHelper.enableForegroundDispatch(this)
        NfcHelper.enableReaderMode(this) { uid ->
            runOnUiThread {
                processNfcUid(uid)
            }
        }
    }

    override fun onPause() {
        super.onPause()
        NfcHelper.disableReaderMode(this)
        NfcHelper.disableForegroundDispatch(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleDeepLinkIntent(intent)
        handleNfcIntent(intent)
    }

    private fun handleDeepLinkIntent(intent: Intent) {
        if (intent.action != Intent.ACTION_VIEW) return
        val uri = intent.data ?: return
        val action = if (uri.scheme == "blank") {
            uri.host.orEmpty()
        } else if (uri.scheme == "https" && uri.path?.startsWith("/open") == true) {
            uri.getQueryParameter("action").orEmpty()
        } else {
            return
        }

        if (action == "handoff") {
            val token = uri.getQueryParameter("token").orEmpty()
            lifecycleScope.launch { claimAppHandoff(token) }
            return
        }

        if (action == "apply-plan" || action == "setup-plan") {
            val start = uri.getQueryParameter("start")?.toIntOrNull()
            val end = uri.getQueryParameter("end")?.toIntOrNull()
            if (start == null || end == null || start !in 0..1439 || end !in 0..1439) return
            lifecycleScope.launch {
                sessionManager.stateLoaded.filter { it }.first()
                val durationDays = (uri.getQueryParameter("days")?.toLongOrNull() ?: 7L).coerceIn(1L, 14L)
                val schedule = FocusSchedule(
                    enabled = true,
                    startMinute = start,
                    endMinute = end,
                    expiresAtMillis = System.currentTimeMillis() + durationDays * 24L * 60L * 60L * 1000L
                )
                sessionManager.updateSchedule(schedule)
                BlankSchedule.schedule(this@MainActivity, schedule)
                sessionManager.applyScheduleWindow()
                Toast.makeText(this@MainActivity, "Protection schedule applied", Toast.LENGTH_SHORT).show()
            }
            return
        }

        if (action != "protection" && action != "mode") return
        val activate = uri.getQueryParameter("activate").equals("true", ignoreCase = true)
        lifecycleScope.launch {
            sessionManager.stateLoaded.filter { it }.first()
            if (sessionManager.blockedPackages.value.isEmpty()) {
                Toast.makeText(this@MainActivity, "Choose your distractions first", Toast.LENGTH_SHORT).show()
                return@launch
            }
            if (activate) {
                val result = sessionManager.activateBlank()
                val messageRes = when (result) {
                    SessionManager.NfcResult.BLANKED -> R.string.session_activated
                    SessionManager.NfcResult.NO_APPS_SELECTED -> R.string.nfc_no_apps_selected
                    else -> R.string.session_activated
                }
                Toast.makeText(this@MainActivity, messageRes, Toast.LENGTH_SHORT).show()
            }
        }
    }

    private suspend fun claimAppHandoff(token: String) {
        if (token.isBlank()) return
        val result = runCatching {
            withContext(kotlinx.coroutines.Dispatchers.IO) {
                val preferences = getSharedPreferences("blank_identity", MODE_PRIVATE)
                val installId = preferences.getString("app_install_id", null) ?: UUID.randomUUID().toString().also {
                    preferences.edit().putString("app_install_id", it).apply()
                }
                val connection = (URL(BuildConfig.BLANK_API_BASE_URL.trimEnd('/') + "/app-handoff").openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    connectTimeout = 8_000
                    readTimeout = 8_000
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                }
                connection.outputStream.use { output ->
                    output.write(JSONObject().apply {
                        put("action", "claim")
                        put("handoff_token", token)
                        put("app_install_id", installId)
                        put("data_consent", true)
                    }.toString().toByteArray())
                }
                val status = connection.responseCode
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                val body = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
                connection.disconnect()
                if (status !in 200..299) error("handoff_failed_$status")
                JSONObject(body)
            }
        }.getOrNull() ?: return

        val preferences = getSharedPreferences("blank_identity", MODE_PRIVATE)
        preferences.edit()
            .putString("assistant_connect_code", result.optString("assistant_connect_code"))
            .putString("phone_e164", result.optString("phone_e164"))
            .apply()
        Toast.makeText(this, "Blankmind connected", Toast.LENGTH_SHORT).show()
    }

    private fun handleNfcIntent(intent: Intent) {
        if (intent.action != NfcAdapter.ACTION_TAG_DISCOVERED &&
            intent.action != NfcAdapter.ACTION_NDEF_DISCOVERED &&
            intent.action != NfcAdapter.ACTION_TECH_DISCOVERED
        ) return

        val uid = NfcHelper.extractUidFromIntent(intent) ?: return
        processNfcUid(uid)
    }

    private fun processNfcUid(uid: String) {
        if (sessionManager.isRelinkingNfc.value) {
            sessionManager.completeNfcRelink(uid)
            Toast.makeText(this, R.string.relink_done_title, Toast.LENGTH_SHORT).show()
            return
        }

        val result = sessionManager.handleNfcTag(uid)
        val messageRes = when (result) {
            SessionManager.NfcResult.TAG_REGISTERED -> R.string.nfc_tag_registered
            SessionManager.NfcResult.BLANKED -> R.string.session_activated
            SessionManager.NfcResult.UNBLANKED -> R.string.session_deactivated
            SessionManager.NfcResult.WRONG_TAG -> R.string.nfc_wrong_tag
            SessionManager.NfcResult.NO_APPS_SELECTED -> R.string.nfc_no_apps_selected
            SessionManager.NfcResult.NOT_ACTIVE -> R.string.nfc_not_active
        }
        Toast.makeText(this, messageRes, Toast.LENGTH_SHORT).show()
    }
}
