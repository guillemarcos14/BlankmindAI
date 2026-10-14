package com.blanknfc.app.ui.screens

import android.content.Intent
import android.app.Activity
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle.Event.ON_RESUME
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.blanknfc.app.R
import com.blanknfc.app.data.AndroidOnboardingResponses
import com.blanknfc.app.data.OnboardingSyncStore
import com.blanknfc.app.data.PlayPurchaseStore
import com.blanknfc.app.data.PurchaseUiState
import com.blanknfc.app.data.SessionManager
import com.blanknfc.app.ui.theme.BlankBackground
import com.blanknfc.app.ui.theme.BlankGray
import com.blanknfc.app.ui.theme.BlankLine
import com.blanknfc.app.ui.theme.BlankOnSurface
import com.blanknfc.app.ui.theme.BlankPanel
import com.blanknfc.app.ui.theme.BlankSurface
import com.blanknfc.app.util.AccessibilityHelper
import com.blanknfc.app.util.BatteryHelper
import com.blanknfc.app.util.findActivity

private enum class SetupError {
    ACCESSIBILITY,
    BATTERY
}

private enum class AndroidOnboardingStep(val analyticsName: String) {
    AWARENESS("awareness"),
    LIFETIME("lifetime"),
    DOPAMINE("dopamine"),
    NAME("name"),
    GOAL("goal"),
    AGE("age"),
    DISTRACTING_APPS("distracting_apps"),
    PROFILE("profile"),
    DAILY_USE("daily_use"),
    RESULT("result"),
    DIAGNOSIS("diagnosis"),
    RECOVERY("recovery"),
    COMMITMENT("commitment"),
    PERSONALIZATION("personalization"),
    TRIAL("trial"),
    PERMISSION("screen_time_permission"),
    NOTIFICATIONS("notifications"),
    APPS("apps_selection")
}

