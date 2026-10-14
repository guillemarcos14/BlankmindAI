import Foundation

enum BlankmindAppPresence {
    static func payload(appReady: Bool) -> [String: Any] {
        [
            "app_present": true,
            "app_ready": appReady,
            "platform": "ios",
            "app_version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
            "build_number": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "",
        ]
    }
}

enum BlankFunnelAnalytics {
    private static let userIdKey = "blankOnboardingAnonymousUserId"
    private static var seenStepKeys = Set<String>()

    static func track(
        _ event: String,
        step: String? = nil,
        properties: [String: Any] = [:],
        defaults: UserDefaults = BlankSharedState.defaults
    ) async {
        guard let baseURL = configuredBaseURL() else { return }
        var request = URLRequest(url: baseURL.appendingPathComponent("funnel-event"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = [
            "anonymous_user_id": anonymousUserId(defaults: defaults),
            "event": event,
            "properties": sanitizedProperties(properties),
            "platform": "ios",
            "locale": Locale.current.identifier,
            "app_version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
            "build_number": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "",
            "data_consent": true,
            "consent_text": "Product analytics"
        ]
        if let step, !step.isEmpty {
            body["step"] = step
        }
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
                return
            }
        } catch {
            return
        }
    }

    static func trackStepOnce(_ step: String, properties: [String: Any] = [:]) {
        let key = "\(step)-\(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "")"
        guard !seenStepKeys.contains(key) else { return }
        seenStepKeys.insert(key)
        Task {
            await track("onboarding_step_viewed", step: step, properties: properties)
        }
    }

    private static func anonymousUserId(defaults: UserDefaults) -> String {
        if let existing = defaults.string(forKey: userIdKey), !existing.isEmpty {
            return existing
        }
        let created = UUID().uuidString
        defaults.set(created, forKey: userIdKey)
        return created
    }

    private static func configuredBaseURL() -> URL? {
        guard let rawValue = Bundle.main.object(forInfoDictionaryKey: "BlankMembershipAPIBaseURL") as? String else {
            return nil
        }
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("$(") else {
            return nil
        }
        return URL(string: trimmed)
    }

    private static func sanitizedProperties(_ properties: [String: Any]) -> [String: Any] {
        properties.reduce(into: [:]) { result, item in
            let key = String(item.key.prefix(64))
            switch item.value {
            case let value as String:
                result[key] = String(value.prefix(240))
            case let value as Int:
                result[key] = value
            case let value as Double:
                result[key] = value
            case let value as Bool:
                result[key] = value
            default:
                result[key] = String(describing: item.value).prefix(240).description
            }
        }
    }
}

// Public, explicit sample data for exploration and App Review. Account-scoped and
// separate from the private QA switch; never enables itself or writes to Health.
enum SampleSleepSource {
    static func enabled(owner: String?, defaults: UserDefaults) -> Bool {
        guard let owner, !owner.isEmpty else { return false }
        return defaults.bool(forKey: "blankSampleSleep.v1.\(owner)")
    }

    static func setEnabled(_ enabled: Bool, owner: String?, defaults: UserDefaults) {
        guard let owner, !owner.isEmpty else { return }
        defaults.set(enabled, forKey: "blankSampleSleep.v1.\(owner)")
    }
}

enum AppStoreScreenshotMode {
    static var enabled: Bool {
        #if DEBUG && targetEnvironment(simulator)
        return ProcessInfo.processInfo.environment["BLANK_APPSTORE_CAPTURE"] == "1"
        #else
        return false
        #endif
    }
}

// Private QA source: only completed sleep nights, never sessions or activity.
enum SyntheticSleepSource {
    static var allowed: Bool {
        #if DEBUG && targetEnvironment(simulator)
        return true // Local native tests and previews; never a distributed build.
        #elseif BLANK_PRIVATE_STAGE_QA
        return allowsDistributedSource(privateQA: true, receiptName: Bundle.main.appStoreReceiptURL?.lastPathComponent)
        #else
        return false
        #endif
    }

    static func allowsDistributedSource(privateQA: Bool, receiptName: String?) -> Bool {
        privateQA && receiptName == "sandboxReceipt"
    }

    static func enabled(owner: String?, defaults: UserDefaults) -> Bool {
        guard allowed, let owner, !owner.isEmpty else { return false }
        return defaults.bool(forKey: "blankSyntheticSleep.\(owner)")
    }

