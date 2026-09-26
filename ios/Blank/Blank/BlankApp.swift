import SwiftUI
import UIKit
import UserNotifications

enum AssistantRemoteNotification {
    static let categoryIdentifier = "BM_PENDING_ACTION"
    static let applyActionIdentifier = "BM_APPLY_NOW"
    static let pollAfterOpenKey = "blankAssistantPollAfterOpen"
    static let tappedActionIDKey = "blankAssistantTappedActionID"
}

extension Notification.Name {
    static let blankAssistantApplyNowRequested = Notification.Name("blankAssistantApplyNowRequested")
}

@main
struct BlankApp: App {
    @UIApplicationDelegateAdaptor(BlankAppDelegate.self) private var appDelegate
    @StateObject private var sessionStore = SessionStore()
    @StateObject private var purchaseStore = StoreKitPurchaseStore()
    @StateObject private var screenTimeBlocker = ScreenTimeBlocker()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        UIScrollView.appearance().showsVerticalScrollIndicator = false
        UIScrollView.appearance().showsHorizontalScrollIndicator = false
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(sessionStore)
                .environmentObject(purchaseStore)
                .environmentObject(screenTimeBlocker)
                .environment(\.font, .blankBody)
                .task {
                    #if DEBUG
                    if AssistantAppPreview.enabled { return }
                    #endif
                    appDelegate.registerForRemoteActions()
                    await purchaseStore.loadProducts()
                    await screenTimeBlocker.restore(selection: sessionStore.selection)
                    sessionStore.syncRecurringSchedule()
                    screenTimeBlocker.updateAdvancedControls(
                        allowOnlyModeEnabled: sessionStore.allowOnlyModeEnabled,
                        adultContentBlockingEnabled: sessionStore.adultContentBlockingEnabled
                    )
                    screenTimeBlocker.apply(isBlankActive: sessionStore.isBlankActive)
                    sessionStore.refreshDailyLimitMonitoring()
                }
                .task {
                    #if DEBUG
                    if AssistantAppPreview.enabled { return }
                    #endif
                    await purchaseStore.observeTransactionUpdates()
                }
                .onChange(of: scenePhase) { phase in
                    #if DEBUG
                    if AssistantAppPreview.enabled { return }
                    #endif
                    if phase == .active {
                        appDelegate.registerForRemoteActions()
                        screenTimeBlocker.refreshAuthorizationStatus()
                        sessionStore.syncRecurringSchedule()
                        screenTimeBlocker.updateAdvancedControls(
                            allowOnlyModeEnabled: sessionStore.allowOnlyModeEnabled,
                            adultContentBlockingEnabled: sessionStore.adultContentBlockingEnabled
                        )
                        sessionStore.refreshDailyLimitMonitoring()
                    }
                }
                .onOpenURL { url in
                    handleDeepLink(url)
                }
        }
    }

    private func handleDeepLink(_ url: URL) {
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let action: String
        if url.scheme == "blank" {
            action = url.host ?? ""
        } else if isBlankedUniversalLink(url) {
            action = components?.stringQueryItem("action") ?? ""
        } else {
            return
        }

        if action == "referral" {
            purchaseStore.captureReferral(from: url)
            return
        }
        if action == "handoff" {
            let token = components?.stringQueryItem("token") ?? ""
            Task { await claimAppHandoff(token) }
            return
        }
        if action == "timer" || action == "schedule-timer" {
            sessionStore.requestWidgetTimerSelector()
            return
        }

        if action == "configure-block" || action == "open-picker" || action == "choose-apps" {
            openBlockConfiguration(from: components)
            return
        }

        if action == "setup-plan" {
            setupPlan(from: components)
            return
        }

        if action == "review-action" {
            if ["open_app_picker", "request_screen_time_permission"].contains(components?.stringQueryItem("type") ?? "") {
                BlankSharedState.defaults.set(true, forKey: "blankAssistantPollAfterOpen")
                return
            }
            requestAssistantActionConfirmation(from: components)
            return
        }

        if action == "start" || action == "start-blank" || action == "start-focus" {
            let minutes = components?.intQueryItem("minutes").map { min(max($0, 5), 240) }
            let hardMode = components?.boolQueryItem("hard") ?? false
            _ = sessionStore.activateBlank(durationMinutes: minutes, hardMode: hardMode, entryMode: .app)
            applyScreenTimeState()
            return
        }

        if action == "stop" || action == "stop-blank" {
            _ = sessionStore.deactivateBlank(entryMode: .app, endedReason: .manual, broken: true)
            screenTimeBlocker.clear()
            return
        }

        if action == "apply-plan" {
            applyPlan(from: components)
            return
        }

        if action == "allow-only" {
            sessionStore.allowOnlyModeEnabled = true
            sessionStore.requestBlockConfiguration()
            applyScreenTimeState()
            return
        }

        if action == "adult-filter" {
            sessionStore.adultContentBlockingEnabled = true
            applyScreenTimeState()
            return
        }

        if action == "daily-limit" {
            if let minutes = components?.intQueryItem("minutes") {
                sessionStore.dailyLimitMinutes = min(max(minutes, 5), 240)
                sessionStore.dailyLimitEnabled = true
                sessionStore.refreshDailyLimitMonitoring()
                applyScreenTimeState()
            }
            return
        }

        if action == "pause-rules" || action == "vacation" {
            let hours = min(max(components?.intQueryItem("hours") ?? 24, 1), 168)
            sessionStore.enableVacationMode(hours: hours)
            applyScreenTimeState()
            return
        }

        if action == "resume-rules" {
            sessionStore.disableVacationMode()
            applyScreenTimeState()
            return
        }

        if action == "mode" {
            let shouldActivate = components?.boolQueryItem("activate") ?? false
            let minutes = components?.intQueryItem("minutes").map { min(max($0, 5), 240) }
            let hardMode = components?.boolQueryItem("hard") ?? false
            if sessionStore.hasSelectedApps {
                if shouldActivate {
                    _ = sessionStore.activateBlank(durationMinutes: minutes, hardMode: hardMode, entryMode: .app)
                }
            } else {
                openBlockConfiguration(
                    from: components,
                    shouldActivate: shouldActivate,
                    durationMinutes: minutes,
                    hardMode: hardMode
                )
            }
            applyScreenTimeState()
        }
    }

    private func openBlockConfiguration(
        from components: URLComponents?,
        shouldActivate: Bool = false,
        durationMinutes: Int? = nil,
        hardMode: Bool = false
    ) {
        let appNames = components?.listQueryItem("apps") ?? []
        sessionStore.requestBlockConfiguration(
            appNames: appNames,
            shouldActivate: shouldActivate,
            durationMinutes: durationMinutes,
            hardMode: hardMode
        )
    }

    private func setupPlan(from components: URLComponents?) {
        applyPlan(from: components, shouldOpenPickerIfIncomplete: false)
        if !sessionStore.hasSelectedApps {
            openBlockConfiguration(from: components)
        }
    }

    private func applyPlan(from components: URLComponents?, shouldOpenPickerIfIncomplete: Bool = true) {
        let startMinute = components?.minuteQueryItem("start") ?? components?.intQueryItem("start_minute")
        let endMinute = components?.minuteQueryItem("end") ?? components?.intQueryItem("end_minute")
        let durationDays = components?.intQueryItem("days") ?? 7
        let weekdays = components?.listQueryItem("weekdays").compactMap(Int.init) ?? Array(1...7)

        if let startMinute, let endMinute {
            sessionStore.applyAdaptivePlan(
                startMinute: min(max(startMinute, 0), 1439),
                endMinute: min(max(endMinute, 0), 1439),
                durationDays: min(max(durationDays, 1), 14),
                activateCurrentWindow: false,
                name: "Protection",
                weekdays: weekdays
            )
            applyScreenTimeState()
        } else if shouldOpenPickerIfIncomplete {
            sessionStore.requestBlockConfiguration()
        }
    }

    private func requestAssistantActionConfirmation(from components: URLComponents?) {
        let type = components?.stringQueryItem("type") ?? ""
        let appNames = components?.listQueryItem("apps") ?? []
        let minutes = components?.intQueryItem("minutes").map { min(max($0, 5), 240) }
        let hardMode = components?.boolQueryItem("hard") ?? false
        switch type {
        case "start_protection", "activate_mode":
            sessionStore.requestAssistantActionConfirmation(.startProtection(minutes: minutes, hardMode: hardMode, appNames: appNames))
        case "switch_mode":
            sessionStore.requestAssistantActionConfirmation(.openAppPicker(appNames: appNames))
        case "apply_schedule":
            guard let start = components?.minuteQueryItem("start") ?? components?.intQueryItem("start_minute"),
                  let end = components?.minuteQueryItem("end") ?? components?.intQueryItem("end_minute") else { return }
            let weekdays = components?.listQueryItem("weekdays").compactMap(Int.init) ?? Array(1...7)
            sessionStore.requestAssistantActionConfirmation(.applySchedule(
                name: components?.stringQueryItem("name") ?? "AI Plan",
                startMinute: min(max(start, 0), 1439),
                endMinute: min(max(end, 0), 1439),
                weekdays: weekdays,
                durationDays: min(max(components?.intQueryItem("days") ?? 7, 1), 14),
                appNames: appNames
            ))
        case "update_schedule":
            guard let windowId = components?.stringQueryItem("window_id"),
                  let start = components?.minuteQueryItem("start") ?? components?.intQueryItem("start_minute"),
                  let end = components?.minuteQueryItem("end") ?? components?.intQueryItem("end_minute") else { return }
            sessionStore.requestAssistantActionConfirmation(.updateSchedule(
                windowId: windowId,
                name: components?.stringQueryItem("name") ?? "Protection",
                startMinute: min(max(start, 0), 1439),
                endMinute: min(max(end, 0), 1439),
                weekdays: components?.listQueryItem("weekdays").compactMap(Int.init) ?? Array(1...7)
            ))
        case "delete_schedule":
            guard let windowId = components?.stringQueryItem("window_id") else { return }
            sessionStore.requestAssistantActionConfirmation(.deleteSchedule(windowId: windowId))
        case "delete_all_schedules":
            sessionStore.requestAssistantActionConfirmation(.deleteAllSchedules)
        case "set_daily_limit":
            sessionStore.requestAssistantActionConfirmation(.setDailyLimit(minutes: minutes, appNames: appNames))
        case "enable_allow_only":
            sessionStore.requestAssistantActionConfirmation(.allowOnly)
        case "enable_adult_filter":
            sessionStore.requestAssistantActionConfirmation(.adultFilter)
        case "pause_rules":
            sessionStore.requestAssistantActionConfirmation(.pauseRules(hours: min(max(components?.intQueryItem("hours") ?? 168, 1), 168)))
        case "disable_pause":
            sessionStore.requestAssistantActionConfirmation(.disablePause)
        case "apply_ai_plan":
            sessionStore.requestAssistantActionConfirmation(.applyAIPlan)
        case "open_app_picker":
            let pickerStart = components?.minuteQueryItem("start") ?? components?.intQueryItem("start_minute")
            let pickerEnd = components?.minuteQueryItem("end") ?? components?.intQueryItem("end_minute")
            let pickerName = components?.stringQueryItem("name") ?? ""
            let pickerSchedule: PendingPlanSchedule?
            if let pickerStart, let pickerEnd {
                pickerSchedule = PendingPlanSchedule(
                    name: components?.stringQueryItem("name") ?? "AI Plan",
                    startMinute: min(max(pickerStart, 0), 1439),
                    endMinute: min(max(pickerEnd, 0), 1439),
                    weekdays: components?.listQueryItem("weekdays").compactMap(Int.init) ?? Array(1...7),
                    durationDays: min(max(components?.intQueryItem("days") ?? 7, 1), 14)
                )
            } else {
                pickerSchedule = nil
            }
            if pickerName == "Daily Limit", let minutes {
                sessionStore.requestAssistantActionConfirmation(.configureAndOpenDailyLimitPicker(appNames: appNames, minutes: minutes))
            } else if pickerSchedule != nil || minutes != nil || hardMode || !pickerName.isEmpty {
                sessionStore.requestAssistantActionConfirmation(.configureAndOpenAppPicker(
                    appNames: appNames,
                    durationMinutes: minutes,
                    hardMode: hardMode,
                    schedule: pickerSchedule
                ))
            } else {
                sessionStore.requestAssistantActionConfirmation(.openAppPicker(appNames: appNames))
            }
        case "request_screen_time_permission":
            sessionStore.requestAssistantActionConfirmation(.requestScreenTimePermission)
        default:
            break
        }
    }

    private func applyScreenTimeState() {
        screenTimeBlocker.updateAdvancedControls(
            allowOnlyModeEnabled: sessionStore.allowOnlyModeEnabled,
            adultContentBlockingEnabled: sessionStore.adultContentBlockingEnabled
        )
        screenTimeBlocker.updateSelection(sessionStore.selection, isBlankActive: sessionStore.isBlankActive)
    }

    private func isBlankedUniversalLink(_ url: URL) -> Bool {
        guard url.scheme == "https", ["blankmind.ai", "blanked.app", "getblank.netlify.app"].contains(url.host ?? "") else { return false }
        return url.path == "/open" || url.path == "/open.html"
    }

    private func claimAppHandoff(_ token: String) async {
        guard !token.isEmpty,
              let baseURL = configuredMembershipBaseURL() else { return }
        var request = URLRequest(url: baseURL.appendingPathComponent("app-handoff"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 8
        let payload: [String: Any] = [
            "action": "claim",
            "handoff_token": token,
            "app_install_id": BlankSharedState.appInstallId,
            "data_consent": true,
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode),
              let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }

        let defaults = BlankSharedState.defaults
        if let connectCode = result["assistant_connect_code"] as? String, !connectCode.isEmpty {
            defaults.set(connectCode, forKey: "blankAssistantConnectCode")
        }
        if let phone = result["phone_e164"] as? String, !phone.isEmpty {
            defaults.set(phone, forKey: "blankAssistantPhoneNumber")
        }
        if !(defaults.string(forKey: "blankAssistantConnectCode") ?? "").isEmpty,
           !(defaults.string(forKey: "blankAssistantPhoneNumber") ?? "").isEmpty {
            defaults.set(true, forKey: "blankAssistantPhoneVerified")
        }
    }

    private func configuredMembershipBaseURL() -> URL? {
        guard let rawValue = Bundle.main.object(forInfoDictionaryKey: "BlankMembershipAPIBaseURL") as? String else {
            return nil
        }
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("$(") else { return nil }
        return URL(string: trimmed)
    }
}

