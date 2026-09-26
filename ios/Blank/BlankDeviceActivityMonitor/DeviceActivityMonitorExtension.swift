import DeviceActivity
import FamilyControls
import Foundation
import ManagedSettings
import OSLog
import UserNotifications

private let log = Logger(
    subsystem: "com.blanknfc.app.ios.device-activity",
    category: "DeviceActivity"
)

final class DeviceActivityMonitorExtension: DeviceActivityMonitor {
    private let strategyActivityPrefix = "BlankStrategyTimer"
    private let recurringSchedulePrefix = "BlankRecurringSchedule"
    private let recurringExpiryActivity = "BlankRecurringScheduleExpiry"
    private let recurringExpiryPrefix = "BlankRecurringScheduleExpiry:"
    private let dailyLimitActivity = "BlankDailyLimit"
    private let dailyLimitEvent = "BlankDailyLimitReached"
    private let strategyStore = ManagedSettingsStore()
    private let recurringStore = ManagedSettingsStore(named: ManagedSettingsStore.Name("BlankRecurringProtection"))
    private let dailyLimitStore = ManagedSettingsStore(named: ManagedSettingsStore.Name("BlankDailyLimitProtection"))

    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        log.info("DeviceActivity interval started: \(activity.rawValue)")

        if activity.rawValue == recurringExpiryActivity || activity.rawValue.hasPrefix(recurringExpiryPrefix) {
            if Self.recurringScheduleIsActive() {
                applySelectedProtection(to: recurringStore)
            } else {
                recurringStore.clearAllSettings()
            }
        } else if activity.rawValue.hasPrefix(recurringSchedulePrefix) {
            if Self.recurringScheduleIsActive() {
                applySelectedProtection(to: recurringStore)
            } else {
                recurringStore.clearAllSettings()
            }
        }
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        log.info("DeviceActivity interval ended: \(activity.rawValue)")