    static func setEnabled(_ enabled: Bool, owner: String?, defaults: UserDefaults) {
        guard allowed, let owner, !owner.isEmpty else { return }
        defaults.set(enabled, forKey: "blankSyntheticSleep.\(owner)")
    }

    static func applying(to real: [HealthDaySummary], now: Date = Date(), days: Int = 14,
                         calendar: Calendar = .current) -> [HealthDaySummary] {
        guard days > 0 else { return [] }
        let today = calendar.startOfDay(for: now)
        let wakeToday = calendar.date(bySettingHour: 7, minute: 30, second: 0, of: today)!
        let latest = now >= wakeToday ? today : calendar.date(byAdding: .day, value: -1, to: today)!
        var byDay = Dictionary(real.map { (calendar.startOfDay(for: $0.date), $0) }, uniquingKeysWith: { _, last in last })
        // Strip every real sleep field first: sources are mutually exclusive, including dates outside the fixture.
        for day in Array(byDay.keys) { byDay[day] = replacingSleep(in: byDay[day]!, with: HealthDaySummary(date: day)) }
        for offset in 0..<days {
            let day = calendar.date(byAdding: .day, value: -offset, to: latest)!
            let sleep = 410 + offset % 4 * 15
            var sample = HealthDaySummary(date: day)
            sample.inBedMinutes = sleep + 25
            sample.sleepMinutes = sleep
            sample.deepSleepMinutes = 75
            sample.remSleepMinutes = 90
            sample.coreSleepMinutes = sleep - 165
            sample.awakeMinutes = 25
            sample.wakeMinute = 7 * 60 + 30
            sample.bedtimeMinute = (sample.wakeMinute! - sleep - 25 + 1440) % 1440
            byDay[day] = replacingSleep(in: byDay[day] ?? HealthDaySummary(date: day), with: sample)
        }
        return byDay.values.filter(\.hasSignals).sorted { $0.date < $1.date }
    }

    static func removingSleep(from summaries: [HealthDaySummary]) -> [HealthDaySummary] {
        summaries.map { replacingSleep(in: $0, with: HealthDaySummary(date: $0.date)) }.filter(\.hasSignals)
    }

    private static func replacingSleep(in real: HealthDaySummary, with sleep: HealthDaySummary) -> HealthDaySummary {
        var result = real
        result.inBedMinutes = sleep.inBedMinutes
        result.sleepMinutes = sleep.sleepMinutes
        result.deepSleepMinutes = sleep.deepSleepMinutes
        result.remSleepMinutes = sleep.remSleepMinutes
        result.coreSleepMinutes = sleep.coreSleepMinutes
        result.awakeMinutes = sleep.awakeMinutes
        result.bedtimeMinute = sleep.bedtimeMinute
        result.wakeMinute = sleep.wakeMinute
        result.signalCount = [result.inBedMinutes, result.sleepMinutes, result.deepSleepMinutes,
            result.remSleepMinutes, result.coreSleepMinutes, result.awakeMinutes, result.bedtimeMinute,
            result.wakeMinute, result.steps, result.distanceMeters, result.activeEnergyKcal,
            result.basalEnergyKcal, result.workoutMinutes, result.mindfulMinutes, result.averageHeartRate,
            result.restingHeartRate, result.hrvSDNN, result.respiratoryRate, result.oxygenSaturation,
            result.vo2Max, result.flightsClimbed].compactMap { $0 }.count
        return result
    }
}

struct HealthDaySummary: Identifiable, Equatable {
    var id: Date { date }
    var date: Date
    var inBedMinutes: Int?
    var sleepMinutes: Int?
    var deepSleepMinutes: Int?
    var remSleepMinutes: Int?
    var coreSleepMinutes: Int?
    var awakeMinutes: Int?
    var bedtimeMinute: Int?
    var wakeMinute: Int?
    var steps: Int?
    var distanceMeters: Int?
    var activeEnergyKcal: Int?
    var basalEnergyKcal: Int?
    var workoutMinutes: Int?
    var mindfulMinutes: Int?
    var averageHeartRate: Int?
    var restingHeartRate: Int?
    var hrvSDNN: Int?
    var respiratoryRate: Int?
    var oxygenSaturation: Int?
    var vo2Max: Int?
    var flightsClimbed: Int?
    var signalCount: Int = 0