@Composable
fun SetupScreen(
    sessionManager: SessionManager,
    purchaseStore: PlayPurchaseStore,
    onboardingSyncStore: OnboardingSyncStore,
    onSetupComplete: () -> Unit,
    onSelectApps: () -> Unit,
    onNavigateToPrivacy: () -> Unit
) {
    val context = LocalContext.current
    val activity = context.findActivity()
    val lifecycleOwner = LocalLifecycleOwner.current
    val purchaseState by purchaseStore.state.collectAsStateWithLifecycle()
    val blockedPackages by sessionManager.blockedPackages.collectAsStateWithLifecycle()
    val steps = AndroidOnboardingStep.entries
    var currentStep by rememberSaveable { mutableIntStateOf(0) }
    var setupError by remember { mutableStateOf<SetupError?>(null) }
    var accessibilityEnabled by remember { mutableStateOf(AccessibilityHelper.isServiceEnabled(context)) }
    var batteryOptimizedIgnored by remember { mutableStateOf(BatteryHelper.isIgnoringBatteryOptimizations(context)) }
    var onboardingName by rememberSaveable { mutableStateOf("") }
    var selectedGoal by rememberSaveable { mutableStateOf("reduce_scrolling") }
    var selectedAgeRange by rememberSaveable { mutableStateOf("25_34") }
    var distractingAppsText by rememberSaveable { mutableStateOf("") }
    var selectedProfile by rememberSaveable { mutableStateOf("night_scroller") }
    var dailyHoursText by rememberSaveable { mutableStateOf("4") }
    var selectedPlan by rememberSaveable { mutableStateOf("annual") }
    var personalizationSubmitted by rememberSaveable { mutableStateOf(false) }
    val selectedAppCount = blockedPackages.size
    val dailyHours = dailyHoursText.toDoubleOrNull()?.coerceIn(0.5, 18.0) ?: 4.0
    val weakMoment = weakMomentFor(selectedProfile, dailyHours, distractingAppsText)
    val aiGoal = aiGoalFor(selectedGoal, weakMoment)
    fun responses(plan: String = selectedPlan): AndroidOnboardingResponses {
        return AndroidOnboardingResponses(
            name = onboardingName.trim().ifBlank { "Blankmind" },
            ageRange = selectedAgeRange,
            goal = selectedGoal,
            profile = selectedProfile,
            dailyHours = dailyHours,
            aiGoal = aiGoal,
            weakMoment = weakMoment,
            selectedPlan = plan
        )
    }
    fun submitPersonalization(plan: String = selectedPlan) {
        onboardingSyncStore.submit(responses(plan))
        personalizationSubmitted = true
    }
    fun goToStep(step: AndroidOnboardingStep) {
        currentStep = steps.indexOf(step).coerceAtLeast(0)
    }
    fun refreshSystemState() {
        accessibilityEnabled = AccessibilityHelper.isServiceEnabled(context)
        batteryOptimizedIgnored = BatteryHelper.isIgnoringBatteryOptimizations(context)
    }

    LaunchedEffect(selectedAppCount) {
        if (steps.getOrNull(currentStep) == AndroidOnboardingStep.APPS && selectedAppCount > 0) {
            currentStep = steps.lastIndex + 1
        }
    }

    LaunchedEffect(currentStep) {
        steps.getOrNull(currentStep)?.let { step ->
            onboardingSyncStore.trackStepViewed(step.analyticsName)
        }
    }

    LaunchedEffect(purchaseState.hasPremiumAccess) {
        if (steps.getOrNull(currentStep) == AndroidOnboardingStep.TRIAL && purchaseState.hasPremiumAccess) {
            goToStep(AndroidOnboardingStep.PERMISSION)
        }
    }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == ON_RESUME) {
                refreshSystemState()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(BlankBackground)
            .padding(horizontal = 24.dp, vertical = 42.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        OnboardingHeader(currentStep = currentStep.coerceIn(0, steps.lastIndex), totalSteps = steps.size)

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(top = 76.dp, bottom = 40.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                color = Color.Transparent,
                shape = RoundedCornerShape(0.dp)
            ) {
                Column(
                    modifier = Modifier.padding(0.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    if (setupError != null) {
                        RecoveryStep(
                            error = setupError!!,
                            onRetry = {
                                refreshSystemState()
                                setupError = null
                            },
                            onOpenSettings = {
                                when (setupError) {
                                    SetupError.ACCESSIBILITY -> AccessibilityHelper.openAccessibilitySettings(context)
                                    SetupError.BATTERY -> {
                                        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                                            data = Uri.parse("package:${context.packageName}")
                                        }
                                        context.startActivity(intent)
                                    }
                                    else -> Unit
                                }
                            }
                        )
                    } else {
                        when (steps.getOrNull(currentStep)) {
                            AndroidOnboardingStep.AWARENESS -> MainSetupStep(
                                stepText = stepText(currentStep, steps.size),
                                title = "Your phone is taking more of your life than you think",
                                description = "Blankmind helps you block distractions, understand your patterns, and stay in control.",
                                primaryText = "Let's see how much",
                                onPrimary = { currentStep++ }
                            )
                            AndroidOnboardingStep.LIFETIME -> MainSetupStep(
                                stepText = stepText(currentStep, steps.size),
                                title = "That time compounds.",
                                description = "At ${dailyHours.formatHours()} hours a day, your phone can take ${lostDays(dailyHours)} days a year.",
                                primaryText = "Continue",
                                onPrimary = { currentStep++ }
                            )
                            AndroidOnboardingStep.DOPAMINE -> MainSetupStep(
                                stepText = stepText(currentStep, steps.size),
                                title = "The loop starts before you notice.",
                                description = "Blankmind is built to interrupt that loop before it wins.",
                                primaryText = "Build my plan",
                                onPrimary = { currentStep++ }
                            )
                            AndroidOnboardingStep.NAME -> TextInputStep(
                                stepText = stepText(currentStep, steps.size),
                                title = "What should Blankmind call you?",
                                description = "This personalizes your AI plan without using your identity for ads.",
                                value = onboardingName,
                                placeholder = "Your name",
                                onValueChange = { onboardingName = it },
                                primaryEnabled = onboardingName.trim().isNotEmpty(),
                                onPrimary = { currentStep++ }
                            )
                            AndroidOnboardingStep.GOAL -> ChoiceStep(
                                stepText = stepText(currentStep, steps.size),
                                title = "What do you want back?",
                                description = "Pick the goal that best matches the habit you want Blankmind to protect.",
                                selected = selectedGoal,
                                options = listOf(
                                    "reduce_scrolling" to "Reduce scrolling",
                                    "sleep_better" to "Sleep better",
                                    "deep_work" to "Do focused work",
                                    "feel_in_control" to "Feel in control"
                                ),
                                onSelect = { selectedGoal = it },
                                onPrimary = { currentStep++ }
                            )
                            AndroidOnboardingStep.AGE -> ChoiceStep(
                                stepText = stepText(currentStep, steps.size),
                                title = "Which age range are you in?",
                                description = "Blankmind uses this only to calibrate your onboarding plan.",
                                selected = selectedAgeRange,
                                options = listOf(
                                    "18_24" to "18-24",
                                    "25_34" to "25-34",
                                    "35_44" to "35-44",
                                    "45_plus" to "45+"
                                ),
                                onSelect = { selectedAgeRange = it },
                                onPrimary = { currentStep++ }
                            )
                            AndroidOnboardingStep.DISTRACTING_APPS -> TextInputStep(
                                stepText = stepText(currentStep, steps.size),
                                title = "Which apps pull you back?",
                                description = "Name the apps or moments that usually start the loop.",
                                value = distractingAppsText,
                                placeholder = "Instagram, TikTok, YouTube...",
                                onValueChange = { distractingAppsText = it },
                                primaryText = "Continue",
                                secondaryText = stringResource(R.string.setup_select_apps),
                                onPrimary = { currentStep++ },
                                onSecondary = onSelectApps
                            )
                            AndroidOnboardingStep.PROFILE -> ChoiceStep(
                                stepText = stepText(currentStep, steps.size),
                                title = "When does it usually happen?",
                                description = "This becomes the weak moment Blankmind uses for your first plan.",
                                selected = selectedProfile,
                                options = listOf(
                                    "night_scroller" to "At night",
                                    "boredom_loop" to "When bored",
                                    "stress_escape" to "Under stress",
                                    "transition_gap" to "Between tasks"
                                ),
                                onSelect = { selectedProfile = it },
                                onPrimary = { currentStep++ }
                            )
                            AndroidOnboardingStep.DAILY_USE -> TextInputStep(
                                stepText = stepText(currentStep, steps.size),
                                title = "How many hours a day?",
                                description = "Use your honest estimate. Blankmind only sends the number after consent.",
                                value = dailyHoursText,
                                placeholder = "4",
                                keyboardType = KeyboardType.Decimal,
                                onValueChange = { dailyHoursText = it },
                                primaryEnabled = dailyHoursText.toDoubleOrNull() != null,
                                onPrimary = { currentStep++ }
                            )
                            AndroidOnboardingStep.RESULT -> MainSetupStep(
                                stepText = stepText(currentStep, steps.size),
                                title = "Your pattern is visible.",
                                description = "Blankmind will start with $aiGoal",
                                primaryText = "Show my diagnosis",
                                onPrimary = { currentStep++ }
                            )
                            AndroidOnboardingStep.DIAGNOSIS -> MainSetupStep(
                                stepText = stepText(currentStep, steps.size),
                                title = "Your weakest moment is $weakMoment.",
                                description = "The first plan protects that window before the scroll pulls you back.",
                                primaryText = "Continue",
                                onPrimary = { currentStep++ }
                            )
                            AndroidOnboardingStep.RECOVERY -> MainSetupStep(
                                stepText = stepText(currentStep, steps.size),
                                title = "You do not need more willpower.",
                                description = "You need the distracting path to become harder at the exact moment it usually wins.",
                                primaryText = "Continue",
                                onPrimary = { currentStep++ }
                            )
                            AndroidOnboardingStep.COMMITMENT -> MainSetupStep(
                                stepText = stepText(currentStep, steps.size),
                                title = "Commit to one protected window.",
                                description = "Start small. Blankmind learns from starts, exits, emergency unlocks and Health context.",
                                primaryText = "I commit",
                                onPrimary = { currentStep++ }
                            )
                            AndroidOnboardingStep.PERSONALIZATION -> MainSetupStep(
                                stepText = stepText(currentStep, steps.size),
                                title = "Let's personalize the plan.",
                                description = "Blankmind uses your answers with consent to understand your routines and rest.",
                                primaryText = "Personalize my plan",
                                onPrimary = {
                                    submitPersonalization()
                                    currentStep++
                                }
                            )
                            AndroidOnboardingStep.TRIAL -> TrialStep(
                                purchaseStore = purchaseStore,
                                purchaseState = purchaseState,
                                onboardingSyncStore = onboardingSyncStore,
                                selectedPlan = selectedPlan,
                                responses = { plan -> responses(plan) },
                                onPlanSelected = { selectedPlan = it },
                                activity = activity,
                                onContinue = { goToStep(AndroidOnboardingStep.PERMISSION) },
                                onPrivacy = onNavigateToPrivacy
                            )
                            AndroidOnboardingStep.PERMISSION -> PermissionsStep(
                                stepText = stepText(currentStep, steps.size),
                                accessibilityEnabled = accessibilityEnabled,
                                batteryOptimizedIgnored = batteryOptimizedIgnored,
                                onOpenAccessibility = {
                                    AccessibilityHelper.openAccessibilitySettings(context)
                                },
                                onOpenBattery = {
                                    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                                        data = Uri.parse("package:${context.packageName}")
                                    }
                                    context.startActivity(intent)
                                },
                                onRetry = {
                                    refreshSystemState()
                                    setupError = when {
                                        !accessibilityEnabled -> SetupError.ACCESSIBILITY
                                        else -> null
                                    }
                                    if (setupError == null) currentStep++
                                },
                                onPrivacy = onNavigateToPrivacy
                            )
                            AndroidOnboardingStep.NOTIFICATIONS -> MainSetupStep(
                                stepText = stepText(currentStep, steps.size),
                                title = "Allow preventive reminders.",
                                description = "Android notification permission can be enabled later. Blankmind will still work without it.",
                                primaryText = "Continue",
                                onPrimary = { currentStep++ }
                            )
                            AndroidOnboardingStep.APPS -> MainSetupStep(
                                stepText = stepText(currentStep, steps.size),
                                title = "Choose your distractions.",
                                description = if (selectedAppCount > 0) "$selectedAppCount distractions selected. Blankmind will reuse this one private list for every protection." else "Select every app that pulls your attention: social media, games, streaming, or anything else. Blankmind will reuse this one private list for every protection.",
                                statusText = if (selectedAppCount > 0) "Distractions ready" else null,
                                primaryText = stringResource(R.string.setup_select_apps),
                                secondaryText = if (selectedAppCount > 0) stringResource(R.string.setup_continue) else null,
                                onPrimary = onSelectApps,
                                onSecondary = { currentStep = steps.lastIndex + 1 }
                            )
                            null -> SetupCompleteStep(
                                onFinish = onSetupComplete
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(24.dp))
                    StepIndicator(currentStep = currentStep.coerceIn(0, steps.lastIndex), totalSteps = steps.size)
                }
            }
        }
    }
}