        if activity.rawValue.hasPrefix(strategyActivityPrefix) {
            strategyStore.clearAllSettings()
        } else if activity.rawValue.hasPrefix(recurringSchedulePrefix) {
            if Self.recurringScheduleIsActive() {
                applySelectedProtection(to: recurringStore)
            } else {
                recurringStore.clearAllSettings()
            }
        } else if activity.rawValue == recurringExpiryActivity || activity.rawValue.hasPrefix(recurringExpiryPrefix) {
            if Self.recurringScheduleIsActive() {
                applySelectedProtection(to: recurringStore)
            } else {
                recurringStore.clearAllSettings()
            }
        } else if activity.rawValue == dailyLimitActivity {
            dailyLimitStore.clearAllSettings()
        }
    }

    private func applySelectedProtection(to store: ManagedSettingsStore) {
        guard let selection = Self.loadSelection() else { return }
        store.shield.applications = selection.applicationTokens
        store.shield.applicationCategories = selection.categoryTokens.isEmpty ? nil : .specific(selection.categoryTokens)
        store.shield.webDomains = selection.webDomainTokens
        store.webContent.blockedByFilter = Self.adultContentBlockingEnabled ? .auto() : nil
    }

    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)
        log.info("DeviceActivity event reached: \(event.rawValue), activity: \(activity.rawValue)")

        guard activity.rawValue == dailyLimitActivity,
              event.rawValue == dailyLimitEvent,
              Self.loadSelection() != nil else {
            return
        }

        applySelectedProtection(to: dailyLimitStore)

        Task {
            await sendBAIThresholdAlarm()
        }
    }

    private static func loadSelection() -> FamilyActivitySelection? {
        let defaults = UserDefaults(suiteName: "group.com.blanknfc.app.ios") ?? .standard
        guard let data = defaults.data(forKey: "familyActivitySelection") else { return nil }
        return try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
    }

    private struct StoredSchedule: Decodable {
        let enabled: Bool
        let windows: [StoredWindow]
    }

    private struct StoredWindow: Decodable {
        let enabled: Bool
        let startMinute: Int
        let endMinute: Int
        let weekdays: [Int]
        let expiresAt: Date?

        func contains(_ date: Date, calendar: Calendar = .current) -> Bool {
            guard enabled, expiresAt.map({ $0 > date }) ?? true else { return false }
            let minute = calendar.component(.hour, from: date) * 60 + calendar.component(.minute, from: date)
            var weekday = calendar.component(.weekday, from: date)
            if startMinute >= endMinute, minute < endMinute {
                weekday = weekday == 1 ? 7 : weekday - 1
            }
            guard weekdays.contains(weekday) else { return false }
            return startMinute < endMinute
                ? minute >= startMinute && minute < endMinute
                : minute >= startMinute || minute < endMinute
        }
    }

    private static func recurringScheduleIsActive(at date: Date = Date()) -> Bool {
        let defaults = sharedDefaults
        if let pausedUntil = defaults.object(forKey: "blankSchedulePausedUntil") as? TimeInterval,
           pausedUntil > date.timeIntervalSince1970 { return false }
        if let vacationUntil = defaults.object(forKey: "blankVacationModeUntil") as? TimeInterval,
           vacationUntil > date.timeIntervalSince1970 { return false }
        guard let data = defaults.data(forKey: "blankFocusSchedule"),
              let schedule = try? JSONDecoder().decode(StoredSchedule.self, from: data),
              schedule.enabled else { return false }
        return schedule.windows.contains { $0.contains(date) }
    }

    private static var adultContentBlockingEnabled: Bool {
        let defaults = UserDefaults(suiteName: "group.com.blanknfc.app.ios") ?? .standard
        return defaults.bool(forKey: "blankAdultContentBlockingEnabled")
    }

    private func sendBAIThresholdAlarm() async {
        let defaults = Self.sharedDefaults
        let thresholdMinutes = max(5, defaults.integer(forKey: "blankDailyLimitMinutes"))
        let declaredApps = defaults.string(forKey: "blankOnboardingDistractingApps") ?? ""
        let weakMoment = defaults.string(forKey: "blankOnboardingWeakMoment") ?? ""
        let dailyHours = defaults.double(forKey: "blankOnboardingDailyHours")
        let selectionCount = Self.loadSelection()?.applicationTokens.count ?? 0
        let prompt = "proactive signal: selected distracting apps reached \(thresholdMinutes) minutes today"

    let fallback = "BM noticed your distracting app limit was reached. Keep the block on now and review whether this time window needs stronger protection."
        let body = await resolveBAIMessage(
            prompt: prompt,
            thresholdMinutes: thresholdMinutes,
            selectionCount: selectionCount,
            declaredApps: declaredApps,
            weakMoment: weakMoment,
            dailyHours: dailyHours
        ) ?? fallback

        saveLatestAlarm(body: body, thresholdMinutes: thresholdMinutes)
        await notify(body: body)
    }

    private func resolveBAIMessage(
        prompt: String,
        thresholdMinutes: Int,
        selectionCount: Int,
        declaredApps: String,
        weakMoment: String,
        dailyHours: Double
    ) async -> String? {
        guard let baseURL = configuredBaseURL() else { return nil }
        var request = URLRequest(url: baseURL.appendingPathComponent("blanked-agent"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 8
        let context: [String: Any] = [
            "trigger": "proactive",
            "mode": "proactive",
            "signal_type": "daily_limit_reached",
            "threshold_minutes": thresholdMinutes,
            "selection_count": selectionCount,
            "has_selected_apps": selectionCount > 0,
            "screen_time_authorized": true,
            "declared_distracting_apps": declaredApps,
            "weak_moment": weakMoment,
            "declared_daily_usage_hours": dailyHours
        ]
        let payload: [String: Any] = [
            "prompt": prompt,
            "locale": Locale.current.identifier,
            "context": context
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200..<300).contains(httpResponse.statusCode),
                  let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let plan = object["plan"] as? [String: Any] else {
                return nil
            }
            let text = (plan["message_text"] as? String) ?? (plan["response_text"] as? String)
            return cleanNotificationText(text)
        } catch {
            return nil
        }
    }

    private func saveLatestAlarm(body: String, thresholdMinutes: Int) {
        let defaults = Self.sharedDefaults
        let id = UUID().uuidString
        defaults.set(id, forKey: "blankBAIProactiveAlertId")
        defaults.set(body, forKey: "blankBAIProactiveAlertBody")
        defaults.set(thresholdMinutes, forKey: "blankBAIProactiveAlertThresholdMinutes")
        defaults.set(Date().timeIntervalSince1970, forKey: "blankBAIProactiveAlertCreatedAt")
        defaults.synchronize()
    }

    private func notify(body: String) async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }

        let content = UNMutableNotificationContent()
        content.title = "BM"
        content.body = body
        content.sound = .default
        content.userInfo = ["blank_url": "blank://bai-alert"]
        let request = UNNotificationRequest(
            identifier: "blank-bai-daily-limit-\(Int(Date().timeIntervalSince1970))",
            content: content,
            trigger: nil
        )
        try? await UNUserNotificationCenter.current().add(request)
    }

    private func cleanNotificationText(_ value: String?) -> String? {
        let text = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        return String(text.prefix(220))
    }

    private func configuredBaseURL() -> URL? {
        guard let rawValue = Bundle.main.object(forInfoDictionaryKey: "BlankMembershipAPIBaseURL") as? String else {
            return nil
        }
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("$(") else { return nil }
        return URL(string: trimmed)
    }

    private static var sharedDefaults: UserDefaults {
        UserDefaults(suiteName: "group.com.blanknfc.app.ios") ?? .standard
    }
}
