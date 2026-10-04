import FamilyControls
import AuthenticationServices
import CryptoKit
import LocalAuthentication
import SwiftUI
import UIKit
import UserNotifications

enum HomeSection: Hashable {
    case distractions
    case schedule
    case report
    case emergency
    case settings
}

struct UnblankHoldCadence {
    static func pulseTimes(duration: Double) -> [Double] {
        guard duration.isFinite, duration > 0 else { return [] }
        var pulses = [0.0]
        var elapsed = 0.0
        while elapsed + 1 < duration {
            elapsed += 1
            pulses.append(elapsed)
        }
        return pulses
    }
}

struct AssistantInboxResponse: Decodable {
    let pendingAction: AssistantInboxAction?

    enum CodingKeys: String, CodingKey {
        case pendingAction = "pending_action"
    }
}

private struct AssistantAcknowledgementResponse: Decodable {
    let acknowledged: Bool
    let reason: String?
}

enum AssistantLifecycleAcknowledgement: Equatable {
    case acknowledged
    case stale
    case retry
}

enum AssistantInboxPollResult {
    case success(AssistantInboxAction?)
    case retry
}

private struct AssistantPushRegistrationResponse: Decodable {
    let registered: Bool
}


struct AssistantActionReceipt: Equatable {
    let actionId: String
    let status: String
    let detail: String
    let executionStarted: Bool
    let requestedAt: String
    let startedAt: String
    let requestedDurationMinutes: Int?
    let effectiveUntil: String
    let origin: String
    let result: String
    let startDelaySeconds: Int?
    let mergedWithExisting: Bool

    init(
        actionId: String,
        status: String,
        detail: String,
        executionStarted: Bool,
        requestedAt: String = "",
        startedAt: String = "",
        requestedDurationMinutes: Int? = nil,
        effectiveUntil: String = "",
        origin: String = "",
        result: String = "",
        startDelaySeconds: Int? = nil,
        mergedWithExisting: Bool = false
    ) {
        self.actionId = actionId
        self.status = status
        self.detail = detail
        self.executionStarted = executionStarted
        self.requestedAt = requestedAt
        self.startedAt = startedAt
        self.requestedDurationMinutes = requestedDurationMinutes
        self.effectiveUntil = effectiveUntil
        self.origin = origin
        self.result = result
        self.startDelaySeconds = startDelaySeconds
        self.mergedWithExisting = mergedWithExisting
    }

}

enum AssistantActionReceiptStore {
    private static let ownerKey = "blankBMBReceiptOwner"
    private static let actionIdKey = "blankAssistantReceiptActionId"
    private static let statusKey = "blankAssistantReceiptStatus"
    private static let detailKey = "blankAssistantReceiptDetail"
    private static let executionStartedKey = "blankAssistantReceiptExecutionStarted"
    private static let evidenceKey = "blankAssistantReceiptEvidence"

    static func load(defaults: UserDefaults = BlankSharedState.defaults) -> AssistantActionReceipt? {
        guard let actionId = defaults.string(forKey: actionIdKey), !actionId.isEmpty,
              let status = defaults.string(forKey: statusKey), !status.isEmpty else { return nil }
        if actionId.hasPrefix("bmb_"), defaults.string(forKey:ownerKey) != AssistantAppSession.userID { return nil }
        let evidence = defaults.dictionary(forKey: evidenceKey) ?? [:]
        return AssistantActionReceipt(
            actionId: actionId,
            status: status,
            detail: defaults.string(forKey: detailKey) ?? "",
            executionStarted: defaults.bool(forKey: executionStartedKey),
            requestedAt: evidence["requested_at"] as? String ?? "",
            startedAt: evidence["started_at"] as? String ?? "",
            requestedDurationMinutes: evidence["requested_duration_minutes"] as? Int,
            effectiveUntil: evidence["effective_until"] as? String ?? "",
            origin: evidence["origin"] as? String ?? "",
            result: evidence["result"] as? String ?? "",
            startDelaySeconds: evidence["start_delay_seconds"] as? Int,
            mergedWithExisting: evidence["merged_with_existing"] as? Bool ?? false
        )
    }

    static func save(
        actionId: String,
        status: String,
        detail: String,
        executionStarted: Bool,
        requestedAt: String = "",
        startedAt: String = "",
        requestedDurationMinutes: Int? = nil,
        effectiveUntil: String = "",
        origin: String = "",
        result: String = "",
        startDelaySeconds: Int? = nil,
        mergedWithExisting: Bool = false,
        defaults: UserDefaults = BlankSharedState.defaults
    ) {
        defaults.set(actionId, forKey: actionIdKey)
        if actionId.hasPrefix("bmb_") { defaults.set(AssistantAppSession.userID,forKey:ownerKey) }
        defaults.set(status, forKey: statusKey)
        defaults.set(detail, forKey: detailKey)
        defaults.set(executionStarted, forKey: executionStartedKey)
        var evidence: [String: Any] = [
            "requested_at": requestedAt,
            "started_at": startedAt,
            "effective_until": effectiveUntil,
            "origin": origin,
            "result": result,
            "merged_with_existing": mergedWithExisting,
        ]
        if let requestedDurationMinutes { evidence["requested_duration_minutes"] = requestedDurationMinutes }
        if let startDelaySeconds { evidence["start_delay_seconds"] = startDelaySeconds }
        defaults.set(evidence, forKey: evidenceKey)
    }

    static func clear(actionId: String, defaults: UserDefaults = BlankSharedState.defaults) {
        guard defaults.string(forKey: actionIdKey) == actionId else { return }
        defaults.removeObject(forKey: actionIdKey)
        defaults.removeObject(forKey: ownerKey)
        defaults.removeObject(forKey: statusKey)
        defaults.removeObject(forKey: detailKey)
        defaults.removeObject(forKey: executionStartedKey)
        defaults.removeObject(forKey: evidenceKey)
    }
}

struct AssistantActionInboxClient {
    var requestTimeout: TimeInterval = 8
    func actionForApplication(actionId: String, connectCode: String, channel: String) async throws -> AssistantInboxAction {
        let data = try await request(action: "poll_pending_action", connectCode: connectCode, channel: channel)
        let response = try JSONDecoder().decode(AssistantInboxResponse.self, from: data)
        guard let action = response.pendingAction, action.id == actionId,
              let expiresAt = action.expiresAt,
              let expiry = AssistantInboxAction.parseDate(expiresAt), expiry > Date(),
              action.toPendingAction() != nil else {
            throw AssistantAppError.server(status: 409, code: "action_unavailable")
        }
        return action
    }

    func poll(connectCode: String, channel: String) async -> AssistantInboxPollResult {
        guard let data = try? await request(action: "poll_pending_action", connectCode: connectCode, channel: channel),
              let response = try? JSONDecoder().decode(AssistantInboxResponse.self, from: data) else {
            return .retry
        }
        return .success(response.pendingAction)
    }

    func acknowledge(
        actionId: String,
        status: String,
        connectCode: String,
        channel: String,
        detail: String = "",
        evidence: AssistantActionReceipt? = nil
    ) async -> AssistantLifecycleAcknowledgement {
        guard let data = try? await request(
            action: "ack_pending_action",
            connectCode: connectCode,
            channel: channel,
            actionId: actionId,
            status: status,
            detail: detail,
            evidence: evidence
        ), let response = try? JSONDecoder().decode(AssistantAcknowledgementResponse.self, from: data) else {
            return .retry
        }
        if response.acknowledged { return .acknowledged }
        if response.reason == "action_mismatch" || response.reason == "no_pending_action" { return .stale }
        return .retry
    }

    func acknowledgeLifecycle(
        receipt: AssistantActionReceipt,
        connectCode: String,
        channel: String
    ) async -> AssistantLifecycleAcknowledgement {
        if receipt.executionStarted {
            let confirmed = await acknowledge(
                actionId: receipt.actionId,
                status: "confirmed",
                connectCode: connectCode,
                channel: channel
            )
            guard confirmed == .acknowledged else { return confirmed }
            let started = await acknowledge(
                actionId: receipt.actionId,
                status: "execution_started",
                connectCode: connectCode,
                channel: channel
            )
            guard started == .acknowledged else { return started }
        }
        return await acknowledge(
            actionId: receipt.actionId,
            status: receipt.status,
            connectCode: connectCode,
            channel: channel,
            detail: receipt.detail,
            evidence: receipt
        )
    }

    func registerDevicePush(token: String, environment: String, connectCode: String, channel: String) async -> Bool {
        guard let data = try? await request(
            action: "register_device_push",
            connectCode: connectCode,
            channel: channel,
            deviceToken: token,
            environment: environment
        ), let response = try? JSONDecoder().decode(AssistantPushRegistrationResponse.self, from: data) else { return false }
        return response.registered
    }

