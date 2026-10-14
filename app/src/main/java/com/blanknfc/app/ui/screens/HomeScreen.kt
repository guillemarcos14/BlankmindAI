package com.blanknfc.app.ui.screens

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.animation.togetherWith
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.blanknfc.app.BlankApp
import com.blanknfc.app.R
import com.blanknfc.app.analytics.BlankEvent
import com.blanknfc.app.analytics.BlankEvents
import com.blanknfc.app.data.FocusActivityDay
import com.blanknfc.app.data.FocusSchedule
import com.blanknfc.app.data.FocusStats
import com.blanknfc.app.data.HealthConnectStore
import com.blanknfc.app.data.PlayPurchaseStore
import com.blanknfc.app.data.ReferralStore
import com.blanknfc.app.data.SessionManager
import com.blanknfc.app.service.BlankSchedule
import com.blanknfc.app.ui.theme.BlankGray
import com.blanknfc.app.ui.theme.BlankOnSurface
import com.blanknfc.app.ui.theme.BlankSurface
import com.blanknfc.app.util.AccessibilityHelper
import com.blanknfc.app.util.AppInfo
import com.blanknfc.app.util.BatteryHelper
import com.blanknfc.app.util.PackageHelper
import java.util.Calendar
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

private enum class HomePanel {
    HOME,
    SETTINGS,
    DISTRACTIONS,
    STATS,
    SCHEDULE,
    RELINK,
    FORGET,
    BLOCK,
    EMERGENCY
}

private data class ConfigIssue(
    val title: String,
    val body: String,
    val action: String?,
    val onAction: () -> Unit = {}
)

private const val HomeTagline = "Your plan adapts\nbefore the scroll\npulls you back."
private val HomeGlassScrim = Color.Black.copy(alpha = 0.18f)

private fun homeCapsuleBorder(): BorderStroke = BorderStroke(
    width = 1.dp,
    brush = Brush.linearGradient(
        colors = listOf(
            Color.White.copy(alpha = 0.42f),
            Color.White.copy(alpha = 0.16f),
            Color.White.copy(alpha = 0.04f),
            Color.White.copy(alpha = 0.00f)
        ),
        start = Offset(0f, 0f),
        end = Offset(180f, 180f)
    )
)

private fun homeCapsuleReflection(center: Offset, radius: Float): Brush = Brush.radialGradient(
    colors = listOf(
        Color.White.copy(alpha = 0.16f),
        Color.White.copy(alpha = 0.04f),
        Color.White.copy(alpha = 0.00f)
    ),
    center = center,
    radius = radius
)