@Composable
private fun OnboardingHeader(currentStep: Int, totalSteps: Int) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(text = "Blankmind", style = MaterialTheme.typography.bodyLarge, color = BlankOnSurface)
        Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            val checkpoints = 6
            repeat(checkpoints) { index ->
                val checkpointStep = ((totalSteps - 1).toFloat() * index / (checkpoints - 1)).toInt()
                Surface(
                    modifier = Modifier.size(width = if (currentStep >= checkpointStep) 22.dp else 8.dp, height = 8.dp),
                    shape = RoundedCornerShape(999.dp),
                    color = if (currentStep >= checkpointStep) BlankOnSurface else BlankLine
                ) {}
            }
        }
    }
}

@Composable
private fun MainSetupStep(
    stepText: String? = null,
    title: String,
    description: String,
    statusText: String? = null,
    primaryText: String,
    primaryEnabled: Boolean = true,
    secondaryText: String? = null,
    onPrimary: () -> Unit,
    onSecondary: (() -> Unit)? = null
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        if (stepText != null) {
            Text(
                text = stepText,
                style = MaterialTheme.typography.labelLarge,
                color = BlankGray,
                textAlign = TextAlign.Center
            )
            Spacer(modifier = Modifier.height(12.dp))
        }
        Text(
            text = title,
            style = MaterialTheme.typography.headlineLarge,
            color = BlankOnSurface,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(14.dp))
        Text(
            text = description,
            style = MaterialTheme.typography.bodyLarge,
            color = BlankGray,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = 330.dp)
        )
        if (statusText != null) {
            Spacer(modifier = Modifier.height(18.dp))
            StatusPill(text = statusText)
        }
        Spacer(modifier = Modifier.height(28.dp))
        PrimaryButton(text = primaryText, enabled = primaryEnabled, onClick = onPrimary)
        if (secondaryText != null && onSecondary != null) {
            Spacer(modifier = Modifier.height(12.dp))
            SecondaryButton(text = secondaryText, onClick = onSecondary)
        }
    }
}