    private func request(
        action: String,
        connectCode: String,
        channel: String,
        actionId: String? = nil,
        status: String? = nil,
        detail: String? = nil,
        evidence: AssistantActionReceipt? = nil,
        deviceToken: String? = nil,
        environment: String? = nil
    ) async throws -> Data {
        var body: [String: Any] = [
            "action": action,
            "connect_code": connectCode,
            "preferred_channel": channel,
            "app_install_id": BlankSharedState.appInstallId,
        ]
        if let actionId { body["action_id"] = actionId }
        if let status { body["status"] = status }
        if let detail, !detail.isEmpty { body["detail"] = detail }
        if let evidence {
            body["requested_at"] = evidence.requestedAt
            body["started_at"] = evidence.startedAt
            body["requested_duration_minutes"] = evidence.requestedDurationMinutes
            body["effective_until"] = evidence.effectiveUntil
            body["origin"] = evidence.origin
            body["result"] = evidence.result
            body["start_delay_seconds"] = evidence.startDelaySeconds
            body["merged_with_existing"] = evidence.mergedWithExisting
        }
        if let deviceToken, !deviceToken.isEmpty { body["device_token"] = deviceToken }
        if let environment, !environment.isEmpty { body["environment"] = environment }
        let payload = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await AssistantAppClient().postAuthorized(
            path: "assistant-channel", payload: payload, timeout: requestTimeout
        )
        guard (200..<300).contains(response.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return data
    }
}

struct HomeView: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @EnvironmentObject private var screenTimeBlocker: ScreenTimeBlocker
    @EnvironmentObject private var purchaseStore: StoreKitPurchaseStore
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.openURL) private var openURL
    @AppStorage("blankAssistantConnectCode", store: BlankSharedState.defaults) private var assistantConnectCode = ""

    @State private var now = Date()
    @State private var message: String?
    @State private var messageAction: HomeMessageAction?
    @State private var showingPicker = false
    @State private var activeSection: HomeSection?
    @State private var showingAssistantChat = false
    @State private var chatLaunchMessage: String?
    @State private var homeChatDraft = ""
    @FocusState private var homeChatFocused: Bool
    @State private var acceptingHomeSpeech = false
    @StateObject private var homeSpeech = AssistantSpeechInput()
    @State private var assistantNotificationsAuthorized = false
    @State private var showingContextualAppPicker = false
    @State private var contextualPlanSelection = FamilyActivitySelection()
    @State private var showingRelink = false
    @State private var showingForgetConfirm = false
    @StateObject private var healthKitStore = HealthKitStore()
    @State private var unblankHoldProgress = 0.0
    @State private var unblankHapticTask: Task<Void, Never>?
    @State private var isAnimatingUnblankHold = false
    @State private var isHoldingToUnblank = false
    @State private var isActiveNavExpanded = false
    @State private var isHomeMenuOpen = false
    private var delayedManualUnlockAt: Date? { sessionStore.delayedManualUnlockAt }
    @State private var showingRelapseReview = false
    @AppStorage("blankPendingAssistantActionId", store: BlankSharedState.defaults) private var pendingAssistantActionId = ""
    @State private var assistantActionPollInFlight = false
    @State private var assistantActionExecutionInFlight = false
    @State private var lastAssistantActionPollAt = Date.distantPast
    @State private var pendingAssistantInboxAction: AssistantInboxAction?

    private let timer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
    private let homeTagline = "Your plan adapts\nbefore the scroll\npulls you back."
    let onOpenOnboardingDemo: () -> Void
    let simulatorGuest: Bool

    init(simulatorGuest: Bool = false, _ onOpenOnboardingDemo: @escaping () -> Void = {}) {
        self.simulatorGuest = simulatorGuest
        self.onOpenOnboardingDemo = onOpenOnboardingDemo
    }

    private var aiSystem: DigitalWellnessV3System {
        sessionStore.digitalWellnessV3
    }

    private var healthPermissionLabel: String {
        switch healthKitStore.state {
        case .connected:
            return "connected"
        case .requesting:
            return "requesting"
        case .unavailable:
            return "unavailable"
        case .notRequested:
            return "not connected"
        case .failed:
            return "needs attention"
        }
    }

    var body: some View {
        GeometryReader { proxy in
            let viewportWidth = proxy.size.width
            let viewportHeight = proxy.size.height
            let layout = HomeLayoutMetrics(size: CGSize(width: viewportWidth, height: viewportHeight), safeAreaInsets: proxy.safeAreaInsets)

            ZStack(alignment: .topLeading) {
                (sessionStore.isBlankActive ? BlankColors.charcoal : BlankColors.pureWhite)
                    .frame(width: viewportWidth, height: viewportHeight)
                    .ignoresSafeArea()

                if activeSection == nil {
                    minimalHome(layout: layout)
                        .frame(width: viewportWidth, height: viewportHeight, alignment: .topLeading)
                }

                homeSectionScreen(viewportWidth: viewportWidth, viewportHeight: viewportHeight)

                if showingRelapseReview {
                    RelapseReviewSheet(
                        onSelect: { reason in
                            sessionStore.recordRelapseReview(reason)
                            sessionStore.applyAIPlan()
                            Task {
                                await BlankFunnelAnalytics.track(
                                    "ai_plan_applied",
                                    properties: ["source": "relapse_review", "reason": reason.rawValue]
                                )
                            }
                            dismissRelapseReview()
                        },
                        onDismiss: dismissRelapseReview
                    )
                    .frame(width: viewportWidth, height: viewportHeight, alignment: .topLeading)
                    .transition(.opacity)
                    .zIndex(20)
                }
            }
            .frame(width: viewportWidth, height: viewportHeight, alignment: .topLeading)
        }
        .ignoresSafeArea(.container)
        .foregroundStyle(sessionStore.isBlankActive ? BlankColors.pureWhite : BlankColors.ink)
        .toolbar(.hidden, for: .navigationBar)
        .preferredColorScheme(sessionStore.isBlankActive ? .dark : .light)
        .statusBarHidden(activeSection == nil)
        .persistentSystemOverlays(activeSection == nil ? .hidden : .automatic)
        .environment(\.blankMinimalAppearance, true)
        .animation(.easeInOut(duration: reduceMotion ? 0.12 : 0.45), value: sessionStore.isBlankActive)
        .animation(.easeInOut(duration: reduceMotion ? 0.12 : 0.35), value: activeSection)
        .animation(.easeInOut(duration: reduceMotion ? 0.12 : 0.35), value: showingRelapseReview)
        .navigationBarBackButtonHidden()
        .onReceive(timer) { date in
            #if DEBUG && targetEnvironment(simulator)
            guard !PostOnboardingPreviewScene.enabled else { return }
            #endif
            now = date
            finishDelayedManualUnlock(now: date)
            pollPendingAssistantActionIfNeeded(now: date)
            sessionStore.syncFromSharedDefaults(now: date)
            sessionStore.applyScheduleWindow(at: date)
            screenTimeBlocker.apply(isBlankActive: sessionStore.isBlankActive)
            updateDelayedUnlockMessage(now: date)
        }
        .onReceive(NotificationCenter.default.publisher(for: .blankAssistantApplyNowRequested)) { _ in
            pollPendingAssistantActionIfNeeded(force: true)
        }
        .onChange(of: assistantConnectCode) { _ in
            clearPendingAssistantIdentityState()
            Task { await activateAppChannel() }
        }
        .onChange(of: homeSpeech.transcript) { transcript in
            if acceptingHomeSpeech && !transcript.isEmpty {
                acceptingHomeSpeech = false
                chatLaunchMessage = transcript
                showingAssistantChat = true
            }
        }
        .onChange(of: homeSpeech.error) { error in
            if let error { message = error }
        }
        .onAppear {
            #if DEBUG && targetEnvironment(simulator)
            isHomeMenuOpen = ["product-menu", "product-menu-active"].contains(AssistantAppPreview.scenario)
            guard !PostOnboardingPreviewScene.enabled else { return }
            #endif
            now = Date()
            finishDelayedManualUnlock(now: now)
            Task { await activateAppChannel() }
            sessionStore.syncFromSharedDefaults(now: now)
            applyScreenTimeControls()
            screenTimeBlocker.refreshAuthorizationStatus()
            healthKitStore.refresh()
            processPendingBlockConfigurationIfNeeded()
            showPendingBAIProactiveAlertIfNeeded()
            evaluateBAIProactiveSignals()
            syncAssistantContext()
            refreshAssistantNotificationAuthorization()
            pollPendingAssistantActionIfNeeded(force: true)
        }
        .onChange(of: scenePhase) { phase in
            #if DEBUG && targetEnvironment(simulator)
            guard !PostOnboardingPreviewScene.enabled else { return }
            #endif
            guard phase == .active else {
                stopUnblankHoldHaptics()
                if phase == .background {
                    acceptingHomeSpeech = false
                    homeSpeech.stop()
                }
                return
            }
            Task { await activateAppChannel() }
            now = Date()
            finishDelayedManualUnlock(now: now)
            sessionStore.syncFromSharedDefaults()
            applyScreenTimeControls()
            screenTimeBlocker.refreshAuthorizationStatus()
            healthKitStore.refresh()
            processPendingBlockConfigurationIfNeeded()
            showPendingBAIProactiveAlertIfNeeded()
            evaluateBAIProactiveSignals()
            syncAssistantContext()
            refreshAssistantNotificationAuthorization()
            pollPendingAssistantActionIfNeeded(force: true)
        }
        .onDisappear {
            stopUnblankHoldHaptics()
            acceptingHomeSpeech = false
            homeSpeech.stop()
        }
        .familyActivityPicker(isPresented: $showingPicker, selection: $sessionStore.selection)
        .onChange(of: sessionStore.canEditSelectedDistractions) { canEdit in
            if !canEdit {
                showingPicker = false
                if showingContextualAppPicker {
                    contextualPlanSelection = FamilyActivitySelection()
                    showingContextualAppPicker = false
                }
            }
        }
        .onChange(of: sessionStore.selection) { newSelection in
            screenTimeBlocker.updateSelection(newSelection, isBlankActive: sessionStore.isBlankActive)
            sessionStore.refreshDailyLimitMonitoring()
            syncAssistantContext()
        }
        .onChange(of: sessionStore.schedule) { _ in syncAssistantContext() }
        .onChange(of: sessionStore.isBlankActive) { isActive in
            if isActive {
                activeSection = nil
                isHomeMenuOpen = false
            } else {
                isActiveNavExpanded = false
                isHoldingToUnblank = false
                unblankHoldProgress = 0
                isAnimatingUnblankHold = false
                stopUnblankHoldHaptics()
            }
            syncAssistantContext()
        }
        .onChange(of: sessionStore.dailyLimitMinutes) { _ in syncAssistantContext() }
        .onChange(of: sessionStore.dailyLimitEnabled) { _ in syncAssistantContext() }
        .onChange(of: sessionStore.allowOnlyModeEnabled) { _ in
            applyScreenTimeControls()
            syncAssistantContext()
            if sessionStore.allowOnlyModeEnabled && !sessionStore.hasSelectedApps {
                showingPicker = true
            }
        }
        .onChange(of: sessionStore.adultContentBlockingEnabled) { _ in
            applyScreenTimeControls()
            syncAssistantContext()
        }
        .onChange(of: sessionStore.shouldOpenBlockConfiguration) { shouldOpen in
            guard shouldOpen else { return }
            processPendingBlockConfigurationIfNeeded()
        }
        .familyActivityPicker(
            headerText: contextualPickerHeaderText,
            footerText: contextualPickerFooterText,
            isPresented: $showingContextualAppPicker,
            selection: $contextualPlanSelection
        )
        .onChange(of: showingContextualAppPicker) { isPresented in
            if !isPresented {
                var assistantActionApplied = false
                var assistantProtectionExecution: AssistantProtectionExecution?
                screenTimeBlocker.refreshAuthorizationStatus()
                let permissionApproved = screenTimeBlocker.authorizationStatus == .approved
                let selectionConfirmed = permissionApproved && contextualPlanSelection.blankedSelectionCount > 0 && sessionStore.canEditSelectedDistractions
                if selectionConfirmed {
                    sessionStore.selection = contextualPlanSelection
                    if sessionStore.pendingPlanShouldActivate,
                       contextualPlanSelection.blankedSelectionCount > 0 {
                        if let remote = pendingAssistantInboxAction,
                           let requestedAt = remote.requestedDate,
                           let duration = remote.minutes {
                            assistantProtectionExecution = sessionStore.applyAssistantProtection(
                                actionId: remote.id,
                                requestedAt: requestedAt,
                                durationMinutes: duration,
                                hardMode: sessionStore.pendingPlanHardMode
                            )
                        } else {
                            _ = withAnimation(.easeInOut(duration: 0.65)) {
                                sessionStore.activateBlank(
                                    durationMinutes: sessionStore.pendingPlanDurationMinutes,
                                    hardMode: sessionStore.pendingPlanHardMode
                                )
                            }
                        }
                        applyScreenTimeControls()
                        activeSection = nil
                        assistantActionApplied = assistantProtectionExecution.map { ["verified", "delayed"].contains($0.status) }
                            ?? sessionStore.isBlankActive
                    } else if let dailyLimitMinutes = sessionStore.pendingPlanDailyLimitMinutes,
                              contextualPlanSelection.blankedSelectionCount > 0 {
                        sessionStore.selection = contextualPlanSelection
                        sessionStore.dailyLimitMinutes = dailyLimitMinutes
                        sessionStore.dailyLimitEnabled = true
                        sessionStore.refreshDailyLimitMonitoring()
                        applyScreenTimeControls()
                        message = sessionStore.dailyLimitRegistered ? "Daily limit set to \(dailyLimitMinutes) minutes." : "The daily limit was saved, but iOS could not activate it. Check Screen Time permission."
                        messageAction = nil
                        assistantActionApplied = sessionStore.dailyLimitRegistered && sessionStore.dailyLimitEnabled && sessionStore.dailyLimitMinutes == dailyLimitMinutes
                    } else if let schedule = sessionStore.pendingPlanSchedule,
                              contextualPlanSelection.blankedSelectionCount > 0 {
                        sessionStore.selection = contextualPlanSelection
                        sessionStore.applyAdaptivePlan(
                            startMinute: schedule.startMinute,
                            endMinute: schedule.endMinute,
                            durationDays: schedule.durationDays,
                            activateCurrentWindow: false,
                            name: schedule.name,
                            weekdays: schedule.weekdays
                        )
                        applyScreenTimeControls()
                        message = sessionStore.recurringScheduleRegistered ? "Protection schedule added for your distractions." : "The schedule was saved, but iOS could not activate it. Check Screen Time permission."
                        messageAction = nil
                        assistantActionApplied = sessionStore.recurringScheduleRegistered
                    } else {
                        assistantActionApplied = contextualPlanSelection.blankedSelectionCount > 0
                    }
                }
                sessionStore.clearPendingPlanAppNames()
                contextualPlanSelection = FamilyActivitySelection()
                if !pendingAssistantActionId.isEmpty {
                    finishPendingAssistantAction(
                        status: assistantProtectionExecution?.status ?? (assistantActionApplied ? "verified" : (!permissionApproved || selectionConfirmed ? "failed" : "dismissed")),
                        detail: assistantProtectionExecution?.detail ?? (!permissionApproved ? "screen_time_permission_denied" : (assistantActionApplied ? "native_state_applied_after_selection" : (selectionConfirmed ? "device_activity_registration_failed" : "app_selection_cancelled"))),
                        executionStarted: selectionConfirmed,
                        execution: assistantProtectionExecution
                    )
                }
            }
        }
        .fullScreenCover(isPresented: $showingAssistantChat, onDismiss: {
            chatLaunchMessage = nil
            if sessionStore.pendingAssistantAction != nil, pendingAssistantInboxAction != nil {
                confirmPendingAssistantAction()
            }
        }) {
            AssistantAppView(initialMessage: chatLaunchMessage, simulatorGuest: simulatorGuest, onOpenControls: { section in
                if let section { openSection(section) }
            }) { actionId in
                let owner = AssistantAppSession.userID
                let code = assistantConnectCode.trimmingCharacters(in: .whitespacesAndNewlines)
                let remote = try await AssistantActionInboxClient().actionForApplication(
                    actionId: actionId, connectCode: code, channel: "app")
                guard assistantIdentityMatches(code: code, channel: "app", owner: owner),
                      !assistantActionExecutionInFlight,
                      sessionStore.pendingAssistantAction == nil,
                      let pending = remote.toPendingAction() else { throw AssistantAppError.sessionChanged }
                clearAssistantNotificationRequest()
                pendingAssistantActionId = remote.id
                pendingAssistantInboxAction = remote
                sessionStore.requestAssistantActionConfirmation(pending)
            }
        }
        .sheet(isPresented: $showingRelink) {
            RelinkSheet(message: $message, messageAction: $messageAction)
                .presentationDetents([.medium])
        }
        .sheet(isPresented: $showingForgetConfirm) {
            ForgetBlankConfirmSheet {
                sessionStore.forgetNfcTag()
                screenTimeBlocker.clear()
            }
            .presentationDetents([.medium])
        }
    }

    @ViewBuilder
    private func homeSectionScreen(viewportWidth: CGFloat, viewportHeight: CGFloat) -> some View {
        if let activeSection {
            HomeSectionScreen(
                showingPicker: $showingPicker,
                section: activeSection,
                screenWidth: viewportWidth,
                screenHeight: viewportHeight,
                intervention: relapseIntervention,
                onEmergencyUnlock: performEmergencyUnlock,
                onOpenSection: openSection,
                onOpenAssistant: { openAssistantChat() },
                onRequestScreenTimePermission: {
                    Task {
                        _ = await screenTimeBlocker.requestAuthorization()
                        applyScreenTimeControls()
                    }
                },
                onRequestHealthAccess: { healthKitStore.requestAccess() },
                screenTimeStatus: screenTimeBlocker.authorizationStatusLabel,
                healthStatus: healthPermissionLabel
            ) {
                closeSection()
            }
            .frame(width: viewportWidth, height: viewportHeight, alignment: .topLeading)
            .transition(.opacity)
            .zIndex(5)
        }
    }

    private var topBar: some View {
        let glassTint = BlankColors.paleSteelBlue.opacity(0.42)
        let logoReflection = RadialGradient(
            colors: [
                BlankColors.pureWhite.opacity(0.22),
                BlankColors.pureWhite.opacity(0.07),
                BlankColors.pureWhite.opacity(0.00)
            ],
            center: .topLeading,
            startRadius: 0,
            endRadius: 52
        )
        let topNavBorder = LinearGradient(
            colors: [
                BlankColors.pureWhite.opacity(0.42),
                BlankColors.pureWhite.opacity(0.16),
                BlankColors.pureWhite.opacity(0.04),
                BlankColors.pureWhite.opacity(0.00)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )

        return HStack(alignment: .center, spacing: 8) {
            Button {
                openSection(.emergency)
            } label: {
                Image(systemName: "sparkle")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(BlankColors.pureWhite)
                    .foregroundColor(BlankColors.pureWhite)
                    .frame(width: 47, height: 47)
                    .background {
                        ZStack {
                            Circle().fill(.ultraThinMaterial)
                            Circle().fill(glassTint)
                            Circle().fill(logoReflection)
                            Circle().stroke(topNavBorder, lineWidth: 1)
                        }
                        .allowsHitTesting(false)
                    }
                    .shadow(color: BlankColors.charcoal.opacity(0.05), radius: 5, y: 3)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Emergency")

            HStack(spacing: 0) {
                topNavButton("Progress") {
                    openSection(.report)
                }
                topNavButton("Distractions") {
                    openSection(.distractions)
                }
                topNavButton("Settings") {
                    openSection(.settings)
                }
            }
            .padding(.horizontal, 22)
            .frame(width: 236, height: 47)
            .background {
                ZStack {
                    Capsule().fill(.ultraThinMaterial)
                    Capsule().fill(glassTint)
                    GlassCornerHighlight(width: 78, height: 30, xOffset: -79, yOffset: -15)
                        .clipShape(Capsule())
                    Capsule().stroke(topNavBorder, lineWidth: 1)
                }
                .allowsHitTesting(false)
            }
            .shadow(color: BlankColors.charcoal.opacity(0.05), radius: 5, y: 3)
        }
        .fixedSize(horizontal: true, vertical: false)
        .frame(width: 291, height: 47)
    }

    private func topNavButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.blankInter(size: 15, weight: .regular, relativeTo: .subheadline))
                .foregroundStyle(BlankColors.pureWhite)
                .foregroundColor(BlankColors.pureWhite)
                .frame(width: 64, height: 47)
                .contentShape(Rectangle())
        }
        .frame(width: 64, height: 47)
        .contentShape(Rectangle())
        .buttonStyle(.plain)
    }

    private func openSection(_ section: HomeSection) {
        if section == .distractions, sessionStore.pinProtectionEnabled {
            unlockAdvancedSettings {
                withAnimation(.easeInOut(duration: 0.35)) {
                    activeSection = section
                }
            }
            return
        }
        withAnimation(.easeInOut(duration: 0.35)) {
            activeSection = section
        }
    }

    private func unlockAdvancedSettings(onSuccess: @escaping () -> Void) {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            message = "Device passcode is required for PIN protection."
            messageAction = nil
            return
        }
        context.evaluatePolicy(
            .deviceOwnerAuthentication,
            localizedReason: "Unlock Blankmind advanced settings."
        ) { success, _ in
            Task { @MainActor in
                if success {
                    onSuccess()
                } else {
                    message = "Advanced settings stayed locked."
                    messageAction = nil
                }
            }
        }
    }

    private func closeSection() {
        withAnimation(.easeInOut(duration: 0.35)) {
            activeSection = nil
        }
    }

    @ViewBuilder
    private func minimalHome(layout: HomeLayoutMetrics) -> some View {
        GeometryReader { proxy in
            let diameter = max(44, min(72, proxy.size.width * 150 / 1080))
            let right = max(24, proxy.size.width * 108 / 1080)
            let bottom = max(proxy.safeAreaInsets.bottom + 16, proxy.size.height * 108 / 1920)
            ZStack(alignment: .bottomTrailing) {
                if sessionStore.isBlankActive && !isHomeMenuOpen {
                    activeMinimalHome(layout: layout)
                }
                if isHomeMenuOpen {
                    Color.clear.contentShape(Rectangle())
                        .onTapGesture { isHomeMenuOpen = false }
                        .accessibilityLabel("Close menu")
                        .accessibilityAddTraits(.isButton)
                    orbMenu(layout: layout, trailing: right + diameter + 16, bottom: bottom)
                        .transition(reduceMotion ? .opacity : .asymmetric(
                            insertion: .move(edge: .bottom).combined(with: .opacity),
                            removal: .opacity))
                }
                HomeOrbControl(menuOpen: isHomeMenuOpen, protectionActive: sessionStore.isBlankActive, onAction: handleHomeOrb)
                    .id(isHomeMenuOpen)
                    .frame(width: diameter, height: diameter)
                    .padding(.trailing, right)
                    .padding(.bottom, bottom)
                    .opacity(isHoldingToUnblank || isHomeMenuOpen ? 0 : 1)
                    .allowsHitTesting(!isHoldingToUnblank && !isHomeMenuOpen)
                    .accessibilityHidden(isHoldingToUnblank || isHomeMenuOpen)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
        }
        .animation(.easeOut(duration: reduceMotion ? 0.12 : 0.38), value: isHomeMenuOpen)
    }

    private func orbMenu(layout: HomeLayoutMetrics, trailing: CGFloat, bottom: CGFloat) -> some View {
        GeometryReader { proxy in
          ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                minimalHomeRow(sessionStore.isBlankActive ? "blank active" : "blank", color: BlankColors.foreground) {
                    handleHomeOrb(.block)
                }
                if sessionStore.isBlankActive {
                    minimalHomeRow("unblank", color: BlankColors.foreground) { beginFullScreenUnblankHold() }
                        .disabled(sessionStore.hardBlankActive || delayedManualUnlockAt != nil)
                    if sessionStore.hardBlankActive {
                        minimalUtilityRow("emergency") { openSection(.emergency) }
                    }
                }
                minimalHomeRow("progress", color: BlankColors.foreground) { openSection(.report) }
                minimalHomeRow("distractions", color: BlankColors.foreground) { openSection(.distractions) }
                minimalHomeRow("settings", color: BlankColors.foreground) { openSection(.settings) }
                minimalHomeRow("chat", color: BlankColors.foreground) { openAssistantChat() }
                minimalStatus
            }
            .frame(maxWidth: .infinity, minHeight: proxy.size.height, alignment: .bottomLeading)
          }
          .scrollIndicators(.hidden)
        }
        .padding(.leading, 24)
        .padding(.trailing, trailing)
        .padding(.top, layout.topPadding)
        .padding(.bottom, bottom)
    }

    private func handleHomeOrb(_ action: HomeOrbAction) {
        switch action {
        case .menu: isHomeMenuOpen = true
        case .closeMenu: isHomeMenuOpen = false
        case .chat: openAssistantChat()
        case .block:
            guard !sessionStore.isBlankActive else {
                isHomeMenuOpen = true
                return
            }
            screenTimeBlocker.refreshAuthorizationStatus()
            guard screenTimeBlocker.authorizationStatus == .approved else {
                message = "Allow Screen Time in settings to block distractions."
                messageAction = nil
                isHomeMenuOpen = true
                return
            }
            let result = sessionStore.activateBlank(usePendingWidgetTimer: false)
            screenTimeBlocker.apply(isBlankActive: sessionStore.isBlankActive)
            setMessage(for: result)
            if !sessionStore.isBlankActive {
                if message == nil { message = "Protection can restart after the unblank cooldown." }
                isHomeMenuOpen = true
            } else {
                isHomeMenuOpen = false
                UIAccessibility.post(notification: .announcement, argument: "Distractions blocked")
            }
        }
    }

    private func idleMinimalHome(layout: HomeLayoutMetrics) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                minimalStartRow

                minimalHomeRow("progress", color: BlankColors.charcoal) {
                    openSection(.report)
                }

                minimalHomeRow("distractions", color: BlankColors.charcoal) {
                    openSection(.distractions)
                }

                minimalHomeRow("settings", color: BlankColors.charcoal) {
                    openSection(.settings)
                }

                minimalHomeRow("chat", color: BlankColors.charcoal) {
                    openAssistantChat()
                }

                minimalStatus

                #if targetEnvironment(simulator)
                HStack(spacing: 18) {
                    minimalUtilityRow("onboarding") {
                        openOnboardingDemo()
                    }

                    minimalUtilityRow("pro") {
                        enableDemoPro()
                    }
                }
                .padding(.top, 7)
                #endif
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .opacity(homeChatFocused ? 0 : 1)
            .allowsHitTesting(!homeChatFocused)
            .accessibilityHidden(homeChatFocused)
            .frame(height: homeChatFocused ? 0 : nil, alignment: .bottom)
            .clipped()
            .padding(.horizontal, 24 - layout.horizontalPadding)

            homeChatComposer

        }
        .padding(.horizontal, layout.horizontalPadding)
        .padding(.bottom, homeChatFocused ? 0 : layout.bottomPadding * 2)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
        .background {
            Color.clear
                .contentShape(Rectangle())
                .onTapGesture { homeChatFocused = false }
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.3), value: homeChatFocused)
    }

    private func activeMinimalHome(layout: HomeLayoutMetrics) -> some View {
        ZStack(alignment: .topLeading) {
            ZStack(alignment: .topLeading) {
                activePrimaryContent
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            }
            .padding(.horizontal, layout.horizontalPadding)
            .padding(.bottom, layout.bottomPadding * 2)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .overlay {
            if !sessionStore.hardBlankActive && delayedManualUnlockAt == nil {
                Color.clear
                    .contentShape(Rectangle())
                    .ignoresSafeArea()
                    .overlay(alignment: .bottom) {
                        GeometryReader { proxy in
                            Rectangle()
                                .fill(BlankColors.pureWhite.opacity(0.46))
                                .frame(width: proxy.size.width * unblankHoldProgress, height: 1.5)
                                .shadow(color: BlankColors.pureWhite.opacity(0.22), radius: 5)
                                .frame(maxHeight: .infinity, alignment: .bottomLeading)
                        }
                        .allowsHitTesting(false)
                    }
                    .simultaneousGesture(
                        LongPressGesture(minimumDuration: 20, maximumDistance: .infinity)
                            .onEnded { _ in
                                guard sessionStore.isBlankActive,
                                      !sessionStore.hardBlankActive,
                                      delayedManualUnlockAt == nil else { return }
                                scheduleDelayedManualUnlock(cooldownSeconds: 60)
                                isHoldingToUnblank = false
                                unblankHoldProgress = 0
                                isAnimatingUnblankHold = false
                                stopUnblankHoldHaptics()
                            }
                    )
                    .simultaneousGesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { _ in
                                guard sessionStore.isBlankActive,
                                      !sessionStore.hardBlankActive,
                                      delayedManualUnlockAt == nil,
                                      !isAnimatingUnblankHold else { return }
                                isHoldingToUnblank = true
                                isAnimatingUnblankHold = true
                                startUnblankHoldHaptics()
                                unblankHoldProgress = 0
                                withAnimation(.linear(duration: 20)) {
                                    unblankHoldProgress = 1
                                }
                            }
                            .onEnded { _ in
                                isAnimatingUnblankHold = false
                                stopUnblankHoldHaptics()
                                withAnimation(.easeOut(duration: 0.18)) {
                                    unblankHoldProgress = 0
                                }
                                if delayedManualUnlockAt == nil {
                                    isHoldingToUnblank = false
                                }
                            }
                    )
                    .padding(.bottom, max(120, layout.bottomPadding * 2 + 80))
                    .zIndex(10)
            }
        }
        .animation(.easeInOut(duration: 0.35), value: isActiveNavExpanded)
    }

    @ViewBuilder
    private var activePrimaryContent: some View {
        ZStack(alignment: .leading) {
            if !sessionStore.hardBlankActive && delayedManualUnlockAt == nil {
                Text("hold the screen to unblank")
                    .font(.blankInter(size: 32, weight: .bold, relativeTo: .largeTitle))
                    .tracking(0)
                    .foregroundStyle(BlankColors.pureWhite)
                    .lineLimit(3)
                    .minimumScaleFactor(0.78)
                    .lineSpacing(0.8)
                    .opacity(1 - unblankHoldProgress)
                    .transition(.opacity)
            } else if let cooldownText {
                Text(cooldownText)
                    .font(.blankInter(size: 32, weight: .bold, relativeTo: .largeTitle))
                    .tracking(0)
                    .foregroundStyle(BlankColors.homeDarkSecondary)
                    .monospacedDigit()
                    .lineLimit(2)
                    .minimumScaleFactor(0.72)
                    .transition(.opacity)
            } else if sessionStore.hardBlankActive {
                Text(timerCountdownText ?? "hard protection active")
                    .font(.blankInter(size: 32, weight: .bold, relativeTo: .largeTitle))
                    .foregroundStyle(BlankColors.pureWhite)
            } else if let timerCountdownText {
                Text(timerCountdownText)
                    .font(.blankInter(size: 32, weight: .bold, relativeTo: .largeTitle))
                    .tracking(0)
                    .foregroundStyle(BlankColors.homeDarkSecondary)
                    .monospacedDigit()
                    .lineLimit(2)
                    .minimumScaleFactor(0.72)
                    .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(.easeInOut(duration: 0.35), value: isHoldingToUnblank)
        .animation(.easeInOut(duration: 0.35), value: delayedManualUnlockAt != nil)
    }

    private var activeExpandedNavigation: some View {
        VStack(alignment: .leading, spacing: 0) {
            minimalHomeRow("progress", color: BlankColors.homeDarkSecondary) {
                openSection(.report)
            }
            minimalHomeRow("distractions", color: BlankColors.homeDarkSecondary) {
                openSection(.distractions)
            }
            minimalHomeRow("settings", color: BlankColors.homeDarkSecondary) {
                openSection(.settings)
            }
            minimalHomeRow("chat", color: BlankColors.homeDarkSecondary) {
                openAssistantChat()
            }

            Button {
                withAnimation(.easeInOut(duration: 0.35)) {
                    isActiveNavExpanded = false
                }
            } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(BlankColors.homeDarkSecondary)
                    .frame(width: 44, height: 44, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Collapse menu")
            .accessibilityHint("Return to the active home")
        }
    }

    private func minimalHomeRow(_ title: String, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .blankHomeDisplayTextStyle(color: color)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }

    private var minimalStartRow: some View {
        let isActive = sessionStore.isBlankActive
        let title = isActive
            ? (sessionStore.hardBlankActive ? "blank active" : "menu")
            : "blank"
        let titleColor = isActive ? BlankColors.pureWhite : BlankColors.charcoal

        return Button {
            if isActive {
                guard !sessionStore.hardBlankActive else { return }
                withAnimation(.easeInOut(duration: 0.35)) {
                    isActiveNavExpanded = true
                }
                return
            }
            let result = withAnimation(.easeInOut(duration: 0.65)) {
                sessionStore.activateBlank()
            }
            screenTimeBlocker.apply(isBlankActive: sessionStore.isBlankActive)
            setMessage(for: result)
        } label: {
            Text(title)
                .font(.blankInter(size: 32, relativeTo: .title))
                .foregroundStyle(titleColor)
                .tracking(-0.9)
                .lineLimit(1)
                .minimumScaleFactor(0.70)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(isActive && !sessionStore.hardBlankActive ? "tap unblank, then hold the screen for 20 seconds" : "")
    }

    @ViewBuilder
    private var minimalStatus: some View {
        VStack(alignment: .leading, spacing: 6) {
            if sessionStore.isBlankActive,
               sessionStore.blankActiveUntil == nil,
               let blankActiveSince = sessionStore.blankActiveSince {
                Text(elapsedText(since: blankActiveSince))
                    .font(.blankInter(size: 14, weight: .semibold, relativeTo: .footnote))
                    .monospacedDigit()
            }

            if let schedulePausedUntil = sessionStore.schedulePausedUntil, now < schedulePausedUntil {
                Text("Schedule paused \(remainingText(until: schedulePausedUntil))")
                    .font(.blankInter(size: 13, weight: .medium, relativeTo: .footnote))
            }

            if let message {
                if let messageAction {
                    Button {
                        resolve(messageAction)
                    } label: {
                        Text(message)
                            .multilineTextAlignment(.leading)
                    }
                    .buttonStyle(.plain)
                } else {
                    Text(message)
                        .multilineTextAlignment(.leading)
                }
            }

            if let cooldownText {
                Text(cooldownText)
                    .monospacedDigit()
            } else if let timerCountdownText {
                Text(timerCountdownText)
                    .monospacedDigit()
            }
        }
        .font(.blankInter(size: 13, weight: .medium, relativeTo: .footnote))
        .foregroundStyle(sessionStore.isBlankActive ? BlankColors.homeDarkSecondary : BlankColors.homeLightSecondary)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.top, 6)
    }

    private func minimalUtilityRow(_ title: String, action: @escaping () -> Void) -> some View {
        Button(title, action: action)
            .font(.blankInter(size: 13, weight: .semibold, relativeTo: .footnote))
            .foregroundStyle(BlankColors.homeLightSecondary)
            .frame(minWidth: 44, minHeight: 44, alignment: .leading)
            .buttonStyle(.plain)
    }

    private var homeChatComposer: some View {
        HStack(alignment: .bottom, spacing: 4) {
            if homeSpeech.isRecording || homeSpeech.isStarting || homeSpeech.hasAudio {
                AssistantAudioWaveform(audio: homeSpeech).padding(.leading, 18)
            } else {
            TextField("", text: $homeChatDraft,
                      prompt: Text("Ask Blankmind").foregroundColor(BlankColors.homeLightSecondary),
                      axis: .vertical)
                .font(.blankInter(size: 16, weight: .medium, relativeTo: .body))
                .lineLimit(1...3)
                .submitLabel(.send)
                .focused($homeChatFocused)
                .onSubmit(sendHomeChatMessage)
                .padding(.leading, 18)
                .padding(.vertical, 14)
                .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
                .accessibilityLabel("Message Blankmind")
            }

            Button {
                homeChatFocused = false
                if !homeSpeech.isRecording && !homeSpeech.isStarting {
                    acceptingHomeSpeech = true
                }
                homeSpeech.toggle()
            } label: {
                Image(systemName: homeSpeech.isRecording || homeSpeech.isStarting ? "stop.circle.fill" : "mic")
                    .font(.system(size: 21))
                    .frame(width: 44, height: 50)
            }
            .disabled(homeSpeech.isStarting)
            .accessibilityLabel(homeSpeech.isRecording || homeSpeech.isStarting ? "Send audio" : "Record audio")

            if !homeSpeech.hasAudio && !homeSpeech.isRecording && !homeSpeech.isStarting && !homeChatDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Button(action: sendHomeChatMessage) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 28))
                        .frame(width: 44, height: 50)
                }
                .disabled(homeChatDraft.utf16.count > 4000)
                .accessibilityLabel("Send message")
            }
        }
        .foregroundStyle(BlankColors.homeLightInk)
        .padding(.trailing, 12)
        .background(RoundedRectangle(cornerRadius: 26).fill(BlankColors.homeLightInk.opacity(0.06)))
        .padding(.top, 22)
        .onTapGesture { if !homeSpeech.isRecording && !homeSpeech.isStarting { homeChatFocused = true } }
    }

    private func openAssistantChat() {
        homeChatFocused = false
        acceptingHomeSpeech = false
        homeSpeech.stop()
        chatLaunchMessage = nil
        showingAssistantChat = true
    }

    private func sendHomeChatMessage() {
        let text = homeChatDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        guard text.utf16.count <= 4000 else {
            message = "Keep your message under 4,000 characters."
            return
        }
        acceptingHomeSpeech = false
        homeSpeech.stop()
        homeChatDraft = ""
        homeChatFocused = false
        chatLaunchMessage = text
        showingAssistantChat = true
    }

    private func centerContent(maxWidth: CGFloat, actionWidth: CGFloat) -> some View {
        VStack(spacing: 28) {
            Text(homeTagline)
                .font(.blankInter(size: 32, weight: .bold, relativeTo: .largeTitle))
                .foregroundStyle(BlankColors.pureWhite)
                .multilineTextAlignment(.center)
                .lineLimit(3)
                .minimumScaleFactor(0.82)

            bottomAction(width: actionWidth)
        }
        .frame(maxWidth: maxWidth)
    }

    @ViewBuilder
    private var centerStatus: some View {
        VStack(spacing: 8) {
            if sessionStore.isBlankActive,
               sessionStore.blankActiveUntil == nil,
               let blankActiveSince = sessionStore.blankActiveSince {
                Text(elapsedText(since: blankActiveSince))
                    .font(.blankInter(size: 16, weight: .semibold, relativeTo: .headline))
                    .foregroundStyle(BlankColors.pureWhite.opacity(0.86))
                    .monospacedDigit()
                if let schedulePausedUntil = sessionStore.schedulePausedUntil, now < schedulePausedUntil {
                    Text("Schedule paused \(remainingText(until: schedulePausedUntil))")
                        .font(.blankInter(size: 13, weight: .medium, relativeTo: .footnote))
                        .foregroundStyle(BlankColors.pureWhite.opacity(0.58))
                }
            }

            if let message {
                if let messageAction {
                    Button {
                        resolve(messageAction)
                    } label: {
                        Text(message)
                            .font(.blankInter(size: 13, weight: .semibold, relativeTo: .footnote))
                            .multilineTextAlignment(.center)
                            .padding(.top, 8)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(sessionStore.isBlankActive ? BlankColors.pureWhite.opacity(0.72) : BlankColors.mutedInk)
                } else {
                    Text(message)
                        .font(.blankInter(size: 13, weight: .medium, relativeTo: .footnote))
                        .foregroundStyle(sessionStore.isBlankActive ? BlankColors.pureWhite.opacity(0.72) : BlankColors.mutedInk)
                        .multilineTextAlignment(.center)
                        .padding(.top, 8)
                }
            }

        }
    }

    private func bottomAction(width: CGFloat) -> some View {
        VStack(spacing: 12) {
            let buttonWidth = sessionStore.isBlankActive ? min(width, 244) : min(width, 184)
            Button(sessionStore.isBlankActive ? (sessionStore.hardBlankActive ? "Hard protection" : "Hold to Unblank") : "Start Blank") {
                if sessionStore.isBlankActive {
                    return
                } else {
                    let result = withAnimation(.easeInOut(duration: 0.65)) {
                        sessionStore.activateBlank()
                    }
                    screenTimeBlocker.apply(isBlankActive: sessionStore.isBlankActive)
                    setMessage(for: result)
                }
            }
            .buttonStyle(HomeBlankButtonStyle())
            .frame(width: buttonWidth)
            .opacity(sessionStore.hardBlankActive ? 0.86 : 1)
            .overlay(alignment: .leading) {
                if sessionStore.isBlankActive, !sessionStore.hardBlankActive {
                    GeometryReader { proxy in
                        Capsule()
                            .fill(BlankColors.pureWhite.opacity(0.18))
                            .frame(width: proxy.size.width * unblankHoldProgress)
                            .frame(maxHeight: .infinity, alignment: .leading)
                    }
                    .clipShape(Capsule())
                    .allowsHitTesting(false)
                }
            }
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 20, maximumDistance: .infinity)
                    .onEnded { _ in
                        guard sessionStore.isBlankActive, !sessionStore.hardBlankActive else { return }
                        scheduleDelayedManualUnlock()
                        unblankHoldProgress = 0
                        isAnimatingUnblankHold = false
                        stopUnblankHoldHaptics()
                    }
            )
            .simultaneousGesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        guard sessionStore.isBlankActive, !sessionStore.hardBlankActive, !isAnimatingUnblankHold else { return }
                        isAnimatingUnblankHold = true
                        startUnblankHoldHaptics()
                        unblankHoldProgress = 0
                        withAnimation(.linear(duration: 20)) {
                            unblankHoldProgress = 1
                        }
                    }
                    .onEnded { _ in
                        isAnimatingUnblankHold = false
                        stopUnblankHoldHaptics()
                        withAnimation(.easeOut(duration: 0.18)) {
                            unblankHoldProgress = 0
                        }
                    }
            )

            if sessionStore.hardBlankActive {
                Button {
                    openSection(.emergency)
                } label: {
                    Text("Emergency unlock only")
                        .font(.blankInter(size: 13, weight: .semibold, relativeTo: .footnote))
                        .foregroundStyle(BlankColors.pureWhite.opacity(0.72))
                }
                .buttonStyle(.plain)
            }

            if let cooldownText {
                Text(cooldownText)
                    .font(.blankInter(size: 12, weight: .semibold, relativeTo: .caption))
                    .monospacedDigit()
                    .foregroundStyle(sessionStore.isBlankActive ? BlankColors.pureWhite.opacity(0.62) : BlankColors.mutedInk)
            } else if let timerCountdownText {
                Text(timerCountdownText)
                    .font(.blankInter(size: 12, weight: .semibold, relativeTo: .caption))
                    .monospacedDigit()
                    .foregroundStyle(sessionStore.isBlankActive ? BlankColors.pureWhite.opacity(0.62) : BlankColors.mutedInk)
            }
        }
    }

    private func applyScreenTimeControls() {
        screenTimeBlocker.updateAdvancedControls(
            allowOnlyModeEnabled: sessionStore.allowOnlyModeEnabled,
            adultContentBlockingEnabled: sessionStore.adultContentBlockingEnabled
        )
        screenTimeBlocker.apply(isBlankActive: sessionStore.isBlankActive)
        sessionStore.refreshDailyLimitMonitoring()
    }

    private func evaluateBAIProactiveSignals() {
        let system = aiSystem
        let summaries = healthKitStore.summaries
        let selectionCount = sessionStore.selectionCount
        let screenTimeAuthorized = screenTimeBlocker.authorizationStatus == .approved
        let isBlankActive = sessionStore.isBlankActive

        Task {
            await BAIProactiveSignalEngine.evaluate(
                system: system,
                healthSummaries: summaries,
                selectionCount: selectionCount,
                screenTimeAuthorized: screenTimeAuthorized,
                isBlankActive: isBlankActive
            )
        }
    }

    private var isSimulatorBuild: Bool {
        #if targetEnvironment(simulator)
        return true
        #else
        return false
        #endif
    }

    private func openOnboardingDemo() {
        withAnimation(.easeInOut(duration: 0.45)) {
            #if !targetEnvironment(simulator)
            _ = sessionStore.deactivateBlank(entryMode: .app, endedReason: .manual)
            sessionStore.setupComplete = false
            #endif
        }
        #if !targetEnvironment(simulator)
        screenTimeBlocker.clear()
        #endif
        message = nil
        messageAction = nil
        onOpenOnboardingDemo()
    }

    private func enableDemoPro() {
        purchaseStore.enableDemoProAccess()
        message = "Demo Pro enabled."
        messageAction = nil
    }

    private func performEmergencyUnlock() -> Bool {
        cancelDelayedManualUnlock()
        let unlocked = withAnimation(.easeInOut(duration: 0.65)) {
            sessionStore.deactivateForEmergency()
        }
        if unlocked {
            screenTimeBlocker.clear()
            Task {
                await BlankFunnelAnalytics.track(
                    "relapse_attempt",
                    properties: [
                        "source": "emergency",
                        "remaining_after": sessionStore.emergencyUnlocksRemaining
                    ]
                )
            }
            message = nil
            messageAction = nil
            closeSection()
            presentRelapseReview()
        }
        return unlocked
    }

    private func stopUnblankHoldHaptics() {
        unblankHapticTask?.cancel()
        unblankHapticTask = nil
    }

    private func startUnblankHoldHaptics() {
        stopUnblankHoldHaptics()
        unblankHapticTask = Task { @MainActor in
            let feedback = UIImpactFeedbackGenerator(style: .light)
            var elapsed = 0.0
            for pulse in UnblankHoldCadence.pulseTimes(duration: 20) {
                if pulse > elapsed {
                    do { try await Task.sleep(nanoseconds: UInt64((pulse - elapsed) * 1_000_000_000)) }
                    catch { return }
                }
                guard !Task.isCancelled, scenePhase == .active,
                      isAnimatingUnblankHold, sessionStore.isBlankActive,
                      !sessionStore.hardBlankActive, delayedManualUnlockAt == nil else { return }
                feedback.prepare()
                feedback.impactOccurred(intensity: 0.65)
                elapsed = pulse
            }
        }
    }

    private func beginFullScreenUnblankHold() {
        guard sessionStore.isBlankActive,
              !sessionStore.hardBlankActive,
              delayedManualUnlockAt == nil else { return }
        withAnimation(.easeInOut(duration: 0.35)) {
            isActiveNavExpanded = false
            isHomeMenuOpen = false
            isHoldingToUnblank = false
        }
        unblankHoldProgress = 0
        isAnimatingUnblankHold = false
        stopUnblankHoldHaptics()
    }

    private func scheduleDelayedManualUnlock(cooldownSeconds requestedCooldownSeconds: Int? = nil) {
        guard delayedManualUnlockAt == nil else { return }
        let cooldownSeconds = requestedCooldownSeconds ?? sessionStore.manualUnblankCooldownSeconds
        let startedAt = Date()
        now = startedAt
        sessionStore.scheduleManualUnlock(after: cooldownSeconds, now: startedAt)
        updateDelayedUnlockMessage(now: Date())
        Task {
            await BlankFunnelAnalytics.track(
                "relapse_attempt",
                properties: ["source": "hold_to_unblank", "delay_seconds": cooldownSeconds]
            )
        }
        finishDelayedManualUnlock(now: startedAt)
    }

    private func finishDelayedManualUnlock(now: Date) {
        guard sessionStore.finishManualUnlockIfDue(now: now) else { return }
        screenTimeBlocker.apply(isBlankActive: sessionStore.isBlankActive)
        setMessage(for: .unblanked)
        presentRelapseReview()
    }

    private func presentRelapseReview() {
        withAnimation(.easeInOut(duration: 0.35)) {
            showingRelapseReview = true
        }
    }

    private func dismissRelapseReview() {
        withAnimation(.easeInOut(duration: 0.35)) {
            showingRelapseReview = false
        }
    }

    private func cancelDelayedManualUnlock() {
        sessionStore.cancelManualUnlock()
    }

    private func updateDelayedUnlockMessage(now _: Date) {
        guard delayedManualUnlockAt != nil else { return }
        message = nil
        messageAction = nil
    }

    private var cooldownText: String? {
        guard let delayedManualUnlockAt else { return nil }
        let seconds = max(0, Int(ceil(delayedManualUnlockAt.timeIntervalSince(now))))
        return formatCooldown(seconds)
    }

    private var timerCountdownText: String? {
        guard sessionStore.isBlankActive, let blankActiveUntil = sessionStore.blankActiveUntil else { return nil }
        let seconds = max(0, Int(ceil(blankActiveUntil.timeIntervalSince(now))))
        return "Timer: \(formatCooldown(seconds))"
    }

    private func formatCooldown(_ seconds: Int) -> String {
        let minutes = seconds / 60
        let remainingSeconds = seconds % 60
        return "\(String(format: "%02d", minutes)):\(String(format: "%02d", remainingSeconds))"
    }

    private func processPendingBlockConfigurationIfNeeded() {
        guard sessionStore.shouldOpenBlockConfiguration else { return }
        guard sessionStore.canEditSelectedDistractions else {
            sessionStore.shouldOpenBlockConfiguration = false
            message = "Your distraction selection stays fixed while protection is active."
            if !pendingAssistantActionId.isEmpty {
                finishPendingAssistantAction(status: "failed", detail: "selection_locked_during_protection", executionStarted: false)
            }
            return
        }
        contextualPlanSelection = sessionStore.selection
        showingContextualAppPicker = true
        sessionStore.shouldOpenBlockConfiguration = false
    }

    private var assistantActionConfirmationMessage: String {
        guard let action = sessionStore.pendingAssistantAction else {
            return "No action is waiting for confirmation."
        }
        switch action {
        case .startProtection(let minutes, _, _):
            return minutes.map { "Protect all your selected distractions for \($0) minutes?" } ?? "Protect all your selected distractions now, with no duration added?"
        case .applySchedule(_, let start, let end, _, let days, _):
            return "Protect your distractions from \(formatMinute(start)) to \(formatMinute(end)) for \(days) days?"
        case .updateSchedule(_, _, let start, let end, _):
            return "Move this blocking window to \(formatMinute(start))–\(formatMinute(end))?"
        case .deleteSchedule:
            return "Remove this blocking window?"
        case .deleteAllSchedules:
            return "Remove every blocking window?"
        case .setDailyLimit(let minutes, _):
            return minutes.map { "Set a daily limit of \($0) minutes?" } ?? "Set a daily limit after you choose its duration?"
        case .allowOnly:
            return "Enable Allow Only?"
        case .adultFilter:
            return "Enable adult web protection?"
        case .disableAllowOnly:
            return "Disable Allow Only?"
        case .disableAdultFilter:
            return "Disable adult web protection?"
        case .disableDailyLimit:
            return "Disable the daily limit?"
        case .pauseRules(let hours):
            return "Pause protection rules for \(hours) hours?"
        case .disablePause:
            return "Resume protection rules?"
        case .applyAIPlan:
            return "Apply the recommended adaptive plan?"
        case .openAppPicker:
            return "Open the app picker to choose what Blankmind can protect?"
        case .configureAndOpenAppPicker(_, let durationMinutes, _, let schedule):
            if let schedule {
                return "Choose your distractions once, then protect them from \(formatMinute(schedule.startMinute)) to \(formatMinute(schedule.endMinute))?"
            }
            return durationMinutes.map { "Choose your distractions once, then protect them for \($0) minutes?" } ?? "Choose your distractions once, then start protection?"
        case .configureAndOpenDailyLimitPicker(_, let minutes):
            return "Choose your distractions once, then set a daily limit of \(minutes) minutes?"
        case .requestScreenTimePermission:
            return "Request Screen Time permission?"
        }
    }

    private func confirmPendingAssistantAction() {
        guard let pendingAction = sessionStore.pendingAssistantAction else { return }
        screenTimeBlocker.refreshAuthorizationStatus()
        if assistantActionRequiresScreenTime(pendingAction), screenTimeBlocker.authorizationStatus != .approved {
            assistantActionExecutionInFlight = true
            let code = assistantConnectCode.trimmingCharacters(in: .whitespacesAndNewlines)
            let channel = "app"
            let accountID = AssistantAppSession.userID
            let actionID = pendingAssistantActionId
            Task {
                _ = await screenTimeBlocker.requestAuthorization()
                await MainActor.run {
                    guard assistantIdentityMatches(code: code, channel: channel, owner: accountID),
                          pendingAssistantActionId == actionID else { return }
                    if screenTimeBlocker.authorizationStatus == .approved {
                        confirmPendingAssistantAction()
                    } else {
                        sessionStore.clearAssistantActionConfirmation()
                        finishPendingAssistantAction(
                            status: "failed",
                            detail: "screen_time_permission_denied",
                            executionStarted: false
                        )
                    }
                }
            }
            return
        }
        assistantActionExecutionInFlight = true
        sessionStore.clearAssistantActionConfirmation()
        switch pendingAction {
        case .startProtection(let minutes, let hardMode, let appNames):
            guard let minutes,
                  let remote = pendingAssistantInboxAction,
                  remote.id == pendingAssistantActionId,
                  let requestedAt = remote.requestedDate else {
                finishPendingAssistantAction(status: "failed", detail: "missing_exact_action_metadata")
                return
            }
            guard sessionStore.restoreSavedSelectionForAssistant(appNames: appNames) else {
                sessionStore.requestBlockConfiguration(
                    appNames: appNames,
                    shouldActivate: true,
                    durationMinutes: minutes,
                    hardMode: hardMode
                )
                return
            }
            let execution = sessionStore.applyAssistantProtection(
                actionId: remote.id,
                requestedAt: requestedAt,
                durationMinutes: minutes,
                hardMode: hardMode
            )
            applyScreenTimeControls()
            finishPendingAssistantAction(
                status: execution.status,
                detail: execution.detail,
                execution: execution
            )
        case .applySchedule(_, let start, let end, let weekdays, let days, let appNames):
            if let remote = pendingAssistantInboxAction, remote.recurrence != nil {
                let registered = sessionStore.applyBMBProtectionSchedule(remote)
                applyScreenTimeControls()
                finishPendingAssistantAction(status: registered ? "verified" : "failed",
                    detail: registered ? "dated_schedule_registered" : sessionStore.bmbScheduleFailure)
                return
            }
            guard sessionStore.restoreSavedSelectionForAssistant(appNames: appNames) else {
                sessionStore.requestBlockConfiguration(
                    appNames: appNames,
                    schedule: PendingPlanSchedule(
                        name: "Protection",
                        startMinute: start,
                        endMinute: end,
                        weekdays: weekdays,
                        durationDays: days
                    )
                )
                return
            }
            sessionStore.applyAdaptivePlan(
                startMinute: start,
                endMinute: end,
                durationDays: days,
                activateCurrentWindow: false,
                name: "Protection",
                weekdays: weekdays
            )
            applyScreenTimeControls()
            message = sessionStore.recurringScheduleRegistered ? "Protection schedule added for your distractions." : "The schedule was saved, but iOS could not activate it. Check Screen Time permission."
            messageAction = nil
            finishPendingAssistantAction(status: sessionStore.recurringScheduleRegistered ? "verified" : "failed", detail: sessionStore.recurringScheduleRegistered ? "schedule_registered" : "device_activity_registration_failed")
        case .updateSchedule(let windowId, let name, let start, let end, let weekdays):
            let updated = pendingAssistantInboxAction?.recurrence != nil
                ? sessionStore.applyBMBProtectionSchedule(pendingAssistantInboxAction!)
                : sessionStore.updateScheduleWindow(
                id: windowId,
                name: name,
                startMinute: start,
                endMinute: end,
                weekdays: weekdays
            )
            applyScreenTimeControls()
            let registered = updated && sessionStore.recurringScheduleRegistered
            message = !updated ? "That blocking window no longer exists." : (registered ? "Blocking window updated." : "The change was saved, but iOS could not activate it. Check Screen Time permission.")
            messageAction = nil
            finishPendingAssistantAction(status: registered ? "verified" : "failed", detail: registered ? "schedule_updated" : (updated ? "device_activity_registration_failed" : "schedule_not_found"))
        case .deleteSchedule(let windowId):
            let deleted = sessionStore.deleteScheduleWindow(id: windowId)
            applyScreenTimeControls()
            message = deleted ? "Blocking window removed." : "That blocking window no longer exists."
            messageAction = nil
            finishPendingAssistantAction(status: deleted ? "verified" : "failed", detail: deleted ? "schedule_deleted" : "schedule_not_found")
        case .deleteAllSchedules:
            let removed = sessionStore.deleteAllScheduleWindows()
            applyScreenTimeControls()
            message = removed == 0 ? "There were no blocking windows to remove." : "All blocking windows removed."
            messageAction = nil
            finishPendingAssistantAction(status: "verified", detail: "all_schedules_deleted")
        case .setDailyLimit(let minutes, let appNames):
            guard let minutes else {
                message = "Tell BM how many minutes per day you want to allow before activating this limit."
                messageAction = nil
                finishPendingAssistantAction(status: "failed", detail: "daily_limit_duration_missing")
                return
            }
            guard sessionStore.restoreSavedSelectionForAssistant(appNames: appNames) else {
                sessionStore.requestBlockConfiguration(appNames: appNames, dailyLimitMinutes: minutes)
                return
            }
            sessionStore.dailyLimitMinutes = minutes
            sessionStore.dailyLimitEnabled = true
            sessionStore.refreshDailyLimitMonitoring()
            applyScreenTimeControls()
            message = sessionStore.dailyLimitRegistered ? "Daily limit set to \(minutes) minutes." : "The daily limit was saved, but iOS could not activate it. Check Screen Time permission."
            messageAction = nil
            finishPendingAssistantAction(
                status: sessionStore.dailyLimitRegistered && sessionStore.dailyLimitEnabled && sessionStore.dailyLimitMinutes == minutes ? "verified" : "failed",
                detail: "daily_limit_state_checked"
            )
        case .disableAllowOnly, .disableAdultFilter, .disableDailyLimit:
            guard !sessionStore.isBlankActive else {
                finishPendingAssistantAction(status: "failed", detail: "controls_locked_during_protection", executionStarted: false)
                return
            }
            switch pendingAction {
            case .disableAllowOnly: sessionStore.allowOnlyModeEnabled = false
            case .disableAdultFilter: sessionStore.adultContentBlockingEnabled = false
            case .disableDailyLimit: sessionStore.dailyLimitEnabled = false
            default: break
            }
            applyScreenTimeControls()
            finishPendingAssistantAction(status: "verified", detail: "control_disabled")
        case .allowOnly:
            sessionStore.allowOnlyModeEnabled = true
            applyScreenTimeControls()
            finishPendingAssistantAction(status: sessionStore.allowOnlyModeEnabled ? "verified" : "failed", detail: "allow_only_state_checked")
        case .adultFilter:
            sessionStore.adultContentBlockingEnabled = true
            applyScreenTimeControls()
            finishPendingAssistantAction(status: sessionStore.adultContentBlockingEnabled ? "verified" : "failed", detail: "adult_filter_state_checked")
        case .pauseRules(let hours):
            sessionStore.enableVacationMode(hours: hours)
            applyScreenTimeControls()
            finishPendingAssistantAction(status: sessionStore.isVacationModeActive ? "verified" : "failed", detail: "pause_state_checked")
        case .disablePause:
            sessionStore.disableVacationMode()
            applyScreenTimeControls()
            finishPendingAssistantAction(status: sessionStore.isVacationModeActive ? "failed" : "verified", detail: "resume_state_checked")
        case .applyAIPlan:
            sessionStore.applyAIPlan()
            applyScreenTimeControls()
            finishPendingAssistantAction(status: sessionStore.recurringScheduleRegistered ? "verified" : "failed", detail: sessionStore.recurringScheduleRegistered ? "ai_plan_registered" : "device_activity_registration_failed")
        case .openAppPicker(let appNames):
            sessionStore.requestBlockConfiguration(appNames: appNames)
        case .configureAndOpenAppPicker(let appNames, let durationMinutes, let hardMode, let schedule):
            sessionStore.requestBlockConfiguration(
                appNames: appNames,
                shouldActivate: schedule == nil,
                durationMinutes: durationMinutes,
                hardMode: hardMode,
                schedule: schedule
            )
        case .configureAndOpenDailyLimitPicker(let appNames, let minutes):
            sessionStore.requestBlockConfiguration(
                appNames: appNames,
                dailyLimitMinutes: minutes
            )
        case .requestScreenTimePermission:
            let code = assistantConnectCode.trimmingCharacters(in: .whitespacesAndNewlines)
            let channel = "app"
            let accountID = AssistantAppSession.userID
            let actionID = pendingAssistantActionId
            Task {
                _ = await screenTimeBlocker.requestAuthorization()
                await MainActor.run {
                    guard assistantIdentityMatches(code: code, channel: channel, owner: accountID),
                          pendingAssistantActionId == actionID else { return }
                    applyScreenTimeControls()
                    finishPendingAssistantAction(
                        status: screenTimeBlocker.authorizationStatus == .approved ? "verified" : "failed",
                        detail: "screen_time_authorization_checked"
                    )
                }
            }
        }
    }

    private func assistantActionRequiresScreenTime(_ action: AssistantPendingAction) -> Bool {
        switch action {
        case .startProtection, .setDailyLimit, .allowOnly, .adultFilter,
             .applySchedule, .updateSchedule, .disablePause, .applyAIPlan,
             .openAppPicker, .configureAndOpenAppPicker, .configureAndOpenDailyLimitPicker:
            return true
        case .deleteSchedule, .deleteAllSchedules, .pauseRules, .requestScreenTimePermission:
            return false
        case .disableAllowOnly, .disableAdultFilter, .disableDailyLimit:
            return false
        }
    }

    private func finishPendingAssistantAction(
        status: String,
        detail: String,
        executionStarted: Bool = true,
        execution: AssistantProtectionExecution? = nil
    ) {
        let actionId = pendingAssistantActionId
        let code = assistantConnectCode.trimmingCharacters(in: .whitespacesAndNewlines)
        let channel = "app"
        guard !actionId.isEmpty else {
            assistantActionExecutionInFlight = false
            return
        }
        let accountID = AssistantAppSession.userID
        let receipt = AssistantActionReceipt(
            actionId: actionId,
            status: status,
            detail: detail,
            executionStarted: executionStarted && status != "dismissed",
            requestedAt: execution.map { ISO8601DateFormatter().string(from: $0.requestedAt) } ?? "",
            startedAt: execution.map { ISO8601DateFormatter().string(from: $0.startedAt) } ?? "",
            requestedDurationMinutes: execution?.requestedDurationMinutes,
            effectiveUntil: execution?.effectiveUntil.map { ISO8601DateFormatter().string(from: $0) } ?? "",
            origin: execution == nil ? "" : "assistant_remote",
            result: execution?.result ?? "",
            startDelaySeconds: execution?.startDelaySeconds,
            mergedWithExisting: execution?.mergedWithExisting ?? false
        )
        AssistantActionReceiptStore.save(
            actionId: receipt.actionId,
            status: receipt.status,
            detail: receipt.detail,
            executionStarted: receipt.executionStarted,
            requestedAt: receipt.requestedAt,
            startedAt: receipt.startedAt,
            requestedDurationMinutes: receipt.requestedDurationMinutes,
            effectiveUntil: receipt.effectiveUntil,
            origin: receipt.origin,
            result: receipt.result,
            startDelaySeconds: receipt.startDelaySeconds,
            mergedWithExisting: receipt.mergedWithExisting
        )
        Task {
            let acknowledgement = await AssistantActionInboxClient().acknowledgeLifecycle(
                receipt: receipt,
                connectCode: code,
                channel: channel
            )
            await MainActor.run {
                assistantActionExecutionInFlight = false
                if acknowledgement == .acknowledged || acknowledgement == .stale {
                    AssistantActionReceiptStore.clear(actionId: actionId)
                    if pendingAssistantActionId == actionId { pendingAssistantActionId = "" }
                }
            }
        }
    }

    private var contextualPickerHeaderText: String {
        "Choose your distractions"
    }

    private var contextualPickerFooterText: String {
        if sessionStore.pendingPlanShouldActivate {
            return "Tap Done to save this list and start protection now."
        }
        if sessionStore.pendingPlanSchedule != nil {
            return "Tap Done to save this list and add its schedule."
        }
        if sessionStore.pendingPlanDailyLimitMinutes != nil {
            return "Tap Done to save this list and apply its daily limit."
        }
        return "Choose every app, category or website that distracts you. You can edit this one list later."
    }

    private var riskWindowText: String {
        aiSystem.forecast.riskWindow
    }

    private func syncAssistantContext() {
        BlankBrain.shared.sync()
    }

    private func refreshAssistantNotificationAuthorization() {
        Task {
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            let granted = settings.authorizationStatus == .authorized
                || settings.authorizationStatus == .provisional
                || settings.authorizationStatus == .ephemeral
            let authorized = granted && (settings.alertSetting == .enabled
                || settings.notificationCenterSetting == .enabled
                || settings.lockScreenSetting == .enabled)
            guard assistantNotificationsAuthorized != authorized else { return }
            assistantNotificationsAuthorized = authorized
            syncAssistantContext()
        }
    }

    private func pollPendingAssistantActionIfNeeded(force: Bool = false, now: Date = Date()) {
        guard force || now.timeIntervalSince(lastAssistantActionPollAt) >= 5 else { return }
        guard !assistantActionPollInFlight,
              !showingAssistantChat,
              !assistantActionExecutionInFlight,
              !showingContextualAppPicker,
              sessionStore.pendingAssistantAction == nil else { return }
        let code = assistantConnectCode.trimmingCharacters(in: .whitespacesAndNewlines)
        let channel = "app"
        lastAssistantActionPollAt = now
        assistantActionPollInFlight = true
        let accountID = AssistantAppSession.userID
        let applyNowRequested = BlankSharedState.defaults.bool(forKey: AssistantRemoteNotification.pollAfterOpenKey)
        // An old receipt must not starve an explicitly requested newer action.
        if !applyNowRequested, let receipt = AssistantActionReceiptStore.load() {
            Task {
                let acknowledgement = await AssistantActionInboxClient().acknowledgeLifecycle(
                    receipt: receipt,
                    connectCode: code,
                    channel: channel
                )
                await MainActor.run {
                    assistantActionPollInFlight = false
                    guard assistantIdentityMatches(code: code, channel: channel, owner: accountID) else { return }
                    if acknowledgement == .acknowledged || acknowledgement == .stale {
                        AssistantActionReceiptStore.clear(actionId: receipt.actionId)
                        if pendingAssistantActionId == receipt.actionId {
                            pendingAssistantActionId = ""
                        }
                        pollPendingAssistantActionIfNeeded(force: true)
                    }
                }
            }
            return
        }
        Task {
            let pollResult = await AssistantActionInboxClient().poll(
                connectCode: code,
                channel: channel
            )
            await MainActor.run {
                assistantActionPollInFlight = false
                guard assistantIdentityMatches(code: code, channel: channel, owner: accountID) else { return }
                // Read this after the network round-trip. On a cold launch the
                // notification response can arrive while the initial poll is
                // already in flight; reading it before the request loses the tap.
                let currentApplyRequest = BlankSharedState.defaults.bool(forKey: AssistantRemoteNotification.pollAfterOpenKey)
                guard case .success(let remoteAction) = pollResult else { return }
                guard let remoteAction else {
                    if currentApplyRequest { clearAssistantNotificationRequest() }
                    return
                }
                guard let pendingAction = remoteAction.toPendingAction(),
                      sessionStore.pendingAssistantAction == nil else { return }
                guard currentApplyRequest else { return }
                let tappedActionID = BlankSharedState.defaults.string(forKey: AssistantRemoteNotification.tappedActionIDKey) ?? ""
                guard tappedActionID.isEmpty || tappedActionID == remoteAction.id else {
                    clearAssistantNotificationRequest()
                    return
                }
                clearAssistantNotificationRequest()
                pendingAssistantActionId = remoteAction.id
                pendingAssistantInboxAction = remoteAction
                sessionStore.requestAssistantActionConfirmation(pendingAction)
                confirmPendingAssistantAction()
            }
        }
    }

    private func clearAssistantNotificationRequest() {
        BlankSharedState.defaults.removeObject(forKey: AssistantRemoteNotification.pollAfterOpenKey)
        BlankSharedState.defaults.removeObject(forKey: AssistantRemoteNotification.tappedActionIDKey)
    }

    private func activateAppChannel() async {
        let activatedCode: String
        do { activatedCode = try await AssistantAppClient().activate() } catch { return }
        assistantConnectCode = activatedCode
        syncAssistantContext()
        let token = BlankSharedState.defaults.string(forKey: "blankAssistantPushToken") ?? ""
        guard !token.isEmpty, !assistantConnectCode.isEmpty else { return }
        #if DEBUG
        let environment = "sandbox"
        #else
        let environment = "production"
        #endif
        let registered = await AssistantActionInboxClient().registerDevicePush(
            token: token, environment: environment, connectCode: assistantConnectCode,
            channel: "app"
        )
        BlankSharedState.defaults.set(registered, forKey: "blankAssistantPushRegistered")
        if registered { syncAssistantContext() }
    }

    private func assistantIdentityMatches(code: String, channel: String, owner: String?) -> Bool {
        let currentChannel = "app"
        return code == assistantConnectCode.trimmingCharacters(in: .whitespacesAndNewlines)
            && channel == currentChannel && owner == AssistantAppSession.userID
    }

    private func clearPendingAssistantIdentityState() {
        clearAssistantNotificationRequest()
        pendingAssistantActionId = ""
        pendingAssistantInboxAction = nil
        sessionStore.clearAssistantActionConfirmation()
        sessionStore.clearPendingPlanAppNames()
        sessionStore.shouldOpenBlockConfiguration = false
        showingContextualAppPicker = false
        assistantActionExecutionInFlight = false
    }

    private var relapseIntervention: RelapseIntervention {
        guard let recoveryScore = homeRecoveryScore(), recoveryScore < 45 else {
            return aiSystem.relapseIntervention
        }
        return RelapseIntervention(
            headline: "Make this easier, not broken.",
            cost: "Low recovery days are when automatic scrolling wins faster.",
            alternative: "Hold 5 more minutes, then do a shorter next block."
        )
    }

    private func homeRecoveryScore() -> Int? {
        let recent = Array(healthKitStore.summaries.suffix(7))
        var scoreParts: [Int] = []
        let sleepValues = recent.compactMap(\.sleepMinutes)
        let stepValues = recent.compactMap(\.steps)
        let workoutValues = recent.compactMap(\.workoutMinutes)

        if let averageSleep = average(sleepValues) {
            scoreParts.append(min(100, max(0, Int(Double(averageSleep) / (8 * 60) * 100))))
        }
        if let averageSteps = average(stepValues) {
            scoreParts.append(min(100, max(0, Int(Double(averageSteps) / 8000 * 100))))
        }
        if let averageWorkout = average(workoutValues) {
            scoreParts.append(min(100, max(0, Int(Double(averageWorkout) / 30 * 100))))
        }
        return average(scoreParts)
    }

    private func average(_ values: [Int]) -> Int? {
        values.isEmpty ? nil : values.reduce(0, +) / values.count
    }

    private func resolve(_ action: HomeMessageAction) {
        switch action {
        case .screenTime:
            Task { @MainActor in
                let approved = await screenTimeBlocker.requestAuthorization()
                message = approved ? nil : "Screen Time is still pending."
                messageAction = approved ? nil : .screenTime
            }
        case .relinkNfc:
            showingRelink = true
        case .selectApps:
            showingPicker = true
        }
    }

    private func showPendingBAIProactiveAlertIfNeeded() {
        let defaults = BlankSharedState.defaults
        // Discard the previous brain's cached copy; BMB owns all proactive text.
        for key in ["blankBAIProactiveAlertId","blankBAIProactiveAlertBody","blankBAIProactiveAlertCreatedAt","blankBAIProactiveAlertConsumedId"] {
            defaults.removeObject(forKey:key)
        }
    }

    private func setMessage(for result: SessionStore.NfcResult) {
        switch result {
        case .tagRegistered:
            message = "NFC registered."
            messageAction = nil
        case .blanked, .unblanked:
            message = nil
            messageAction = nil
        case .schedulePaused:
            message = "Apps unlocked for 5 minutes."
            messageAction = nil
        case .wrongTag:
            message = "That NFC is not your Blank tag."
            messageAction = nil
        case .noAppsSelected:
            message = "No apps selected"
            messageAction = .selectApps
        case .hardBlankLocked:
            message = "Hard protection: use Emergency to unlock early."
            messageAction = nil
        }
    }

    private func elapsedText(since date: Date) -> String {
        let elapsed = max(0, Int(now.timeIntervalSince(date)))
        let hours = elapsed / 3600
        let minutes = (elapsed % 3600) / 60
        let seconds = elapsed % 60
        return String(format: "%02d:%02d:%02d", hours, minutes, seconds)
    }

    private func remainingText(until date: Date) -> String {
        let remaining = max(0, Int(date.timeIntervalSince(now)))
        let hours = remaining / 3600
        let minutes = (remaining % 3600) / 60
        if hours > 0 {
            return "\(hours)h \(minutes)m"
        }
        return "\(minutes)m"
    }
}