    var hasSignals: Bool {
        inBedMinutes != nil ||
        sleepMinutes != nil ||
        deepSleepMinutes != nil ||
        remSleepMinutes != nil ||
        coreSleepMinutes != nil ||
        awakeMinutes != nil ||
        bedtimeMinute != nil ||
        wakeMinute != nil ||
        steps != nil ||
        distanceMeters != nil ||
        activeEnergyKcal != nil ||
        basalEnergyKcal != nil ||
        workoutMinutes != nil ||
        mindfulMinutes != nil ||
        averageHeartRate != nil ||
        restingHeartRate != nil ||
        hrvSDNN != nil ||
        respiratoryRate != nil ||
        oxygenSaturation != nil ||
        vo2Max != nil ||
        flightsClimbed != nil ||
        signalCount > 0
    }
}

enum BlankStrategyKind: String, Codable, CaseIterable, Identifiable {
    case manual
    case nfc
    case manualStartNfcStop
    case nfcTimer

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .manual:
            return "Manual"
        case .nfc:
            return "NFC"
        case .manualStartNfcStop:
            return "Manual + NFC"
        case .nfcTimer:
            return "NFC + Timer"
        }
    }

    var usesNFC: Bool {
        switch self {
        case .nfc, .manualStartNfcStop, .nfcTimer:
            return true
        case .manual:
            return false
        }
    }

    var hasTimer: Bool {
        switch self {
        case .nfcTimer:
            return true
        case .manual, .nfc, .manualStartNfcStop:
            return false
        }
    }
}

enum BlankEntryMode: String, Codable {
    case app
    case nfc
    case schedule
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = Self(rawValue: value) ?? .app
    }

}

enum BlankUsageEventKind: String, Codable {
    case blockStarted
    case blockEnded
    case blockBroken
}

enum BlankEndedReason: String, Codable {
    case control
    case nfc
    case manual
    case timer
    case schedule
    case emergency
    case expired
    case unknown
}

struct BlankSelectionSnapshot: Codable, Equatable {
    var applicationCount: Int
    var categoryCount: Int
    var webDomainCount: Int

    var totalCount: Int {
        applicationCount + categoryCount + webDomainCount
    }

    init(applicationCount: Int = 0, categoryCount: Int = 0, webDomainCount: Int = 0) {
        self.applicationCount = applicationCount
        self.categoryCount = categoryCount
        self.webDomainCount = webDomainCount
    }
}

struct BlankUsageEvent: Codable, Identifiable, Equatable {
    var id: UUID
    var kind: BlankUsageEventKind
    var sessionId: UUID?
    var occurredAt: Date
    var entryMode: BlankEntryMode
    var endedReason: BlankEndedReason?
    var duration: TimeInterval?
    var selectionSnapshot: BlankSelectionSnapshot
    var modeName: String?
    var localHour: Int
    var weekday: Int
    var plannedDurationMinutes: Int?

    init(
        id: UUID = UUID(),
        kind: BlankUsageEventKind,
        sessionId: UUID?,
        occurredAt: Date = Date(),
        entryMode: BlankEntryMode,
        endedReason: BlankEndedReason? = nil,
        duration: TimeInterval? = nil,
        selectionSnapshot: BlankSelectionSnapshot = BlankSelectionSnapshot(),
        modeName: String? = nil,
        localHour: Int? = nil,
        weekday: Int? = nil,
        plannedDurationMinutes: Int? = nil,
        calendar: Calendar = .current
    ) {
        self.id = id
        self.kind = kind
        self.sessionId = sessionId
        self.occurredAt = occurredAt
        self.entryMode = entryMode
        self.endedReason = endedReason
        self.duration = duration
        self.selectionSnapshot = selectionSnapshot
        self.modeName = modeName
        self.localHour = localHour ?? calendar.component(.hour, from: occurredAt)
        self.weekday = weekday ?? calendar.component(.weekday, from: occurredAt)
        self.plannedDurationMinutes = plannedDurationMinutes
    }

    enum CodingKeys: String, CodingKey {
        case id
        case kind
        case sessionId
        case occurredAt
        case entryMode
        case endedReason
        case duration
        case selectionSnapshot
        case modeName
        case localHour
        case weekday
        case plannedDurationMinutes
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        kind = try container.decode(BlankUsageEventKind.self, forKey: .kind)
        sessionId = try container.decodeIfPresent(UUID.self, forKey: .sessionId)
        occurredAt = try container.decodeIfPresent(Date.self, forKey: .occurredAt) ?? Date()
        entryMode = try container.decodeIfPresent(BlankEntryMode.self, forKey: .entryMode) ?? .app
        endedReason = try container.decodeIfPresent(BlankEndedReason.self, forKey: .endedReason)
        duration = try container.decodeIfPresent(TimeInterval.self, forKey: .duration)
        selectionSnapshot = try container.decodeIfPresent(BlankSelectionSnapshot.self, forKey: .selectionSnapshot) ?? BlankSelectionSnapshot()
        modeName = try container.decodeIfPresent(String.self, forKey: .modeName)
        localHour = try container.decodeIfPresent(Int.self, forKey: .localHour) ?? Calendar.current.component(.hour, from: occurredAt)
        weekday = try container.decodeIfPresent(Int.self, forKey: .weekday) ?? Calendar.current.component(.weekday, from: occurredAt)
        plannedDurationMinutes = try container.decodeIfPresent(Int.self, forKey: .plannedDurationMinutes)
    }
}