@Composable
private fun TextInputStep(
    stepText: String,
    title: String,
    description: String,
    value: String,
    placeholder: String,
    keyboardType: KeyboardType = KeyboardType.Text,
    primaryText: String = "Continue",
    primaryEnabled: Boolean = true,
    secondaryText: String? = null,
    onValueChange: (String) -> Unit,
    onPrimary: () -> Unit,
    onSecondary: (() -> Unit)? = null
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = stepText,
            style = MaterialTheme.typography.labelLarge,
            color = BlankGray,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = title,
            style = MaterialTheme.typography.headlineLarge,
            color = BlankOnSurface,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = description,
            style = MaterialTheme.typography.bodyLarge,
            color = BlankGray,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = 330.dp)
        )
        Spacer(modifier = Modifier.height(18.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            placeholder = { Text(placeholder) },
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
            singleLine = keyboardType == KeyboardType.Decimal,
            colors = OutlinedTextFieldDefaults.colors(
                focusedTextColor = BlankOnSurface,
                unfocusedTextColor = BlankOnSurface,
                focusedBorderColor = BlankOnSurface,
                unfocusedBorderColor = BlankLine,
                focusedContainerColor = Color.White.copy(alpha = 0.62f),
                unfocusedContainerColor = Color.White.copy(alpha = 0.48f)
            ),
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(modifier = Modifier.height(22.dp))
        PrimaryButton(text = primaryText, enabled = primaryEnabled, onClick = onPrimary)
        if (secondaryText != null && onSecondary != null) {
            Spacer(modifier = Modifier.height(10.dp))
            SecondaryButton(text = secondaryText, onClick = onSecondary)
        }
    }
}