private extension View {
    func blankHomeDisplayTextStyle(color: Color) -> some View {
        font(.blankInter(size: 32, relativeTo: .title))
            .foregroundStyle(color)
            .tracking(-0.9)
            .lineLimit(1)
            .minimumScaleFactor(0.72)
            .lineSpacing(0)
    }
}

private struct HomeLayoutMetrics {
    let horizontalPadding: CGFloat
    let topPadding: CGFloat
    let configTopPadding: CGFloat
    let bottomPadding: CGFloat
    let messageMaxWidth: CGFloat
    let actionWidth: CGFloat
    let centerX: CGFloat
    let topBarCenterY: CGFloat
    let messageCenterY: CGFloat
    let bottomShortcutCenterY: CGFloat

    init(size: CGSize, safeAreaInsets: EdgeInsets) {
        let width = max(size.width, 320)
        let height = max(size.height, 600)
        let topSafeArea = safeAreaInsets.top > 0 ? safeAreaInsets.top : 44
        horizontalPadding = min(max(width * 0.075, 28), 36)
        topPadding = topSafeArea + 26
        configTopPadding = topPadding + 47 + 14
        bottomPadding = max(safeAreaInsets.bottom + 18, 34)
        messageMaxWidth = min(max(width - horizontalPadding * 2, 280), 350)
        actionWidth = min(max(width - horizontalPadding * 2, 260), 342)
        centerX = width / 2
        topBarCenterY = topPadding + 47 / 2
        messageCenterY = height * 0.52
        bottomShortcutCenterY = height - bottomPadding - 22
    }
}