struct LegacyFocusMode: Codable, Identifiable, Equatable {
    var id: UUID
    var name: String
    var selectionData: Data?
    var appNames: [String]
    var createdAt: Date
    var updatedAt: Date

    init(
        id: UUID = UUID(),
        name: String,
        selectionData: Data? = nil,
        appNames: [String] = [],
        createdAt: Date = Date(),
        updatedAt: Date = Date()
    ) {
        self.id = id
        self.name = name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "Mode"
            : name.trimmingCharacters(in: .whitespacesAndNewlines)
        self.selectionData = selectionData
        self.appNames = Self.normalizedAppNames(appNames)
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    private enum CodingKeys: String, CodingKey {
        case id
        case name
        case selectionData
        case appNames
        case createdAt
        case updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        let decodedName = try container.decodeIfPresent(String.self, forKey: .name)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let decodedName, !decodedName.isEmpty {
            name = decodedName
        } else {
            name = "Mode"
        }
        selectionData = try container.decodeIfPresent(Data.self, forKey: .selectionData)
        appNames = Self.normalizedAppNames(try container.decodeIfPresent([String].self, forKey: .appNames) ?? [])
        createdAt = try container.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
        updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt) ?? createdAt
    }

    private static func normalizedAppNames(_ names: [String]) -> [String] {
        var seen = Set<String>()
        return names.compactMap { rawName in
            let name = rawName.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty, !seen.contains(name.lowercased()) else { return nil }
            seen.insert(name.lowercased())
            return name
        }
    }
}

struct BlankHabitWindow: Codable, Identifiable, Equatable {
    var id: UUID
    var name: String
    var enabled: Bool
    var startMinute: Int
    var endMinute: Int
    var weekdays: [Int]
    var expiresAt: Date?
    var startsAt: Date?
    var endsAt: Date?
    var timeZoneIdentifier: String?

    init(
        id: UUID = UUID(),
        name: String = "Habit",
        enabled: Bool = true,
        startMinute: Int = 23 * 60 + 30,
        endMinute: Int = 8 * 60,
        weekdays: [Int] = Array(1...7),
        expiresAt: Date? = nil,
        startsAt: Date? = nil,
        endsAt: Date? = nil,
        timeZoneIdentifier: String? = nil
    ) {
        self.id = id
        self.name = name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "Habit"
            : name.trimmingCharacters(in: .whitespacesAndNewlines)
        self.enabled = enabled
        self.startMinute = min(max(startMinute, 0), 1439)
        self.endMinute = min(max(endMinute, 0), 1439)
        self.weekdays = Self.normalizedWeekdays(weekdays)
        self.expiresAt = expiresAt
        self.startsAt = startsAt
        self.endsAt = endsAt
        self.timeZoneIdentifier = timeZoneIdentifier
    }

    func contains(_ date: Date, calendar: Calendar = .current) -> Bool {
        guard enabled, expiresAt.map({ $0 > date }) ?? true else { return false }
        if let startsAt, let endsAt { return date >= startsAt && date < endsAt }
        var calendar = calendar
        if let timeZoneIdentifier, let zone = TimeZone(identifier: timeZoneIdentifier) { calendar.timeZone = zone }
        let minute = calendar.component(.hour, from: date) * 60 + calendar.component(.minute, from: date)
        let activeWeekday = activeWeekday(for: date, minute: minute, calendar: calendar)
        guard weekdays.contains(activeWeekday) else { return false }
        if startMinute < endMinute {
            return minute >= startMinute && minute < endMinute
        }
        return minute >= startMinute || minute < endMinute
    }

    var durationMinutes: Int {
        if startMinute < endMinute {
            return max(1, endMinute - startMinute)
        }
        return max(1, (24 * 60 - startMinute) + endMinute)
    }