@Composable
private fun ChoiceStep(
    stepText: String,
    title: String,
    description: String,
    selected: String,
    options: List<Pair<String, String>>,
    onSelect: (String) -> Unit,
    onPrimary: () -> Unit
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = stepText,
            style = MaterialTheme.typography.labelLarge,
            color = BlankGray,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = title,
            style = MaterialTheme.typography.headlineLarge,
            color = BlankOnSurface,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = description,
            style = MaterialTheme.typography.bodyLarge,
            color = BlankGray,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = 330.dp)
        )
        Spacer(modifier = Modifier.height(18.dp))
        options.forEach { (value, label) ->
            ChoiceButton(
                label = label,
                selected = selected == value,
                onClick = { onSelect(value) }
            )
            Spacer(modifier = Modifier.height(10.dp))
        }
        Spacer(modifier = Modifier.height(10.dp))
        PrimaryButton(text = "Continue", onClick = onPrimary)
    }
}

@Composable
private fun ChoiceButton(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = Color.White.copy(alpha = if (selected) 0.86f else 0.58f),
        shape = RoundedCornerShape(22.dp),
        onClick = onClick
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 18.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelLarge,
                color = BlankOnSurface,
                modifier = Modifier.weight(1f)
            )
            Checkbox(checked = selected, onCheckedChange = { onClick() })
        }
    }
}

