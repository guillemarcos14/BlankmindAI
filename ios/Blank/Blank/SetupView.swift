import FamilyControls
import Foundation
import SwiftUI
import UIKit
import UserNotifications

private enum OnboardingStep: Int {
    case phone
    case device

    var analyticsName: String {
        switch self {
        case .phone: return "phone_verification"
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

    @State private var currentStep: OnboardingStep = .phone
    @State private var showingPicker = false
    @State private var completionInFlight = false
    @State private var notificationReady = false
    @State private var notificationDenied = false
    @State private var message: String?

    @AppStorage("blankOnboardingStepRaw", store: BlankSharedState.defaults) private var savedStepRaw = 0
    @AppStorage("blankOnboardingFlowVersion", store: BlankSharedState.defaults) private var onboardingFlowVersion = 0
    @AppStorage("blankOnboardingAnonymousUserId", store: BlankSharedState.defaults) private var onboardingAnonymousUserId = ""
    @AppStorage("blankAssistantPhoneNumber", store: BlankSharedState.defaults) private var assistantPhoneNumber = ""
    @AppStorage("blankAssistantConnectCode", store: BlankSharedState.defaults) private var assistantConnectCode = ""
    @AppStorage("blankAssistantPhoneVerified", store: BlankSharedState.defaults) private var assistantPhoneVerified = false

    var onFinishForQA: (() -> Void)?

    init(_ onFinishForQA: (() -> Void)? = nil) {
        self.onFinishForQA = onFinishForQA
    }

    var body: some View {
        Group {
            if currentStep == .phone {
                AppPhoneSignInSheet(initialPhone: assistantPhoneNumber, showsCancel: false) {
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
        .overlay(alignment: .topTrailing) {
            Button("Home") { skipToHomeForQA() }
                .font(.blankInter(size: 13, weight: .medium, relativeTo: .caption))
                .padding(20)
                .accessibilityLabel("Skip onboarding and open Home")
        }
        #endif
        .task {
            if onboardingFlowVersion != 4 {
                savedStepRaw = assistantPhoneVerified ? OnboardingStep.device.rawValue : OnboardingStep.phone.rawValue
                onboardingFlowVersion = 4
            }
            if !sessionStore.setupComplete, let savedStep = OnboardingStep(rawValue: savedStepRaw) {
                currentStep = assistantPhoneVerified ? savedStep : .phone
            }
            if currentStep == .phone && assistantPhoneVerified && !assistantConnectCode.isEmpty {
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
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("blank")
                    .font(.blankInter(size: 18, weight: .semibold, relativeTo: .headline))
                Spacer()
                Text("2 / 2")
                    .font(.blankInter(size: 13, weight: .medium, relativeTo: .caption))
                    .foregroundStyle(.secondary)
            }
            .padding(.top, 24)
            .padding(.bottom, 44)

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    deviceContent
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            if let message {
                Text(message)
                    .font(.blankInter(size: 14, relativeTo: .footnote))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.bottom, 14)
                    .accessibilityAddTraits(.updatesFrequently)
            }

            primaryButton(completionInFlight ? "Preparing Blank…" : "Go to Home", enabled: deviceReady && !completionInFlight) {
                Task { await completeSetup() }
            }
        }
        .padding(.horizontal, 28)
        .padding(.bottom, 12)
        .foregroundStyle(Color(uiColor: .label))
        .tint(Color(uiColor: .label))
        .background(Color(uiColor: .systemBackground).ignoresSafeArea())
    }

    private var deviceContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Prepare this iPhone")
                .font(.blankInter(size: 32, weight: .semibold, relativeTo: .largeTitle))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 12)

            Text("Prepare protection on this iPhone, then talk to Blankmind directly in the app.")
                .font(.blankInter(size: 16, relativeTo: .body))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 28)

            setupRow(
                title: "Screen Time",
                detail: "Allows blocking on this iPhone.",
                ready: screenTimeBlocker.authorizationStatus == .approved,
                actionTitle: screenTimeBlocker.authorizationStatus == .denied ? "Open Settings" : "Allow Screen Time",
                action: authorizeScreenTime
            )
            setupRow(
                title: "Apps and websites",
                detail: sessionStore.hasSelectedApps
                    ? "\(sessionStore.selectionCount) selected for future blocks."
                    : "Choose apps for one reusable protection list.",
                ready: sessionStore.hasSelectedApps,
                actionTitle: sessionStore.hasSelectedApps ? "Edit selection" : "Choose apps",
                showActionWhenReady: true
            ) {
                if screenTimeBlocker.authorizationStatus == .approved {
                    showingPicker = true
                } else {
                    message = "Allow Screen Time before choosing apps."
                }
            }
            setupRow(
                title: "Notifications",
                detail: "Tap an alert to apply a block from chat.",
                ready: notificationReady,
                actionTitle: notificationDenied ? "Open Settings" : "Enable notifications",
                action: requestNotifications
            )

            Button("Change phone number") {
                message = nil
                currentStep = .phone
            }
            .font(.blankInter(size: 14, weight: .medium, relativeTo: .footnote))
            .frame(minHeight: 44)
            .padding(.top, 14)
        }
    }

    private func setupRow(
        title: String,
        detail: String,
        ready: Bool,
        actionTitle: String,
        showActionWhenReady: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(title)
                    .font(.blankInter(size: 17, weight: .semibold, relativeTo: .headline))
                Spacer(minLength: 8)
                Text(ready ? "Ready" : "Needed")
                    .font(.blankInter(size: 13, weight: .medium, relativeTo: .caption))
                    .foregroundStyle(ready ? Color(uiColor: .label) : Color(uiColor: .secondaryLabel))
            }
            Text(detail)
                .font(.blankInter(size: 14, relativeTo: .subheadline))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if !ready || showActionWhenReady {
                Button(actionTitle, action: action)
                    .font(.blankInter(size: 15, weight: .medium, relativeTo: .body))
                    .frame(minHeight: 44)
                    .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 17)
        .overlay(alignment: .bottom) { Divider() }
    }

    private func primaryButton(_ title: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.blankInter(size: 16, weight: .semibold, relativeTo: .headline))
                .frame(maxWidth: .infinity, minHeight: 54)
                .foregroundStyle(Color(uiColor: .systemBackground))
                .background(Color(uiColor: .label), in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.42)
        .padding(.bottom, 4)
    }

    private var deviceReady: Bool {
        assistantPhoneVerified && !assistantPhoneNumber.isEmpty && !assistantConnectCode.isEmpty
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
            try await AssistantAppClient().activate()
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
                channel: "app", phoneNumber: assistantPhoneNumber
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
            savedStepRaw = OnboardingStep.phone.rawValue
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
            phoneNumber: assistantPhoneNumber,
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
        guard let rawBase = Bundle.main.object(forInfoDictionaryKey: "BlankMembershipAPIBaseURL") as? String,
              !rawBase.contains("$("), let baseURL = URL(string: rawBase) else { throw URLError(.badURL) }
        var request = URLRequest(url: baseURL.appendingPathComponent("assistant-channel"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 12
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "action": action,
            "connect_code": assistantConnectCode,
            "preferred_channel": "app",
            "user_phone": assistantPhoneNumber,
            "app_install_id": BlankSharedState.appInstallId,
        ])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
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
        ["flow_version": 4,
         "channel": "app",
         "screen_time_status": screenTimeBlocker.authorizationStatusLabel,
         "selection_count": sessionStore.selectionCount]
    }

    private func skipToHomeForQA() {
        message = nil
        sessionStore.finishSetup()
        onFinishForQA?()
    }
}