@Composable
fun HomeScreen(
    sessionManager: SessionManager,
    purchaseStore: PlayPurchaseStore,
    healthConnectStore: HealthConnectStore,
    referralStore: ReferralStore,
    onRelinkTag: () -> Unit,
    onForgetTag: () -> Unit
) {
    val context = LocalContext.current
    val appContainer = remember(context) { BlankApp.get(context).container }
    val analyticsTracker = appContainer.analyticsTracker
    val backendClient = appContainer.backendClient
    val lifecycleOwner = LocalLifecycleOwner.current
    val isBlankActive by sessionManager.isBlankActive.collectAsState()
    val blockedPackages by sessionManager.blockedPackages.collectAsState()
    val stats by sessionManager.stats.collectAsState()
    val emergencyUnlocksRemaining by sessionManager.emergencyUnlocksRemaining.collectAsState()
    val schedule by sessionManager.schedule.collectAsState()
    val purchaseState by purchaseStore.state.collectAsState()
    val healthSummary by healthConnectStore.summary.collectAsState()
    val referralState by referralStore.state.collectAsState()
    val hasPremiumAccess = purchaseState.hasPremiumAccess || referralStore.hasReferralProAccess || referralState.rewardUnlocked
    val buttonLight = !isBlankActive
    val apps = remember { PackageHelper.getInstalledApps(context) }
    var panel by remember { mutableStateOf(HomePanel.HOME) }
    var showDistractionPicker by remember { mutableStateOf(false) }
    var accessibilityEnabled by remember { mutableStateOf(AccessibilityHelper.isServiceEnabled(context)) }
    var batteryOptimizedIgnored by remember { mutableStateOf(BatteryHelper.isIgnoringBatteryOptimizations(context)) }

    fun refreshSystemConfig() {
        accessibilityEnabled = AccessibilityHelper.isServiceEnabled(context)
        batteryOptimizedIgnored = BatteryHelper.isIgnoringBatteryOptimizations(context)
    }

    DisposableEffect(lifecycleOwner, context) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                refreshSystemConfig()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }



    LaunchedEffect(healthSummary) {
        val status = healthSourceStatus(healthSummary)
        if (status == "Connected" || status == "Partial" || status == "Stale") {
            val baseProperties = mapOf(
                "source" to "health_connect",
                "status" to status.lowercase(),
                "health_days" to healthSummary.daysWithAnySignal.toString(),
                "signal_coverage_percent" to (
                    healthSummary.daysWithAnySignal * 100 / healthSummary.daysRequested.coerceAtLeast(1)
                    ).toString(),
                "raw_health_samples_sent" to "false"
            )
            analyticsTracker.track(
                BlankEvent(
                    if (status == "Stale") BlankEvents.STALE_HEALTH_DATA else BlankEvents.HEALTH_DATA_AVAILABLE,
                    baseProperties
                )
            )
            analyticsTracker.track(
                BlankEvent(
                    if (status == "Stale") BlankEvents.WEARABLE_DATA_STALE else BlankEvents.WEARABLE_DATA_AVAILABLE,
                    baseProperties + ("provider" to "health_connect")
                )
            )
        }
    }

    val configIssues = buildList {
        if (!accessibilityEnabled) {
            add(
                ConfigIssue(
                    title = "Accessibility pending",
                    body = "Enable Blankmind in Accessibility so Android can detect protected apps.",
                    action = "Open Accessibility",
                    onAction = { AccessibilityHelper.openAccessibilitySettings(context) }
                )
            )
        }
        if (!batteryOptimizedIgnored) {
            add(
                ConfigIssue(
                    title = "Battery restricted",
                    body = "Allow Blankmind to keep running in the background so blocks stay stable.",
                    action = "Open Battery",
                    onAction = { BatteryHelper.openBatteryOptimizationSettings(context) }
                )
            )
        }
    }

    AppBackground(
        isBlankActive = isBlankActive,
        isDark = panel == HomePanel.BLOCK || panel == HomePanel.EMERGENCY
    ) {
        AnimatedContent(
            targetState = panel,
            transitionSpec = {
                fadeIn(animationSpec = tween(260)) togetherWith fadeOut(animationSpec = tween(180))
            },
            label = "blank_panel_transition"
        ) { currentPanel ->
        when (currentPanel) {
            HomePanel.HOME -> HomePanelContent(
                isBlankActive = isBlankActive,
                configIssues = configIssues,
                hasPremiumAccess = hasPremiumAccess,
                onSettings = { panel = HomePanel.SETTINGS },
                onStats = { panel = HomePanel.STATS },
                onDistractions = { panel = HomePanel.DISTRACTIONS },
                onTimer = { panel = HomePanel.SCHEDULE },

                onMainAction = {
                    if (blockedPackages.isEmpty()) {
                        showDistractionPicker = true
                    } else if (!AccessibilityHelper.isServiceEnabled(context)) {
                        AccessibilityHelper.openAccessibilitySettings(context)
                    } else {
                        sessionManager.activateBlank()

                    }
                }
            )

            HomePanel.SETTINGS -> SettingsPanel(
                buttonLight = buttonLight,
                onBack = { panel = HomePanel.HOME },
                onDistractions = { panel = HomePanel.DISTRACTIONS },
                onSchedule = {
                    panel = HomePanel.SCHEDULE
                },
                onStats = {
                    panel = HomePanel.STATS
                },
                onEmergency = {
                    panel = HomePanel.EMERGENCY
                }
            )

            HomePanel.DISTRACTIONS -> DistractionsPanel(
                selectedCount = blockedPackages.size,
                buttonLight = buttonLight,
                onBack = { panel = HomePanel.HOME },
                onEdit = { showDistractionPicker = true }
            )

            HomePanel.RELINK -> CenterActionPanel(
                topTitle = "NFC",
                label = "Nueva etiqueta",
                title = "Vincula una nueva pieza.",
                body = "Blankmind will keep your protected apps and replace only the optional unlock key.",
                action = "Open pairing",
                buttonLight = buttonLight,
                onBack = { panel = HomePanel.SETTINGS },
                onAction = onRelinkTag
            )

            HomePanel.FORGET -> ForgetConfirmPanel(
                buttonLight = buttonLight,
                onBack = { panel = HomePanel.SETTINGS },
                onConfirm = onForgetTag
            )

            HomePanel.STATS -> StatsPanel(
                healthConnectStore = healthConnectStore,
                buttonLight = buttonLight,
                onBack = { panel = HomePanel.HOME }
            )

            HomePanel.SCHEDULE -> SchedulePanel(
                schedule = schedule,
                buttonLight = buttonLight,
                onBack = { panel = HomePanel.SETTINGS },
                onSave = { updatedSchedule ->
                    sessionManager.updateSchedule(updatedSchedule)
                    BlankSchedule.schedule(context, updatedSchedule)
                    sessionManager.applyScheduleWindow()
                    panel = HomePanel.SETTINGS
                }
            )

            HomePanel.BLOCK -> BlockPanel(
                onEmergency = { panel = HomePanel.EMERGENCY }
            )

            HomePanel.EMERGENCY -> EmergencyPanel(
                emergencyUnlocksRemaining = emergencyUnlocksRemaining,
                onBack = {
                    panel = if (isBlankActive) HomePanel.BLOCK else HomePanel.SETTINGS
                },
                onUnlock = {
                    if (sessionManager.deactivateForEmergency()) {
                        panel = HomePanel.HOME
                    }
                }
            )
        }
        }
    }

    if (showDistractionPicker) {
        DistractionPickerDialog(
            selectedPackages = blockedPackages,
            apps = apps,
            buttonLight = buttonLight,
            onDismiss = { showDistractionPicker = false },
            onSave = { packages ->
                sessionManager.setBlockedPackages(packages)
                showDistractionPicker = false
            }
        )
    }
}

