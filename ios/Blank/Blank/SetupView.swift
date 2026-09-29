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
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL

    @State private var currentStep: OnboardingStep = .account
    @State private var showingPicker = false
    @State private var completionInFlight = false
    @State private var notificationReady = false
    @State private var notificationDenied = false
    @State private var message: String?

    @AppStorage("blankOnboardingStepRaw", store: BlankSharedState.defaults) private var savedStepRaw = 0
    @AppStorage("blankOnboardingFlowVersion", store: BlankSharedState.defaults) private var onboardingFlowVersion = 0
    @AppStorage("blankOnboardingAnonymousUserId", store: BlankSharedState.defaults) private var onboardingAnonymousUserId = ""
    @AppStorage("blankAssistantConnectCode", store: BlankSharedState.defaults) private var assistantConnectCode = ""

    var onFinishForQA: (() -> Void)?

    init(_ onFinishForQA: (() -> Void)? = nil) {
        self.onFinishForQA = onFinishForQA
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
        .familyActivityPicker(isPresented: $showingPicker, selection: $sessionStore.selection)
        #if targetEnvironment(simulator)
        .overlay(alignment: .topLeading) {
            Button(currentStep == .account ? "Next" : "Back") {
                currentStep = currentStep == .account ? .device : .account
                message = nil
            }
            .font(.blankInter(size: 13, weight: .medium, relativeTo: .caption))
            .padding(20)
            .accessibilityLabel(currentStep == .account ? "Preview device setup" : "Preview account sign-in")
        }
        #endif
        .task {
            if onboardingFlowVersion != 5 {
                savedStepRaw = OnboardingStep.account.rawValue
                onboardingFlowVersion = 5
            }
            if !AssistantAppSession.hasAppleIdentity || assistantConnectCode.isEmpty {
                currentStep = .account
            } else if !sessionStore.setupComplete {
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
        .onChange(of: sessionStore.selection) { selection in
            screenTimeBlocker.updateSelection(selection, isBlankActive: sessionStore.isBlankActive)
            if sessionStore.hasSelectedApps { message = nil }
            Task {
                await BlankFunnelAnalytics.track(
                    "apps_selection_updated",
                    step: currentStep.analyticsName,
                    properties: ["selection_count": sessionStore.selectionCount,
                                 "has_selected_apps": sessionStore.hasSelectedApps]
                )
            }
        }
    }

    private var functionalStep: some View {
        GeometryReader { geometry in
            ScrollView(showsIndicators: false) {
                VStack(alignment: .center, spacing: 0) {
                    deviceContent

                    if let message {
                        Text(message)
                            .font(.blankInter(size: 14, relativeTo: .footnote))
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .center)
                            .multilineTextAlignment(.center)
                            .padding(.bottom, 14)
                            .accessibilityAddTraits(.updatesFrequently)
                    }

                    primaryButton(completionInFlight ? "Preparing…" : "Go to Home", enabled: deviceReady && !completionInFlight) {
                        Task { await completeSetup() }
                    }
                    .padding(.top, 24)
                }
                .padding(.horizontal, 28)
                .padding(.vertical, 24)
                .frame(minHeight: geometry.size.height, alignment: .center)
            }
        }
        .foregroundStyle(BlankColors.charcoal)
        .tint(BlankColors.charcoal)
        .background(BlankColors.pureWhite.ignoresSafeArea())
    }

    private var deviceContent: some View {
        VStack(alignment: .center, spacing: 0) {
            Text("Prepare this iPhone")
                .font(.blankEditorial(size: 32))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 28)

            VStack(spacing: 12) {
                setupCard(
                    title: "Screen Time",
                    detail: "Block distracting apps on this iPhone.",
                    ready: screenTimeBlocker.authorizationStatus == .approved,
                    actionTitle: screenTimeBlocker.authorizationStatus == .denied ? "Open Settings" : "Allow Screen Time",
                    action: authorizeScreenTime
                )
                setupCard(
                    title: "Apps and websites",
                    detail: sessionStore.hasSelectedApps
                        ? "\(sessionStore.selectionCount) selected."
                        : "Choose apps for one reusable protection list.",
                    ready: sessionStore.hasSelectedApps,
                    actionTitle: sessionStore.hasSelectedApps ? "Edit apps" : "Choose apps",
                    showActionWhenReady: true
                ) {
                    if screenTimeBlocker.authorizationStatus == .approved {
                        showingPicker = true
                    } else {
                        message = "Allow Screen Time before choosing apps."
                    }
                }
                setupCard(
                    title: "Notifications",
                    detail: "Get alerts to apply blocks from chat.",
                    ready: notificationReady,
                    actionTitle: notificationDenied ? "Open Settings" : "Enable notifications",
                    action: requestNotifications
                )
            }
        }
    }

    private func setupCard(
        title: String,
        detail: String,
        ready: Bool,
        actionTitle: String,
        showActionWhenReady: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text(title)
                    .font(.blankInter(size: 17, weight: .semibold, relativeTo: .headline))
                Spacer(minLength: 8)
                if ready {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18, weight: .medium))
                        .accessibilityLabel("Completed")
                }
            }
            Text(detail)
                .font(.blankInter(size: 14, relativeTo: .subheadline))
                .foregroundStyle(.white.opacity(0.78))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 6)

            if !ready || showActionWhenReady {
                Button(action: action) {
                    Text(actionTitle)
                        .font(.blankInter(size: 15, weight: .semibold, relativeTo: .body))
                        .foregroundStyle(.black)
                        .frame(maxWidth: .infinity, minHeight: 46)
                        .background(.white, in: RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
                .padding(.top, 18)
            }
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(.black, in: RoundedRectangle(cornerRadius: 16))
    }

    private func primaryButton(_ title: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.blankInter(size: 16, weight: .semibold, relativeTo: .headline))
                .frame(maxWidth: .infinity, minHeight: 54)
                .foregroundStyle(enabled ? Color.white : BlankColors.stoneGray)
                .background(enabled ? Color.black : Color(uiColor: .systemGray5), in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .padding(.bottom, 4)
    }

    private var deviceReady: Bool {
        !assistantConnectCode.isEmpty
            && screenTimeBlocker.authorizationStatus == .approved
            && sessionStore.hasSelectedApps && notificationReady
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

    private func requestNotifications() {
        if notificationDenied {
            openSettings()
            return
        }
        Task {
            let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])) ?? false
            await refreshNotificationStatus()
            if notificationReady { UIApplication.shared.registerForRemoteNotifications() }
            await BlankFunnelAnalytics.track(
                "notifications_permission_result",
                step: currentStep.analyticsName,
                properties: ["granted": granted, "ready": notificationReady]
            )
            message = notificationReady ? nil : "Enable alerts in iPhone Settings to receive block requests."
        }
    }

    private func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        openURL(url)
    }

    private func refreshDeviceState() async {
        await screenTimeBlocker.refreshAuthorizationStatusUntilSettled()
        await refreshNotificationStatus()
    }

    private func refreshNotificationStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        notificationDenied = settings.authorizationStatus == .denied
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
        await refreshDeviceState()
        guard deviceReady else {
            message = "Finish the three iPhone settings before continuing."
            return
        }
        completionInFlight = true
        defer { completionInFlight = false }
        do {
            _ = try await AssistantAppClient().activate()
            guard await syncAssistantContext(deviceReady: false) else {
                message = "Could not save this iPhone's setup. Try again."
                return
            }
            UIApplication.shared.registerForRemoteNotifications()
            var token = BlankSharedState.defaults.string(forKey: "blankAssistantPushToken") ?? ""
            for _ in 0..<5 where token.isEmpty {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                token = BlankSharedState.defaults.string(forKey: "blankAssistantPushToken") ?? ""
            }
            guard !token.isEmpty else {
                message = "Waiting for iPhone notifications. Try again in a moment."
                return
            }
            #if DEBUG
            let environment = "sandbox"
            #else
            let environment = "production"
            #endif
            guard await AssistantActionInboxClient().registerDevicePush(
                token: token, environment: environment, connectCode: assistantConnectCode,
                channel: "app"
            ) else {
                message = "This iPhone could not register for notifications. Try again."
                return
            }
            BlankSharedState.defaults.set(true, forKey: "blankAssistantPushRegistered")
            guard await syncAssistantContext(deviceReady: true) else {
                message = "Could not sync this iPhone. Try again."
                return
            }
            let completed = try await postAssistantChannel("complete_onboarding")
            guard completed["ready"] as? Bool == true else {
                message = "Blankmind is still checking this iPhone. Try again in a moment."
                return
            }
            savedStepRaw = OnboardingStep.account.rawValue
            await purchaseStore.registerReferredActivation(referredUserId: currentAnonymousUserId())
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
        ["flow_version": 5,
         "channel": "app",
         "screen_time_status": screenTimeBlocker.authorizationStatusLabel,
         "selection_count": sessionStore.selectionCount]
    }

}