@Composable
private fun PermissionsStep(
    stepText: String,
    accessibilityEnabled: Boolean,
    batteryOptimizedIgnored: Boolean,
    onOpenAccessibility: () -> Unit,
    onOpenBattery: () -> Unit,
    onRetry: () -> Unit,
    onPrivacy: () -> Unit
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = stepText,
            style = MaterialTheme.typography.labelLarge,
            color = BlankGray,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = "Allow Blankmind to block.",
            style = MaterialTheme.typography.headlineLarge,
            color = BlankOnSurface,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = stringResource(R.string.setup_permissions_desc),
            style = MaterialTheme.typography.bodyLarge,
            color = BlankGray,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = 330.dp)
        )
        Spacer(modifier = Modifier.height(18.dp))
        PermissionRow(
            title = stringResource(R.string.setup_accessibility_label),
            status = stringResource(R.string.setup_required),
            description = stringResource(R.string.setup_accessibility_desc),
            checked = accessibilityEnabled,
            onClick = onOpenAccessibility
        )
        Spacer(modifier = Modifier.height(10.dp))
        PermissionRow(
            title = stringResource(R.string.setup_battery_label),
            status = stringResource(R.string.setup_recommended),
            description = stringResource(R.string.setup_battery_desc),
            checked = batteryOptimizedIgnored,
            onClick = onOpenBattery
        )
        if (accessibilityEnabled) {
            Spacer(modifier = Modifier.height(18.dp))
            StatusPill(text = stringResource(R.string.setup_permissions_ready))
        }
        Spacer(modifier = Modifier.height(18.dp))
        PrimaryButton(
            text = if (accessibilityEnabled) stringResource(R.string.setup_continue) else stringResource(R.string.setup_open_accessibility),
            onClick = if (accessibilityEnabled) onRetry else onOpenAccessibility
        )
        Spacer(modifier = Modifier.height(4.dp))
        androidx.compose.material3.TextButton(onClick = onPrivacy) {
            Text(text = stringResource(R.string.privacy_open), color = BlankGray)
        }
    }
}

@Composable
private fun SetupCompleteStep(onFinish: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = stringResource(R.string.setup_complete_title),
            style = MaterialTheme.typography.headlineLarge,
            color = BlankOnSurface,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(14.dp))
        Text(
            text = stringResource(R.string.setup_complete_desc),
            style = MaterialTheme.typography.bodyLarge,
            color = BlankGray,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = 330.dp)
        )
        Spacer(modifier = Modifier.height(18.dp))
        StatusPill(text = stringResource(R.string.setup_complete_status))
        Spacer(modifier = Modifier.height(28.dp))
        PrimaryButton(
            text = stringResource(R.string.setup_first_blank),
            onClick = onFinish
        )
    }
}

@Composable
private fun StatusPill(text: String) {
    Surface(
        color = Color.White.copy(alpha = 0.72f),
        shape = RoundedCornerShape(999.dp),
        modifier = Modifier.height(42.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(text = "✓", style = MaterialTheme.typography.labelLarge, color = BlankOnSurface)
            Text(text = text, style = MaterialTheme.typography.labelLarge, color = BlankOnSurface)
        }
    }
}