@Composable
private fun AppBackground(
    isBlankActive: Boolean,
    isDark: Boolean,
    content: @Composable () -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(if (isDark) Color.Black else Color(0xFFE7E7E2))
    ) {
        if (!isDark) {
            Crossfade(
                targetState = if (isBlankActive) R.drawable.blank_home_background_active else R.drawable.blank_home_background_idle,
                animationSpec = tween(durationMillis = 520),
                label = "blank_background_image"
            ) { backgroundImageResId ->
                Image(
                    painter = painterResource(backgroundImageResId),
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .fillMaxSize()
                )
            }
        }
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp, vertical = 42.dp)
        ) {
            content()
        }
    }
}

@Composable
private fun HomePanelContent(
    isBlankActive: Boolean,
    configIssues: List<ConfigIssue>,
    hasPremiumAccess: Boolean,
    onSettings: () -> Unit,
    onStats: () -> Unit,
    onDistractions: () -> Unit,
    onTimer: () -> Unit,
    onMainAction: () -> Unit
) {
    Box(modifier = Modifier.fillMaxSize()) {
        HomeTopNav(
            onSettings = onSettings,
            onStats = onStats,
            onDistractions = onDistractions,
            onTimer = onTimer,
            modifier = Modifier.align(Alignment.TopCenter)
        )
        if (configIssues.isNotEmpty()) {
            ConfigIssuesCard(
                issues = configIssues,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 62.dp)
            )
        }
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                Text(
                    text = HomeTagline,
                    style = MaterialTheme.typography.titleLarge.copy(
                        fontWeight = FontWeight.Bold,
                        fontSize = 34.sp,
                        lineHeight = 39.sp,
                        letterSpacing = (-1.9).sp
                    ),
                    color = Color.White,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(24.dp))
                HomeBlankearButton(
                    text = if (isBlankActive) "Blankmind active" else "Start Blankmind",
                    enabled = !isBlankActive,
                    modifier = Modifier.widthIn(max = if (isBlankActive) 342.dp else 178.dp),
                    onClick = onMainAction
                )
            }
        }
    }
}



