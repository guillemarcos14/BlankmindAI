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
    case widget
    case nfc
    case schedule
}

enum BlankUsageEventKind: String, Codable {
    case blockStarted
    case blockEnded
    case blockBroken
}

enum BlankEndedReason: String, Codable {
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

    init(
        id: UUID = UUID(),
        name: String = "Habit",
        enabled: Bool = true,
        startMinute: Int = 23 * 60 + 30,
        endMinute: Int = 8 * 60,
        weekdays: [Int] = Array(1...7),
        expiresAt: Date? = nil
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
    }

    func contains(_ date: Date, calendar: Calendar = .current) -> Bool {
        guard enabled, expiresAt.map({ $0 > date }) ?? true else { return false }
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

            for session in trackedSessions {
                let overlapStart = max(session.start, dayStart)
                let overlapEnd = min(session.end, dayEnd)

                guard overlapStart < overlapEnd else { continue }

                dailyDurations[dayOffset] += overlapEnd.timeIntervalSince(overlapStart)
                dailySessionCounts[dayOffset] += 1
            }
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

struct DigitalWellnessPlanItem: Codable, Equatable, Identifiable {
    var id: Int
    var title: String
    var action: String
}

struct DigitalWellnessDiagnosis: Codable, Equatable {
    var archetype: String
    var riskTitle: String
    var riskBody: String
    var primaryGoal: String
    var weakMoment: String
    var dailyHours: Double
    var initialBlockMinutes: Int
    var recommendedHour: Int
    var plan: [DigitalWellnessPlanItem]
    var createdAt: Date
}

struct DigitalWellnessFeaturePayload: Codable, Equatable {
    var schema_version: Int
    var generated_at: Date
    var period_start: Date
    var period_end: Date
    var common_features: [String: String]
    var provider_features: [String: [String: String]]
    var source_confidence: [String: String]
    var freshness: [String: String]
    var profile: DigitalWellnessProfileFeatures
    var daily: [DigitalWellnessDailyFeatures]
    var weekly: DigitalWellnessWeeklyFeatures
    var correlations: DigitalWellnessCorrelationFeatures
    var privacy: DigitalWellnessPrivacyFeatures
}

struct DigitalWellnessProfileFeatures: Codable, Equatable {
    var age_range: String?
    var goal: String?
    var profile: String?
    var declared_daily_usage_hours: Double?
    var weak_moment: String?
    var motivation_cluster: String
    var latest_mood_score: Int?
    var latest_energy_score: Int?
    var latest_stress_score: Int?
}

struct DigitalWellnessDailyFeatures: Codable, Identifiable, Equatable {
    var id: Date { date }
    var date: Date
    var day_of_week: Int
    var sleep_total_minutes: Int?
    var deep_sleep_minutes: Int?
    var rem_sleep_minutes: Int?
    var core_sleep_minutes: Int?
    var awake_minutes: Int?
    var sleep_efficiency: Double?
    var bedtime_local: String?
    var wake_time_local: String?
    var sleep_debt_minutes: Int?
    var bedtime_variability_minutes: Int?
    var wake_time_variability_minutes: Int?
    var resting_hr: Int?
    var avg_daily_hr: Int?
    var resting_hr_delta: Int?
    var hrv_avg: Int?
    var hrv_vs_baseline_percent: Int?
    var respiratory_rate: Int?
    var oxygen_saturation: Int?
    var vo2_max: Int?
    var recovery_score: Int?
    var steps_total: Int?
    var distance_meters: Int?
    var active_energy_kcal: Int?
    var basal_energy_kcal: Int?
    var flights_climbed: Int?
    var exercise_minutes: Int?
    var workout_total_minutes: Int?
    var workout_intensity_score: Int?
    var training_load_proxy: String?
    var mindful_minutes: Int?
    var blocks_started: Int
    var blocks_completed: Int
    var relapses_count: Int
    var pickup_pressure_score: Int
    var blocked_minutes: Int
    var avg_block_duration_minutes: Int?
    var plan_adherence_percent: Int
    var weakest_hour: Int?
    var risk_windows: [String]
    var first_phone_risk_after_wake: String?
    var night_scroll_risk: String
    var sedentary_day_flag: Bool?
    var high_activity_day_flag: Bool?
    var low_recovery_flag: Bool?
    var late_bedtime_flag: Bool?
    var short_sleep_flag: Bool?
}

struct DigitalWellnessWeeklyFeatures: Codable, Equatable {
    var days_count: Int
    var active_days_7d: Int
    var selection_count: Int
    var category_mix: String
    var distraction_cluster: String
    var avg_sleep_minutes: Int?
    var avg_deep_sleep_minutes: Int?
    var avg_rem_sleep_minutes: Int?
    var avg_awake_minutes: Int?
    var sleep_consistency_score: Int?
    var bedtime_variability_minutes: Int?
    var wake_time_variability_minutes: Int?
    var avg_resting_hr: Int?
    var avg_hrv: Int?
    var avg_respiratory_rate: Int?
    var avg_oxygen_saturation: Int?
    var avg_vo2_max: Int?
    var avg_recovery_score: Int?
    var health_days_count: Int
    var health_signal_coverage_percent: Int
    var latest_health_signal_age_hours: Int?
    var recovery_trend_14d: String
    var avg_steps: Int?
    var avg_distance_meters: Int?
    var avg_active_energy_kcal: Int?
    var avg_basal_energy_kcal: Int?
    var avg_flights_climbed: Int?
    var avg_exercise_minutes: Int?
    var blocks_started: Int
    var blocks_completed: Int
    var relapses_count: Int
    var relapse_rate: Double
    var unlock_pressure_score: Int
    var pickup_pressure_score: Int
    var dominant_app_sequence: String
    var app_sequence_risk: String
    var blocked_minutes: Int
    var plan_adherence_percent: Int
    var weakest_hour: Int?
    var best_focus_window: String?
    var worst_focus_window: String?
    var habit_volatility_score: Int
    var recommended_plan_difficulty: String
}

struct DigitalWellnessCorrelationFeatures: Codable, Equatable {
    var relapses_after_short_sleep: Int
    var relapses_after_low_hrv: Int
    var night_scroll_after_late_bedtime: Bool
    var morning_scroll_after_poor_sleep: Bool
    var focus_success_after_workout: Bool
    var screen_risk_after_workout: String
    var screen_risk_after_bad_sleep: String
    var rapid_pickups_before_relapse: Bool
    var sequence_risk_after_harmless_check: Bool
}

struct DigitalWellnessPrivacyFeatures: Codable, Equatable {
    var raw_health_samples_sent: Bool
    var raw_sleep_stage_timestamps_sent: Bool
    var exact_app_selection_sent: Bool
    var exact_location_sent: Bool
    var health_processing_location: String
    var backend_payload_type: String
}

struct DigitalWellnessPlanUpdate: Codable, Equatable {
    var title: String
    var evidence: String
    var proposed_start_minute: Int
    var proposed_end_minute: Int
    var duration_days: Int
    var action_label: String
}

struct DigitalWellnessBehaviorForecast: Codable, Equatable {
    var window: String
    var risk_score: Int
    var confidence: Int
    var reasons: [String]
    var action_label: String
}

struct DigitalWellnessExperiment: Codable, Equatable {
    var name: String
    var hypothesis: String
    var variant: String
    var success_metric: String
}

struct DigitalWellnessRemoteInsight: Codable, Equatable {
    var schema_version: Int
    var generated_at: Date
    var confidence: Int
    var motivation_cluster: String
    var summary: String
    var patterns: [String]
    var recommendations: [String]
    var next_step: String
    var risk_window: String?
    var source: String?
    var plan_update: DigitalWellnessPlanUpdate?
    var behavior_forecast: DigitalWellnessBehaviorForecast?
    var experiment: DigitalWellnessExperiment?
    var recommendation_id: String?
}

private struct DigitalWellnessFeatureEnvelope: Encodable {
    var anonymous_user_id: String
    var payload: DigitalWellnessFeaturePayload
    var locale: String
    var app_version: String
    var build_number: String
    var data_consent: Bool
    var consent_text: String
}

private struct DigitalWellnessFeatureSubmitResponse: Decodable {
    var ok: Bool
    var insight: DigitalWellnessRemoteInsight
}

struct DigitalWellnessFeaturesClient {
    private let baseURL: URL?
    private let session: URLSession

    init(baseURL: URL? = Self.configuredBaseURL(), session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    func submit(payload: DigitalWellnessFeaturePayload, anonymousUserId: String, consentText: String) async throws -> DigitalWellnessRemoteInsight {
        #if DEBUG
        if baseURL == nil {
            return DigitalWellnessRemoteInsight(
                schema_version: 1,
                generated_at: Date(),
                confidence: 20,
                motivation_cluster: payload.profile.motivation_cluster,
                summary: "Debug build has no backend URL configured.",
                patterns: ["Local feature payload generated without raw Health samples."],
                recommendations: ["Configure the backend URL to sync wellness features."],
                next_step: "Run a release-configured build.",
                risk_window: payload.weekly.worst_focus_window,
                plan_update: DigitalWellnessPlanUpdate(
                    title: "Protect your next risk window.",
                    evidence: "Debug build generated a local plan proposal.",
                    proposed_start_minute: 21 * 60 + 30,
                    proposed_end_minute: 7 * 60,
                    duration_days: 5,
                    action_label: "Apply preventive block"
                ),
                behavior_forecast: DigitalWellnessBehaviorForecast(
                    window: payload.weekly.worst_focus_window ?? "Learning",
                    risk_score: 40,
                    confidence: 20,
                    reasons: ["Blankmind is learning your baseline timing."],
                    action_label: "Test a light preventive block"
                ),
                experiment: DigitalWellnessExperiment(
                    name: "Stable Repeat",
                    hypothesis: "Repeat the same window to build a clean baseline.",
                    variant: "same_window_same_apps",
                    success_metric: "Completed sessions without emergency exits."
                ),
                recommendation_id: nil
            )
        }
        #endif

        guard let baseURL else {
            throw URLError(.badURL)
        }

        let envelope = DigitalWellnessFeatureEnvelope(
            anonymous_user_id: anonymousUserId,
            payload: payload,
            locale: Locale.current.identifier,
            app_version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
            build_number: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "",
            data_consent: true,
            consent_text: consentText
        )

        let url = baseURL.appendingPathComponent("digital-wellness-features")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        request.httpBody = try encoder.encode(envelope)

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .blankFlexibleISO8601
        return try decoder.decode(DigitalWellnessFeatureSubmitResponse.self, from: data).insight
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
}

private extension JSONDecoder.DateDecodingStrategy {
    static let blankFlexibleISO8601 = custom { decoder in
        let container = try decoder.singleValueContainer()
        let value = try container.decode(String.self)

        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractionalFormatter.date(from: value) {
            return date
        }

        if let date = ISO8601DateFormatter().date(from: value) {
            return date
        }

        throw DecodingError.dataCorruptedError(
            in: container,
            debugDescription: "Invalid ISO8601 date: \(value)"
        )
    }
}

enum DigitalWellnessFeatureBuilder {
    static func makePayload(
        defaults: UserDefaults = BlankSharedState.defaults,
        healthSummaries: [HealthDaySummary],
        sessions: [BlankSession],
        events: [BlankUsageEvent],
        selectionCount: Int,
        selectionSnapshot: BlankSelectionSnapshot = BlankSelectionSnapshot(),
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> DigitalWellnessFeaturePayload {
        let periodEnd = calendar.startOfDay(for: now)
        let periodStart = calendar.date(byAdding: .day, value: -13, to: periodEnd) ?? periodEnd
        let healthByDay = Dictionary(uniqueKeysWithValues: healthSummaries.map { (calendar.startOfDay(for: $0.date), $0) })
        let days = (0..<14).compactMap { calendar.date(byAdding: .day, value: $0, to: periodStart) }
        let baselines = HealthBaselines(summaries: healthSummaries)
        let daily = days.map { day in
            makeDailyFeatures(
                day: day,
                health: healthByDay[calendar.startOfDay(for: day)],
                baselines: baselines,
                sessions: sessionsForDay(day, sessions: sessions, now: now, calendar: calendar),
                events: eventsForDay(day, events: events, calendar: calendar),
                calendar: calendar
            )
        }
        let weekly = makeWeeklyFeatures(daily: daily, selectionCount: selectionCount, selectionSnapshot: selectionSnapshot)

        return DigitalWellnessFeaturePayload(
            schema_version: 2,
            generated_at: now,
            period_start: periodStart,
            period_end: periodEnd,
            common_features: commonFeatures(daily: daily, weekly: weekly),
            provider_features: providerFeatures(daily: daily),
            source_confidence: sourceConfidence(daily: daily),
            freshness: freshnessFeatures(daily: daily, now: now),
            profile: makeProfile(defaults: defaults),
            daily: daily,
            weekly: weekly,
            correlations: makeCorrelations(daily: daily),
            privacy: DigitalWellnessPrivacyFeatures(
                raw_health_samples_sent: false,
                raw_sleep_stage_timestamps_sent: false,
                exact_app_selection_sent: false,
                exact_location_sent: false,
                health_processing_location: "on_device",
                backend_payload_type: "daily_and_weekly_features"
            )
        )
    }

    private static func commonFeatures(daily: [DigitalWellnessDailyFeatures], weekly: DigitalWellnessWeeklyFeatures) -> [String: String] {
        var features: [String: String] = [
            "sleep": weekly.avg_sleep_minutes.map { "\($0)" } ?? "learning",
            "sleep_timing": weekly.bedtime_variability_minutes.map { "\($0)" } ?? "learning",
            "recovery": weekly.avg_recovery_score.map { "\($0)" } ?? "learning",
            "activity": weekly.avg_steps.map { "\($0)" } ?? "learning",
            "strain_load": weekly.avg_exercise_minutes.map { "\($0)" } ?? "learning",
            "stress_proxy": weekly.avg_hrv.map { "\($0)" } ?? "learning",
            "pickup_pressure": "\(weekly.pickup_pressure_score)",
            "behavior_chain": weekly.dominant_app_sequence,
            "sequence_risk": weekly.app_sequence_risk,
            "freshness": weekly.latest_health_signal_age_hours.map { "\($0)" } ?? "unknown",
            "coverage": "\(weekly.health_signal_coverage_percent)",
            "confidence": "\(wearableConfidence(weekly: weekly))"
        ]
        if daily.contains(where: { $0.low_recovery_flag == true }) {
            features["low_recovery_mode"] = "candidate"
        }
        return features
    }

    private static func providerFeatures(daily: [DigitalWellnessDailyFeatures]) -> [String: [String: String]] {
        let recent = Array(daily.suffix(7))
        var appleHealth: [String: String] = [:]
        average(recent.compactMap(\.deep_sleep_minutes)).map { appleHealth["deep_sleep_minutes"] = "\($0)" }
        average(recent.compactMap(\.rem_sleep_minutes)).map { appleHealth["rem_sleep_minutes"] = "\($0)" }
        average(recent.compactMap(\.core_sleep_minutes)).map { appleHealth["core_sleep_minutes"] = "\($0)" }
        average(recent.compactMap(\.awake_minutes)).map { appleHealth["awake_minutes"] = "\($0)" }
        average(recent.compactMap(\.respiratory_rate)).map { appleHealth["respiratory_rate"] = "\($0)" }
        average(recent.compactMap(\.oxygen_saturation)).map { appleHealth["oxygen_saturation"] = "\($0)" }
        average(recent.compactMap(\.vo2_max)).map { appleHealth["vo2_max"] = "\($0)" }
        average(recent.compactMap(\.flights_climbed)).map { appleHealth["flights_climbed"] = "\($0)" }
        return appleHealth.isEmpty ? [:] : ["apple_health": appleHealth]
    }

    private static func sourceConfidence(daily: [DigitalWellnessDailyFeatures]) -> [String: String] {
        let recent = Array(daily.suffix(7))
        let coverage = min(100, recent.reduce(0) { total, day in
            total + min(12, signalDepth(day: day)) * 100 / 12
        } / max(1, recent.count))
        let confidence = wearableConfidence(coverage: coverage, daysWithHealth: recent.filter(hasHealthSignal).count)
        return [
            "apple_health": "\(confidence)",
            "sleep": metricConfidence(recent.compactMap(\.sleep_total_minutes).count),
            "recovery": metricConfidence(recent.compactMap(\.recovery_score).count),
            "activity": metricConfidence(recent.compactMap(\.steps_total).count),
            "vitals": metricConfidence(recent.compactMap(\.hrv_avg).count + recent.compactMap(\.resting_hr).count)
        ]
    }

    private static func freshnessFeatures(daily: [DigitalWellnessDailyFeatures], now: Date) -> [String: String] {
        let latest = daily.filter(hasHealthSignal).map(\.date).max()
        let age = latest.map { Int(now.timeIntervalSince($0) / 3600) }
        return [
            "apple_health_latest_signal_age_hours": age.map { "\($0)" } ?? "unknown",
            "status": age.map { $0 > 72 ? "stale" : "fresh" } ?? "no_data"
        ]
    }

    private static func wearableConfidence(weekly: DigitalWellnessWeeklyFeatures) -> Int {
        wearableConfidence(coverage: weekly.health_signal_coverage_percent, daysWithHealth: weekly.health_days_count)
    }

    private static func wearableConfidence(coverage: Int, daysWithHealth: Int) -> Int {
        min(100, max(0, coverage / 2 + min(7, daysWithHealth) * 7))
    }

    private static func metricConfidence(_ days: Int) -> String {
        "\(min(100, max(0, days * 14)))"
    }

    private static func hasHealthSignal(_ day: DigitalWellnessDailyFeatures) -> Bool {
        signalDepth(day: day) > 0
    }

    private static func signalDepth(day: DigitalWellnessDailyFeatures) -> Int {
        [
            day.sleep_total_minutes,
            day.steps_total,
            day.exercise_minutes,
            day.resting_hr,
            day.hrv_avg,
            day.respiratory_rate,
            day.oxygen_saturation,
            day.vo2_max,
            day.flights_climbed
        ].compactMap { $0 }.count
    }

    private struct HealthBaselines {
        var sleep: Int?
        var bedtime: Int?
        var wake: Int?
        var restingHR: Int?
        var hrv: Int?
        var steps: Int?

        init(summaries: [HealthDaySummary]) {
            sleep = DigitalWellnessFeatureBuilder.average(summaries.compactMap { $0.sleepMinutes })
            bedtime = DigitalWellnessFeatureBuilder.circularAverage(summaries.compactMap { $0.bedtimeMinute })
            wake = DigitalWellnessFeatureBuilder.circularAverage(summaries.compactMap { $0.wakeMinute })
            restingHR = DigitalWellnessFeatureBuilder.average(summaries.compactMap { $0.restingHeartRate })
            hrv = DigitalWellnessFeatureBuilder.average(summaries.compactMap { $0.hrvSDNN })
            steps = DigitalWellnessFeatureBuilder.average(summaries.compactMap { $0.steps })
        }
    }

    private static func makeProfile(defaults: UserDefaults) -> DigitalWellnessProfileFeatures {
        let goal = clean(defaults.string(forKey: "blankOnboardingGoal"))
        let profile = clean(defaults.string(forKey: "blankOnboardingProfile"))
        let weakMoment = clean(defaults.string(forKey: "blankOnboardingWeakMoment"))
        let dailyUsage = defaults.object(forKey: "blankOnboardingDailyHours") == nil
            ? nil
            : defaults.double(forKey: "blankOnboardingDailyHours")

        return DigitalWellnessProfileFeatures(
            age_range: clean(defaults.string(forKey: "blankOnboardingAgeRange")),
            goal: goal,
            profile: profile,
            declared_daily_usage_hours: dailyUsage,
            weak_moment: weakMoment,
            motivation_cluster: motivationCluster(goal: goal, profile: profile, weakMoment: weakMoment),
            latest_mood_score: defaults.object(forKey: "blankWellnessLastMood") == nil ? nil : defaults.integer(forKey: "blankWellnessLastMood"),
            latest_energy_score: defaults.object(forKey: "blankWellnessLastEnergy") == nil ? nil : defaults.integer(forKey: "blankWellnessLastEnergy"),
            latest_stress_score: defaults.object(forKey: "blankWellnessLastStress") == nil ? nil : defaults.integer(forKey: "blankWellnessLastStress")
        )
    }

    private static func makeDailyFeatures(
        day: Date,
        health: HealthDaySummary?,
        baselines: HealthBaselines,
        sessions: [BlankSession],
        events: [BlankUsageEvent],
        calendar: Calendar
    ) -> DigitalWellnessDailyFeatures {
        let completed = sessions.filter { $0.endedAt != nil }
        let blockedMinutes = Int(sessions.reduce(TimeInterval.zero) { $0 + $1.duration } / 60)
        let relapseEvents = events.filter { $0.kind == .blockBroken || $0.endedReason == .emergency || $0.endedReason == .manual }
        let started = events.filter { $0.kind == .blockStarted }.count
        let pickupPressure = pickupPressureScore(events: events, sessions: sessions)
        let weakHour = mostCommon(relapseEvents.map(\.localHour) + sessions.compactMap(\.localStartHour))
        let hrvDelta = percentDelta(value: health?.hrvSDNN, baseline: baselines.hrv)
        let restingDelta = delta(value: health?.restingHeartRate, baseline: baselines.restingHR)
        let recovery = recoveryScore(
            sleepMinutes: health?.sleepMinutes,
            hrvDelta: hrvDelta,
            restingHRDelta: restingDelta,
            steps: health?.steps,
            stepsBaseline: baselines.steps,
            respiratoryRate: health?.respiratoryRate,
            oxygenSaturation: health?.oxygenSaturation
        )
        let shortSleep = health?.sleepMinutes.map { $0 < 6 * 60 }
        let lowRecovery = recovery.map { $0 < 45 }

        return DigitalWellnessDailyFeatures(
            date: day,
            day_of_week: calendar.component(.weekday, from: day),
            sleep_total_minutes: health?.sleepMinutes,
            deep_sleep_minutes: health?.deepSleepMinutes,
            rem_sleep_minutes: health?.remSleepMinutes,
            core_sleep_minutes: health?.coreSleepMinutes,
            awake_minutes: health?.awakeMinutes,
            sleep_efficiency: sleepEfficiency(sleep: health?.sleepMinutes, inBed: health?.inBedMinutes, awake: health?.awakeMinutes),
            bedtime_local: health?.bedtimeMinute.map(timeText),
            wake_time_local: health?.wakeMinute.map(timeText),
            sleep_debt_minutes: sleepDebt(sleep: health?.sleepMinutes, baseline: baselines.sleep),
            bedtime_variability_minutes: minuteDistance(health?.bedtimeMinute, baselines.bedtime),
            wake_time_variability_minutes: minuteDistance(health?.wakeMinute, baselines.wake),
            resting_hr: health?.restingHeartRate,
            avg_daily_hr: health?.averageHeartRate,
            resting_hr_delta: restingDelta,
            hrv_avg: health?.hrvSDNN,
            hrv_vs_baseline_percent: hrvDelta,
            respiratory_rate: health?.respiratoryRate,
            oxygen_saturation: health?.oxygenSaturation,
            vo2_max: health?.vo2Max,
            recovery_score: recovery,
            steps_total: health?.steps,
            distance_meters: health?.distanceMeters,
            active_energy_kcal: health?.activeEnergyKcal,
            basal_energy_kcal: health?.basalEnergyKcal,
            flights_climbed: health?.flightsClimbed,
            exercise_minutes: health?.workoutMinutes,
            workout_total_minutes: health?.workoutMinutes,
            workout_intensity_score: workoutIntensityScore(workoutMinutes: health?.workoutMinutes, activeEnergy: health?.activeEnergyKcal, averageHeartRate: health?.averageHeartRate),
            training_load_proxy: trainingLoadProxy(workoutIntensityScore(workoutMinutes: health?.workoutMinutes, activeEnergy: health?.activeEnergyKcal, averageHeartRate: health?.averageHeartRate)),
            mindful_minutes: health?.mindfulMinutes,
            blocks_started: started,
            blocks_completed: completed.count,
            relapses_count: relapseEvents.count,
            pickup_pressure_score: pickupPressure,
            blocked_minutes: blockedMinutes,
            avg_block_duration_minutes: completed.isEmpty ? nil : blockedMinutes / max(1, completed.count),
            plan_adherence_percent: started == 0 ? 0 : Int(Double(completed.count) / Double(started) * 100),
            weakest_hour: weakHour,
            risk_windows: riskWindowsFrom(hours: relapseEvents.map(\.localHour) + sessions.compactMap(\.localStartHour)),
            first_phone_risk_after_wake: firstPhoneRiskAfterWake(wakeMinute: health?.wakeMinute, events: relapseEvents),
            night_scroll_risk: nightRisk(events: relapseEvents, sessions: sessions, shortSleep: shortSleep ?? false, lowRecovery: lowRecovery ?? false),
            sedentary_day_flag: health?.steps.map { $0 < 3500 },
            high_activity_day_flag: health?.steps.map { $0 >= 9000 },
            low_recovery_flag: lowRecovery,
            late_bedtime_flag: health?.bedtimeMinute.map { $0 >= 23 * 60 || $0 < 2 * 60 },
            short_sleep_flag: shortSleep
        )
    }

    private static func makeWeeklyFeatures(
        daily: [DigitalWellnessDailyFeatures],
        selectionCount: Int,
        selectionSnapshot: BlankSelectionSnapshot
    ) -> DigitalWellnessWeeklyFeatures {
        let recent = Array(daily.suffix(7))
        let started = recent.reduce(0) { $0 + $1.blocks_started }
        let completed = recent.reduce(0) { $0 + $1.blocks_completed }
        let relapses = recent.reduce(0) { $0 + $1.relapses_count }
        let attempts = max(1, completed + relapses)
        let adherence = started == 0 ? 0 : Int(Double(completed) / Double(started) * 100)
        let bedtimeDrift = average(recent.compactMap(\.bedtime_variability_minutes))
        let weakHour = mostCommon(recent.compactMap(\.weakest_hour))
        let pickupPressure = min(100, recent.reduce(0) { $0 + $1.pickup_pressure_score } / max(1, recent.count) + relapses * 8)
        let behaviorChain = behaviorChain(started: started, completed: completed, relapses: relapses, selectionSnapshot: selectionSnapshot)
        let volatility = min(100, relapses * 16 + max(0, 100 - adherence) / 2 + (bedtimeDrift ?? 0) / 3)

        return DigitalWellnessWeeklyFeatures(
            days_count: recent.count,
            active_days_7d: recent.filter { $0.blocks_started > 0 || $0.blocked_minutes > 0 }.count,
            selection_count: selectionCount,
            category_mix: categoryMix(selectionSnapshot),
            distraction_cluster: distractionCluster(selectionSnapshot),
            avg_sleep_minutes: average(recent.compactMap(\.sleep_total_minutes)),
            avg_deep_sleep_minutes: average(recent.compactMap(\.deep_sleep_minutes)),
            avg_rem_sleep_minutes: average(recent.compactMap(\.rem_sleep_minutes)),
            avg_awake_minutes: average(recent.compactMap(\.awake_minutes)),
            sleep_consistency_score: bedtimeDrift.map { max(0, 100 - min(100, $0)) },
            bedtime_variability_minutes: bedtimeDrift,
            wake_time_variability_minutes: average(recent.compactMap(\.wake_time_variability_minutes)),
            avg_resting_hr: average(recent.compactMap(\.resting_hr)),
            avg_hrv: average(recent.compactMap(\.hrv_avg)),
            avg_respiratory_rate: average(recent.compactMap(\.respiratory_rate)),
            avg_oxygen_saturation: average(recent.compactMap(\.oxygen_saturation)),
            avg_vo2_max: average(recent.compactMap(\.vo2_max)),
            avg_recovery_score: average(recent.compactMap(\.recovery_score)),
            health_days_count: recent.filter { day in
                day.sleep_total_minutes != nil ||
                day.steps_total != nil ||
                day.resting_hr != nil ||
                day.hrv_avg != nil ||
                day.respiratory_rate != nil ||
                day.oxygen_saturation != nil ||
                day.vo2_max != nil
            }.count,
            health_signal_coverage_percent: min(100, recent.reduce(0) { total, day in
                total +
                (day.sleep_total_minutes == nil ? 0 : 12) +
                (day.steps_total == nil ? 0 : 10) +
                (day.exercise_minutes == nil ? 0 : 8) +
                (day.resting_hr == nil ? 0 : 10) +
                (day.hrv_avg == nil ? 0 : 14) +
                (day.respiratory_rate == nil ? 0 : 8) +
                (day.oxygen_saturation == nil ? 0 : 8) +
                (day.vo2_max == nil ? 0 : 6)
            } / max(1, recent.count)),
            latest_health_signal_age_hours: latestHealthSignalAgeHours(recent: recent),
            recovery_trend_14d: recoveryTrend(daily),
            avg_steps: average(recent.compactMap(\.steps_total)),
            avg_distance_meters: average(recent.compactMap(\.distance_meters)),
            avg_active_energy_kcal: average(recent.compactMap(\.active_energy_kcal)),
            avg_basal_energy_kcal: average(recent.compactMap(\.basal_energy_kcal)),
            avg_flights_climbed: average(recent.compactMap(\.flights_climbed)),
            avg_exercise_minutes: average(recent.compactMap(\.exercise_minutes)),
            blocks_started: started,
            blocks_completed: completed,
            relapses_count: relapses,
            relapse_rate: Double(relapses) / Double(attempts),
            unlock_pressure_score: min(100, relapses * 22 + max(0, 70 - adherence) / 2 + pickupPressure / 3),
            pickup_pressure_score: pickupPressure,
            dominant_app_sequence: behaviorChain,
            app_sequence_risk: sequenceRisk(pickupPressure: pickupPressure, relapses: relapses),
            blocked_minutes: recent.reduce(0) { $0 + $1.blocked_minutes },
            plan_adherence_percent: adherence,
            weakest_hour: weakHour,
            best_focus_window: bestFocusWindow(recent),
            worst_focus_window: weakHour.map(DigitalWellnessAI.hourRangeText),
            habit_volatility_score: volatility,
            recommended_plan_difficulty: recommendedDifficulty(adherence: adherence, relapses: relapses, selectionCount: selectionCount)
        )
    }

    private static func makeCorrelations(daily: [DigitalWellnessDailyFeatures]) -> DigitalWellnessCorrelationFeatures {
        let shortSleepDays = daily.filter { $0.short_sleep_flag == true }
        let lowHRVDays = daily.filter { ($0.hrv_vs_baseline_percent ?? 0) <= -15 }
        let lateBedtimeDays = daily.filter { $0.late_bedtime_flag == true }
        let workoutDays = daily.filter { ($0.workout_total_minutes ?? 0) >= 20 }
        let badSleepRelapses = shortSleepDays.reduce(0) { $0 + $1.relapses_count }
        let workoutRelapses = workoutDays.reduce(0) { $0 + $1.relapses_count }
        let workoutBlocks = workoutDays.reduce(0) { $0 + $1.blocks_completed }

        return DigitalWellnessCorrelationFeatures(
            relapses_after_short_sleep: badSleepRelapses,
            relapses_after_low_hrv: lowHRVDays.reduce(0) { $0 + $1.relapses_count },
            night_scroll_after_late_bedtime: lateBedtimeDays.contains { $0.night_scroll_risk == "high" },
            morning_scroll_after_poor_sleep: shortSleepDays.contains { $0.first_phone_risk_after_wake == "high" },
            focus_success_after_workout: workoutBlocks > workoutRelapses,
            screen_risk_after_workout: workoutRelapses > workoutBlocks ? "high" : "low",
            screen_risk_after_bad_sleep: badSleepRelapses > 0 ? "high" : "low",
            rapid_pickups_before_relapse: daily.contains { $0.pickup_pressure_score >= 65 && $0.relapses_count > 0 },
            sequence_risk_after_harmless_check: daily.contains { $0.pickup_pressure_score >= 50 && $0.relapses_count > 0 }
        )
    }

    private static func sessionsForDay(_ day: Date, sessions: [BlankSession], now: Date, calendar: Calendar) -> [BlankSession] {
        guard let dayEnd = calendar.date(byAdding: .day, value: 1, to: day) else { return [] }
        return sessions.filter { session in
            let end = session.endedAt ?? now
            return session.startedAt < dayEnd && end >= day
        }
    }

    private static func eventsForDay(_ day: Date, events: [BlankUsageEvent], calendar: Calendar) -> [BlankUsageEvent] {
        guard let dayEnd = calendar.date(byAdding: .day, value: 1, to: day) else { return [] }
        return events.filter { $0.occurredAt >= day && $0.occurredAt < dayEnd }
    }

    private static func sleepEfficiency(sleep: Int?, inBed: Int?, awake: Int?) -> Double? {
        guard let sleep else { return nil }
        let denominator = inBed ?? (awake.map { sleep + $0 } ?? sleep)
        guard denominator > 0 else { return nil }
        return Double(sleep) / Double(denominator)
    }

    private static func sleepDebt(sleep: Int?, baseline: Int?) -> Int? {
        guard let sleep else { return nil }
        return max(0, (baseline ?? 8 * 60) - sleep)
    }

    private static func recoveryScore(sleepMinutes: Int?, hrvDelta: Int?, restingHRDelta: Int?, steps: Int?, stepsBaseline: Int?, respiratoryRate: Int?, oxygenSaturation: Int?) -> Int? {
        var parts: [Int] = []
        if let sleepMinutes {
            parts.append(min(100, max(0, Int(Double(sleepMinutes) / Double(8 * 60) * 100))))
        }
        if let hrvDelta {
            parts.append(min(100, max(0, 70 + hrvDelta)))
        }
        if let restingHRDelta {
            parts.append(min(100, max(0, 70 - restingHRDelta * 4)))
        }
        if let steps, let stepsBaseline, stepsBaseline > 0 {
            parts.append(min(100, max(0, Int(Double(steps) / Double(stepsBaseline) * 70))))
        }
        if let respiratoryRate {
            parts.append(min(100, max(0, 100 - abs(respiratoryRate - 15) * 8)))
        }
        if let oxygenSaturation {
            parts.append(min(100, max(0, (oxygenSaturation - 90) * 10)))
        }
        return average(parts)
    }

    private static func workoutIntensityScore(workoutMinutes: Int?, activeEnergy: Int?, averageHeartRate: Int?) -> Int? {
        guard workoutMinutes != nil || activeEnergy != nil || averageHeartRate != nil else { return nil }
        let minuteScore = min(45, (workoutMinutes ?? 0) * 45 / 60)
        let energyScore = min(35, (activeEnergy ?? 0) * 35 / 700)
        let heartScore = min(20, max(0, ((averageHeartRate ?? 70) - 70) * 20 / 80))
        return min(100, minuteScore + energyScore + heartScore)
    }

    private static func firstPhoneRiskAfterWake(wakeMinute: Int?, events: [BlankUsageEvent]) -> String? {
        guard let wakeMinute else { return nil }
        let risky = events.contains { event in
            let eventMinute = event.localHour * 60
            let distance = (eventMinute - wakeMinute + 24 * 60) % (24 * 60)
            return distance <= 90
        }
        return risky ? "high" : "low"
    }

    private static func nightRisk(events: [BlankUsageEvent], sessions: [BlankSession], shortSleep: Bool, lowRecovery: Bool) -> String {
        let nightEvents = events.filter { $0.localHour >= 21 || $0.localHour <= 2 }
        let nightSessions = sessions.filter { ($0.localStartHour ?? 12) >= 21 || ($0.localStartHour ?? 12) <= 2 }
        let score = nightEvents.count * 25 + nightSessions.count * 8 + (shortSleep ? 18 : 0) + (lowRecovery ? 18 : 0)
        if score >= 45 { return "high" }
        if score >= 20 { return "medium" }
        return "low"
    }

    private static func pickupPressureScore(events: [BlankUsageEvent], sessions: [BlankSession]) -> Int {
        let relapseEvents = events.filter { $0.kind == .blockBroken || $0.endedReason == .emergency || $0.endedReason == .manual }
        let shortSessions = sessions.filter { ($0.duration / 60) < 20 && ($0.endedReason == .manual || $0.endedReason == .emergency) }
        let clusteredHours = Dictionary(grouping: relapseEvents.map(\.localHour), by: { $0 }).values.filter { $0.count >= 2 }.count
        return min(100, relapseEvents.count * 22 + shortSessions.count * 18 + clusteredHours * 12)
    }

    private static func behaviorChain(started: Int, completed: Int, relapses: Int, selectionSnapshot: BlankSelectionSnapshot) -> String {
        let selectionType: String
        if selectionSnapshot.categoryCount > selectionSnapshot.applicationCount {
            selectionType = "category"
        } else if selectionSnapshot.applicationCount > 0 {
            selectionType = "app"
        } else {
            selectionType = "selection"
        }

        if relapses >= 3 { return "quick check -> \(selectionType) urge -> exit" }
        if started > completed { return "planned block -> early exit" }
        if completed >= 3 && relapses == 0 { return "planned block -> clean session" }
        if selectionSnapshot.totalCount > 0 { return "\(selectionType) urge -> protected window" }
        return "learning"
    }

    private static func sequenceRisk(pickupPressure: Int, relapses: Int) -> String {
        if pickupPressure >= 70 || relapses >= 4 { return "high" }
        if pickupPressure >= 40 || relapses >= 2 { return "medium" }
        return "low"
    }

    private static func riskWindowsFrom(hours: [Int]) -> [String] {
        mostCommonValues(hours, limit: 3).map(DigitalWellnessAI.hourRangeText)
    }

    private static func bestFocusWindow(_ days: [DigitalWellnessDailyFeatures]) -> String? {
        let candidates = days.filter { $0.blocks_completed > 0 && $0.relapses_count == 0 }.compactMap(\.weakest_hour)
        return mostCommon(candidates).map(DigitalWellnessAI.hourRangeText)
    }

    private static func recoveryTrend(_ daily: [DigitalWellnessDailyFeatures]) -> String {
        let scores = daily.compactMap(\.recovery_score)
        guard scores.count >= 4 else { return "learning" }
        let midpoint = scores.count / 2
        let first = average(Array(scores.prefix(midpoint))) ?? 0
        let second = average(Array(scores.suffix(scores.count - midpoint))) ?? 0
        if second >= first + 8 { return "improving" }
        if second <= first - 8 { return "worsening" }
        return "stable"
    }

    private static func latestHealthSignalAgeHours(recent: [DigitalWellnessDailyFeatures], now: Date = Date(), calendar: Calendar = .current) -> Int? {
        guard let latestDay = recent.last(where: { day in
            day.sleep_total_minutes != nil ||
            day.steps_total != nil ||
            day.resting_hr != nil ||
            day.hrv_avg != nil ||
            day.respiratory_rate != nil ||
            day.oxygen_saturation != nil ||
            day.vo2_max != nil
        })?.date else {
            return nil
        }
        return max(0, Int(now.timeIntervalSince(calendar.startOfDay(for: latestDay)) / 3600))
    }

    private static func trainingLoadProxy(_ score: Int?) -> String? {
        guard let score else { return nil }
        if score >= 72 { return "high" }
        if score >= 38 { return "medium" }
        return "low"
    }

    private static func recommendedDifficulty(adherence: Int, relapses: Int, selectionCount: Int) -> String {
        if selectionCount == 0 { return "setup_required" }
        if relapses >= 3 || adherence < 45 { return "recovery" }
        if adherence >= 80 && relapses == 0 { return "progressive" }
        return "baseline"
    }

    private static func categoryMix(_ snapshot: BlankSelectionSnapshot) -> String {
        let total = max(1, snapshot.totalCount)
        let appShare = Double(snapshot.applicationCount) / Double(total)
        let categoryShare = Double(snapshot.categoryCount) / Double(total)
        let webShare = Double(snapshot.webDomainCount) / Double(total)
        if appShare >= 0.60 { return "mostly_apps" }
        if categoryShare >= 0.60 { return "mostly_categories" }
        if webShare >= 0.60 { return "mostly_web" }
        if snapshot.totalCount == 0 { return "none" }
        return "mixed"
    }

    private static func distractionCluster(_ snapshot: BlankSelectionSnapshot) -> String {
        if snapshot.totalCount == 0 { return "not_configured" }
        if snapshot.webDomainCount > snapshot.applicationCount && snapshot.webDomainCount >= snapshot.categoryCount {
            return "web_loop"
        }
        if snapshot.categoryCount >= snapshot.applicationCount && snapshot.categoryCount >= snapshot.webDomainCount {
            return "category_loop"
        }
        return "app_loop"
    }

    private static func motivationCluster(goal: String?, profile: String?, weakMoment: String?) -> String {
        let text = [goal, profile, weakMoment].compactMap { $0?.lowercased() }.joined(separator: " ")
        if text.contains("sleep") || text.contains("night") || text.contains("bed") { return "sleep_protection" }
        if text.contains("study") || text.contains("student") || text.contains("school") { return "study_focus" }
        if text.contains("work") || text.contains("deep") { return "deep_work" }
        if text.contains("mental") || text.contains("dopamine") { return "mental_wellness" }
        return "general_control"
    }

    private static func average(_ values: [Int]) -> Int? {
        values.isEmpty ? nil : values.reduce(0, +) / values.count
    }

    private static func circularAverage(_ values: [Int]) -> Int? {
        guard !values.isEmpty else { return nil }
        let adjusted = values.map { $0 < 12 * 60 ? $0 + 24 * 60 : $0 }
        return (adjusted.reduce(0, +) / adjusted.count) % (24 * 60)
    }

    private static func delta(value: Int?, baseline: Int?) -> Int? {
        guard let value, let baseline else { return nil }
        return value - baseline
    }

    private static func percentDelta(value: Int?, baseline: Int?) -> Int? {
        guard let value, let baseline, baseline > 0 else { return nil }
        return Int(((Double(value) - Double(baseline)) / Double(baseline) * 100).rounded())
    }

    private static func minuteDistance(_ lhs: Int?, _ rhs: Int?) -> Int? {
        guard let lhs, let rhs else { return nil }
        let diff = abs(lhs - rhs)
        return min(diff, 24 * 60 - diff)
    }

    private static func timeText(_ minute: Int) -> String {
        let safeMinuteOfDay = ((minute % (24 * 60)) + (24 * 60)) % (24 * 60)
        let hour = safeMinuteOfDay / 60
        let displayHour = hour % 12 == 0 ? 12 : hour % 12
        let meridiem = hour < 12 ? "AM" : "PM"
        return "\(displayHour):\(String(format: "%02d", safeMinuteOfDay % 60)) \(meridiem)"
    }

    private static func clean(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func mostCommon(_ values: [Int]) -> Int? {
        mostCommonValues(values, limit: 1).first
    }

    private static func mostCommonValues(_ values: [Int], limit: Int) -> [Int] {
        let counts = Dictionary(grouping: values, by: { $0 }).mapValues(\.count)
        return counts
            .sorted { first, second in
                first.value == second.value ? first.key < second.key : first.value > second.value
            }
            .prefix(limit)
            .map(\.key)
    }
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

struct AIWeakWindow: Identifiable, Equatable {
    var hour: Int
    var count: Int
    var reason: String

    var id: Int { hour }
    var windowText: String { DigitalWellnessAI.hourRangeText(hour) }
}

struct DigitalWellnessV3Profile: Equatable {
    var archetype: String
    var primaryGoal: String
    var weeklyProtectedMinutes: Int
    var weeklySessionCount: Int
    var weeklyBreakCount: Int
    var adherenceScore: Int
    var relapseRiskScore: Int
    var strongestWindow: Int?
    var weakestWindow: Int?
    var dominantModeName: String?
    var confidence: Int
    var pickupPressureScore: Int
    var behaviorChain: String
    var experimentName: String
    var experimentHypothesis: String
}

struct AdaptiveFocusPlan: Equatable {
    var title: String
    var weeklyGoal: String
    var recommendedStartHour: Int
    var recommendedDurationMinutes: Int
    var difficulty: String
    var primaryAction: String
    var secondaryAction: String
    var adjustmentReason: String
}

struct DigitalWellnessV3Forecast: Equatable {
    var title: String
    var riskWindow: String
    var riskScore: Int
    var minutesUntilRisk: Int
    var reason: String
    var recommendedAction: String
    var reasons: [String]
    var experimentName: String
    var experimentMetric: String
}

struct DigitalWellnessV3System: Equatable {
    var profile: DigitalWellnessV3Profile
    var plan: AdaptiveFocusPlan
    var forecast: DigitalWellnessV3Forecast
    var relapseIntervention: RelapseIntervention
    var weakWindows: [AIWeakWindow]
    var relapseReview: String
    var dailySummary: String
    var weeklyInsight: String
}

enum DigitalWellnessAI {
    private static let diagnosisKey = "blankDigitalWellnessDiagnosis"

    static func saveInitialDiagnosis(
        defaults: UserDefaults = BlankSharedState.defaults,
        goal: String,
        profile: String,
        dailyHours: Double,
        selectionCount: Int,
        now: Date = Date()
    ) {
        let diagnosis = initialDiagnosis(
            goal: goal,
            profile: profile,
            dailyHours: dailyHours,
            selectionCount: selectionCount,
            now: now
        )
        guard let data = try? JSONEncoder().encode(diagnosis) else { return }
        defaults.set(data, forKey: diagnosisKey)
    }

    static func loadDiagnosis(defaults: UserDefaults = BlankSharedState.defaults) -> DigitalWellnessDiagnosis? {
        guard let data = defaults.data(forKey: diagnosisKey) else { return nil }
        return try? JSONDecoder().decode(DigitalWellnessDiagnosis.self, from: data)
    }

    static func currentDiagnosis(
        defaults: UserDefaults = BlankSharedState.defaults,
        events: [BlankUsageEvent],
        sessions: [BlankSession],
        selectionCount: Int,
        now: Date = Date()
    ) -> DigitalWellnessDiagnosis {
        let stored = loadDiagnosis(defaults: defaults)
        let goal = defaults.string(forKey: "blankOnboardingGoal") ?? stored?.primaryGoal ?? ""
        let profile = defaults.string(forKey: "blankOnboardingProfile") ?? ""
        let dailyHours = defaults.object(forKey: "blankOnboardingDailyHours") == nil
            ? stored?.dailyHours ?? 4.5
            : defaults.double(forKey: "blankOnboardingDailyHours")
        var diagnosis = stored ?? initialDiagnosis(
            goal: goal,
            profile: profile,
            dailyHours: dailyHours,
            selectionCount: selectionCount,
            now: now
        )

        if let weakHour = weakHour(events: events, sessions: sessions, now: now) {
            diagnosis.recommendedHour = weakHour
            diagnosis.weakMoment = hourRangeText(weakHour)
        }
        return diagnosis
    }

    static func relapseIntervention(
        defaults: UserDefaults = BlankSharedState.defaults,
        events: [BlankUsageEvent],
        sessions: [BlankSession],
        selectionCount: Int,
        now: Date = Date()
    ) -> RelapseIntervention {
        let diagnosis = currentDiagnosis(
            defaults: defaults,
            events: events,
            sessions: sessions,
            selectionCount: selectionCount,
            now: now
        )
        let weakHour = weakHour(events: events, sessions: sessions, now: now) ?? diagnosis.recommendedHour
        let isWeakWindow = Calendar.current.component(.hour, from: now) == weakHour
        return RelapseIntervention(
            headline: isWeakWindow ? "This is your risk window." : "This break trains the loop.",
            cost: "Breaking now weakens your \(diagnosis.archetype.lowercased()) plan.",
            alternative: "Try 5 more minutes, then decide again."
        )
    }

    static func v3System(
        defaults: UserDefaults = BlankSharedState.defaults,
        events: [BlankUsageEvent],
        sessions: [BlankSession],
        selectionCount: Int,
        modeName: String?,
        emergencyUnlocksRemaining: Int,
        now: Date = Date()
    ) -> DigitalWellnessV3System {
        let diagnosis = currentDiagnosis(
            defaults: defaults,
            events: events,
            sessions: sessions,
            selectionCount: selectionCount,
            now: now
        )
        let profile = v3Profile(
            diagnosis: diagnosis,
            events: events,
            sessions: sessions,
            modeName: modeName,
            now: now
        )
        let plan = adaptivePlan(
            diagnosis: diagnosis,
            profile: profile,
            selectionCount: selectionCount,
            emergencyUnlocksRemaining: emergencyUnlocksRemaining
        )
        let forecast = v3Forecast(profile: profile, plan: plan, now: now)
        let relapse = v3RelapseIntervention(
            diagnosis: diagnosis,
            profile: profile,
            forecast: forecast,
            emergencyUnlocksRemaining: emergencyUnlocksRemaining,
            now: now
        )

        return DigitalWellnessV3System(
            profile: profile,
            plan: plan,
            forecast: forecast,
            relapseIntervention: relapse,
            weakWindows: weakWindows(events: events, sessions: sessions, diagnosis: diagnosis, now: now),
            relapseReview: relapseReviewText(defaults: defaults, profile: profile),
            dailySummary: dailySummary(profile: profile, plan: plan),
            weeklyInsight: weeklyInsight(profile: profile, forecast: forecast)
        )
    }

    static func weakHour(events: [BlankUsageEvent], sessions: [BlankSession], now: Date = Date()) -> Int? {
        let calendar = Calendar.current
        let weekStart = BlankWeeklySessionAggregator.startOfWeek(for: now, calendar: calendar)
        let brokenEventHours = events
            .filter { event in
                event.occurredAt >= weekStart &&
                event.occurredAt <= now &&
                (event.kind == .blockBroken || event.endedReason == .emergency || event.endedReason == .manual)
            }
            .map(\.localHour)
        let emergencySessionHours = sessions
            .filter { session in
                let sessionEnd = session.endedAt ?? now
                return session.startedAt <= now &&
                sessionEnd >= weekStart &&
                (session.endedReason == .emergency || session.endedReason == .manual)
            }
            .compactMap(\.localStartHour)

        return mostCommonValue(brokenEventHours + emergencySessionHours)
    }

    static func hourRangeText(_ hour: Int) -> String {
        "\(clockTimeText(hour: hour)) to \(clockTimeText(hour: (hour + 1) % 24))"
    }

    private static func v3Profile(
        diagnosis: DigitalWellnessDiagnosis,
        events: [BlankUsageEvent],
        sessions: [BlankSession],
        modeName: String?,
        now: Date
    ) -> DigitalWellnessV3Profile {
        let calendar = Calendar.current
        let weekStart = BlankWeeklySessionAggregator.startOfWeek(for: now, calendar: calendar)
        let weeklySessions = sessions.filter { session in
            let sessionEnd = session.endedAt ?? now
            return session.startedAt <= now && sessionEnd >= weekStart
        }
        let weeklyEvents = events.filter { $0.occurredAt >= weekStart && $0.occurredAt <= now }
        let brokenEvents = weeklyEvents.filter { $0.kind == .blockBroken || $0.endedReason == .emergency || $0.endedReason == .manual }
        let protectedMinutes = Int(weeklySessions.reduce(TimeInterval.zero) { $0 + $1.duration } / 60)
        let breakCount = brokenEvents.count + weeklySessions.filter { $0.endedReason == .emergency || $0.endedReason == .manual }.count
        let sessionCount = weeklySessions.count
        let adherenceBase = min(72, sessionCount * 12) + min(28, protectedMinutes / 20)
        let breakPenalty = min(58, breakCount * 14)
        let adherence = min(100, max(0, adherenceBase - breakPenalty))
        let riskScore = min(100, max(8, 36 + breakCount * 18 - sessionCount * 4 + (diagnosis.dailyHours >= 6 ? 12 : 0)))
        let strongest = mostCommonValue(weeklySessions.compactMap(\.localStartHour) + weeklyEvents.filter { $0.kind == .blockStarted }.map(\.localHour))
        let weakest = weakHour(events: events, sessions: sessions, now: now) ?? diagnosis.recommendedHour
        let confidence = min(100, max(16, sessionCount * 13 + weeklyEvents.count * 4))
        let pickupPressure = min(100, brokenEvents.count * 18 + weeklySessions.filter { $0.endedReason == .manual || $0.endedReason == .emergency }.count * 14 + max(0, 70 - adherence) / 3)
        let chain = v3BehaviorChain(events: weeklyEvents, sessions: weeklySessions)
        let experiment = v3ExperimentName(pickupPressure: pickupPressure, breakCount: breakCount, adherence: adherence)

        return DigitalWellnessV3Profile(
            archetype: diagnosis.archetype,
            primaryGoal: diagnosis.primaryGoal,
            weeklyProtectedMinutes: protectedMinutes,
            weeklySessionCount: sessionCount,
            weeklyBreakCount: breakCount,
            adherenceScore: adherence,
            relapseRiskScore: riskScore,
            strongestWindow: strongest,
            weakestWindow: weakest,
            dominantModeName: modeName,
            confidence: confidence,
            pickupPressureScore: pickupPressure,
            behaviorChain: chain,
            experimentName: experiment.name,
            experimentHypothesis: experiment.hypothesis
        )
    }

    private static func v3BehaviorChain(events: [BlankUsageEvent], sessions: [BlankSession]) -> String {
        let relapses = events.filter { $0.kind == .blockBroken || $0.endedReason == .manual || $0.endedReason == .emergency }.count
        let started = events.filter { $0.kind == .blockStarted }.count
        let completed = sessions.filter { $0.endedAt != nil && $0.endedReason != .manual && $0.endedReason != .emergency }.count
        if relapses >= 3 { return "quick check -> protected app urge -> exit" }
        if started > completed { return "planned block -> early exit" }
        if completed >= 3 && relapses == 0 { return "planned block -> clean session" }
        if started > 0 { return "urge -> protected window" }
        return "learning"
    }

    private static func v3ExperimentName(pickupPressure: Int, breakCount: Int, adherence: Int) -> (name: String, hypothesis: String, metric: String) {
        if pickupPressure >= 65 {
            return (
                "Chain Intercept",
                "Stop the second quick check before it becomes a longer scroll loop.",
                "Fewer exits in the same window."
            )
        }
        if breakCount >= 2 || adherence < 45 {
            return (
                "Lighter Earlier Block",
                "A shorter earlier block should hold better than strict late friction.",
                "Completed block without manual exit."
            )
        }
        if adherence >= 78 {
            return (
                "Progressive Window",
                "A stable window can be extended without raising relapse risk.",
                "Three clean completed sessions."
            )
        }
        return (
            "Stable Repeat",
            "Repeat the same window to build a clean baseline.",
            "Completed sessions without emergency exits."
        )
    }

    private static func adaptivePlan(
        diagnosis: DigitalWellnessDiagnosis,
        profile: DigitalWellnessV3Profile,
        selectionCount: Int,
        emergencyUnlocksRemaining: Int
    ) -> AdaptiveFocusPlan {
        let weakHour = profile.weakestWindow ?? diagnosis.recommendedHour
        let duration: Int
        let difficulty: String
        let reason: String

        if profile.weeklyBreakCount >= 2 || emergencyUnlocksRemaining == 0 {
            duration = max(15, diagnosis.initialBlockMinutes - 15)
            difficulty = "Recovery"
            reason = "Recent breaks suggest the next block should be easier, not harder."
        } else if profile.adherenceScore >= 78 && profile.weeklySessionCount >= 4 {
            duration = min(90, diagnosis.initialBlockMinutes + 15)
            difficulty = "Progressive"
            reason = "Your recent adherence is strong enough to extend one window."
        } else {
            duration = diagnosis.initialBlockMinutes
            difficulty = "Baseline"
            reason = "Blankmind needs repeated sessions before increasing difficulty."
        }

        let mode = profile.dominantModeName ?? "main mode"
        let appAction = selectionCount < 3
            ? "Add at least 3 apps or categories before judging results."
            : "Keep \(mode) unchanged for the next 3 sessions."

        return AdaptiveFocusPlan(
            title: "\(profile.archetype) plan",
            weeklyGoal: weeklyGoal(profile: profile),
            recommendedStartHour: weakHour,
            recommendedDurationMinutes: duration,
            difficulty: difficulty,
            primaryAction: "Start \(duration) min at \(activationTimeText(before: weakHour)).",
            secondaryAction: appAction,
            adjustmentReason: reason
        )
    }

    private static func v3Forecast(
        profile: DigitalWellnessV3Profile,
        plan: AdaptiveFocusPlan,
        now: Date
    ) -> DigitalWellnessV3Forecast {
        let targetHour = profile.weakestWindow ?? plan.recommendedStartHour
        let minutes = minutesUntilNextHour(targetHour, now: now)
        let urgencyBonus = minutes <= 60 ? 18 : 0
        let risk = min(100, profile.relapseRiskScore + urgencyBonus + profile.pickupPressureScore / 5)
        let reason: String
        var reasons: [String] = []
        if profile.weeklyBreakCount > 0 {
            reason = "Breaks clustered around \(hourRangeText(targetHour))."
            reasons.append(reason)
        } else if profile.weeklySessionCount == 0 {
            reason = "Your onboarding profile points to this as the first window to protect."
            reasons.append(reason)
        } else {
            reason = "This is the next window with the highest expected attention leak."
            reasons.append(reason)
        }
        if profile.pickupPressureScore >= 50 {
            reasons.append("Pickup pressure is \(profile.pickupPressureScore)/100.")
        }
        if profile.behaviorChain != "learning" {
            reasons.append("Behavior chain: \(profile.behaviorChain).")
        }

        return DigitalWellnessV3Forecast(
            title: risk >= 70 ? "High-risk window" : "Control forecast",
            riskWindow: hourRangeText(targetHour),
            riskScore: risk,
            minutesUntilRisk: minutes,
            reason: reason,
            recommendedAction: plan.primaryAction,
            reasons: Array(reasons.prefix(4)),
            experimentName: profile.experimentName,
            experimentMetric: v3ExperimentName(pickupPressure: profile.pickupPressureScore, breakCount: profile.weeklyBreakCount, adherence: profile.adherenceScore).metric
        )
    }

    private static func v3RelapseIntervention(
        diagnosis: DigitalWellnessDiagnosis,
        profile: DigitalWellnessV3Profile,
        forecast: DigitalWellnessV3Forecast,
        emergencyUnlocksRemaining: Int,
        now: Date
    ) -> RelapseIntervention {
        let currentHour = Calendar.current.component(.hour, from: now)
        let weakHour = profile.weakestWindow ?? diagnosis.recommendedHour
        let headline = currentHour == weakHour
            ? "This is your highest-risk window."
            : "This unlock trains the loop."
        let cost = emergencyUnlocksRemaining <= 1
            ? "You have \(emergencyUnlocksRemaining) emergency unlock left this week."
            : "Breaking now lowers your \(profile.archetype.lowercased()) plan score."
        let alternative = forecast.minutesUntilRisk <= 30
            ? "Protect the next 5 minutes, then decide again."
            : "Delay this unlock and repeat your weekly goal once."
        return RelapseIntervention(headline: headline, cost: cost, alternative: alternative)
    }

    private static func dailySummary(profile: DigitalWellnessV3Profile, plan: AdaptiveFocusPlan) -> String {
        if profile.weeklySessionCount == 0 {
            return "No signal yet today. Start with \(plan.recommendedDurationMinutes) min."
        }
        if profile.weeklyBreakCount == 0 {
            return "\(profile.weeklyProtectedMinutes) min protected this week with no emergency breaks."
        }
        return "\(profile.weeklyBreakCount) break signal\(profile.weeklyBreakCount == 1 ? "" : "s") detected. Use recovery difficulty."
    }

    private static func weeklyInsight(profile: DigitalWellnessV3Profile, forecast: DigitalWellnessV3Forecast) -> String {
        "Score \(profile.adherenceScore)/100, confidence \(profile.confidence)%. Next risk: \(forecast.riskWindow)."
    }

    private static func weakWindows(
        events: [BlankUsageEvent],
        sessions: [BlankSession],
        diagnosis: DigitalWellnessDiagnosis,
        now: Date
    ) -> [AIWeakWindow] {
        let calendar = Calendar.current
        let weekStart = BlankWeeklySessionAggregator.startOfWeek(for: now, calendar: calendar)
        let eventHours = events
            .filter { event in
                event.occurredAt >= weekStart &&
                event.occurredAt <= now &&
                (event.kind == .blockBroken || event.endedReason == .emergency || event.endedReason == .manual)
            }
            .map(\.localHour)
        let sessionHours = sessions
            .filter { session in
                let end = session.endedAt ?? now
                return session.startedAt <= now &&
                    end >= weekStart &&
                    (session.endedReason == .emergency || session.endedReason == .manual)
            }
            .compactMap(\.localStartHour)
        let counted = (eventHours + sessionHours).reduce(into: [Int: Int]()) { $0[$1, default: 0] += 1 }
        let ranked = counted.sorted { lhs, rhs in
            lhs.value == rhs.value ? lhs.key < rhs.key : lhs.value > rhs.value
        }

        let windows = ranked.prefix(3).map { hour, count in
            AIWeakWindow(hour: hour, count: count, reason: weakWindowReason(hour: hour, count: count))
        }
        if windows.isEmpty {
            return [
                AIWeakWindow(hour: diagnosis.recommendedHour, count: 0, reason: "Predicted from onboarding until Blankmind has enough real relapse data.")
            ]
        }
        return windows
    }

    private static func weakWindowReason(hour: Int, count: Int) -> String {
        let daypart: String
        switch hour {
        case 5..<10: daypart = "morning checking"
        case 10..<17: daypart = "work or study avoidance"
        case 17..<21: daypart = "transition time"
        case 21...23, 0..<2: daypart = "night scrolling"
        default: daypart = "low-energy scrolling"
        }
        return count > 0
            ? "\(count) break signal\(count == 1 ? "" : "s") point to \(daypart)."
            : "Predicted \(daypart) risk."
    }

    private static func relapseReviewText(defaults: UserDefaults, profile: DigitalWellnessV3Profile) -> String {
        guard let raw = defaults.string(forKey: "blankLastRelapseReviewReason"),
              let reason = RelapseReviewReason(rawValue: raw) else {
            return "After the next manual unlock, Blankmind will ask why and adjust this plan."
        }
        return "\(reason.title): \(reason.planAdjustment)"
    }

    private static func weeklyGoal(profile: DigitalWellnessV3Profile) -> String {
        if profile.weeklyBreakCount > 0 {
            return "Complete 3 blocks without Emergency in your weak window."
        }
        if profile.weeklySessionCount < 5 {
            return "Reach 5 protected sessions this week."
        }
        return "Increase protected time by 15% without adding breaks."
    }

    private static func activationTimeText(before hour: Int) -> String {
        clockTimeText(hour: (hour + 23) % 24, minute: 50)
    }

    private static func clockTimeText(hour: Int, minute: Int = 0) -> String {
        let safeHour = ((hour % 24) + 24) % 24
        let safeMinute = max(0, min(59, minute))
        let displayHour = safeHour % 12 == 0 ? 12 : safeHour % 12
        let meridiem = safeHour < 12 ? "AM" : "PM"
        return "\(displayHour):\(String(format: "%02d", safeMinute)) \(meridiem)"
    }

    private static func initialDiagnosis(
        goal: String,
        profile: String,
        dailyHours: Double,
        selectionCount: Int,
        now: Date
    ) -> DigitalWellnessDiagnosis {
        let goalText = goal.isEmpty ? "Build healthier screen habits" : goal
        let normalizedGoal = goal.lowercased()
        let normalizedProfile = profile.lowercased()

        let archetype: String
        let riskTitle: String
        let riskBody: String
        let recommendedHour: Int
        let blockMinutes: Int

        if normalizedGoal.contains("sleep") {
            archetype = "Night Scroller"
            riskTitle = "Late-night scroll risk"
            riskBody = "Your highest leverage habit is protecting the final hour before sleep."
            recommendedHour = 22
            blockMinutes = 45
        } else if normalizedGoal.contains("mental") || dailyHours >= 6.5 {
            archetype = "Dopamine Loop"
            riskTitle = "High stimulation risk"
            riskBody = "Your phone is likely filling low-energy moments before you notice."
            recommendedHour = 20
            blockMinutes = 30
        } else if normalizedGoal.contains("present") || normalizedProfile.contains("caregiver") {
            archetype = "Presence Drifter"
            riskTitle = "Attention leak risk"
            riskBody = "The main win is protecting short windows where you want to be more present."
            recommendedHour = 18
            blockMinutes = 25
        } else if normalizedProfile.contains("student") || normalizedGoal.contains("focus") || normalizedProfile.contains("technology") {
            archetype = "Focus Breaker"
            riskTitle = "Deep-work interruption risk"
            riskBody = "Your biggest gain is starting blocks before the first distraction."
            recommendedHour = 9
            blockMinutes = 45
        } else {
            archetype = "Habit Rebuilder"
            riskTitle = "Automatic checking risk"
            riskBody = "Your plan should make the first block easy and repeatable."
            recommendedHour = Calendar.current.component(.hour, from: now)
            blockMinutes = selectionCount < 3 ? 25 : 35
        }

        let weakMoment = hourRangeText(recommendedHour)
        return DigitalWellnessDiagnosis(
            archetype: archetype,
            riskTitle: riskTitle,
            riskBody: riskBody,
            primaryGoal: goalText,
            weakMoment: weakMoment,
            dailyHours: dailyHours,
            initialBlockMinutes: blockMinutes,
            recommendedHour: recommendedHour,
            plan: sevenDayPlan(archetype: archetype, weakMoment: weakMoment, blockMinutes: blockMinutes),
            createdAt: now
        )
    }

    private static func sevenDayPlan(archetype: String, weakMoment: String, blockMinutes: Int) -> [DigitalWellnessPlanItem] {
        [
            DigitalWellnessPlanItem(id: 1, title: "Day 1", action: "\(blockMinutes) min during \(weakMoment)."),
            DigitalWellnessPlanItem(id: 2, title: "Day 2", action: "Repeat the same window with the same apps."),
            DigitalWellnessPlanItem(id: 3, title: "Day 3", action: "Add 10 min if there was no emergency."),
            DigitalWellnessPlanItem(id: 4, title: "Day 4", action: "Start 10 min before the urge usually appears."),
            DigitalWellnessPlanItem(id: 5, title: "Day 5", action: "Keep one strict block and one short reset."),
            DigitalWellnessPlanItem(id: 6, title: "Day 6", action: "Review which app pulled hardest."),
            DigitalWellnessPlanItem(id: 7, title: "Day 7", action: "Repeat your best \(archetype.lowercased()) block.")
        ]
    }

    private static func minutesUntilNextHour(_ hour: Int, now: Date) -> Int {
        let calendar = Calendar.current
        let currentHour = calendar.component(.hour, from: now)
        let currentMinute = calendar.component(.minute, from: now)
        if currentHour == hour {
            return 0
        }
        let hoursUntil = (hour - currentHour + 24) % 24
        return max(0, hoursUntil * 60 - currentMinute)
    }

    private static func mostCommonValue<T: Hashable>(_ values: [T]) -> T? {
        let counts = values.reduce(into: [T: Int]()) { counts, value in
            counts[value, default: 0] += 1
        }
        return counts.max { lhs, rhs in lhs.value < rhs.value }?.key
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