    func remainingMinutes(from date: Date, calendar: Calendar = .current) -> Int {
        if let endsAt { return max(1, Int(ceil(endsAt.timeIntervalSince(date) / 60))) }
        let minute = calendar.component(.hour, from: date) * 60 + calendar.component(.minute, from: date)
        let remaining: Int
        if startMinute < endMinute {
            remaining = endMinute - minute
        } else if minute >= startMinute {
            remaining = (24 * 60 - minute) + endMinute
        } else {
            remaining = endMinute - minute
        }
        return max(1, remaining)
    }

    var runsEveryDay: Bool {
        Set(weekdays) == Set(1...7)
    }

    private func activeWeekday(for date: Date, minute: Int, calendar: Calendar) -> Int {
        let weekday = calendar.component(.weekday, from: date)
        guard startMinute >= endMinute, minute < endMinute else {
            return weekday
        }
        return weekday == 1 ? 7 : weekday - 1
    }

    private static func normalizedWeekdays(_ weekdays: [Int]) -> [Int] {
        let unique = Array(Set(weekdays.filter { (1...7).contains($0) })).sorted()
        return unique.isEmpty ? Array(1...7) : unique
    }

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case enabled
        case startMinute
        case endMinute
        case weekdays
        case expiresAt
        case startsAt, endsAt, timeZoneIdentifier
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        name = try container.decodeIfPresent(String.self, forKey: .name) ?? "Habit"
        enabled = try container.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
        startMinute = min(max(try container.decodeIfPresent(Int.self, forKey: .startMinute) ?? 23 * 60 + 30, 0), 1439)
        endMinute = min(max(try container.decodeIfPresent(Int.self, forKey: .endMinute) ?? 8 * 60, 0), 1439)
        weekdays = Self.normalizedWeekdays(try container.decodeIfPresent([Int].self, forKey: .weekdays) ?? Array(1...7))
        expiresAt = try container.decodeIfPresent(Date.self, forKey: .expiresAt)
        startsAt = try container.decodeIfPresent(Date.self, forKey: .startsAt)
        endsAt = try container.decodeIfPresent(Date.self, forKey: .endsAt)
        timeZoneIdentifier = try container.decodeIfPresent(String.self, forKey: .timeZoneIdentifier)
    }
}

struct BlankFocusSchedule: Codable, Equatable {
    var enabled: Bool
    var startMinute: Int
    var endMinute: Int
    var windows: [BlankHabitWindow]

    init(
        enabled: Bool = false,
        startMinute: Int = 23 * 60 + 30,
        endMinute: Int = 8 * 60,
        windows: [BlankHabitWindow]? = nil
    ) {
        self.enabled = enabled
        self.startMinute = min(max(startMinute, 0), 1439)
        self.endMinute = min(max(endMinute, 0), 1439)
        if let windows {
            self.windows = windows
        } else if enabled {
            self.windows = [
                BlankHabitWindow(name: "Habit 1", enabled: true, startMinute: self.startMinute, endMinute: self.endMinute)
            ]
        } else {
            self.windows = []
        }
    }

    var activeWindows: [BlankHabitWindow] {
        windows.filter(\.enabled)
    }

    func contains(_ date: Date, calendar: Calendar = .current) -> Bool {
        activeWindows.contains { $0.contains(date, calendar: calendar) }
    }

    func window(containing date: Date, calendar: Calendar = .current) -> BlankHabitWindow? {
        activeWindows.first { $0.contains(date, calendar: calendar) }
    }

    enum CodingKeys: String, CodingKey {
        case enabled
        case startMinute
        case endMinute
        case windows
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        enabled = try container.decodeIfPresent(Bool.self, forKey: .enabled) ?? false
        startMinute = min(max(try container.decodeIfPresent(Int.self, forKey: .startMinute) ?? 23 * 60 + 30, 0), 1439)
        endMinute = min(max(try container.decodeIfPresent(Int.self, forKey: .endMinute) ?? 8 * 60, 0), 1439)
        let decodedWindows = try container.decodeIfPresent([BlankHabitWindow].self, forKey: .windows)
        if let decodedWindows, !decodedWindows.isEmpty {
            windows = decodedWindows
        } else if enabled {
            windows = [
                BlankHabitWindow(name: "Habit 1", enabled: true, startMinute: startMinute, endMinute: endMinute)
            ]
        } else {
            windows = []
        }
    }
}