private struct HomeBlankButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        let glassTint = BlankColors.paleSteelBlue.opacity(configuration.isPressed ? 0.58 : 0.48)
        let capsuleBorder = LinearGradient(
            colors: [
                BlankColors.pureWhite.opacity(0.42),
                BlankColors.pureWhite.opacity(0.16),
                BlankColors.pureWhite.opacity(0.04),
                BlankColors.pureWhite.opacity(0.00)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )

        configuration.label
            .font(.blankInter(size: 16, weight: .regular, relativeTo: .headline))
            .foregroundStyle(BlankColors.pureWhite)
            .foregroundColor(BlankColors.pureWhite)
            .frame(maxWidth: .infinity)
            .frame(height: 50)
            .background {
                ZStack {
                    Capsule().fill(.ultraThinMaterial)
                    Capsule().fill(glassTint)
                    GlassCornerHighlight(width: 78, height: 30, xOffset: -64, yOffset: -16)
                        .clipShape(Capsule())
                    Capsule().stroke(capsuleBorder, lineWidth: 1)
                }
                .allowsHitTesting(false)
            }
            .shadow(color: BlankColors.charcoal.opacity(configuration.isPressed ? 0.02 : 0.05), radius: 5, y: 3)
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
    }
}

private struct GlassCornerHighlight: View {
    let width: CGFloat
    let height: CGFloat
    let xOffset: CGFloat
    let yOffset: CGFloat