@Composable
private fun PermissionRow(
    title: String,
    status: String,
    description: String,
    checked: Boolean,
    onClick: () -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = Color.White.copy(alpha = 0.74f),
        shape = RoundedCornerShape(22.dp),
        onClick = onClick
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Checkbox(checked = checked, onCheckedChange = { onClick() })
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(start = 8.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = title,
                        style = MaterialTheme.typography.labelLarge,
                        color = BlankOnSurface,
                        modifier = Modifier.weight(1f)
                    )
                    Text(
                        text = status,
                        style = MaterialTheme.typography.labelSmall,
                        color = BlankGray,
                        textAlign = TextAlign.End
                    )
                }
                Text(text = description, style = MaterialTheme.typography.bodyMedium, color = BlankGray)
            }
        }
    }
}

@Composable
private fun RecoveryStep(
    error: SetupError,
    onRetry: () -> Unit,
    onOpenSettings: () -> Unit
) {
    val title = stringResource(R.string.setup_permission_error_title)
    val description = when (error) {
        SetupError.ACCESSIBILITY -> stringResource(R.string.setup_accessibility_error_desc)
        SetupError.BATTERY -> stringResource(R.string.setup_battery_error_desc)
    }
    MainSetupStep(
        title = title,
        description = description,
        primaryText = when (error) {
            SetupError.ACCESSIBILITY -> stringResource(R.string.setup_open_accessibility)
            SetupError.BATTERY -> stringResource(R.string.setup_open_battery)
        },
        secondaryText = stringResource(R.string.setup_retry),
        onPrimary = onOpenSettings,
        onSecondary = onRetry
    )
}

@Composable
private fun TrialStep(
    purchaseStore: PlayPurchaseStore,
    purchaseState: PurchaseUiState,
    onboardingSyncStore: OnboardingSyncStore,
    selectedPlan: String,
    responses: (String) -> AndroidOnboardingResponses,
    onPlanSelected: (String) -> Unit,
    activity: Activity?,
    onContinue: () -> Unit,
    onPrivacy: () -> Unit
) {
    val selectedProductId = when (selectedPlan) {
        "monthly" -> PlayPurchaseStore.monthlyProductId
        else -> PlayPurchaseStore.annualProductId
    }
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            text = "Step 15 of 18",
            style = MaterialTheme.typography.labelLarge,
            color = BlankGray,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = "Start your 3-day trial.",
            style = MaterialTheme.typography.headlineLarge,
            color = BlankOnSurface,
            textAlign = TextAlign.Center
        )
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = "Free includes basic blocking. Pro supports personalized rest plans and sleep context.",
            style = MaterialTheme.typography.bodyLarge,
            color = BlankGray,
            textAlign = TextAlign.Center,
            modifier = Modifier.widthIn(max = 330.dp)
        )
        Spacer(modifier = Modifier.height(18.dp))
        PlanButton(
            title = "Annual",
            price = purchaseStore.priceText(PlayPurchaseStore.annualProductId, "€19.99"),
            detail = "3 days free, then billed yearly",
            selected = selectedPlan == "annual",
            onClick = { onPlanSelected("annual") }
        )
        Spacer(modifier = Modifier.height(10.dp))
        PlanButton(
            title = "Monthly",
            price = purchaseStore.priceText(PlayPurchaseStore.monthlyProductId, "€2.99"),
            detail = "3 days free, then billed monthly",
            selected = selectedPlan == "monthly",
            onClick = { onPlanSelected("monthly") }
        )
        Spacer(modifier = Modifier.height(18.dp))
        PrimaryButton(
            text = if (purchaseState.isPurchasing || purchaseState.isLoading) "Opening..." else "Start 3-day trial",
            enabled = !purchaseState.isPurchasing && !purchaseState.isLoading,
            onClick = {
                onboardingSyncStore.submit(responses(selectedPlan))
                if (activity != null && purchaseState.products.isNotEmpty()) {
                    purchaseStore.purchase(activity, selectedProductId)
                } else {
                    onContinue()
                }
            }
        )
        Spacer(modifier = Modifier.height(8.dp))
        SecondaryButton(
            text = "Continue with free blocking",
            onClick = {
                onPlanSelected("free")
                onboardingSyncStore.submit(responses("free"))
                onContinue()
            }
        )
        Spacer(modifier = Modifier.height(4.dp))
        TextButton(onClick = { purchaseStore.restorePurchases() }) {
            Text(text = "Restore purchases", color = BlankGray)
        }
        TextButton(onClick = onPrivacy) {
            Text(text = "Terms · Privacy", color = BlankGray)
        }
        if (purchaseState.message != null) {
            Text(
                text = purchaseState.message,
                style = MaterialTheme.typography.bodySmall,
                color = BlankGray,
                textAlign = TextAlign.Center
            )
        }
    }
}