@Composable
private fun HomeTopNav(
    onSettings: () -> Unit,
    onStats: () -> Unit,
    onDistractions: () -> Unit,
    onTimer: () -> Unit,
    modifier: Modifier = Modifier
) {
    val logoReflection = homeCapsuleReflection(center = Offset(12f, 8f), radius = 52f)
    val capsuleReflection = homeCapsuleReflection(center = Offset(34f, 8f), radius = 132f)
    val topNavBorder = homeCapsuleBorder()

    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Surface(
            modifier = Modifier.shadow(
                elevation = 5.dp,
                shape = RoundedCornerShape(50.dp),
                clip = false,
                ambientColor = Color.Black.copy(alpha = 0.05f),
                spotColor = Color.Black.copy(alpha = 0.04f)
            ),
            color = HomeGlassScrim,
            shape = RoundedCornerShape(50.dp),
            border = topNavBorder,
            onClick = onSettings
        ) {
            Box(
                modifier = Modifier
                    .size(47.dp)
                    .background(logoReflection, RoundedCornerShape(50.dp)),
                contentAlignment = Alignment.Center
            ) {
                Image(
                    painter = painterResource(R.drawable.blank_logo_white),
                    contentDescription = "Settings",
                    modifier = Modifier.size(31.dp)
                )
            }
        }
        Spacer(modifier = Modifier.size(8.dp))
        Surface(
            modifier = Modifier.shadow(
                elevation = 5.dp,
                shape = RoundedCornerShape(50.dp),
                clip = false,
                ambientColor = Color.Black.copy(alpha = 0.05f),
                spotColor = Color.Black.copy(alpha = 0.04f)
            ),
            color = HomeGlassScrim,
            shape = RoundedCornerShape(50.dp),
            border = topNavBorder
        ) {
            Row(
                modifier = Modifier
                    .height(47.dp)
                    .background(capsuleReflection, RoundedCornerShape(50.dp))
                    .padding(horizontal = 22.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                HomeTopNavButton("Stats", onStats)
                HomeTopNavButton("Distractions", onDistractions)
                HomeTopNavButton("Timer", onTimer)
            }
        }
    }
}

@Composable
private fun HomeTopNavButton(label: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .height(47.dp)
            .widthIn(min = 64.dp)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
            color = Color.White,
            textAlign = TextAlign.Center
        )
    }
}

