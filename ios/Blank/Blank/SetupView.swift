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
    @AppStorage("blankHealthOnboardingVersion", store: BlankSharedState.defaults) private var healthOnboardingVersion = 0
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    @State private var currentStep: OnboardingStep = .account
    @State private var completionInFlight = false
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
        .sheet(isPresented: $showingHealthHelp) {
            NavigationStack {
                ScrollView {
                    Text("Open Health → your profile → Apps → Blankmind and enable Sleep reading. If it is already enabled, check Health → Sleep for recorded sleep. Then return and tap Check again.")
                        .font(.blankBody).padding(24)
                }
                .navigationTitle("Health access")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showingHealthHelp = false } } }
            }
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
            if !AssistantAppSession.hasAppleIdentity || assistantConnectCode.isEmpty {
                currentStep = .account
            } else {
                currentStep = .device
            }
            await refreshDeviceState()
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
        .task(id: canAutomaticallyComplete) {
            guard canAutomaticallyComplete, !automaticCompletionAttempted else { return }
            automaticCompletionAttempted = true
            await completeSetup()
        }
        .onChange(of: deviceReady) { ready in
            if !ready { automaticCompletionAttempted = false }
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
                    Button { Task { await completeSetup() } } label: {
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
            if !needsSleepRecovery {
                Text("I need two connections to support you: Screen Time to protect you from distractions, and Health to understand your sleep alongside activity and physical signals.")
                    .font(.blankBody).fixedSize(horizontal: false, vertical: true)
            }
            VStack(spacing: 12) {
                permissionButton(title: "Allow Screen Time",
                    ready: screenTimeBlocker.authorizationStatus == .approved, action: authorizeScreenTime)
                permissionButton(title: "Connect Apple Health",
                    ready: healthKitStore.sleepAccess.hasData, action: healthKitStore.requestAccess)
                    .disabled(healthKitStore.state == .requesting || healthKitStore.sleepCheckInFlight)
            }
            if healthKitStore.sleepCheckInFlight || healthKitStore.state == .requesting {
                Text("Checking available records…")
                    .font(.blankBody).accessibilityAddTraits(.updatesFrequently)
            } else if healthKitStore.sleepAccess == .noData {
                Text("I can't read sleep records yet. Check access and sleep tracking. If you're starting today, wear your watch overnight and return when records appear in Health.")
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
        currentStep == .device && deviceReady
            && scenePhase == .active
    }

    private var deviceReady: Bool {
        !assistantConnectCode.isEmpty && SleepAccessPolicy.canEnter(
            screenTimeApproved: screenTimeBlocker.authorizationStatus == .approved,
            sleep: healthKitStore.onboardingSleepAccess)
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
        await refreshDeviceState()
        guard deviceReady else {
            message = "Allow Screen Time and connect sleep records to continue."
            return
        }
        do {
            _ = try await AssistantAppClient().activate()
            guard setupOwner == AssistantAppSession.userID else { return }
            guard await syncAssistantContext(deviceReady: false) else {
                message = "Could not save this iPhone's setup. Try again."
                return
            }
            guard setupOwner == AssistantAppSession.userID else { return }
            let completed = try await postAssistantChannel("complete_onboarding")
            guard setupOwner == AssistantAppSession.userID else { return }
            guard completed["ready"] as? Bool == true else {
                message = "Blankmind is still checking this iPhone. Try again in a moment."
                return
            }
            savedStepRaw = OnboardingStep.account.rawValue
            await purchaseStore.registerReferredActivation(referredUserId: currentAnonymousUserId())
            guard deviceReady, AssistantAppSession.userID == setupOwner else { return }
            healthOnboardingVersion = 6
            sessionStore.finishSetup()
            onFinishForQA?()
        } catch {
            message = "Could not prepare Blankmind on this iPhone. Try again."
        }
    }

    @MainActor
    private func syncAssistantContext(deviceReady: Bool) async -> Bool {
        await AssistantContextSyncClient().sync(
            connectCode: assistantConnectCode,
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
                "screen_time_authorized": screenTimeBlocker.authorizationStatus == .approved,
                "notification_authorized": notificationReady,
                "device_execution_ready": deviceReady,
                "protection_target": "selected_distractions",
                "app_presence": BlankmindAppPresence.payload(
                    appReady: sessionStore.hasSelectedApps && screenTimeBlocker.authorizationStatus == .approved
                ),
            ]
        )
    }

    @MainActor
    private func postAssistantChannel(_ action: String) async throws -> [String: Any] {
        let payload = try JSONSerialization.data(withJSONObject: [
            "action": action,
            "connect_code": assistantConnectCode,
            "preferred_channel": "app",
            "app_install_id": BlankSharedState.appInstallId,
        ])
        let (data, response) = try await AssistantAppClient().postAuthorized(
            path: "assistant-channel", payload: payload, timeout: 12
        )
        guard (200..<300).contains(response.statusCode),
              let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw URLError(.badServerResponse)
        }
        return result
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