    var body: some View {
        Ellipse()
            .fill(
                RadialGradient(
                    colors: [
                        BlankColors.pureWhite.opacity(0.24),
                        BlankColors.pureWhite.opacity(0.08),
                        BlankColors.pureWhite.opacity(0.00)
                    ],
                    center: .center,
                    startRadius: 0,
                    endRadius: max(width, height) / 2
                )
            )
            .frame(width: width, height: height)
            .offset(x: xOffset, y: yOffset)
    }
}

private enum HomeMessageAction {
    case screenTime
    case relinkNfc
    case selectApps
}

struct AppBackground: View {
    let isActive: Bool
    var body: some View {
        (isActive ? BlankColors.charcoal : BlankColors.pureWhite).ignoresSafeArea()
    }
}

private extension View {
}

struct HomeSectionScreen: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @Binding var showingPicker: Bool
    let section: HomeSection
    let screenWidth: CGFloat
    let screenHeight: CGFloat
    var horizontalOffset: CGFloat = 0
    let intervention: RelapseIntervention
    let onEmergencyUnlock: () -> Bool
    let onOpenSection: (HomeSection) -> Void
    let onOpenAssistant: () -> Void
    let onRequestScreenTimePermission: () -> Void
    let onRequestHealthAccess: () -> Void
    let screenTimeStatus: String
    let healthStatus: String
    let onClose: () -> Void
    private var textColor: Color { sessionStore.isBlankActive ? BlankColors.pureWhite : BlankColors.ink }

    var body: some View {
        let sectionHorizontalPadding: CGFloat = 24
        let contentWidth = screenWidth
        let minimalAppearance = true

        ZStack(alignment: .topLeading) {
            if minimalAppearance {
                (sessionStore.isBlankActive ? BlankColors.newLookDarkBackground : BlankColors.minimalBackground)
                    .ignoresSafeArea()
            } else {
                AppBackground(isActive: true)
                    .ignoresSafeArea()
            }

            routeContent
                .environment(\.blankMinimalAppearance, minimalAppearance)
                .environment(\.blankSectionHorizontalPadding, sectionHorizontalPadding)
                .padding(.top, 60)
                .frame(width: contentWidth, height: screenHeight, alignment: .top)
                .frame(width: screenWidth, height: screenHeight, alignment: .top)
                .offset(x: horizontalOffset)
        }
        .frame(width: screenWidth, height: screenHeight, alignment: .topLeading)
        .preferredColorScheme(sessionStore.isBlankActive ? .dark : .light)
    }

    @ViewBuilder
    private var routeContent: some View {
        switch section {
        case .distractions:
            DistractionsScreen(showingPicker: $showingPicker) {
                onClose()
            }
        case .schedule:
            ScheduleEditorContent(onSave: onClose, onClose: onClose)
        case .report:
            ReportView(usesMainBackground: true, onClose: onClose)
        case .emergency:
            EmergencyScreen(
                emergencyUnlocksRemaining: sessionStore.emergencyUnlocksRemaining,
                intervention: intervention,
                onUnlock: onEmergencyUnlock,
                onClose: onClose
            )
        case .settings:
            SettingsScreen(
                onClose: onClose,
                onOpenEmergency: { onOpenSection(.emergency) },
                onOpenAssistant: onOpenAssistant,
                onRequestScreenTimePermission: onRequestScreenTimePermission,
                onRequestHealthAccess: onRequestHealthAccess,
                screenTimeStatus: screenTimeStatus,
                healthStatus: healthStatus
            )
        }
    }
}

struct SectionBackHeader: View {
    @EnvironmentObject private var sessionStore: SessionStore
    let action: () -> Void

    var body: some View {
        HStack {
            Button(action: action) {
                Label("Back", systemImage: "chevron.left")
                    .font(.blankInter(size: 14))
                    .foregroundStyle(sessionStore.isBlankActive ? BlankColors.pureWhite.opacity(0.72) : BlankColors.premiumBlue)
                    .frame(minWidth: 44, minHeight: 44, alignment: .leading)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("back")

            Spacer()
        }
        .padding(.top, 16)
        .padding(.bottom, 22)
    }
}

struct SectionHeader: View {
    @EnvironmentObject private var sessionStore: SessionStore
    let title: String
    let subtitle: String
    let action: () -> Void
    var titleColor: Color? = nil
    var subtitleColor: Color? = nil

    private var resolvedTitleColor: Color {
        titleColor ?? (sessionStore.isBlankActive ? BlankColors.pureWhite : BlankColors.charcoal)
    }

    private var resolvedSubtitleColor: Color {
        subtitleColor ?? (sessionStore.isBlankActive ? BlankColors.pureWhite.opacity(0.70) : BlankColors.mutedInk)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionBackHeader(action: action)

            Text(title.capitalized)
                .font(.blankSectionEditorial())
                .tracking(-0.9)
                .foregroundStyle(resolvedTitleColor)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)

            Text(subtitle)
                .font(.blankInter(size: 14, relativeTo: .subheadline))
                .foregroundStyle(resolvedSubtitleColor)
                .lineSpacing(0)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 24)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct SettingsScreen: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @Environment(\.openURL) private var openURL
    @Environment(\.blankSectionHorizontalPadding) private var sectionHorizontalPadding
    @State private var showingAccount = false
    @State private var showingBMBSettings = false

    let onClose: () -> Void
    let onOpenEmergency: () -> Void
    let onOpenAssistant: () -> Void
    let onRequestScreenTimePermission: () -> Void
    let onRequestHealthAccess: () -> Void
    let screenTimeStatus: String
    let healthStatus: String

    private var textColor: Color { sessionStore.isBlankActive ? BlankColors.pureWhite : BlankColors.ink }
    private var secondaryColor: Color { sessionStore.isBlankActive ? BlankColors.pureWhite.opacity(0.70) : BlankColors.mutedInk }

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader(
                    title: "settings",
                    subtitle: "access, support and preferences.",
                    action: onClose,
                    titleColor: textColor,
                    subtitleColor: secondaryColor
                )
                .padding(.bottom, 12)

                settingsRow(title: "blankmind", detail: "autonomy and notifications", action: { showingBMBSettings = true })
                settingsRow(
                    title: "emergency",
                    detail: "unlock access while blanked",
                    action: onOpenEmergency
                )

                settingsRow(
                    title: "screen time",
                    detail: "screen time \(screenTimeStatus.lowercased())",
                    symbol: screenTimeStatus == "approved" ? "checkmark" : "chevron.right",
                    action: onRequestScreenTimePermission
                )

                settingsRow(
                    title: "health",
                    detail: "apple health \(healthStatus.lowercased())",
                    symbol: healthStatus == "connected" ? "checkmark" : "chevron.right",
                    action: onRequestHealthAccess
                )

                settingsRow(
                    title: "assistant",
                    detail: "conversation and account",
                    action: onOpenAssistant
                )