struct BlankSession: Codable, Identifiable, Equatable {
    var id: UUID
    var profileId: UUID
    var strategy: BlankStrategyKind
    var startTag: String?
    var startedAt: Date
    var endedAt: Date?
    var pauseStartedAt: Date?
    var pauseEndedAt: Date?
    var forceStarted: Bool
    var entryMode: BlankEntryMode?
    var endedReason: BlankEndedReason?
    var selectionSnapshot: BlankSelectionSnapshot?
    var modeName: String?
    var localStartHour: Int?
    var startWeekday: Int?
    var plannedDurationMinutes: Int?

    init(
        id: UUID = UUID(),
        profileId: UUID,
        strategy: BlankStrategyKind,
        startTag: String? = nil,
        startedAt: Date = Date(),
        endedAt: Date? = nil,
        pauseStartedAt: Date? = nil,
        pauseEndedAt: Date? = nil,
        forceStarted: Bool = false,
        entryMode: BlankEntryMode? = nil,
        endedReason: BlankEndedReason? = nil,
        selectionSnapshot: BlankSelectionSnapshot? = nil,
        modeName: String? = nil,
        localStartHour: Int? = nil,
        startWeekday: Int? = nil,
        plannedDurationMinutes: Int? = nil,
        calendar: Calendar = .current
    ) {
        self.id = id
        self.profileId = profileId
        self.strategy = strategy
        self.startTag = startTag
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.pauseStartedAt = pauseStartedAt
        self.pauseEndedAt = pauseEndedAt
        self.forceStarted = forceStarted
        self.entryMode = entryMode
        self.endedReason = endedReason
        self.selectionSnapshot = selectionSnapshot
        self.modeName = modeName
        self.localStartHour = localStartHour ?? calendar.component(.hour, from: startedAt)
        self.startWeekday = startWeekday ?? calendar.component(.weekday, from: startedAt)
        self.plannedDurationMinutes = plannedDurationMinutes
    }

    var isActive: Bool {
        endedAt == nil
    }

    var duration: TimeInterval {
        (endedAt ?? Date()).timeIntervalSince(startedAt)
    }

    mutating func end(at date: Date = Date(), endedReason: BlankEndedReason? = nil) {
        endedAt = date
        self.endedReason = endedReason
    }

    enum CodingKeys: String, CodingKey {
        case id
        case profileId
        case strategy
        case startTag
        case startedAt
        case endedAt
        case pauseStartedAt
        case pauseEndedAt
        case forceStarted
        case entryMode
        case endedReason
        case selectionSnapshot
        case modeName
        case localStartHour
        case startWeekday
        case plannedDurationMinutes
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        profileId = try container.decode(UUID.self, forKey: .profileId)
        strategy = try container.decode(BlankStrategyKind.self, forKey: .strategy)
        startTag = try container.decodeIfPresent(String.self, forKey: .startTag)
        startedAt = try container.decodeIfPresent(Date.self, forKey: .startedAt) ?? Date()
        endedAt = try container.decodeIfPresent(Date.self, forKey: .endedAt)
        pauseStartedAt = try container.decodeIfPresent(Date.self, forKey: .pauseStartedAt)
        pauseEndedAt = try container.decodeIfPresent(Date.self, forKey: .pauseEndedAt)
        forceStarted = try container.decodeIfPresent(Bool.self, forKey: .forceStarted) ?? false
        entryMode = try container.decodeIfPresent(BlankEntryMode.self, forKey: .entryMode)
        endedReason = try container.decodeIfPresent(BlankEndedReason.self, forKey: .endedReason)
        selectionSnapshot = try container.decodeIfPresent(BlankSelectionSnapshot.self, forKey: .selectionSnapshot)
        modeName = try container.decodeIfPresent(String.self, forKey: .modeName)
        localStartHour = try container.decodeIfPresent(Int.self, forKey: .localStartHour) ?? Calendar.current.component(.hour, from: startedAt)
        startWeekday = try container.decodeIfPresent(Int.self, forKey: .startWeekday) ?? Calendar.current.component(.weekday, from: startedAt)
        plannedDurationMinutes = try container.decodeIfPresent(Int.self, forKey: .plannedDurationMinutes)
    }
}

struct BlankWeeklyReport: Equatable {
    var dailyDurations: [TimeInterval]
    var dailySessionCounts: [Int]
    var totalFocusTime: TimeInterval
    var completedSessionCount: Int
    var estimatedTimeSaved: TimeInterval
    var averageSessionDuration: TimeInterval {
        completedSessionCount > 0 ? totalFocusTime / Double(completedSessionCount) : 0
    }
}

