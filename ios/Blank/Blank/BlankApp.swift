import AuthenticationServices
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
                    BlankBrain.shared.configure(store: sessionStore, blocker: screenTimeBlocker, purchases: purchaseStore)
                    appDelegate.registerForRemoteActions()
                    checkAppleCredentialState()
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
                        BlankBrain.shared.configure(store: sessionStore, blocker: screenTimeBlocker, purchases: purchaseStore)
                    appDelegate.registerForRemoteActions()
                        BlankBrain.shared.sync()
                        checkAppleCredentialState()
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

    private func checkAppleCredentialState() {
        guard let appleUserID = AssistantAppSession.appleUserID else { return }
        ASAuthorizationAppleIDProvider().getCredentialState(forUserID: appleUserID) { state, error in
            guard error == nil, state == .revoked || state == .notFound,
                  AssistantAppSession.appleUserID == appleUserID else { return }
            AssistantAppSession.clear()
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
        let command = AssistantInboxAction(
            id: "", type: components?.stringQueryItem("type") ?? "",
            name: components?.stringQueryItem("name"), windowId: components?.stringQueryItem("window_id"),
            minutes: components?.intQueryItem("minutes").map { min(max($0, 5), 240) },
            hardMode: components?.boolQueryItem("hard"),
            startMinute: components?.minuteQueryItem("start") ?? components?.intQueryItem("start_minute"),
            endMinute: components?.minuteQueryItem("end") ?? components?.intQueryItem("end_minute"),
            weekdays: components?.listQueryItem("weekdays").compactMap(Int.init),
            durationDays: components?.intQueryItem("days"), hours: components?.intQueryItem("hours"),
            appNames: components?.listQueryItem("apps"), requestedAt: nil, expiresAt: nil)
        if let pending = command.toPendingAction() {
            sessionStore.requestAssistantActionConfirmation(pending)
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
        // A remote proposal is intentionally inert until the person taps
        // its visible notification. This callback may be delivered silently by
        // APNs, so it must never acknowledge or execute the pending action.
        completionHandler(.noData)
    }

    private func registerStoredTokenIfPossible() {
        let defaults = BlankSharedState.defaults
        let token = defaults.string(forKey: "blankAssistantPushToken") ?? ""
        let code = defaults.string(forKey: "blankAssistantConnectCode") ?? ""
        let channel = "app"
        guard !token.isEmpty, !code.isEmpty, AssistantAppSession.userID != nil else { return }
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
                channel: channel
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