                settingsRow(
                    title: "account",
                    detail: "Apple sign-in and account controls",
                    action: { showingAccount = true }
                )

                settingsRow(
                    title: "privacy policy",
                    detail: "how Blankmind handles your data",
                    symbol: "arrow.up.right",
                    action: { openURL(URL(string: "https://blankmind.ai/privacy")!) }
                )

                settingsRow(
                    title: "terms of service",
                    detail: "terms for using Blankmind",
                    symbol: "arrow.up.right",
                    action: { openURL(URL(string: "https://blankmind.ai/terms")!) }
                )
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.bottom, 24)
        }
        .padding(.horizontal, sectionHorizontalPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .sheet(isPresented: $showingBMBSettings) { BMBSettingsView() }
        .sheet(isPresented: $showingAccount) {
            AccountSettingsSheet()
                .environmentObject(sessionStore)
        }
    }

    private func settingsRow(
        title: String,
        detail: String,
        symbol: String = "chevron.right",
        color: Color? = nil,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(title.capitalized)
                        .font(.blankOnboardingControl)

                    Text(detail)
                        .font(.blankInter(size: 12, relativeTo: .caption))
                        .foregroundStyle(BlankColors.cardInk.opacity(0.72))
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Image(systemName: symbol)
                    .font(.system(size: 12, weight: .regular))
                    .accessibilityHidden(true)
            }
            .foregroundStyle(color ?? BlankColors.cardInk)
            .blankBlackCard()
            .contentShape(RoundedRectangle(cornerRadius: 4))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
        .accessibilityValue(detail)
    }
}

private struct ScheduleEditorContent: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.blankSectionHorizontalPadding) private var sectionHorizontalPadding
    let onSave: () -> Void
    let onClose: () -> Void
    @State private var windows: [BlankHabitWindow] = [BlankHabitWindow(name: "Routine 1", enabled: false)]
    private var textColor: Color { sessionStore.isBlankActive ? BlankColors.pureWhite : BlankColors.ink }
    private var secondaryColor: Color { sessionStore.isBlankActive ? BlankColors.pureWhite.opacity(0.70) : BlankColors.mutedInk }

    var body: some View {
        List {
            VStack(alignment: .center, spacing: 16) {
                SectionHeader(
                    title: "Routines",
                    subtitle: "BM schedules routines.\nYou review and override them here.",
                    action: onClose,
                    titleColor: textColor,
                    subtitleColor: secondaryColor
                )
                .padding(.bottom, 8)

                baiHabitsSummary

                Text("manual overrides")
                    .font(.blankInter(size: 13, weight: .semibold, relativeTo: .caption))
                    .foregroundStyle(secondaryColor)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 2)

                VStack(spacing: 12) {
                    ForEach($windows) { $window in
                        HabitWindowCard(
                            window: $window,
                            canDelete: windows.count > 1,
                            textColor: textColor,
                            secondaryColor: secondaryColor
                        ) {
                            deleteWindow(window.id)
                        }
                    }
                }

                Button {
                    addWindow()
                } label: {
                    Label("add manually", systemImage: "plus")
                        .font(.blankInter(size: 15, weight: .semibold, relativeTo: .subheadline))
                        .foregroundStyle(textColor)
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .blankGlassCard(cornerRadius: 18, tintOpacity: 0.22)
                }
                .buttonStyle(.plain)

                VacationModeCard(
                    textColor: textColor,
                    secondaryColor: secondaryColor
                )

                Text("manual exits pause only the current habit window.")
                    .font(.footnote)
                    .foregroundStyle(secondaryColor)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 300)
                    .padding(.top, 2)

                Button {
                    saveSchedule()
                } label: {
                    TopSheetPrimaryButtonLabel(title: "save habits")
                }
                .padding(.top, 6)
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, sectionHorizontalPadding)
            .padding(.bottom, 34)
            .listRowInsets(EdgeInsets())
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .scrollIndicators(.hidden)
        .background(Color.clear)
        .preferredColorScheme(sessionStore.isBlankActive ? .dark : .light)
        .onAppear {
            windows = sessionStore.schedule.windows.isEmpty
                ? [BlankHabitWindow(name: "Routine 1", enabled: false)]
                : sessionStore.schedule.windows
        }
    }

    private func saveSchedule() {
        let normalized = windows.enumerated().map { index, window in
            BlankHabitWindow(
                id: window.id,
                name: window.name.isEmpty ? "Routine \(index + 1)" : window.name,
                enabled: window.enabled,
                startMinute: window.startMinute,
                endMinute: window.endMinute,
                weekdays: window.weekdays,
                expiresAt: window.expiresAt,
                startsAt: window.startsAt,
                endsAt: window.endsAt,
                timeZoneIdentifier: window.timeZoneIdentifier
            )
        }
        let first = normalized.first ?? BlankHabitWindow(enabled: false)
        sessionStore.schedule = BlankFocusSchedule(
            enabled: normalized.contains { $0.enabled },
            startMinute: first.startMinute,
            endMinute: first.endMinute,
            windows: normalized
        )
        onSave()
        dismiss()
    }

    private func addWindow() {
        let number = windows.count + 1
        windows.append(BlankHabitWindow(name: "Routine \(number)", enabled: true, startMinute: 9 * 60, endMinute: 10 * 60))
    }

    private func deleteWindow(_ id: UUID) {
        guard windows.count > 1 else { return }
        windows.removeAll { $0.id == id }
    }

    private var baiHabitsSummary: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "sparkles")
                    .font(.system(size: 17, weight: .semibold))
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(textColor.opacity(0.10)))

                VStack(alignment: .leading, spacing: 6) {
                    Text("recurring bm routines")
                        .font(.blankInter(size: 18, weight: .semibold, relativeTo: .headline))
                    Text(habitSummaryText)
                        .font(.blankInter(size: 15, weight: .medium, relativeTo: .body))
                        .foregroundStyle(secondaryColor)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer()
            }

            Divider()
                .overlay(secondaryColor.opacity(0.20))

            HStack(spacing: 10) {
                habitMetric(title: "active", value: "\(enabledWindows.count)")
                habitMetric(title: "total", value: "\(windows.count)")
                habitMetric(title: "pause", value: sessionStore.isVacationModeActive ? "on" : "off")
            }
        }
        .foregroundStyle(textColor)
        .padding(18)
        .blankGlassCard(cornerRadius: 20, tintOpacity: 0.30)
    }

    private var enabledWindows: [BlankHabitWindow] {
        windows.filter { $0.enabled }
    }

    private var habitSummaryText: String {
        guard let first = enabledWindows.first else {
            return "no active routine yet. ask bm to create one, then approve it here."
        }
        return "\(first.name): \(formatMinute(first.startMinute)) to \(formatMinute(first.endMinute))"
    }

    private func habitMetric(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(secondaryColor)
            Text(value)
                .font(.blankInter(size: 15, weight: .semibold, relativeTo: .subheadline))
                .foregroundStyle(textColor)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct VacationModeCard: View {
    @EnvironmentObject private var sessionStore: SessionStore
    let textColor: Color
    let secondaryColor: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("vacation mode")
                        .font(.blankInter(size: 16, weight: .semibold, relativeTo: .headline))
                        .foregroundStyle(textColor)
                    Text(statusText)
                        .font(.caption)
                        .foregroundStyle(secondaryColor)
                }
                Spacer()
                if sessionStore.isVacationModeActive {
                    Button("off") {
                        sessionStore.disableVacationMode()
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(textColor)
                    .buttonStyle(.plain)
                }
            }

            if !sessionStore.isVacationModeActive {
                HStack(spacing: 10) {
                    vacationButton("today", hours: 24)
                    vacationButton("weekend", hours: 72)
                    vacationButton("week", hours: 168)
                }
            }
        }
        .padding(16)
        .blankGlassCard(cornerRadius: 18, tintOpacity: sessionStore.isVacationModeActive ? 0.32 : 0.20)
    }

    private var statusText: String {
        guard let until = sessionStore.vacationModeUntil, until > Date() else {
            return "pause routines and daily limits temporarily."
        }
        return "paused until \(formatMinute(minuteOfDay(from: until)))."
    }

    private func vacationButton(_ title: String, hours: Int) -> some View {
        Button {
            sessionStore.enableVacationMode(hours: hours)
        } label: {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(textColor)
                .frame(maxWidth: .infinity)
                .frame(height: 38)
                .blankGlassCard(cornerRadius: 14, tintOpacity: 0.20)
        }
        .buttonStyle(.plain)
    }
}

private struct HabitWindowCard: View {
    @Binding var window: BlankHabitWindow
    let canDelete: Bool
    let textColor: Color
    let secondaryColor: Color
    let onDelete: () -> Void
    @State private var isExpanded = false

    var body: some View {
        VStack(spacing: 14) {
            HStack(spacing: 10) {
                Image(systemName: "clock.badge.checkmark")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(textColor.opacity(0.86))
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(textColor.opacity(0.10)))

                TextField("routine", text: $window.name)
                    .font(.blankInter(size: 17, weight: .semibold, relativeTo: .headline))
                    .foregroundStyle(textColor)
                    .submitLabel(.done)

                Toggle("", isOn: $window.enabled)
                    .labelsHidden()

                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        isExpanded.toggle()
                    }
                } label: {
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(secondaryColor)
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
            }

            HStack(spacing: 8) {
                routineMetric(title: "start", value: formatMinute(window.startMinute))
                routineMetric(title: "end", value: formatMinute(window.endMinute))
                routineMetric(title: window.startsAt == nil ? "days" : "date", value: daysSummary)
            }

            if isExpanded {
                VStack(spacing: 12) {
                    VStack(spacing: 10) {
                        WheelTimePicker(minute: $window.startMinute)
                        WheelTimePicker(minute: $window.endMinute)
                    }
                    .padding(.top, 2)
                    .disabled(window.startsAt != nil)

                    HabitDaysPicker(
                        selectedWeekdays: $window.weekdays,
                        textColor: textColor,
                        secondaryColor: secondaryColor
                    )
                    .disabled(window.startsAt != nil)

                    if canDelete {
                        Button(action: onDelete) {
                            Label("delete routine", systemImage: "trash")
                                .font(.blankInter(size: 14, weight: .semibold, relativeTo: .subheadline))
                                .foregroundStyle(secondaryColor)
                                .frame(maxWidth: .infinity)
                                .frame(height: 44)
                                .blankGlassCard(cornerRadius: 16, tintOpacity: 0.12)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(16)
        .foregroundStyle(textColor)
        .blankControlSurface(cornerRadius: 20, tintOpacity: window.enabled ? 0.10 : 0.06)
        .opacity(window.enabled ? 1 : 0.72)
    }

    private func routineMetric(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(secondaryColor)
            Text(value)
                .font(.blankInter(size: 13, weight: .semibold, relativeTo: .caption))
                .foregroundStyle(textColor)
                .lineLimit(1)
                .minimumScaleFactor(0.74)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 10)
        .frame(height: 48)
        .background {
            RoundedRectangle(cornerRadius: 15, style: .continuous)
                .fill(textColor.opacity(0.075))
        }
    }

    private var daysSummary: String {
        if let start = window.startsAt {
            let formatter = DateFormatter(); formatter.dateFormat = "MMM d"
            if let timezone = window.timeZoneIdentifier { formatter.timeZone = TimeZone(identifier:timezone) }
            return formatter.string(from:start)
        }
        if window.runsEveryDay {
            return "everyday"
        }
        return "\(window.weekdays.count)d"
    }
}

private struct HabitDaysPicker: View {
    @Binding var selectedWeekdays: [Int]
    let textColor: Color
    let secondaryColor: Color

    private let days: [(id: Int, label: String)] = [
        (2, "m"),
        (3, "t"),
        (4, "w"),
        (5, "t"),
        (6, "f"),
        (7, "s"),
        (1, "s")
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("days")
                    .font(.blankInter(size: 12, weight: .semibold, relativeTo: .caption))
                    .foregroundStyle(secondaryColor)
                Spacer()
                Text(summary)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(textColor.opacity(0.86))
            }

            HStack(spacing: 7) {
                ForEach(days, id: \.id) { day in
                    Button {
                        toggle(day.id)
                    } label: {
                        Text(day.label)
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(isSelected(day.id) ? BlankColors.ink : textColor)
                            .frame(maxWidth: .infinity)
                            .frame(height: 34)
                            .background {
                                Capsule()
                                    .fill(isSelected(day.id) ? BlankColors.pureWhite.opacity(0.82) : BlankColors.pureWhite.opacity(0.12))
                            }
                    }
                    .buttonStyle(.plain)
                }
            }

            HStack(spacing: 8) {
                presetButton("every day", weekdays: Array(1...7))
                presetButton("weekdays", weekdays: [2, 3, 4, 5, 6])
                presetButton("weekend", weekdays: [1, 7])
            }
        }
    }

    private var summary: String {
        let set = Set(selectedWeekdays)
        if set == Set(1...7) { return "every day" }
        if set == Set([2, 3, 4, 5, 6]) { return "weekdays" }
        if set == Set([1, 7]) { return "weekend" }
        return "\(selectedWeekdays.count) days"
    }

    private func presetButton(_ title: String, weekdays: [Int]) -> some View {
        Button {
            selectedWeekdays = weekdays
        } label: {
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(textColor)
                .frame(maxWidth: .infinity)
                .frame(height: 30)
                .background {
                    Capsule().fill(BlankColors.pureWhite.opacity(Set(selectedWeekdays) == Set(weekdays) ? 0.20 : 0.10))
                }
        }
        .buttonStyle(.plain)
    }

    private func isSelected(_ weekday: Int) -> Bool {
        selectedWeekdays.contains(weekday)
    }

    private func toggle(_ weekday: Int) {
        var set = Set(selectedWeekdays)
        if set.contains(weekday), set.count > 1 {
            set.remove(weekday)
        } else {
            set.insert(weekday)
        }
        selectedWeekdays = set.sorted()
    }
}

private struct WheelTimePicker: View {
    @Binding var minute: Int

    var body: some View {
        DatePicker("", selection: dateBinding, displayedComponents: .hourAndMinute)
            .datePickerStyle(.wheel)
            .labelsHidden()
            .frame(height: 96)
            .clipped()
            .colorScheme(.dark)
        .frame(maxWidth: .infinity)
    }

    private var dateBinding: Binding<Date> {
        Binding(
            get: { dateForMinute(minute) },
            set: { minute = minuteOfDay(from: $0) }
        )
    }
}

private struct ForgetBlankConfirmSheet: View {
    @Environment(\.dismiss) private var dismiss
    let onConfirm: () -> Void

    var body: some View {
        TechnicalSettingsSheetLayout {
            TechnicalSheetTitle("I forgot my Blank")
            TechnicalSheetDescription("This turns Blank off, removes the linked item, and returns to onboarding so you can register a new one.")
            TechnicalSheetDescription("Your distraction list and protection settings stay saved.", emphasized: true)
            TechnicalSheetActions {
                Button("I forgot my Blank") {
                    onConfirm()
                    dismiss()
                }
                .buttonStyle(BlankPrimaryButtonStyle())

                Button("Cancel") {
                    dismiss()
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
        }
    }

}

private struct RelapseReviewSheet: View {
    let onSelect: (RelapseReviewReason) -> Void
    let onDismiss: () -> Void

    var body: some View {
        GeometryReader { proxy in
            let horizontalPadding = min(max(proxy.size.width * 0.075, 28), 36)
            let bottomInset = max(proxy.safeAreaInsets.bottom + 18, 34) + 51

            ZStack {
                BlankColors.homeDarkBackground
                    .ignoresSafeArea()

                ZStack(alignment: .bottomLeading) {
                    Text("why now?")
                        .font(.blankInter(size: 32, weight: .semibold, relativeTo: .largeTitle))
                        .tracking(0)
                        .foregroundStyle(BlankColors.pureWhite)
                        .lineLimit(1)
                        .minimumScaleFactor(0.78)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)

                    VStack(alignment: .leading, spacing: -8) {
                        ForEach(RelapseReviewReason.allCases) { reason in
                            Button {
                                onSelect(reason)
                            } label: {
                                RelapseReasonTile(reason: reason)
                            }
                            .buttonStyle(RelapseReasonButtonStyle())
                        }

                        Button {
                            onDismiss()
                        } label: {
                            Text("skip")
                                .font(.blankInter(size: 32, weight: .semibold, relativeTo: .title))
                                .tracking(0)
                                .foregroundStyle(BlankColors.homeDarkSecondary)
                                .lineLimit(1)
                                .minimumScaleFactor(0.72)
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.bottom, bottomInset)
                }
                .padding(.horizontal, horizontalPadding)
            }
        }
        .preferredColorScheme(.dark)
    }
}

private struct RelapseReasonTile: View {
    let reason: RelapseReviewReason

    var body: some View {
        HStack {
            Text(reason.title.lowercased())
                .font(.blankInter(size: 32, weight: .semibold, relativeTo: .title))
                .tracking(0)
                .foregroundStyle(BlankColors.homeDarkSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
        }
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .contentShape(Rectangle())
    }
}

private struct RelapseReasonButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.52 : 1)
            .animation(.easeOut(duration: 0.16), value: configuration.isPressed)
    }
}