@MainActor
final class BlankAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        configureActionableNotifications()
        registerForRemoteActions()
        return true
    }

    private func configureActionableNotifications() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        let applyNow = UNNotificationAction(
            identifier: AssistantRemoteNotification.applyActionIdentifier,
            title: "Apply Now",
            options: [.foreground]
        )
        let category = UNNotificationCategory(
            identifier: AssistantRemoteNotification.categoryIdentifier,
            actions: [applyNow],
            intentIdentifiers: [],
            options: []
        )
        center.setNotificationCategories([category])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let hasAssistantAction = notification.request.content.userInfo["bm_action_id"] != nil
        completionHandler(hasAssistantAction ? [.banner, .list, .sound] : [])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        let isAssistantAction = userInfo["bm_action_id"] != nil
        let shouldApply = response.actionIdentifier == AssistantRemoteNotification.applyActionIdentifier
            || response.actionIdentifier == UNNotificationDefaultActionIdentifier
        if isAssistantAction && shouldApply {
            BlankSharedState.defaults.set(true, forKey: AssistantRemoteNotification.pollAfterOpenKey)
            if let actionID = userInfo["bm_action_id"] as? String, !actionID.isEmpty {
                BlankSharedState.defaults.set(actionID, forKey: AssistantRemoteNotification.tappedActionIDKey)
            }
            DispatchQueue.main.async {
                NotificationCenter.default.post(name: .blankAssistantApplyNowRequested, object: nil)
            }
        }
        completionHandler()
    }

    func registerForRemoteActions() {
        UIApplication.shared.registerForRemoteNotifications()
        registerStoredTokenIfPossible()
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        if BlankSharedState.defaults.string(forKey: "blankAssistantPushToken") != token {
            BlankSharedState.defaults.set(false, forKey: "blankAssistantPushRegistered")
        }
        BlankSharedState.defaults.set(token, forKey: "blankAssistantPushToken")
        registerStoredTokenIfPossible()
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        BlankSharedState.defaults.removeObject(forKey: "blankAssistantPushToken")
        BlankSharedState.defaults.set(false, forKey: "blankAssistantPushRegistered")
    }

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        // A WhatsApp/SMS proposal is intentionally inert until the person taps
        // its visible notification. This callback may be delivered silently by
        // APNs, so it must never acknowledge or execute the pending action.
        completionHandler(.noData)
    }

    private func registerStoredTokenIfPossible() {
        let defaults = BlankSharedState.defaults
        let token = defaults.string(forKey: "blankAssistantPushToken") ?? ""
        let code = defaults.string(forKey: "blankAssistantConnectCode") ?? ""
        let rawChannel = defaults.string(forKey: "blankAssistantPreferredChannel") ?? ""
        let channel = rawChannel == "whatsApp" ? "whatsapp" : rawChannel.lowercased()
        guard !token.isEmpty, !code.isEmpty, ["whatsapp", "sms"].contains(channel) else { return }
        let phone = defaults.string(forKey: "blankAssistantPhoneNumber") ?? ""
        #if DEBUG
        let environment = "sandbox"
        #else
        let environment = "production"
        #endif
        Task {
            let registered = await AssistantActionInboxClient().registerDevicePush(
                token: token,
                environment: environment,
                connectCode: code,
                channel: channel,
                phoneNumber: phone
            )
            defaults.set(registered, forKey: "blankAssistantPushRegistered")
        }
    }
}

