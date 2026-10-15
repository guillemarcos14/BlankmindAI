import FamilyControls
import Foundation
import SwiftUI
import UIKit
import UserNotifications

private enum OnboardingStep: Int {
    case account
    case device

    var analyticsName: String {
        switch self {
        case .account: return "account_sign_in"
        case .device: return "device_setup"
        }
    }
}

struct SetupView: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @EnvironmentObject private var screenTimeBlocker: ScreenTimeBlocker
    @EnvironmentObject private var purchaseStore: StoreKitPurchaseStore
    @ObservedObject private var healthKitStore: HealthKitStore
    @State private var showingHealthHelp = false
    @State private var showingSampleSleepConfirmation = false
    @AppStorage("blankHealthOnboardingVersion", store: BlankSharedState.defaults) private var healthOnboardingVersion = 0
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @State private var currentStep: OnboardingStep = .account
    @State private var completionInFlight = false
    @State private var completionTask: Task<Void, Never>?
    @State private var automaticCompletionAttempted = false
    @State private var notificationReady = false
    @State private var message: String?

    @AppStorage("blankOnboardingStepRaw", store: BlankSharedState.defaults) private var savedStepRaw = 0
    @AppStorage("blankOnboardingFlowVersion", store: BlankSharedState.defaults) private var onboardingFlowVersion = 0
    @AppStorage("blankOnboardingAnonymousUserId", store: BlankSharedState.defaults) private var onboardingAnonymousUserId = ""
    @AppStorage("blankAssistantConnectCode", store: BlankSharedState.defaults) private var assistantConnectCode = ""

    var onFinishForQA: (() -> Void)?

    init(healthKitStore: HealthKitStore = HealthKitStore.shared, _ onFinishForQA: (() -> Void)? = nil) {
        self.healthKitStore = healthKitStore
        self.onFinishForQA = onFinishForQA
        #if DEBUG && targetEnvironment(simulator)
        _currentStep = State(initialValue: AssistantAppPreview.scenario.hasPrefix("product-onboarding-device") ? .device : .account)
        if AssistantAppPreview.scenario == "product-onboarding-device-empty" {
            healthKitStore.setPreviewSleepAccess(.noData)
        }
        if AssistantAppPreview.scenario == "product-onboarding-device-error" {
            healthKitStore.setPreviewSleepAccess(.failed("Fixture"))
        }
        #endif
    }

    var body: some View {
        Group {
            if currentStep == .account {
                AppAccountSignInSheet(showsCancel: false) {
                    message = nil
                    currentStep = .device
                }
                .environmentObject(sessionStore)
            } else {
                functionalStep
            }
        }
        .statusBarHidden(true)
        .blankBackSwipe(enabled: !completionInFlight) {
            if currentStep == .device { currentStep = .account; message = nil }
            else { dismiss() }
        }
        .sheet(isPresented: $showingHealthHelp) {
            NavigationStack {
                ScrollView {
                    Text("Open Health → your profile → Apps → Blankmind and enable Sleep reading. If it is already enabled, check Health → Sleep for recorded sleep. Then return and tap Check again.")
                        .font(.blankBody).padding(24)
                }
                .navigationTitle("Health access")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showingHealthHelp = false } } }
            }
            .blankBackSwipe { showingHealthHelp = false }
        }
        #if targetEnvironment(simulator)
        .overlay(alignment: .topLeading) {
          GeometryReader { proxy in
            HStack(spacing: 20) {
                Button(currentStep == .account ? "Next" : "Back") {
                    currentStep = currentStep == .account ? .device : .account
                    message = nil
                }
                .font(.blankInter(size: 13, weight: .medium, relativeTo: .caption))
                .frame(minWidth: 44, minHeight: 44)
                .accessibilityLabel(currentStep == .account ? "Preview device setup" : "Preview account sign-in")
                Button("Home") { onFinishForQA?() }
                    .font(.blankInter(size: 13, weight: .medium, relativeTo: .caption))
                    .frame(minWidth: 44, minHeight: 44)
                    .accessibilityLabel("Preview Home")
            }
            .buttonStyle(.plain)
            .foregroundStyle(MinimalHomeDesign.ink)
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .padding(.horizontal, 20)
            .padding(.top, max(proxy.safeAreaInsets.top,
                UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
                    .flatMap(\.windows).first(where: \.isKeyWindow)?.safeAreaInsets.top ?? 0) + 8)
          }
        }
        #endif
        .task {
            #if DEBUG && targetEnvironment(simulator)
            if AssistantAppPreview.scenario.hasPrefix("product-onboarding") { return }
            #endif
            if onboardingFlowVersion != 6 {
                savedStepRaw = OnboardingStep.account.rawValue
                onboardingFlowVersion = 6
            }
            if !AssistantAppSession.hasAppleIdentity || AssistantAppSession.userID == nil || assistantConnectCode.isEmpty {
                currentStep = .account
            } else {
                currentStep = .device
            }
            await refreshDeviceState()
            startAutomaticCompletion()
            BlankFunnelAnalytics.trackStepOnce(currentStep.analyticsName, properties: analyticsProperties)
            await BlankFunnelAnalytics.track("onboarding_started", step: currentStep.analyticsName)
        }
        .onChange(of: scenePhase) { phase in
            guard phase == .active else { return }
            Task {
                await refreshDeviceState()
            }
        }
        .onChange(of: currentStep) { step in
            savedStepRaw = step.rawValue
            BlankFunnelAnalytics.trackStepOnce(step.analyticsName, properties: analyticsProperties)
        }
        .onChange(of: canAutomaticallyComplete) { ready in
            if ready { startAutomaticCompletion() }
        }
        .onDisappear {
            completionTask?.cancel()
            completionTask = nil
        }
        .onChange(of: deviceReady) { ready in
            if !ready { automaticCompletionAttempted = false }
        }
        .alert("Use sample sleep data?", isPresented: $showingSampleSleepConfirmation) {
            Button("Use sample data") { healthKitStore.setSampleSleepEnabled(true) }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This creates fictional sleep nights on this iPhone so you can explore rest features without recorded sleep. It does not write to Apple Health. AI still requires your separate permission to share with OpenAI and ElevenLabs. Turn it off in Control > Data & Permissions > Sample sleep.")
        }

    }

    @MainActor
    private func startAutomaticCompletion() {
        #if DEBUG && targetEnvironment(simulator)
        if AssistantAppPreview.scenario == "product-onboarding-device-sample" { return }
        #endif
        guard canAutomaticallyComplete, !automaticCompletionAttempted else { return }
        automaticCompletionAttempted = true
        startCompletion()
    }

    @MainActor
    private func startCompletion() {
        guard completionTask == nil, !completionInFlight, canAutomaticallyComplete else { return }
        // A readiness/scene update must not cancel a request started by consent.
        // Only leaving setup cancels this operation; backend verification stays mandatory.
        completionTask = Task {
            await completeSetup()
            completionTask = nil
        }
    }

    private var functionalStep: some View {
        MinimalOnboardingPanel {
            deviceContent

            if completionInFlight {
                AccountJustifiedCopy(text: NSAttributedString(string: "Finishing setup..."), foregroundColor: UIColor(MinimalHomeDesign.ink))
                    .padding(.top, 24)
                    .accessibilityAddTraits(.updatesFrequently)
            } else if let message {
                AccountJustifiedCopy(text: NSAttributedString(string: message), foregroundColor: UIColor(MinimalHomeDesign.ink))
                    .padding(.top, 24)
                    .accessibilityAddTraits(.updatesFrequently)
                if deviceReady && automaticCompletionAttempted {
                    Button { startCompletion() } label: {
                        HStack { Text("Retry"); Spacer(minLength: 8) }
                    }
                    .buttonStyle(OnboardingButtonStyle())
                }
            }
        }
    }


    private var deviceContent: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text("Let's get ready")
                .font(.blankOnboardingEditorial(size: 32, relativeTo: .title))
                .tracking(-0.9).fixedSize(horizontal: false, vertical: true)
            if !needsSleepRecovery && !healthKitStore.syntheticSleepEnabled {
                Text("Screen Time protects your distractions. Use Apple Health sleep records or explore with sample sleep if you do not have an Apple Watch.")
                    .font(.blankBody).fixedSize(horizontal: false, vertical: true)
            }
            VStack(spacing: 12) {
                permissionButton(title: "Allow Screen Time",
                    ready: screenTimeBlocker.hasAuthorization, action: authorizeScreenTime)
                permissionButton(title: "Connect Apple Health",
                    ready: !healthKitStore.syntheticSleepEnabled && healthKitStore.sleepAccess.hasData, action: healthKitStore.requestAccess)
                    .disabled(healthKitStore.state == .requesting || healthKitStore.sleepCheckInFlight)
            }
            if healthKitStore.canUseSampleSleep {
                Button(healthKitStore.sampleSleepEnabled ? "Use measured sleep" : "Explore with sample sleep") {
                    if healthKitStore.sampleSleepEnabled { healthKitStore.setSampleSleepEnabled(false) }
                    else { showingSampleSleepConfirmation = true }
                }
                .buttonStyle(OnboardingButtonStyle())
                .accessibilityIdentifier("onboarding-sample-sleep")
                Text(healthKitStore.sampleSleepEnabled ? "Sample sleep is active. These nights are fictional, not measured health data." : "No sleep records yet? Explore rest features using clearly labelled sample nights.")
                    .font(.blankInter(size: 13, relativeTo: .caption))
                    .fixedSize(horizontal: false, vertical: true)
            }
            if healthKitStore.sampleSleepEnabled {
                Text("Sample nights are ready. Apple Health and Apple Watch are not required for this exploration.")
                    .font(.blankBody).accessibilityIdentifier("onboarding-sample-ready")
            } else if healthKitStore.sleepCheckInFlight || healthKitStore.state == .requesting {
                Text("Checking available records…")
                    .font(.blankBody).accessibilityAddTraits(.updatesFrequently)
            } else if healthKitStore.sleepAccess == .noData {
                Text("No sleep records are available yet. Explore with sample sleep without an Apple Watch, or review Apple Health access for measured records.")
                    .font(.blankBody).fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("onboarding-sleep-empty")
                recoveryButtons
            } else if case .failed = healthKitStore.sleepAccess {
                Text("We couldn't check Health. Unlock your iPhone and try again. You can also review access and sleep tracking.")
                    .font(.blankBody).fixedSize(horizontal: false, vertical: true)
                recoveryButtons
            } else if healthKitStore.sleepAccess.hasData {
                Text("Sleep records are available. We'll keep gathering context to understand your patterns.")
                    .font(.blankBody).accessibilityIdentifier("onboarding-sleep-available")
            }
            if !healthKitStore.aiSharingAllowed {
                Text("To use Blankmind AI, your messages, protection history and selected sleep summaries are sent to our backend and OpenAI. For spoken replies, the response text is also sent to ElevenLabs to generate audio. This is separate from Apple Health read access. Additional Health context and phone-use data require separate optional choices in Automatic protection. Original clinical documents stay in Apple Health. Spoken replies are AI-generated.")
                    .font(.blankBody).fixedSize(horizontal: false, vertical: true)
                Link("Privacy Policy", destination: URL(string: "https://blankmind.ai/privacy")!)
                    .padding(.vertical, 12)
                Button("Allow sharing with OpenAI and ElevenLabs") { healthKitStore.enableAISharing() }
                    .buttonStyle(OnboardingButtonStyle())
                    .accessibilityIdentifier("onboarding-ai-consent")
            }
            if !completionInFlight && screenTimeBlocker.hasAuthorization {
                if deviceReady && healthKitStore.aiSharingAllowed {
                    Button("Continue with Blankmind") { startCompletion() }
                        .buttonStyle(OnboardingButtonStyle())
                        .accessibilityIdentifier("onboarding-continue-blankmind")
                }
                Button("Continue with basic blocking") {
                    healthOnboardingVersion = 6
                    sessionStore.finishSetup()
                    onFinishForQA?()
                }
                .buttonStyle(OnboardingButtonStyle())
                .accessibilityIdentifier("onboarding-basic-blocking")
                Text("Blocking and unlocking are available without sleep data. Rest features use measured records or explicitly selected sample sleep.")
                    .font(.blankInter(size: 13, relativeTo: .caption)).padding(.top, 12)
            }
            if healthKitStore.canUseSyntheticSleep {
                Button(healthKitStore.syntheticSleepEnabled ? "Use Apple Health sleep" : "Use synthetic sleep") {
                    healthKitStore.setSyntheticSleepEnabled(!healthKitStore.syntheticSleepEnabled)
                }
                .buttonStyle(OnboardingButtonStyle())
                .accessibilityIdentifier("onboarding-synthetic-demo")
                Text("Only sleep is synthetic. Blankmind, protection and activity remain real.")
                    .font(.blankInter(size: 13, relativeTo: .caption))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .foregroundStyle(MinimalHomeDesign.ink)
        .frame(maxWidth: .infinity, alignment: .leading)
        .disabled(completionInFlight)
    }

    private var recoveryButtons: some View {
        VStack(spacing: 12) {
            permissionButton(title: "Review access", ready: false) { showingHealthHelp = true }
            permissionButton(title: "Set up sleep tracking", ready: false) {
                if let url = URL(string: "https://support.apple.com/108906") { openURL(url) }
            }
            permissionButton(title: "Check again", ready: false) { healthKitStore.verifySleepAccess() }
        }
    }

    private func permissionButton(
        title: String,
        ready: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Text(title)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                if ready {
                    Image(systemName: "checkmark")
                        .font(.body.weight(.medium))
                        .scaleEffect(0.65)
                        .accessibilityHidden(true)
                }
            }
        }
        .buttonStyle(OnboardingButtonStyle(completed: ready))
        .disabled(ready)
        .accessibilityLabel(title)
        .accessibilityValue(ready ? "Completed" : "Not completed")
    }
    private var needsSleepRecovery: Bool {
        switch healthKitStore.sleepAccess {
        case .noData, .failed: return true
        default: return false
        }
    }

    private var canAutomaticallyComplete: Bool {
        currentStep == .device && deviceReady && healthKitStore.aiSharingAllowed
            && scenePhase == .active
    }

    private var deviceReady: Bool {
        !assistantConnectCode.isEmpty && SleepAccessPolicy.canEnterBasic(screenTimeApproved: screenTimeBlocker.hasAuthorization)
    }

    private func authorizeScreenTime() {
        if screenTimeBlocker.authorizationStatus == .denied {
            openSettings()
            return
        }
        Task {
            let granted = await screenTimeBlocker.requestAuthorization()
            await BlankFunnelAnalytics.track(
                "screen_time_permission_result",
                step: currentStep.analyticsName,
                properties: ["status": screenTimeBlocker.authorizationStatusLabel, "granted": granted]
            )
            message = granted ? nil : (screenTimeBlocker.lastErrorMessage ?? "Screen Time is still pending. Try again in Settings.")
        }
    }

    private func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        openURL(url)
    }

    private func refreshDeviceState() async {
        await screenTimeBlocker.refreshAuthorizationStatusUntilSettled()
        await refreshNotificationStatus()
        healthKitStore.verifySleepAccess()
    }

    private func refreshNotificationStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            notificationReady = settings.alertSetting == .enabled
                || settings.notificationCenterSetting == .enabled
                || settings.lockScreenSetting == .enabled
        case .denied, .notDetermined:
            notificationReady = false
        @unknown default:
            notificationReady = false
        }
    }

    @MainActor
    private func completeSetup() async {
        guard !completionInFlight else { return }
        let setupOwner = AssistantAppSession.userID
        completionInFlight = true
        message = nil
        defer { completionInFlight = false }
        do {
            await refreshDeviceState()
            try Task.checkCancellation()
            guard deviceReady && healthKitStore.aiSharingAllowed else {
                message = "Allow Screen Time and AI sharing to continue. Sleep data is optional."
                return
            }
            guard let setupOwner, setupOwner == AssistantAppSession.userID else {
                throw AssistantAppError.authenticationRequired
            }
            let activatedCode = try await AssistantAppClient().activate()
            try Task.checkCancellation()
            guard setupOwner == AssistantAppSession.userID else { return }
            guard await syncAssistantContext(deviceReady: false, connectCode: activatedCode) else {
                try Task.checkCancellation()
                message = "Could not save this iPhone's setup. Try again."
                return
            }
            try Task.checkCancellation()
            guard setupOwner == AssistantAppSession.userID else { return }
            let completed = try await postAssistantChannel("complete_onboarding", connectCode: activatedCode)
            try Task.checkCancellation()
            guard setupOwner == AssistantAppSession.userID else { return }
            guard completed["ready"] as? Bool == true else {
                message = "Blankmind is still checking this iPhone. Try again in a moment."
                return
            }
            savedStepRaw = OnboardingStep.account.rawValue
            await purchaseStore.registerReferredActivation(referredUserId: currentAnonymousUserId())
            guard deviceReady, AssistantAppSession.userID == setupOwner else { return }
            healthKitStore.completeRestSetup(owner: setupOwner)
            BlankSharedState.defaults.removeObject(forKey: "blankRestSetupLastError")
            healthOnboardingVersion = 6
            sessionStore.finishSetup()
            onFinishForQA?()
        } catch is CancellationError {
            automaticCompletionAttempted = false
        } catch let error as AssistantAppError {
            guard setupOwner == AssistantAppSession.userID else { return }
            message = error.localizedDescription
            BlankSharedState.defaults.set(error.code, forKey: "blankRestSetupLastError")
        } catch {
            guard !Task.isCancelled, setupOwner == AssistantAppSession.userID else { return }
            message = "Could not prepare Blankmind. Tap Continue with Blankmind to try again."
        }
    }

    @MainActor
    private func syncAssistantContext(deviceReady: Bool, connectCode: String) async -> Bool {
        await AssistantContextSyncClient().sync(
            connectCode: connectCode,
            channel: "app",
            payload: [
                "locale": Locale.current.identifier,
                "onboarding_version": 6,
                "sleep_data_available": healthKitStore.sleepDataAvailable,
                "health_signal_reasons": healthKitStore.sleepProvenance,
                "personal_profile": healthKitStore.sleepContextProfile(),
                "sleep_data_checked_at": ISO8601DateFormatter().string(from: Date()),
                "has_selected_apps": sessionStore.hasSelectedApps,
                "selection_count": sessionStore.selectionCount,
                "screen_time_authorized": screenTimeBlocker.hasAuthorization,
                "notification_authorized": notificationReady,
                "device_execution_ready": deviceReady,
                "protection_target": "selected_distractions",
                "app_presence": BlankmindAppPresence.payload(
                    appReady: sessionStore.hasSelectedApps && screenTimeBlocker.hasAuthorization
                ),
            ]
        )
    }

    @MainActor
    private func postAssistantChannel(_ action: String, connectCode: String) async throws -> [String: Any] {
        let payload = try JSONSerialization.data(withJSONObject: [
            "action": action,
            "connect_code": connectCode,
            "preferred_channel": "app",
            "app_install_id": BlankSharedState.appInstallId,
        ])
        return try await AssistantAppClient().postAuthorizedJSON(
            path: "assistant-device", payload: payload, timeout: 12
        )
    }

    private func currentAnonymousUserId() -> String {
        if !onboardingAnonymousUserId.isEmpty { return onboardingAnonymousUserId }
        let created = UUID().uuidString
        onboardingAnonymousUserId = created
        return created
    }

    private var analyticsProperties: [String: Any] {
        ["flow_version": 6,
         "channel": "app",
         "screen_time_status": screenTimeBlocker.authorizationStatusLabel,
         "selection_count": sessionStore.selectionCount]
    }

}
