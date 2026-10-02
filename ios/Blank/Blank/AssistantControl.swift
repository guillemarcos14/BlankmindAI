import Foundation

struct AssistantInboxAction: Decodable {
    let id: String
    let type: String
    let name: String?
    let windowId: String?
    let minutes: Int?
    let hardMode: Bool?
    let startMinute: Int?
    let endMinute: Int?
    let weekdays: [Int]?
    let durationDays: Int?
    let hours: Int?
    let appNames: [String]?
    let requestedAt: String?
    let expiresAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case type
        case name
        case windowId = "window_id"
        case minutes
        case hardMode = "hard_mode"
        case startMinute = "start_minute"
        case endMinute = "end_minute"
        case weekdays
        case durationDays = "duration_days"
        case hours
        case appNames = "app_names"
        case requestedAt = "requested_at"
        case expiresAt = "expires_at"
    }

    func toPendingAction() -> AssistantPendingAction? {
        let apps = (appNames ?? []).filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        switch type {
        case "start_protection", "activate_mode":
            return .startProtection(minutes: minutes, hardMode: hardMode ?? false, appNames: apps)
        case "switch_mode":
            return .openAppPicker(appNames: apps)
        case "apply_schedule":
            guard let startMinute, let endMinute else { return nil }
            return .applySchedule(
                name: "Protection",
                startMinute: min(max(startMinute, 0), 1439),
                endMinute: min(max(endMinute, 0), 1439),
                weekdays: (weekdays ?? Array(1...7)).filter { (1...7).contains($0) },
                durationDays: min(max(durationDays ?? 7, 1), 14),
                appNames: apps
            )
        case "update_schedule":
            guard let windowId, let startMinute, let endMinute else { return nil }
            return .updateSchedule(
                windowId: windowId,
                name: name ?? "Protection",
                startMinute: min(max(startMinute, 0), 1439),
                endMinute: min(max(endMinute, 0), 1439),
                weekdays: (weekdays ?? Array(1...7)).filter { (1...7).contains($0) }
            )
        case "delete_schedule":
            guard let windowId else { return nil }
            return .deleteSchedule(windowId: windowId)
        case "delete_all_schedules":
            return .deleteAllSchedules
        case "set_daily_limit":
            return .setDailyLimit(minutes: minutes, appNames: apps)
        case "enable_allow_only":
            return .allowOnly
        case "enable_adult_filter":
            return .adultFilter
        case "disable_allow_only":
            return .disableAllowOnly
        case "disable_adult_filter":
            return .disableAdultFilter
        case "disable_daily_limit":
            return .disableDailyLimit
        case "pause_rules":
            return .pauseRules(hours: min(max(hours ?? 168, 1), 168))
        case "disable_pause":
            return .disablePause
        case "apply_ai_plan":
            return .applyAIPlan
        case "open_app_picker":
            let pickerName = name ?? ""
            let pickerSchedule: PendingPlanSchedule?
            if let startMinute, let endMinute {
                pickerSchedule = PendingPlanSchedule(
                    name: pickerName.isEmpty ? "AI Plan" : pickerName,
                    startMinute: min(max(startMinute, 0), 1439),
                    endMinute: min(max(endMinute, 0), 1439),
                    weekdays: (weekdays ?? Array(1...7)).filter { (1...7).contains($0) },
                    durationDays: min(max(durationDays ?? 7, 1), 14)
                )
            } else {
                pickerSchedule = nil
            }
            if pickerName == "Daily Limit", let minutes {
                return .configureAndOpenDailyLimitPicker(appNames: apps, minutes: minutes)
            }
            if pickerSchedule != nil || minutes != nil || hardMode == true || !pickerName.isEmpty {
                return .configureAndOpenAppPicker(
                    appNames: apps,
                    durationMinutes: minutes,
                    hardMode: hardMode ?? false,
                    schedule: pickerSchedule
                )
            }
            return .openAppPicker(appNames: apps)
        case "request_screen_time_permission":
            return .requestScreenTimePermission
        default:
            return nil
        }
    }

    var requestedDate: Date? {
        Self.parseDate(requestedAt)
    }

    static func parseDate(_ value: String?) -> Date? {
        guard let value else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}
