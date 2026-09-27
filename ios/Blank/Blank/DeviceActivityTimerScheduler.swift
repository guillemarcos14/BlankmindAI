import Foundation

#if canImport(DeviceActivity)
import DeviceActivity
import FamilyControls
import ManagedSettings
#endif

enum DeviceActivityTimerScheduler {
    static let strategyActivityPrefix = "BlankStrategyTimer"
    static let recurringSchedulePrefix = "BlankRecurringSchedule"
    static let dailyLimitActivity = "BlankDailyLimit"
    static let dailyLimitEvent = "BlankDailyLimitReached"

    // Apple permits twenty monitored activities across the app and extensions.
    // Keep one slot for the daily limit and one for an immediate strategy timer.
    private static let maxScheduleActivities = 18
    static let recurringExpiryActivity = "BlankRecurringScheduleExpiry"
    static let recurringExpiryPrefix = "\(recurringExpiryActivity):"
    private static let recurringStoreName = ManagedSettingsStore.Name("BlankRecurringProtection")
    private static let dailyLimitStoreName = ManagedSettingsStore.Name("BlankDailyLimitProtection")

    static var hasIndependentProtection: Bool {
        #if canImport(DeviceActivity)
        return [recurringStoreName, dailyLimitStoreName].contains { name in
            let shield = ManagedSettingsStore(named: name).shield
            return shield.applications?.isEmpty == false || shield.applicationCategories != nil
                || shield.webDomains?.isEmpty == false || shield.webDomainCategories != nil
        }
        #else
        return false
        #endif
    }

    @discardableResult
    static func syncRecurringSchedule(_ schedule: BlankFocusSchedule, until _: Date? = nil) -> Bool {
        #if canImport(DeviceActivity)
        let center = DeviceActivityCenter()
        let activityNames = (0..<maxScheduleActivities).map {
            DeviceActivityName(rawValue: "\(recurringSchedulePrefix):\($0)")
        }
        let expiryNames = (0..<maxScheduleActivities).map {
            DeviceActivityName(rawValue: "\(recurringExpiryPrefix)\($0)")
        }
        guard schedule.enabled else {
            center.stopMonitoring(activityNames + expiryNames + [DeviceActivityName(rawValue: recurringExpiryActivity)])
            ManagedSettingsStore(named: recurringStoreName).clearAllSettings()
            return true
        }
        let now = Date()
        let intervals = schedule.activeWindows
            .filter { $0.expiresAt.map { $0 > now } ?? true }
            .flatMap(recurringIntervals(for:))
        let expirations = schedule.activeWindows.compactMap(\.expiresAt).filter { $0 > now }
        guard intervals.count + expirations.count <= maxScheduleActivities else { return false }
        // Reject an oversized plan before removing working monitors.
        center.stopMonitoring(activityNames + expiryNames + [DeviceActivityName(rawValue: recurringExpiryActivity)])
        for (index, interval) in intervals.enumerated() {
            let name = DeviceActivityName(rawValue: "\(recurringSchedulePrefix):\(index)")
            let activity = DeviceActivitySchedule(
                intervalStart: interval.start,
                intervalEnd: interval.end,
                repeats: true
            )
            do {
                try center.startMonitoring(name, during: activity)
            } catch {
                return false
            }
        }
        for (index, expiry) in expirations.enumerated() {
            let calendar = Calendar.current
            let start = calendar.dateComponents(
                [.calendar, .timeZone, .year, .month, .day, .hour, .minute, .second],
                from: expiry
            )
            let end = calendar.dateComponents(
                [.calendar, .timeZone, .year, .month, .day, .hour, .minute, .second],
                from: expiry.addingTimeInterval(120)
            )
            do {
                try center.startMonitoring(
                    DeviceActivityName(rawValue: "\(recurringExpiryPrefix)\(index)"),
                    during: DeviceActivitySchedule(intervalStart: start, intervalEnd: end, repeats: false)
                )
            } catch {
                return false
            }
        }
        return true
        #else
        return false
        #endif
    }

    static func start(protectionId: UUID, durationMinutes: Int) -> Bool {
        guard durationMinutes > 0 else { return false }

        #if canImport(DeviceActivity)
        let center = DeviceActivityCenter()
        let activityName = DeviceActivityName(rawValue: "\(strategyActivityPrefix):\(protectionId.uuidString)")
        let timerInterval = makeTimerInterval(durationMinutes: durationMinutes)
        guard timerInterval.start != timerInterval.end else {
            return false
        }

        center.stopMonitoring([activityName])
        let schedule = DeviceActivitySchedule(
            intervalStart: timerInterval.start,
            intervalEnd: timerInterval.end,
            repeats: false
        )

        do {
            try center.startMonitoring(activityName, during: schedule)
            return true
        } catch {
            return false
        }
        #else
        return false
        #endif
    }

    static func stop(protectionId: UUID) {
        #if canImport(DeviceActivity)
        let center = DeviceActivityCenter()
        center.stopMonitoring([DeviceActivityName(rawValue: "\(strategyActivityPrefix):\(protectionId.uuidString)")])
        #endif
    }

    static func startDailyLimit(selection: FamilyActivitySelection, thresholdMinutes: Int) -> Bool {
        #if canImport(DeviceActivity)
        guard thresholdMinutes > 0 else { return false }
        let center = DeviceActivityCenter()
        let activityName = DeviceActivityName(rawValue: dailyLimitActivity)
        let eventName = DeviceActivityEvent.Name(dailyLimitEvent)
        let schedule = DeviceActivitySchedule(
            intervalStart: DateComponents(hour: 0, minute: 0),
            intervalEnd: DateComponents(hour: 23, minute: 59),
            repeats: true
        )
        let event = DeviceActivityEvent(
            applications: selection.applicationTokens,
            categories: selection.categoryTokens,
            webDomains: selection.webDomainTokens,
            threshold: DateComponents(minute: thresholdMinutes)
        )

        center.stopMonitoring([activityName])
        do {
            try center.startMonitoring(activityName, during: schedule, events: [eventName: event])
            return true
        } catch {
            return false
        }
        #else
        return false
        #endif
    }

    static func stopDailyLimit() {
        #if canImport(DeviceActivity)
        DeviceActivityCenter().stopMonitoring([DeviceActivityName(rawValue: dailyLimitActivity)])
        ManagedSettingsStore(named: dailyLimitStoreName).clearAllSettings()
        #endif
    }

    private static func makeTimerInterval(durationMinutes: Int) -> (start: DateComponents, end: DateComponents) {
        let startDate = Date().addingTimeInterval(1)
        let endDate = Date().addingTimeInterval(TimeInterval(durationMinutes * 60))
        let components: Set<Calendar.Component> = [.calendar, .timeZone, .year, .month, .day, .hour, .minute, .second]
        let calendar = Calendar.current
        return (
            start: calendar.dateComponents(components, from: startDate),
            end: calendar.dateComponents(components, from: endDate)
        )
    }

    private static func recurringIntervals(for window: BlankHabitWindow) -> [(start: DateComponents, end: DateComponents)] {
        let start = dateComponents(minute: window.startMinute, second: 0)
        let end = dateComponents(minute: window.endMinute, second: 0)
        if window.startMinute < window.endMinute {
            return [(start, end)]
        }

        return [
            (start, dateComponents(minute: 24 * 60 - 1, second: 59)),
            (dateComponents(minute: 0, second: 0), end)
        ]
    }

    private static func dateComponents(minute: Int, second: Int) -> DateComponents {
        DateComponents(hour: minute / 60, minute: minute % 60, second: second)
    }
}