@Composable
private fun ConfigIssuesCard(issues: List<ConfigIssue>, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = Color.White.copy(alpha = 0.78f),
        shape = RoundedCornerShape(22.dp)
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text(
                text = "Review setup",
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Medium),
                color = BlankOnSurface
            )
            issues.forEach { issue ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(text = issue.title, style = MaterialTheme.typography.bodyLarge, color = BlankOnSurface)
                        Text(
                            text = issue.body,
                            style = MaterialTheme.typography.bodySmall,
                            color = BlankOnSurface.copy(alpha = 0.64f)
                        )
                    }
                    if (issue.action != null) {
                        TextButton(onClick = issue.onAction) {
                            Text(text = issue.action, color = BlankOnSurface)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SettingsPanel(
    buttonLight: Boolean,
    onBack: () -> Unit,
    onDistractions: () -> Unit,
    onSchedule: () -> Unit,
    onStats: () -> Unit,
    onEmergency: () -> Unit
) {
    Column(modifier = Modifier.fillMaxSize()) {
        ScreenHeader(title = "Settings", onBack = onBack)
        Spacer(modifier = Modifier.height(58.dp))
        Text(text = "Settings", style = MaterialTheme.typography.headlineLarge, color = BlankOnSurface)
        Spacer(modifier = Modifier.height(28.dp))
        val items = buildList {
            add(MenuItem("Distractions", "Edit", onDistractions))
            add(MenuItem("Timer", "Daily", onSchedule))
            add(MenuItem("Stats", "Time", onStats))
            add(MenuItem("Emergency", "Exit", onEmergency, destructive = true))
        }
        MenuList(
            buttonLight = buttonLight,
            items = items
        )
    }
}

private data class MenuItem(
    val label: String,
    val meta: String,
    val action: () -> Unit,
    val destructive: Boolean = false
)

@Composable
private fun MenuList(buttonLight: Boolean, items: List<MenuItem>) {
    val buttonBackground = if (buttonLight) Color.White else Color.Black
    val buttonContent = if (buttonLight) Color.Black else Color.White
    val metaColor = buttonContent.copy(alpha = 0.72f)
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        items.forEach { item ->
            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = buttonBackground,
                shape = RoundedCornerShape(22.dp),
                onClick = item.action
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 18.dp, vertical = 16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    val labelColor = if (item.destructive) Color(0xFFB3261E) else buttonContent
                    Text(text = item.label, color = labelColor, modifier = Modifier.weight(1f))
                    Text(text = item.meta, color = metaColor, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}

@Composable
private fun StatsPanel(
    healthConnectStore: HealthConnectStore,
    buttonLight: Boolean,
    onBack: () -> Unit
) {
    val sleep by healthConnectStore.summary.collectAsState()
    val ink = progressTextColor(buttonLight)
    LazyColumn(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item { ScreenHeader(title = "Rest", onBack = onBack) }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(20.dp)) {
                Text("Your sleep", color = ink, style = MaterialTheme.typography.titleMedium)
                SummaryLine("Sleep per night", sleep.avgSleepMinutes7d?.let { "${it / 60} h ${it % 60} min" } ?: "No measured sleep", "${sleep.sleepSessions7d ?: 0} recorded sessions in 7 days", ink)
                sleep.avgSleepEfficiency7d?.let { SummaryLine("Sleep continuity", "$it%", "Recorded sleep efficiency", ink) }
                Text("Missing data is unknown. Blocking records alone do not demonstrate improved rest.", color = ink, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}




@Composable
private fun RowScope.QuickSignalButton(label: String, textColor: Color, onClick: () -> Unit) {
    Surface(
        modifier = Modifier.weight(1f),
        color = textColor.copy(alpha = 0.08f),
        shape = RoundedCornerShape(999.dp),
        onClick = onClick
    ) {
        Text(
            text = label,
            color = textColor.copy(alpha = 0.78f),
            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 9.dp)
        )
    }
}














private fun healthSourceStatus(summary: com.blanknfc.app.data.HealthConnectSummary): String {
    return when {
        !summary.available -> "Unavailable"
        summary.partialPermission -> "Partial"
        !summary.permissionGranted -> "Not connected"
        summary.latestSignalAgeHours != null && summary.latestSignalAgeHours > 72 -> "Stale"
        summary.daysWithAnySignal == 0 -> "No data"
        else -> "Connected"
    }
}





@Composable
private fun SummaryLine(label: String, value: String, caption: String, textColor: Color) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(text = label, color = textColor, style = MaterialTheme.typography.bodyLarge)
            Text(text = caption, color = textColor.copy(alpha = 0.62f), style = MaterialTheme.typography.bodySmall)
        }
        Text(text = value, color = textColor, style = MaterialTheme.typography.titleLarge)
    }
}





@Composable
private fun SchedulePanel(
    schedule: FocusSchedule,
    buttonLight: Boolean,
    onBack: () -> Unit,
    onSave: (FocusSchedule) -> Unit
) {
    var enabled by remember(schedule) { mutableStateOf(schedule.enabled) }
    var startMinute by remember(schedule) { mutableStateOf(schedule.startMinute) }
    var endMinute by remember(schedule) { mutableStateOf(schedule.endMinute) }

    Column(modifier = Modifier.fillMaxSize()) {
        ScreenHeader(title = "Timer", onBack = onBack)
        Spacer(modifier = Modifier.height(46.dp))
        Text(text = "Daily window", style = MaterialTheme.typography.headlineLarge, color = BlankOnSurface)
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Blankmind can turn on automatically during this window. Emergency unlock stays available when needed.",
            style = MaterialTheme.typography.bodyLarge,
            color = BlankOnSurface
        )
        Spacer(modifier = Modifier.height(24.dp))
        ToggleRow(
            label = "Enable daily schedule",
            checked = enabled,
            buttonLight = buttonLight,
            onCheckedChange = { enabled = it }
        )
        Spacer(modifier = Modifier.height(10.dp))
        TimeDropdown(label = "Start", minute = startMinute, buttonLight = buttonLight, onMinuteChange = { startMinute = it })
        Spacer(modifier = Modifier.height(10.dp))
        TimeDropdown(label = "End", minute = endMinute, buttonLight = buttonLight, onMinuteChange = { endMinute = it })
        Spacer(modifier = Modifier.height(16.dp))
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = if (buttonLight) Color.White.copy(alpha = 0.86f) else Color.Black,
            shape = RoundedCornerShape(22.dp)
        ) {
            Column(modifier = Modifier.padding(horizontal = 18.dp, vertical = 16.dp)) {
                Text(
                    text = "Active window",
                    color = progressTextColor(buttonLight).copy(alpha = 0.62f),
                    style = MaterialTheme.typography.bodySmall
                )
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = "${formatMinute(startMinute)} - ${formatMinute(endMinute)}",
                    color = progressTextColor(buttonLight),
                    style = MaterialTheme.typography.titleLarge
                )
            }
        }
        Spacer(modifier = Modifier.weight(1f))
        MainActionButton(
            text = "Save schedule",
            light = buttonLight,
            onClick = {
                onSave(
                    FocusSchedule(
                        enabled = enabled,
                        startMinute = startMinute,
                        endMinute = endMinute
                    )
                )
            }
        )
    }
}