enum BlankWeeklySessionAggregator {
    static func startOfWeek(for date: Date, calendar: Calendar = .current) -> Date {
        calendar.dateInterval(of: .weekOfYear, for: date)?.start ?? date
    }

    static func aggregate(
        sessions: [BlankSession],
        weekStart: Date,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> BlankWeeklyReport {
        let weekEnd = calendar.date(byAdding: .day, value: 7, to: weekStart) ?? weekStart
        let trackedSessions = sessions.compactMap { session -> (start: Date, end: Date, completed: Bool)? in
            let sessionEnd = session.endedAt ?? now
            guard session.startedAt < weekEnd,
                  sessionEnd > weekStart,
                  sessionEnd > session.startedAt else {
                return nil
            }
            return (session.startedAt, sessionEnd, session.endedAt != nil)
        }

        var dailyDurations = Array(repeating: TimeInterval.zero, count: 7)
        var dailySessionCounts = Array(repeating: 0, count: 7)

        for dayOffset in 0..<7 {
            guard let dayStart = calendar.date(byAdding: .day, value: dayOffset, to: weekStart),
                  let dayEnd = calendar.date(byAdding: .day, value: 1, to: dayStart) else {
                continue
            }

            dailyDurations[dayOffset] = BlankBrainMetrics.protectedSeconds(sessions: sessions, from: dayStart, to: min(dayEnd, now))
            dailySessionCounts[dayOffset] = BlankBrainMetrics.sessionCount(sessions: sessions, from: dayStart, to: min(dayEnd, now))
        }

        let totalFocusTime = dailyDurations.reduce(0, +)
        let completedSessionCount = trackedSessions.filter { $0.completed }.count
        let trackedSessionCount = max(completedSessionCount, trackedSessions.count)
        let sessionBaseSavedTime = TimeInterval(trackedSessionCount * 7 * 60)
        let protectedTimeSavedShare = totalFocusTime * 0.10
        let estimatedTimeSaved = min(
            totalFocusTime,
            sessionBaseSavedTime + protectedTimeSavedShare
        )

        return BlankWeeklyReport(
            dailyDurations: dailyDurations,
            dailySessionCounts: dailySessionCounts,
            totalFocusTime: totalFocusTime,
            completedSessionCount: trackedSessionCount,
            estimatedTimeSaved: estimatedTimeSaved
        )
    }
}

struct BlankActivityDay: Identifiable, Equatable {
    var id: Date { date }
    var date: Date
    var totalFocusTime: TimeInterval
    var sessionCount: Int
}

struct BlankProtectionActivity: Identifiable, Equatable {
    var id: UUID { protectionId }
    var protectionId: UUID
    var name: String
    var totalFocusTime: TimeInterval
    var sessionCount: Int
}

struct BlankProgressReport: Equatable {
    var weeklyReport: BlankWeeklyReport
    var recentActivity: [BlankActivityDay]
    var protectionActivity: [BlankProtectionActivity]
    var currentStreakDays: Int
    var longestStreakDays: Int
}


struct RelapseIntervention: Equatable {
    var headline: String
    var cost: String
    var alternative: String
}

enum RelapseReviewReason: String, CaseIterable, Identifiable, Codable {
    case bored
    case anxious
    case tired
    case neededApp
    case procrastinating
    case other

    var id: String { rawValue }

    var title: String {
        switch self {
        case .bored: return "Bored"
        case .anxious: return "Anxious"
        case .tired: return "Tired"
        case .neededApp: return "Needed app"
        case .procrastinating: return "Procrastinating"
        case .other: return "Other"
        }
    }