private extension URLComponents {
    func stringQueryItem(_ name: String) -> String? {
        queryItems?.first(where: { $0.name == name })?.value?.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func intQueryItem(_ name: String) -> Int? {
        guard let value = stringQueryItem(name) else { return nil }
        return Int(value)
    }

    func boolQueryItem(_ name: String) -> Bool? {
        guard let value = stringQueryItem(name)?.lowercased() else { return nil }
        if ["1", "true", "yes"].contains(value) { return true }
        if ["0", "false", "no"].contains(value) { return false }
        return nil
    }

    func listQueryItem(_ name: String) -> [String] {
        guard let value = stringQueryItem(name) else { return [] }

        var items: [String] = []
        for rawItem in value.split(separator: ",") {
            let item = rawItem.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !item.isEmpty else { continue }
            items.append(String(item.prefix(30)))
            if items.count >= 8 { break }
        }
        return items
    }

    func minuteQueryItem(_ name: String) -> Int? {
        guard let value = stringQueryItem(name) else { return nil }
        if let minutes = Int(value) { return minutes }
        let parts = value.split(separator: ":")
        guard parts.count == 2, let hour = Int(parts[0]), let minute = Int(parts[1]) else { return nil }
        return min(max(hour, 0), 23) * 60 + min(max(minute, 0), 59)
    }
}