@Composable
private fun ToggleRow(
    label: String,
    checked: Boolean,
    buttonLight: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    val rowColor = if (buttonLight) Color.White else Color.Black
    val textColor = if (buttonLight) Color.Black else Color.White
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = rowColor,
        shape = RoundedCornerShape(22.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 18.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(text = label, color = textColor, modifier = Modifier.weight(1f))
            Switch(checked = checked, onCheckedChange = onCheckedChange)
        }
    }
}

@Composable
private fun TimeDropdown(
    label: String,
    minute: Int,
    buttonLight: Boolean,
    onMinuteChange: (Int) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    val rowColor = if (buttonLight) Color.White else Color.Black
    val textColor = if (buttonLight) Color.Black else Color.White
    Box {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { expanded = true },
            color = rowColor,
            shape = RoundedCornerShape(22.dp)
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 18.dp, vertical = 16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(text = label, color = textColor, modifier = Modifier.weight(1f))
                Text(text = formatMinute(minute), color = textColor, style = MaterialTheme.typography.titleMedium)
                Text(text = "⌄", color = textColor.copy(alpha = 0.62f), modifier = Modifier.padding(start = 8.dp))
            }
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            timeOptions().forEach { option ->
                DropdownMenuItem(
                    text = { Text(formatMinute(option)) },
                    onClick = {
                        onMinuteChange(option)
                        expanded = false
                    }
                )
            }
        }
    }
}

@Composable
private fun DistractionsPanel(
    selectedCount: Int,
    buttonLight: Boolean,
    onBack: () -> Unit,
    onEdit: () -> Unit
) {
    val surfaceColor = if (buttonLight) Color.White else Color.Black
    val textColor = if (buttonLight) Color.Black else Color.White
    Column(modifier = Modifier.fillMaxSize()) {
        ScreenHeader(title = "Distractions", onBack = onBack)
        Spacer(modifier = Modifier.height(46.dp))
        Text(
            text = "One list. Every protection.",
            style = MaterialTheme.typography.headlineLarge,
            color = BlankOnSurface
        )
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = "Choose every app that pulls your attention. Blankmind reuses this list whenever it protects your time.",
            style = MaterialTheme.typography.bodyLarge,
            color = BlankGray
        )
        Spacer(modifier = Modifier.height(28.dp))
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = surfaceColor,
            shape = RoundedCornerShape(22.dp)
        ) {
            Column(modifier = Modifier.padding(horizontal = 18.dp, vertical = 18.dp)) {
                Text(
                    text = if (selectedCount == 1) "1 distraction selected" else "$selectedCount distractions selected",
                    color = textColor,
                    style = MaterialTheme.typography.titleMedium
                )
                Text(
                    text = if (selectedCount == 0) "Add apps before starting protection." else "You can update this list at any time.",
                    color = textColor.copy(alpha = 0.7f),
                    style = MaterialTheme.typography.bodyMedium
                )
            }
        }
        Spacer(modifier = Modifier.weight(1f))
        MainActionButton(
            text = if (selectedCount == 0) "Choose distractions" else "Edit distractions",
            light = buttonLight,
            onClick = onEdit
        )
    }
}