private struct EmergencyScreen: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @Environment(\.blankMinimalAppearance) private var minimalAppearance
    @Environment(\.blankSectionHorizontalPadding) private var sectionHorizontalPadding
    let emergencyUnlocksRemaining: Int
    let intervention: RelapseIntervention
    let onUnlock: () -> Bool
    let onClose: () -> Void
    @State private var isConfirming = false
    private var textColor: Color { sessionStore.isBlankActive ? BlankColors.pureWhite : BlankColors.ink }
    private var secondaryColor: Color { sessionStore.isBlankActive ? BlankColors.pureWhite.opacity(0.70) : BlankColors.mutedInk }

    var body: some View {
        VStack(alignment: minimalAppearance ? .leading : .center, spacing: 0) {
            if minimalAppearance {
                SectionBackHeader(action: onClose)
            }

            VStack(alignment: minimalAppearance ? .leading : .center, spacing: minimalAppearance ? 0 : 10) {
                if !minimalAppearance {
                    Image(systemName: isConfirming ? "lock.open.fill" : "shield.lefthalf.filled")
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(textColor)
                        .frame(width: 52, height: 52)
                        .background {
                            Circle().fill(textColor.opacity(0.08))
                        }
                }

                Text(isConfirming ? "spend emergency?" : "emergency")
                    .font(.blankInter(
                        size: minimalAppearance ? 40 : 34,
                        weight: minimalAppearance ? .bold : .medium,
                        relativeTo: .largeTitle
                    ))
                    .tracking(minimalAppearance ? -0.6 : 0)
                    .foregroundStyle(textColor)
                    .multilineTextAlignment(minimalAppearance ? .leading : .center)

                Text(bodyText)
                    .font(.blankInter(size: minimalAppearance ? 14 : 16, weight: .regular, relativeTo: .body))
                    .foregroundStyle(secondaryColor)
                    .multilineTextAlignment(minimalAppearance ? .leading : .center)
                    .lineSpacing(minimalAppearance ? 0 : 3)
                    .frame(maxWidth: 300)
                    .padding(.top, minimalAppearance ? 5 : 0)
                    .padding(.bottom, minimalAppearance ? 24 : 0)
            }
            .frame(maxWidth: .infinity, alignment: minimalAppearance ? .leading : .center)

            emergencyAllowance
                .padding(.bottom, minimalAppearance ? 24 : 0)

            VStack(spacing: 12) {
                if isConfirming {
                    Button(minimalAppearance ? "keep blocking" : "Keep blocking") {
                        isConfirming = false
                    }
                    .buttonStyle(BlankPrimaryButtonStyle())

                    Button(minimalAppearance ? "confirm unlock" : "Confirm unlock") {
                        _ = onUnlock()
                    }
                    .font(.blankInter(size: 15, weight: .semibold, relativeTo: .subheadline))
                    .buttonStyle(.plain)
                    .foregroundStyle(secondaryColor)
                    .disabled(emergencyUnlocksRemaining <= 0)
                } else {
                    Button(minimalAppearance ? "spend emergency" : "Spend emergency") {
                        isConfirming = true
                    }
                    .buttonStyle(BlankPrimaryButtonStyle())
                    .disabled(emergencyUnlocksRemaining <= 0 || !sessionStore.isBlankActive)
                }
            }
            .frame(maxWidth: 300)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, sectionHorizontalPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.clear)
        .preferredColorScheme(sessionStore.isBlankActive ? .dark : .light)
    }

    private var bodyText: String {
        if isConfirming {
            return minimalAppearance
                ? "this unlocks blankmind now. you will have \(max(0, emergencyUnlocksRemaining - 1)) left this week."
                : "This unlocks Blankmind now. You will have \(max(0, emergencyUnlocksRemaining - 1)) left this week."
        }
        guard sessionStore.isBlankActive else {
            return minimalAppearance ? "no active block right now." : "No active block right now."
        }
        guard emergencyUnlocksRemaining > 0 else {
            return minimalAppearance ? "no emergency unlocks left." : "No emergency unlocks left."
        }
        return minimalAppearance ? "use one unlock only if access is necessary now." : "Use one unlock only if access is necessary now."
    }

    private var emergencyAllowance: some View {
        VStack(spacing: 8) {
            Text("\(emergencyUnlocksRemaining)/3 left this week")
                .font(.blankInter(size: 14, weight: .semibold, relativeTo: .subheadline))
                .foregroundStyle(textColor)
                .monospacedDigit()

            HStack(spacing: 6) {
                ForEach(0..<3, id: \.self) { index in
                    Capsule()
                        .fill(index < emergencyUnlocksRemaining ? textColor.opacity(0.82) : secondaryColor.opacity(0.20))
                        .frame(maxWidth: .infinity)
                        .frame(height: 7)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: 260)
        .blankControlSurface(cornerRadius: 18, tintOpacity: 0.08)
    }
}

private struct RelinkSheet: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @Environment(\.dismiss) private var dismiss
    @Binding var message: String?
    @Binding var messageAction: HomeMessageAction?
    @State private var nfcReader = NFCReader()

    var body: some View {
        TechnicalSettingsSheetLayout {
            TechnicalSheetTitle("New Blank")
            TechnicalSheetDescription("Scan the new Blank to replace the one you linked. Your distraction list and protection settings stay saved.")
            TechnicalSheetActions {
                Button("Scan new Blank") {
                    nfcReader.scan { result in
                        Task { @MainActor in
                            switch result {
                            case .success(let uid):
                                sessionStore.nfcTagUid = uid
                                message = "New Blank linked."
                                messageAction = nil
                                dismiss()
                            case .failure(let error):
                                message = error.localizedDescription
                                messageAction = nil
                            }
                        }
                    }
                }
                .buttonStyle(BlankPrimaryButtonStyle())

                Button("Cancel") {
                    dismiss()
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
        }
    }
}

private struct TechnicalSettingsSheetLayout<Content: View>: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @ViewBuilder var content: Content
    private var textColor: Color { sessionStore.isBlankActive ? BlankColors.pureWhite : BlankColors.ink }

    var body: some View {
        VStack(spacing: 18) {
            content
            Spacer()
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .foregroundStyle(textColor)
        .background(BlankAtmosphericBackground(dimmed: sessionStore.isBlankActive))
        .preferredColorScheme(sessionStore.isBlankActive ? .dark : .light)
    }
}

private struct TechnicalSheetTitle: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.blankInter(size: 32, weight: .semibold, relativeTo: .largeTitle))
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .minimumScaleFactor(0.86)
            .frame(maxWidth: 320)
    }
}

private struct TechnicalSheetDescription: View {
    let text: String
    var emphasized = false

    init(_ text: String, emphasized: Bool = false) {
        self.text = text
        self.emphasized = emphasized
    }

    var body: some View {
        Text(text)
            .font(emphasized ? .footnote.weight(.medium) : .body)
            .multilineTextAlignment(.center)
            .foregroundStyle(.secondary)
            .lineSpacing(2)
            .frame(maxWidth: 330)
    }
}

private struct TechnicalSheetActions<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(spacing: 12) {
            content
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
    }
}

private struct DistractionsScreen: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @Environment(\.blankSectionHorizontalPadding) private var sectionHorizontalPadding
    @Binding var showingPicker: Bool
    let onClose: () -> Void

    private var textColor: Color {
        sessionStore.isBlankActive ? BlankColors.pureWhite : BlankColors.homeLightInk
    }

    private var secondaryColor: Color {
        sessionStore.isBlankActive ? BlankColors.pureWhite.opacity(0.70) : BlankColors.homeLightSecondary
    }

    private var activeWindows: [BlankHabitWindow] {
        sessionStore.schedule.activeWindows
    }

    var body: some View {
        GeometryReader { proxy in
            let homeContentBottomMargin = max(proxy.safeAreaInsets.bottom + 18, 34) * 2

            ZStack(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: 0) {
                    SectionBackHeader(action: onClose)

                    VStack(alignment: .leading, spacing: 0) {
                        Text("Distractions")
                            .font(.blankSectionEditorial())
                            .tracking(-0.9)
                            .foregroundStyle(textColor)
                            .fixedSize(horizontal: false, vertical: true)

                        Text("Your protection list.")
                            .font(.blankInter(size: 14, relativeTo: .subheadline))
                            .foregroundStyle(secondaryColor)
                            .padding(.top, 24)

                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "clock")
                                .accessibilityHidden(true)
                            scheduleRanges
                        }
                        .font(.blankInter(size: 13, relativeTo: .subheadline))
                        .foregroundStyle(secondaryColor)
                        .padding(.top, 24)
                    }

                    ScrollView(.vertical, showsIndicators: false) {
                        VStack(alignment: .leading, spacing: 12) {
                            if sessionStore.selection.blankedSelectionCount == 0 {
                                Text("No distractions yet")
                                    .font(.blankInter(size: 16, relativeTo: .headline))
                                    .foregroundStyle(BlankColors.cardInk.opacity(0.72))
                                    .blankBlackCard()
                            } else {
                                if !sessionStore.selection.applicationTokens.isEmpty {
                                    distractionGroupHeading("Apps")
                                    ForEach(Array(sessionStore.selection.applicationTokens), id: \.self) { token in
                                        distractionRow { Label(token).labelStyle(.titleAndIcon) }
                                    }
                                }
                                if !sessionStore.selection.categoryTokens.isEmpty {
                                    distractionGroupHeading("Categories")
                                    ForEach(Array(sessionStore.selection.categoryTokens), id: \.self) { token in
                                        distractionRow { Label(token).labelStyle(.titleAndIcon) }
                                    }
                                }
                                if !sessionStore.selection.webDomainTokens.isEmpty {
                                    distractionGroupHeading("Websites")
                                    ForEach(Array(sessionStore.selection.webDomainTokens), id: \.self) { token in
                                        distractionRow { Label(token).labelStyle(.titleAndIcon) }
                                    }
                                }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                        .padding(.bottom, homeContentBottomMargin + 76)
                    }
                    .padding(.top, 24)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                }
                .padding(.horizontal, sectionHorizontalPadding)
                .padding(.bottom, 20)

                editButton
                    .padding(.leading, sectionHorizontalPadding)
                    .padding(.bottom, homeContentBottomMargin)
            }
        }
        .preferredColorScheme(sessionStore.isBlankActive ? .dark : .light)
    }

    private var scheduleRanges: some View {
        VStack(alignment: .leading, spacing: 3) {
            if activeWindows.isEmpty {
                Text("no scheduled blocks")
            } else {
                ForEach(activeWindows) { window in
                    Text("\(distractionTimeLabel(window.startMinute)) to \(distractionTimeLabel(window.endMinute))")
                }
            }
        }
        .font(.blankInter(size: 13, relativeTo: .subheadline))
        .foregroundStyle(secondaryColor)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var editButton: some View {
        Button {
            if sessionStore.canEditSelectedDistractions { showingPicker = true }
        } label: {
            Label("Edit distractions", systemImage: "plus")
                .font(.blankInter(size: 16))
                .foregroundStyle(BlankColors.cardInk)
                .padding(.horizontal, 16)
                .frame(minHeight: 44)
                .background(RoundedRectangle(cornerRadius: 4).fill(BlankColors.cardSurface))
        }
        .buttonStyle(.plain)
        .disabled(!sessionStore.canEditSelectedDistractions)
        .accessibilityLabel("Edit distractions")
        .accessibilityHint(sessionStore.canEditSelectedDistractions
                           ? "Choose apps to add or remove from your distractions"
                           : "Available when protection ends")
    }

    private func distractionGroupHeading(_ title: String) -> some View {
        Text(title)
            .font(.blankInter(size: 12, relativeTo: .caption))
            .foregroundStyle(secondaryColor)
            .padding(.top, 12)
            .accessibilityAddTraits(.isHeader)
    }

    private func distractionRow<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        HStack(spacing: 12) {
            content()
                .font(.blankOnboardingControl)
            Spacer(minLength: 0)
            Image(systemName: "checkmark")
                .font(.system(size: 12, weight: .regular))
                .accessibilityHidden(true)
        }
        .blankBlackCard()
        .accessibilityElement(children: .combine)
        .accessibilityValue("In protection list")
    }
}

struct AppAccountSignInSheet: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @Environment(\.dismiss) private var dismiss
    @State private var rawNonce: String?
    @State private var isWorking = false
    @State private var errorMessage: String?

    let showsCancel: Bool
    var onSignedIn: (() -> Void)?

    init(showsCancel: Bool = true, onSignedIn: (() -> Void)? = nil) {
        self.showsCancel = showsCancel
        self.onSignedIn = onSignedIn
    }

    var body: some View {
        Group {
            if showsCancel {
                NavigationStack {
                    accountForm
                        .navigationTitle("Your account")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button("Cancel") { dismiss() }
                            }
                        }
                }
            } else {
                accountForm
            }
        }
        .preferredColorScheme(sessionStore.isBlankActive ? .dark : .light)
    }

    private var accountForm: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Sign in to Blankmind")
                        .font(.blankOnboardingEditorial(size: 32, relativeTo: .title))
                        .tracking(-0.9)
                        .foregroundStyle(BlankColors.foreground)
                        .padding(.bottom, 24)
                    AccountJustifiedCopy(text: NSAttributedString(string: "Blankmind AI's core model is trained to identify recurring behavioral patterns, detect high-risk moments, and adapt interventions in real time."))
                        .padding(.bottom, 24)

                    if AssistantAppSession.userID != nil && !AssistantAppSession.hasAppleIdentity {
                        Text("This will connect Apple to your existing Blank account and preserve its chat history.")
                            .font(.blankInter(size: 14, relativeTo: .footnote))
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.bottom, 16)
                    }

                    SignInWithAppleButton(.continue, onRequest: { request in
                        let nonce = Self.makeNonce()
                        rawNonce = nonce
                        request.requestedScopes = [.email]
                        request.nonce = Self.hashNonce(nonce)
                    }, onCompletion: finishAppleAuthorization)
                        .signInWithAppleButtonStyle(sessionStore.isBlankActive ? .white : .black)
                        .frame(width: accountTitleWidth, height: 44)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                        .disabled(isWorking)
                        .overlay {
                            if isWorking {
                                ProgressView().tint(BlankColors.pureWhite)
                            }
                        }
                    if let errorMessage {
                        Text(errorMessage)
                            .font(.blankInter(size: 14, relativeTo: .footnote))
                            .foregroundStyle(BlankColors.red)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 16)
                    }
                }
                .frame(maxWidth: 400, alignment: .leading)
                .padding(.horizontal, 24)
                .padding(.vertical, 24)
                .frame(maxWidth: .infinity, minHeight: geometry.size.height, alignment: .center)
            }
        }
        .background(BlankColors.canvas)
        .preferredColorScheme(sessionStore.isBlankActive ? .dark : .light)
    }

    private var accountTitleWidth: CGFloat {
        let font = UIFontMetrics(forTextStyle: .title1).scaledFont(for: UIFont(name: "TimesNewRomanPSMT", size: 32)!)
        return ceil(NSAttributedString(string: "Sign in to Blankmind", attributes: [.font: font, .kern: -0.9]).size().width)
    }

    private func finishAppleAuthorization(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let idToken = String(data: tokenData, encoding: .utf8),
                  let nonce = rawNonce else {
                errorMessage = "Apple did not return a valid account token. Try again."
                return
            }
            Task { await signIn(idToken: idToken, nonce: nonce, appleUserID: credential.user) }
        case .failure(let error as ASAuthorizationError) where error.code == .canceled:
            rawNonce = nil
        case .failure:
            errorMessage = "Apple sign-in did not complete. Try again."
            rawNonce = nil
        }
    }

    @MainActor
    private func signIn(idToken: String, nonce: String, appleUserID: String) async {
        isWorking = true
        errorMessage = nil
        defer { isWorking = false; rawNonce = nil }
        do {
            let existingAccess = AssistantAppSession.token("access")
            let shouldLinkExistingAccount = existingAccess != nil && !AssistantAppSession.hasAppleIdentity
            var payload: [String: Any] = [
                "action": "sign_in_with_apple",
                "id_token": idToken,
                "nonce": nonce,
            ]
            if shouldLinkExistingAccount, let refresh = AssistantAppSession.token("refresh") {
                payload["refresh_token"] = refresh
            }
            let auth = try await postJSON(
                path: "app-auth",
                payload: payload,
                bearerToken: shouldLinkExistingAccount ? existingAccess : nil
            )
            guard let accessToken = auth["access_token"] as? String, !accessToken.isEmpty,
                  let refreshToken = auth["refresh_token"] as? String, !refreshToken.isEmpty else {
                throw AppAccountSignInError.message("Blank did not return a secure account session. Try again.")
            }
            let email = auth["apple_email"] as? String
            guard AssistantAppSession.save(accessToken: accessToken, refreshToken: refreshToken,
                                           appleUserID: appleUserID, email: email) else {
                throw AppAccountSignInError.message("Could not securely save your account on this iPhone. Try again.")
            }
            _ = try await AssistantAppClient().activate()
            let defaults = BlankSharedState.defaults
            defaults.removeObject(forKey: "blankAssistantPhoneNumber")
            defaults.removeObject(forKey: "blankAssistantPhoneVerified")
            defaults.set("app", forKey: "blankAssistantPreferredChannel")
            onSignedIn?()
            if showsCancel { dismiss() }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func postJSON(path: String, payload: [String: Any], bearerToken: String?) async throws -> [String: Any] {
        guard let baseURL = configuredBaseURL() else {
            throw AppAccountSignInError.message("Blankmind connection is not configured in this build.")
        }
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 20
        if let bearerToken { request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization") }
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        let (data, response) = try await URLSession.shared.data(for: request)
        let body = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let code = body["error"] as? String ?? "account_sign_in_failed"
            let message = code == "app_auth_unavailable"
                ? "Sign-in is unavailable right now. Try again in a moment."
                : "Could not connect this Apple Account to Blank. Check the Apple Account and try again."
            throw AppAccountSignInError.message(message)
        }
        return body
    }

    private func configuredBaseURL() -> URL? {
        guard let rawValue = Bundle.main.object(forInfoDictionaryKey: "BlankMembershipAPIBaseURL") as? String else { return nil }
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("$(") else { return nil }
        return URL(string: trimmed)
    }

    private static func makeNonce() -> String {
        UUID().uuidString + UUID().uuidString
    }

    private static func hashNonce(_ nonce: String) -> String {
        SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

private struct AccountSettingsSheet: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @Environment(\.dismiss) private var dismiss
    @State private var showingDeleteConfirmation = false
    @State private var isVerifyingDeletion = false
    @State private var isDeleting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Apple account") {
                    if let email = AssistantAppSession.email, !email.isEmpty {
                        LabeledContent("Email shared by Apple", value: email)
                    } else {
                        Text("Apple has not shared an email with this account.")
                            .foregroundStyle(.secondary)
                    }
                    Text("Blank never receives your Apple password.")
                        .foregroundStyle(.secondary)
                }
                Section("Subscription") {
                    Link("Manage in the App Store", destination: URL(string: "https://apps.apple.com/account/subscriptions")!)
                }
                Section {
                    Button("Sign out") {
                        AssistantAppSession.clear()
                        dismiss()
                    }
                    Button("Delete account and cloud data", role: .destructive) {
                        showingDeleteConfirmation = true
                    }
                    .disabled(isDeleting)
                    if isVerifyingDeletion {
                        Text("Verify with Apple to finish deleting your account.")
                            .foregroundStyle(.secondary)
                        SignInWithAppleButton(.signIn, onRequest: { request in
                            request.requestedScopes = []
                        }, onCompletion: finishDeleteAuthorization)
                            .signInWithAppleButtonStyle(.black)
                            .frame(height: 48)
                            .disabled(isDeleting)
                    }
                } footer: {
                    Text("Deleting your Blank account does not cancel an App Store subscription. Cancel it in the App Store first.")
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Account")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .confirmationDialog("Delete your Blank account and cloud data?", isPresented: $showingDeleteConfirmation, titleVisibility: .visible) {
                Button("Continue to Apple verification", role: .destructive) { isVerifyingDeletion = true }
            } message: {
                Text("This cannot be undone. Your App Store subscription must be canceled separately.")
            }
            .overlay { if isDeleting { ProgressView().controlSize(.large) } }
        }
    }

    @MainActor
    private func finishDeleteAuthorization(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let codeData = credential.authorizationCode,
                  let code = String(data: codeData, encoding: .utf8), !code.isEmpty else {
                errorMessage = "Apple did not return a deletion authorization. Try again."
                return
            }
            Task { await deleteAccount(authorizationCode: code) }
        case .failure(let error as ASAuthorizationError) where error.code == .canceled:
            break
        case .failure:
            errorMessage = "Apple verification did not complete. Try again."
        }
    }

    @MainActor
    private func deleteAccount(authorizationCode: String) async {
        guard !isDeleting else { return }
        isDeleting = true
        errorMessage = nil
        defer { isDeleting = false }
        do {
            let payload = try JSONSerialization.data(withJSONObject: [
                "action": "delete_apple", "apple_authorization_code": authorizationCode,
            ])
            let (_, response) = try await AssistantAppClient().postAuthorized(
                path: "account-data", payload: payload, timeout: 30
            )
            guard (200..<300).contains(response.statusCode) else {
                throw AppAccountSignInError.message("Could not delete your account. Try again or contact support.")
            }
            AssistantAppSession.clear()
            isVerifyingDeletion = false
            BlankSharedState.defaults.removeObject(forKey: "blankAssistantConnectCode")
            sessionStore.setupComplete = false
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private enum AppAccountSignInError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        if case let .message(value) = self { return value }
        return nil
    }
}

