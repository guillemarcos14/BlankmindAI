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
    private let strategyExpiryPrefix = "BlankStrategyExpiry"
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

        if activity.rawValue.hasPrefix(strategyExpiryPrefix) {
            releaseExpiredStrategy()
        } else if activity.rawValue == recurringExpiryActivity || activity.rawValue.hasPrefix(recurringExpiryPrefix) {
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

        if activity.rawValue.hasPrefix(strategyActivityPrefix) || activity.rawValue.hasPrefix(strategyExpiryPrefix) {
            releaseExpiredStrategy()
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

    private func releaseExpiredStrategy() {
        // A delayed callback from an older timer must not release a newer block.
        guard Self.strategyHasExpired(defaults: Self.sharedDefaults) else { return }
        strategyStore.clearAllSettings()
    }

    private static func strategyHasExpired(defaults: UserDefaults, now: Date = Date()) -> Bool {
        guard defaults.bool(forKey: "isBlankActive") else { return true }
        guard let end = defaults.object(forKey: "blankActiveUntil") as? TimeInterval else { return false }
        return now.timeIntervalSince1970 >= end
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

        let defaults = Self.sharedDefaults
        guard let owner = defaults.string(forKey: "blankBMBSignalOwner") else { return }
        let signal: [String: Any] = ["id": UUID().uuidString, "owner": owner,
            "kind": "daily_limit_reached", "occurred_at": ISO8601DateFormatter().string(from: Date()),
            "threshold_minutes": defaults.integer(forKey: "blankDailyLimitMinutes")]
        var signals = defaults.array(forKey: "blankBMBDeviceSignals") as? [[String: Any]] ?? []
        signals.append(signal)
        defaults.set(Array(signals.suffix(100)), forKey: "blankBMBDeviceSignals")
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
        let startsAt: Date?
        let endsAt: Date?
        let timeZoneIdentifier: String?

        func contains(_ date: Date, calendar: Calendar = .current) -> Bool {
            guard enabled, expiresAt.map({ $0 > date }) ?? true else { return false }
            if let startsAt, let endsAt { return date >= startsAt && date < endsAt }
            var calendar = calendar
            if let timeZoneIdentifier, let zone = TimeZone(identifier: timeZoneIdentifier) { calendar.timeZone = zone }
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

    private static var sharedDefaults: UserDefaults {
        UserDefaults(suiteName: "group.com.blanknfc.app.ios") ?? .standard
    }
}
