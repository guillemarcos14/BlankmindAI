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
    static private(set) var recurringScheduleFailure: String?

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
        recurringScheduleFailure = nil
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
            .filter { $0.startsAt == nil }
            .flatMap(recurringIntervals(for:))
        let dated = schedule.activeWindows.filter { $0.startsAt != nil && ($0.endsAt ?? .distantPast) > now }
        let expirations = schedule.activeWindows.filter { $0.startsAt == nil }.compactMap(\.expiresAt).filter { $0 > now }
        guard intervals.count + expirations.count + dated.count <= maxScheduleActivities else {
            recurringScheduleFailure = "schedule_activity_limit"; return false
        }
        // Reject an oversized plan before removing working monitors.
        center.stopMonitoring(activityNames + expiryNames + [DeviceActivityName(rawValue: recurringExpiryActivity)])
        for (index, window) in dated.enumerated() {
            guard let start = window.startsAt, let end = window.endsAt,
                  let timezone = window.timeZoneIdentifier.flatMap(TimeZone.init(identifier:)) else {
                recurringScheduleFailure = "schedule_invalid_metadata"; return false
            }
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = timezone
            let components: Set<Calendar.Component> = [.calendar, .timeZone, .year, .month, .day, .hour, .minute, .second]
            do {
                try center.startMonitoring(DeviceActivityName(rawValue: "\(recurringSchedulePrefix):\(intervals.count + index)"),
                    during: DeviceActivitySchedule(intervalStart: calendar.dateComponents(components, from: start),
                        intervalEnd: calendar.dateComponents(components, from: end), repeats: false))
            } catch { return recordScheduleFailure(error) }
        }
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
                return recordScheduleFailure(error)
            }
        }
        for (index, expiry) in expirations.enumerated() {
            let interval = makeExpiryInterval(expiry: expiry)
            do {
                try center.startMonitoring(
                    DeviceActivityName(rawValue: "\(recurringExpiryPrefix)\(index)"),
                    during: DeviceActivitySchedule(intervalStart: interval.start, intervalEnd: interval.end, repeats: false)
                )
            } catch {
                return recordScheduleFailure(error)
            }
        }
        return true
        #else
        recurringScheduleFailure = "schedule_native_unavailable"
        return false
        #endif
    }

    #if canImport(DeviceActivity)
    private static func recordScheduleFailure(_ error: Error) -> Bool {
        switch error as? DeviceActivityCenter.MonitoringError {
        case .excessiveActivities: recurringScheduleFailure = "schedule_activity_limit"
        case .intervalTooLong: recurringScheduleFailure = "schedule_interval_too_long"
        case .intervalTooShort: recurringScheduleFailure = "schedule_interval_too_short"
        case .invalidDateComponents: recurringScheduleFailure = "schedule_invalid_dates"
        case .unauthorized: recurringScheduleFailure = "schedule_monitoring_unauthorized"
        default: recurringScheduleFailure = "schedule_monitoring_failed"
        }
        return false
    }
    #endif

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

    private static func makeExpiryInterval(expiry: Date, calendar: Calendar = .current) -> (start: DateComponents, end: DateComponents) {
        // The callback at the START releases the expired window. This monitoring
        // span meets Apple's 15-minute minimum without extending protection.
        let components: Set<Calendar.Component> = [.calendar, .timeZone, .year, .month, .day, .hour, .minute, .second]
        // DateComponents has whole seconds. A truncated callback could arrive
        // before expiry and leave the old shield until the interval's end.
        let callbackDate = Date(timeIntervalSince1970: ceil(expiry.timeIntervalSince1970))
        return (calendar.dateComponents(components, from: callbackDate),
                calendar.dateComponents(components, from: callbackDate.addingTimeInterval(15 * 60)))
    }

    private static func recurringIntervals(for window: BlankHabitWindow) -> [(start: DateComponents, end: DateComponents)] {
        let start = dateComponents(minute: window.startMinute, second: 0)
        let end = dateComponents(minute: window.endMinute, second: 0)
        let intervals: [(start: DateComponents, end: DateComponents)] = window.startMinute < window.endMinute
            ? [(start,end)]
            : [(start,dateComponents(minute:24*60-1,second:59)),(dateComponents(minute:0,second:0),end)]
        return intervals.map { interval in
            var start=interval.start, end=interval.end
            if let timezone=window.timeZoneIdentifier.flatMap(TimeZone.init(identifier:)) { start.timeZone=timezone; end.timeZone=timezone }
            return (start,end)
        }
    }

    private static func dateComponents(minute: Int, second: Int) -> DateComponents {
        DateComponents(hour: minute / 60, minute: minute % 60, second: second)
    }
}