private func formatMinute(_ minuteOfDay: Int) -> String {
    let hour = max(0, min(23, minuteOfDay / 60))
    let minute = max(0, min(59, minuteOfDay % 60))
    let displayHour = hour % 12 == 0 ? 12 : hour % 12
    let meridiem = hour < 12 ? "AM" : "PM"
    return "\(displayHour):\(String(format: "%02d", minute)) \(meridiem)"
}

private func distractionTimeLabel(_ minuteOfDay: Int) -> String {
    let hour = max(0, min(23, minuteOfDay / 60))
    let minute = max(0, min(59, minuteOfDay % 60))
    let displayHour = hour % 12 == 0 ? 12 : hour % 12
    let meridiem = hour < 12 ? "am" : "pm"
    let minuteText = minute == 0 ? "" : ":\(String(format: "%02d", minute))"
    return "\(displayHour)\(minuteText)\(meridiem)"
}

private func dateForMinute(_ minuteOfDay: Int) -> Date {
    let calendar = Calendar.current
    let hour = max(0, min(23, minuteOfDay / 60))
    let minute = max(0, min(59, minuteOfDay % 60))
    return calendar.date(
        bySettingHour: hour,
        minute: minute,
        second: 0,
        of: Date()
    ) ?? Date()
}

private func minuteOfDay(from date: Date) -> Int {
    let components = Calendar.current.dateComponents([.hour, .minute], from: date)
    return (components.hour ?? 0) * 60 + (components.minute ?? 0)
}

private extension FamilyActivitySelection {
    var blankedSelectionCount: Int {
        applicationTokens.count + categoryTokens.count + webDomainTokens.count
    }
}

#if DEBUG
@MainActor
private struct HomePreviewScene: View {
    let name: String
    let sessionStore: SessionStore
    let screenTimeBlocker: ScreenTimeBlocker

    init(
        _ name: String,
        isBlankActive: Bool = false,
        protectedSelectionCount: Int = 3,
        nfcLinked: Bool = true,
        authorizationApproved: Bool = true,
        schedule: BlankFocusSchedule = BlankFocusSchedule(),
        schedulePausedUntil: Date? = nil,
        timedUntil: Date? = nil
    ) {
        self.name = name
        self.sessionStore = SessionStore.preview(
            isBlankActive: isBlankActive,
            protectedSelectionCount: protectedSelectionCount,
            nfcLinked: nfcLinked,
            schedule: schedule,
            schedulePausedUntil: schedulePausedUntil,
            timedUntil: timedUntil
        )
        self.screenTimeBlocker = ScreenTimeBlocker.preview(authorizationApproved: authorizationApproved)
    }

    var body: some View {
        HomeView()
            .environmentObject(sessionStore)
            .environmentObject(screenTimeBlocker)
            .environmentObject(StoreKitPurchaseStore())
            .environment(\.font, .blankBody)
            .previewDisplayName(name)
    }
}

#Preview("Home - Idle") {
    HomePreviewScene("Home - Idle")
}

#Preview("Home - No apps") {
    HomePreviewScene("Home - No apps", protectedSelectionCount: 0)
}

#Preview("Home - NFC pending") {
    HomePreviewScene("Home - NFC pending", nfcLinked: false)
}

#Preview("Blank active") {
    HomePreviewScene("Blank active", isBlankActive: true)
}

#Preview("Blank active - Timer") {
    HomePreviewScene(
        "Blank active - Timer",
        isBlankActive: true,
        timedUntil: Date().addingTimeInterval(38 * 60)
    )
}

#Preview("Schedule paused") {
    HomePreviewScene(
        "Schedule paused",
        isBlankActive: false,
        schedule: BlankFocusSchedule(enabled: true, startMinute: 0, endMinute: 24 * 60 - 1),
        schedulePausedUntil: Date().addingTimeInterval(5 * 60)
    )
}

#Preview("Permission pending") {
    HomePreviewScene("Permission pending", authorizationApproved: false)
}
#endif

#if DEBUG && targetEnvironment(simulator)
// Isolated accounts and production views for CI screenshots; never an iPhone setup bypass.
@MainActor
struct PostOnboardingPreviewScene: View {
    static var enabled: Bool {
        ["product-home", "product-home-active", "product-menu", "product-menu-active", "product-progress", "product-progress-active", "product-settings", "product-settings-active", "product-distractions", "product-distractions-active"]
            .contains(AssistantAppPreview.scenario)
    }

    @StateObject private var sessionStore = SessionStore.preview(
        isBlankActive: AssistantAppPreview.scenario.hasSuffix("-active"), protectedSelectionCount: 0)
    @StateObject private var screenTimeBlocker = ScreenTimeBlocker.preview()
    @State private var showingPicker = false

    private var section: HomeSection? {
        switch AssistantAppPreview.scenario {
        case "product-progress", "product-progress-active": return .report
        case "product-settings", "product-settings-active": return .settings
        case "product-distractions", "product-distractions-active": return .distractions
        default: return nil
        }
    }

    var body: some View {
        GeometryReader { proxy in
            if let section {
                HomeSectionScreen(
                    showingPicker: $showingPicker,
                    section: section,
                    screenWidth: proxy.size.width,
                    screenHeight: proxy.size.height,
                    intervention: RelapseIntervention(headline: "", cost: "", alternative: ""),
                    onEmergencyUnlock: { false },
                    onOpenSection: { _ in },
                    onOpenAssistant: {},
                    onRequestScreenTimePermission: {},
                    onRequestHealthAccess: {},
                    screenTimeStatus: screenTimeBlocker.authorizationStatusLabel,
                    healthStatus: "not connected",
                    onClose: {}
                )
            } else {
                HomeView(simulatorGuest: true)
            }
        }
        .ignoresSafeArea(.container)
        .environmentObject(sessionStore)
        .environmentObject(screenTimeBlocker)
        .environment(\.blankMinimalAppearance, true)
        .preferredColorScheme(sessionStore.isBlankActive ? .dark : .light)
    }
}
#endif

// TextKit supplies true paragraph justification while preserving native legal links.
struct AccountJustifiedCopy: UIViewRepresentable {
    @Environment(\.colorScheme) private var colorScheme
    let text: NSAttributedString
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    func makeUIView(context: Context) -> UITextView {
        let storage = NSTextStorage()
        let layout = AccountLegalLayoutManager()
        let container = NSTextContainer(size: .zero)
        container.widthTracksTextView = true
        storage.addLayoutManager(layout)
        layout.addTextContainer(container)
        let view = UITextView(frame: .zero, textContainer: container)
        view.isEditable = false
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        let color = colorScheme == .dark
            ? UIColor(red: 1, green: 1, blue: 252/255, alpha: 0.72)
            : UIColor(red: 41/255, green: 41/255, blue: 41/255, alpha: 0.72)
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .justified
        paragraph.lineSpacing = 4
        let font = UIFontMetrics(forTextStyle: .body).scaledFont(for: UIFont(name: "ArialMT", size: 14)!)
        let styled = NSMutableAttributedString(attributedString: text)
        styled.addAttributes([.font: font, .foregroundColor: color, .paragraphStyle: paragraph], range: NSRange(location: 0, length: styled.length))
        text.enumerateAttribute(.link, in: NSRange(location: 0, length: text.length)) { link, range, _ in
            if link != nil { styled.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: range) }
        }
        view.linkTextAttributes = [.foregroundColor: color, .underlineStyle: NSUnderlineStyle.single.rawValue]
        view.attributedText = styled
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        guard let width = proposal.width else { return nil }
        return uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
    }
}

private final class AccountLegalLayoutManager: NSLayoutManager {
    override func drawUnderline(forGlyphRange glyphRange: NSRange, underlineType underlineVal: NSUnderlineStyle, baselineOffset: CGFloat, lineFragmentRect lineRect: CGRect, lineFragmentGlyphRange lineGlyphRange: NSRange, containerOrigin: CGPoint) {
        super.drawUnderline(forGlyphRange: glyphRange, underlineType: underlineVal, baselineOffset: baselineOffset - 2, lineFragmentRect: lineRect, lineFragmentGlyphRange: lineGlyphRange, containerOrigin: containerOrigin)
    }
}


private struct BMBSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var version = 0
    @State private var active = false
    @State private var enabled = false
    @State private var allowedTypes = Set(["start_protection"])
    @State private var actionStart = 0
    @State private var actionEnd = 0
    @State private var quietStart = 480
    @State private var quietEnd = 1320
    @State private var maxMinutes = 30
    @State private var actionDaily = 1
    @State private var actionWeekly = 3
    @State private var notifyDaily = 1
    @State private var notifyWeekly = 3
    @State private var intervalMinutes = 1440
    @State private var expires = Date().addingTimeInterval(30*86400)
    @State private var pausedUntil: String?
    @State private var opportunities = true
    @State private var interventions = true
    @State private var failures = true
    @State private var busy = true
    @State private var status = ""
    @State private var events: [[String: Any]] = []
    private func clock(_ value: Binding<Int>) -> Binding<Date> {
        Binding(get: { Calendar.current.date(bySettingHour:value.wrappedValue/60,minute:value.wrappedValue%60,second:0,of:Date()) ?? Date() },
                set: { value.wrappedValue = Calendar.current.component(.hour,from:$0)*60 + Calendar.current.component(.minute,from:$0) })
    }
    var body: some View {
        NavigationStack {
            Form {
                Section("Automatic protection") {
                    Toggle("Allow BMB to act", isOn:$active)
                    Text("BMB can try these actions within your limits. iOS may delay background delivery. Existing blocks keep their release rules.").font(.footnote)
                    ForEach([("start_protection","Block selected distractions"),("set_daily_limit","Set daily limit"),("enable_adult_filter","Enable adult filter")], id: \.0) { type,label in
                        Toggle(label,isOn:Binding(get:{ allowedTypes.contains(type) },set:{ if $0 { allowedTypes.insert(type) } else { allowedTypes.remove(type) } }))
                    }
                    DatePicker("From",selection:clock($actionStart),displayedComponents:.hourAndMinute)
                    DatePicker("Until",selection:clock($actionEnd),displayedComponents:.hourAndMinute)
                    Text("Matching times allow any hour.").font(.footnote)
                    Text("Daily limits and the adult filter stay on until you change them. Revoking permission stops future automatic changes.").font(.footnote)
                    Stepper("Maximum minutes \(maxMinutes)",value:$maxMinutes,in:5...240,step:5)
                    Stepper("Actions per day \(actionDaily)",value:$actionDaily,in:0...10)
                    Stepper("Actions per 7 days \(actionWeekly)",value:$actionWeekly,in:0...30)
                    Stepper("Minimum gap \(intervalMinutes) min",value:$intervalMinutes,in:15...10080,step:15)
                    DatePicker("Permission expires",selection:$expires,in:Date()...,displayedComponents:[.date,.hourAndMinute])
                }
                Section("Notifications") {
                    Toggle("Useful notifications",isOn:$enabled)
                    Text("Notification permission is separate from acting. Quiet hours still apply to failures. No routine start or end alerts.").font(.footnote)
                    Toggle("Useful opportunities",isOn:$opportunities)
                    Toggle("Confirmed new interventions",isOn:$interventions)
                    Toggle("Failures needing my help",isOn:$failures)
                    DatePicker("Allowed from",selection:clock($quietStart),displayedComponents:.hourAndMinute)
                    DatePicker("Allowed until",selection:clock($quietEnd),displayedComponents:.hourAndMinute)
                    Stepper("Notifications per day \(notifyDaily)",value:$notifyDaily,in:0...10)
                    Stepper("Notifications per 7 days \(notifyWeekly)",value:$notifyWeekly,in:0...30)
                }
                Section {
                    Button("Pause BMB for 24 hours") { pausedUntil=ISO8601DateFormatter().string(from:Date().addingTimeInterval(86400)); Task { await save() } }
                    Button("Resume BMB") { pausedUntil=nil; Task { await save() } }
                    Button("Revoke automatic protection",role:.destructive) { active=false; Task { await save() } }
                    Button("Save preferences") { Task { await save() } }
                    if !status.isEmpty { Text(status).font(.footnote) }
                }
                if !events.isEmpty {
                    Section("Recent help") {
                        ForEach(events.indices,id: \.self) { index in
                            let event=events[index]
                            VStack(alignment:.leading) {
                                Text((event["outcome"] as? [String:Any])?["message_text"] as? String ?? (event["kind"] as? String ?? "BMB"))
                                Text(event["created_at"] as? String ?? "").font(.caption)
                                HStack {
                                    Button("Helpful") { Task { await feedback(event,"helpful") } }
                                    Button("Wrong time") { Task { await feedback(event,"wrong_time") } }
                                    Button("Too frequent") { Task { await feedback(event,"too_frequent") } }
                                }.buttonStyle(.borderless)
                            }
                        }
                    }
                }
            }
            .disabled(busy)
            .navigationTitle("Blankmind")
            .toolbar { Button("Done") { dismiss() } }
            .task { await load() }
        }
    }
    private func request(_ body: [String: Any]) async throws -> [String: Any] {
        let owner=AssistantAppSession.userID
        var payload=body; payload["app_install_id"]=BlankSharedState.appInstallId
        let data=try JSONSerialization.data(withJSONObject:payload)
        let (result,response)=try await AssistantAppClient().postAuthorized(path:"assistant-app",payload:data,timeout:8)
        guard owner != nil, owner==AssistantAppSession.userID, (200..<300).contains(response.statusCode),
              let decoded=try JSONSerialization.jsonObject(with:result) as? [String:Any] else { throw URLError(.badServerResponse) }
        return decoded
    }
    private func load() async {
        busy=true; defer { busy=false }
        do {
            let result=try await request(["action":"bmb_settings"])
            let account=result["account"] as? [String:Any] ?? [:]
            version=account["version"] as? Int ?? 0
            let settings=account["settings"] as? [String:Any] ?? [:]
            let grant=settings["grant"] as? [String:Any] ?? [:], notifications=settings["notifications"] as? [String:Any] ?? [:]
            active=grant["active"] as? Bool ?? false; enabled=notifications["enabled"] as? Bool ?? false
            allowedTypes=Set(grant["action_types"] as? [String] ?? ["start_protection"])
            if allowedTypes.isEmpty { allowedTypes=["start_protection"] }
            actionStart=grant["start_minute"] as? Int ?? 0; actionEnd=grant["end_minute"] as? Int ?? 0
            maxMinutes=grant["max_minutes"] as? Int ?? 30
            actionDaily=grant["max_per_day"] as? Int ?? 1; actionWeekly=grant["max_per_week"] as? Int ?? 3
            intervalMinutes=grant["min_interval_minutes"] as? Int ?? 1440
            expires=AssistantInboxAction.parseDate(grant["expires_at"] as? String) ?? Date().addingTimeInterval(30*86400)
            quietStart=notifications["start_minute"] as? Int ?? 480; quietEnd=notifications["end_minute"] as? Int ?? 1320
            notifyDaily=notifications["max_per_day"] as? Int ?? 1; notifyWeekly=notifications["max_per_week"] as? Int ?? 3
            opportunities=notifications["opportunities"] as? Bool ?? true; interventions=notifications["interventions"] as? Bool ?? true; failures=notifications["failures"] as? Bool ?? true
            pausedUntil=settings["paused_until"] as? String
            events=(try await request(["action":"bmb_activity"]))["events"] as? [[String:Any]] ?? []
        } catch { status="Could not load preferences. Reopen to retry." }
    }
    private func save() async {
        busy=true; defer { busy=false }
        let settings: [String:Any] = ["timezone":TimeZone.current.identifier,"paused_until":pausedUntil as Any? ?? NSNull(),
            "grant":["active":active,"action_types":Array(allowedTypes).sorted(),"start_minute":actionStart,"end_minute":actionEnd,
                "max_minutes":maxMinutes,"max_per_day":actionDaily,"max_per_week":actionWeekly,"min_interval_minutes":intervalMinutes,"expires_at":ISO8601DateFormatter().string(from:expires)],
            "notifications":["enabled":enabled,"start_minute":quietStart,"end_minute":quietEnd,"max_per_day":notifyDaily,"max_per_week":notifyWeekly,
                "opportunities":opportunities,"interventions":interventions,"failures":failures]]
        do { let response=try await request(["action":"bmb_save_settings","settings":settings,"version":version]); version=response["version"] as? Int ?? version; status="Saved." }
        catch { status="Could not save. Reopen to refresh preferences and retry." }
    }
    private func feedback(_ event: [String:Any],_ value: String) async {
        do { _ = try await request(["action":"bmb_feedback","event_id":event["id"] ?? "","feedback":value]); status="Feedback saved." }
        catch { status="Could not save feedback." }
    }
}