@Composable
private fun DistractionPickerDialog(
    selectedPackages: Set<String>,
    apps: List<AppInfo>,
    buttonLight: Boolean,
    onDismiss: () -> Unit,
    onSave: (Set<String>) -> Unit
) {
    var selected by remember(selectedPackages) { mutableStateOf(selectedPackages) }
    Dialog(onDismissRequest = onDismiss) {
        Surface(color = BlankSurface, shape = RoundedCornerShape(28.dp)) {
            Column(modifier = Modifier.padding(20.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(text = "Your distractions", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                    TextButton(onClick = onDismiss) { Text("×", fontSize = 22.sp, color = BlankOnSurface) }
                }
                Spacer(modifier = Modifier.height(10.dp))
                Text(
                    text = "Choose every app that pulls your attention. This one list is reused for every protection.",
                    style = MaterialTheme.typography.bodyLarge,
                    color = BlankGray
                )
                Spacer(modifier = Modifier.height(12.dp))
                AppPickerContent(
                    apps = apps,
                    selected = selected,
                    onSelectedChange = { selected = it },
                    listMaxHeight = 360.dp
                )
                Spacer(modifier = Modifier.height(14.dp))
                MainActionButton(
                    text = "Save distractions",
                    light = buttonLight,
                    onClick = { onSave(selected) }
                )
            }
        }
    }
}

@Composable
private fun CenterActionPanel(
    topTitle: String,
    label: String,
    title: String,
    body: String,
    action: String,
    buttonLight: Boolean,
    onBack: () -> Unit,
    onAction: () -> Unit
) {
    Column(modifier = Modifier.fillMaxSize()) {
        ScreenHeader(title = topTitle, onBack = onBack)
        Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(text = label, color = BlankOnSurface, style = MaterialTheme.typography.labelLarge)
                Spacer(modifier = Modifier.height(12.dp))
                Text(text = title, style = MaterialTheme.typography.headlineLarge, color = BlankOnSurface, textAlign = TextAlign.Center)
                Spacer(modifier = Modifier.height(12.dp))
                Text(text = body, style = MaterialTheme.typography.bodyLarge, color = BlankOnSurface, textAlign = TextAlign.Center)
            }
        }
        MainActionButton(text = action, light = buttonLight, onClick = onAction)
    }
}

@Composable
private fun ForgetConfirmPanel(
    buttonLight: Boolean,
    onBack: () -> Unit,
    onConfirm: () -> Unit
) {
    var confirmed by remember { mutableStateOf(false) }
    Column(modifier = Modifier.fillMaxSize()) {
        ScreenHeader(title = "Reset NFC", onBack = onBack)
        Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(text = "Confirmation", color = BlankOnSurface, style = MaterialTheme.typography.labelLarge)
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = "Forget my Blankmind key.",
                    style = MaterialTheme.typography.headlineLarge,
                    color = BlankOnSurface,
                    textAlign = TextAlign.Center
                )
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = "Blankmind will turn off, the optional key will be removed, and onboarding will restart.",
                    style = MaterialTheme.typography.bodyLarge,
                    color = BlankOnSurface,
                    textAlign = TextAlign.Center
                )
                Spacer(modifier = Modifier.height(18.dp))
                Surface(color = if (buttonLight) Color.White else Color.Black, shape = RoundedCornerShape(22.dp)) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { confirmed = !confirmed }
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Checkbox(checked = confirmed, onCheckedChange = { confirmed = it })
                        Text(
                            text = "I understand I will need to pair Blankmind again.",
                            color = progressTextColor(buttonLight),
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                }
            }
        }
        MainActionButton(
            text = "Yes, forget Blankmind",
            enabled = confirmed,
            light = buttonLight,
            onClick = onConfirm
        )
    }
}

@Composable
private fun BlockPanel(onEmergency: () -> Unit) {
    Column(modifier = Modifier.fillMaxSize()) {
        Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(text = "Instagram", color = BlankSurface.copy(alpha = 0.72f), style = MaterialTheme.typography.labelLarge)
                Spacer(modifier = Modifier.height(12.dp))
                Text(text = "App blocked", style = MaterialTheme.typography.headlineLarge, color = BlankSurface, textAlign = TextAlign.Center)
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = stringResource(R.string.block_message),
                    style = MaterialTheme.typography.bodyLarge,
                    color = BlankSurface.copy(alpha = 0.72f),
                    textAlign = TextAlign.Center
                )
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    text = stringResource(R.string.block_reinforcement),
                    style = MaterialTheme.typography.bodyMedium,
                    color = BlankSurface.copy(alpha = 0.54f),
                    textAlign = TextAlign.Center
                )
            }
        }
        TextButton(onClick = onEmergency, modifier = Modifier.align(Alignment.CenterHorizontally)) {
            Text(text = stringResource(R.string.emergency_start), color = BlankSurface.copy(alpha = 0.74f))
        }
    }
}