@Composable
private fun PlanButton(
    title: String,
    price: String,
    detail: String,
    selected: Boolean,
    onClick: () -> Unit
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        color = Color.White.copy(alpha = if (selected) 0.86f else 0.68f),
        shape = RoundedCornerShape(22.dp),
        onClick = onClick
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 18.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(text = title, style = MaterialTheme.typography.labelLarge, color = BlankOnSurface)
                Text(text = price, style = MaterialTheme.typography.headlineSmall, color = BlankOnSurface)
                Text(text = detail, style = MaterialTheme.typography.bodySmall, color = BlankGray)
            }
            Checkbox(checked = selected, onCheckedChange = { onClick() })
        }
    }
}

@Composable
private fun PrimaryButton(text: String, enabled: Boolean = true, onClick: () -> Unit) {
    Button(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(999.dp),
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp)
            .shadow(
                elevation = if (enabled) 16.dp else 0.dp,
                shape = RoundedCornerShape(999.dp),
                ambientColor = Color.Black.copy(alpha = 0.12f),
                spotColor = Color.Black.copy(alpha = 0.12f)
            ),
        colors = ButtonDefaults.buttonColors(
            containerColor = BlankOnSurface,
            contentColor = BlankSurface,
            disabledContainerColor = Color(0xFFD8D8D5),
            disabledContentColor = BlankGray
        )
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
private fun SecondaryButton(text: String, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        shape = RoundedCornerShape(999.dp),
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = BlankOnSurface)
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
private fun StepIndicator(currentStep: Int, totalSteps: Int) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        val checkpoints = 6
        repeat(checkpoints) { index ->
            val checkpointStep = ((totalSteps - 1).toFloat() * index / (checkpoints - 1)).toInt()
            Surface(
                modifier = Modifier.size(width = if (currentStep >= checkpointStep) 22.dp else 8.dp, height = 8.dp),
                shape = RoundedCornerShape(999.dp),
                color = if (currentStep >= checkpointStep) BlankOnSurface else BlankLine
            ) {}
        }
    }
}

private fun stepText(currentStep: Int, totalSteps: Int): String = "Step ${currentStep + 1} of $totalSteps"

private fun Double.formatHours(): String {
    val rounded = if (this % 1.0 == 0.0) toInt().toString() else String.format("%.1f", this)
    return rounded
}

private fun lostDays(dailyHours: Double): Int = ((dailyHours * 365.0) / 24.0).toInt().coerceAtLeast(1)

private fun weakMomentFor(profile: String, dailyHours: Double, distractingApps: String): String {
    return when (profile) {
        "night_scroller" -> "before_sleep"
        "stress_escape" -> "stress"
        "transition_gap" -> "between_tasks"
        "boredom_loop" -> "low_energy_boredom"
        else -> if (distractingApps.isNotBlank() || dailyHours >= 5.0) "automatic_scrolling" else "general_distraction"
    }
}

private fun aiGoalFor(goal: String, weakMoment: String): String {
    val focus = when (goal) {
        "sleep_better" -> "protecting the final hour before sleep"
        "deep_work" -> "starting a block before the first distraction"
        "feel_in_control" -> "creating friction before automatic checking"
        else -> "reducing automatic scrolling"
    }
    return "$focus around $weakMoment."
}