    var planAdjustment: String {
        switch self {
        case .neededApp:
            return "Keep the block shorter and review whether that app belongs in this mode."
        case .tired:
            return "Move protection earlier and use sleep difficulty tonight."
        case .bored:
            return "Start the block before idle time begins."
        case .anxious:
            return "Use a shorter recovery block with extra friction."
        case .procrastinating:
            return "Protect the transition before work starts."
        case .other:
            return "Repeat this window once more before changing the plan."
        }
    }
}


enum BlankProgressAggregator {
    static func aggregate(
        sessions: [BlankSession],
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> BlankProgressReport {
        let weekStart = BlankWeeklySessionAggregator.startOfWeek(for: now, calendar: calendar)
        let weeklyReport = BlankWeeklySessionAggregator.aggregate(
            sessions: sessions,
            weekStart: weekStart,
            now: now,
            calendar: calendar
        )

        return BlankProgressReport(
            weeklyReport: weeklyReport,
            recentActivity: activityDays(sessions: sessions, days: 28, endingOn: now, calendar: calendar),
            protectionActivity: protectionActivity(sessions: sessions, weekStart: weekStart, now: now, calendar: calendar),
            currentStreakDays: currentStreakDays(sessions: sessions, now: now, calendar: calendar),
            longestStreakDays: longestStreakDays(sessions: sessions, days: 365, endingOn: now, calendar: calendar)
        )
    }

    static func activityDays(
        sessions: [BlankSession],
        days: Int,
        endingOn endDate: Date,
        calendar: Calendar = .current
    ) -> [BlankActivityDay] {
        let endDay = calendar.startOfDay(for: endDate)
        guard let startDay = calendar.date(byAdding: .day, value: -(days - 1), to: endDay) else {
            return []
        }

        return (0..<days).compactMap { offset in
            guard let dayStart = calendar.date(byAdding: .day, value: offset, to: startDay),
                  let dayEnd = calendar.date(byAdding: .day, value: 1, to: dayStart) else {
                return nil
            }

            let overlapping = sessions.compactMap { session -> TimeInterval? in
                let sessionEnd = session.endedAt ?? endDate
                let overlapStart = max(session.startedAt, dayStart)
                let overlapEnd = min(sessionEnd, dayEnd)
                guard overlapStart < overlapEnd else { return nil }
                return overlapEnd.timeIntervalSince(overlapStart)
            }

            return BlankActivityDay(
                date: dayStart,
                totalFocusTime: overlapping.reduce(0, +),
                sessionCount: overlapping.count
            )
        }
    }

    private static func protectionActivity(
        sessions: [BlankSession],
        weekStart: Date,
        now: Date,
        calendar: Calendar
    ) -> [BlankProtectionActivity] {
        guard let weekEnd = calendar.date(byAdding: .day, value: 7, to: weekStart) else {
            return []
        }

        var totalDuration: TimeInterval = 0
        var sessionCount = 0

        for session in sessions {
            let sessionEnd = session.endedAt ?? now
            guard session.startedAt < weekEnd,
                  sessionEnd > weekStart,
                  sessionEnd > session.startedAt else {
                continue
            }

            let overlapStart = max(session.startedAt, weekStart)
            let overlapEnd = min(sessionEnd, weekEnd)
            guard overlapStart < overlapEnd else { continue }

            totalDuration += overlapEnd.timeIntervalSince(overlapStart)
            sessionCount += 1
        }

        guard sessionCount > 0 else { return [] }
        return [BlankProtectionActivity(
            protectionId: BlankSharedState.canonicalProtectionId,
            name: BlankSharedState.canonicalProtectionName,
            totalFocusTime: totalDuration,
            sessionCount: sessionCount
        )]
    }

    private static func currentStreakDays(
        sessions: [BlankSession],
        now: Date,
        calendar: Calendar
    ) -> Int {
        let activeDays = completedSessionDays(sessions: sessions, calendar: calendar)
        var expectedDay = calendar.startOfDay(for: now)
        var streak = 0

        while activeDays.contains(expectedDay) {
            streak += 1
            guard let previousDay = calendar.date(byAdding: .day, value: -1, to: expectedDay) else {
                break
            }
            expectedDay = previousDay
        }

        return streak
    }

    private static func longestStreakDays(
        sessions: [BlankSession],
        days: Int,
        endingOn endDate: Date,
        calendar: Calendar
    ) -> Int {
        let activeDays = completedSessionDays(sessions: sessions, calendar: calendar)
        let endDay = calendar.startOfDay(for: endDate)
        guard let startDay = calendar.date(byAdding: .day, value: -(days - 1), to: endDay) else {
            return 0
        }

        var currentDay = startDay
        var currentStreak = 0
        var longestStreak = 0

        while currentDay <= endDay {
            if activeDays.contains(currentDay) {
                currentStreak += 1
                longestStreak = max(longestStreak, currentStreak)
            } else {
                currentStreak = 0
            }

            guard let nextDay = calendar.date(byAdding: .day, value: 1, to: currentDay) else {
                break
            }
            currentDay = nextDay
        }

        return longestStreak
    }

    private static func completedSessionDays(
        sessions: [BlankSession],
        calendar: Calendar
    ) -> Set<Date> {
        Set(
            sessions.compactMap { session in
                guard let endedAt = session.endedAt else { return nil }
                return calendar.startOfDay(for: endedAt)
            }
        )
    }
}