@Composable
private fun EmergencyPanel(
    emergencyUnlocksRemaining: Int,
    onBack: () -> Unit,
    onUnlock: () -> Unit
) {
    var phrase by remember { mutableStateOf("") }
    val expected = stringResource(R.string.emergency_phrase)
    Column(modifier = Modifier.fillMaxSize()) {
        ScreenHeader(title = "Emergency", onBack = onBack, dark = true)
        Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(text = "Unlock", color = BlankSurface.copy(alpha = 0.72f), style = MaterialTheme.typography.labelLarge)
                Spacer(modifier = Modifier.height(12.dp))
                Text(text = "Type the full phrase.", style = MaterialTheme.typography.headlineLarge, color = BlankSurface, textAlign = TextAlign.Center)
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = if (emergencyUnlocksRemaining > 0)
                        "$emergencyUnlocksRemaining emergency unlocks left this week."
                    else
                        "You have used all 3 emergency unlocks this week.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = BlankSurface.copy(alpha = 0.72f),
                    textAlign = TextAlign.Center
                )
                Spacer(modifier = Modifier.height(16.dp))
                Text(text = expected, style = MaterialTheme.typography.bodyLarge, color = BlankSurface.copy(alpha = 0.72f), textAlign = TextAlign.Center)
                Spacer(modifier = Modifier.height(16.dp))
                OutlinedTextField(
                    value = phrase,
                    onValueChange = { phrase = it },
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = BlankSurface,
                        unfocusedTextColor = BlankSurface,
                        focusedBorderColor = BlankSurface.copy(alpha = 0.64f),
                        unfocusedBorderColor = BlankSurface.copy(alpha = 0.32f)
                    )
                )
            }
        }
        MainActionButton(
            text = stringResource(R.string.emergency_unlock),
            light = true,
            enabled = emergencyUnlocksRemaining > 0 && phrase.trim() == expected,
            onClick = onUnlock
        )
    }
}

@Composable
private fun ScreenHeader(
    title: String,
    backLabel: String = "Back",
    onBack: () -> Unit,
    dark: Boolean = false
) {
    val color = if (dark) BlankSurface else BlankOnSurface
    Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Box(
            modifier = Modifier
                .height(44.dp)
                .clickable(onClick = onBack),
            contentAlignment = Alignment.CenterStart
        ) {
            Text(text = backLabel, color = color, style = MaterialTheme.typography.bodyLarge)
        }
        Text(
            text = title,
            color = color,
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.weight(1f),
            textAlign = TextAlign.End
        )
    }
}

@Composable
private fun HomeBlankearButton(
    text: String,
    enabled: Boolean = true,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val capsuleReflection = homeCapsuleReflection(center = Offset(34f, 8f), radius = 132f)
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(999.dp),
        color = HomeGlassScrim,
        contentColor = Color.White,
        border = homeCapsuleBorder(),
        modifier = modifier
            .fillMaxWidth()
            .height(47.dp)
            .shadow(
                elevation = 5.dp,
                shape = RoundedCornerShape(999.dp),
                ambientColor = Color.Black.copy(alpha = 0.05f),
                spotColor = Color.Black.copy(alpha = 0.04f)
            )
            .background(capsuleReflection, RoundedCornerShape(999.dp))
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(capsuleReflection, RoundedCornerShape(999.dp)),
            contentAlignment = Alignment.Center
        ) {
            Text(text = text, style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.SemiBold))
        }
    }
}

@Composable
private fun MainActionButton(
    text: String,
    enabled: Boolean = true,
    light: Boolean = false,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(999.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = if (light) Color.White else Color.Black,
            contentColor = if (light) Color.Black else Color.White,
            disabledContainerColor = Color(0xFFD8D8D5),
            disabledContentColor = BlankGray
        ),
        modifier = modifier
            .fillMaxWidth()
            .height(54.dp)
            .shadow(
                elevation = if (enabled) 14.dp else 0.dp,
                shape = RoundedCornerShape(999.dp),
                ambientColor = Color.Black.copy(alpha = 0.12f),
                spotColor = Color.Black.copy(alpha = 0.12f)
            )
    ) {
        Text(text = text, style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Medium))
    }
}



































@Composable
private fun progressTextColor(buttonLight: Boolean): Color {
    return if (buttonLight) Color.Black else Color.White
}

private fun formatMinute(minuteOfDay: Int): String {
    val hour = (minuteOfDay / 60).coerceIn(0, 23)
    val minute = (minuteOfDay % 60).coerceIn(0, 59)
    return hour.toString().padStart(2, '0') + ":" + minute.toString().padStart(2, '0')
}

private fun timeOptions(): List<Int> {
    return (0..47).map { it * 30 }
}
