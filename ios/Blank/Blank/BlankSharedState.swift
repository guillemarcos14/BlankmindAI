import FamilyControls
import Foundation

enum BlankSharedState {
    static var familyControlsApproved: Bool {
        let status = AuthorizationCenter.shared.authorizationStatus
        if status == .approved { return true }
        #if compiler(>=6.3)
        if #available(iOS 26.4, *) { return status == .approvedWithDataAccess }
        #endif
        return false
    }
    static func recordRestProtection(activeWindowIDs: [String], plans: [String: [String: Any]] = [:], uncertain: Bool = false, defaults: UserDefaults, now: Date = Date()) {
        guard let owner = defaults.string(forKey: "blankBMBSignalOwner"), !owner.isEmpty else { return }
        let iso = ISO8601DateFormatter()
        var rows = defaults.array(forKey: "blankRestProtectionIntervals") as? [[String: Any]] ?? []
        for index in rows.indices where rows[index]["owner"] as? String == owner && rows[index]["ended_at"] == nil {
            let id = rows[index]["window_id"] as? String ?? ""
            let old = rows[index]["plan"] as? [String: Any] ?? [:]
            if !activeWindowIDs.contains(id) || !NSDictionary(dictionary: old).isEqual(to: plans[id] ?? [:]) {
                rows[index]["ended_at"] = iso.string(from: now)
                if uncertain { rows[index]["uncertain"] = true }
            }
        }
        for id in activeWindowIDs where !rows.contains(where: { $0["owner"] as? String == owner && $0["window_id"] as? String == id && $0["ended_at"] == nil }) {
            rows.append(["id": UUID().uuidString, "owner": owner, "window_id": id, "started_at": iso.string(from: now), "source": "native_schedule_shield", "plan": plans[id] ?? [:], "uncertain": false])
        }
        defaults.set(Array(rows.suffix(140)), forKey: "blankRestProtectionIntervals")
    }
    static let appGroupIdentifier = "group.com.blanknfc.app.ios"
    static let canonicalProtectionId = UUID(uuidString: "A1E43B14-22E6-4B55-8E89-5E2A3C100001")!
    static let canonicalProtectionName = "Distractions"

    static var defaults: UserDefaults {
        UserDefaults(suiteName: appGroupIdentifier) ?? .standard
    }

    static var appInstallId: String {
        if let existing = defaults.string(forKey: Keys.appInstallId), !existing.isEmpty {
            return existing
        }
        let created = UUID().uuidString
        defaults.set(created, forKey: Keys.appInstallId)
        return created
    }

    static func hasConfiguredBlock(in defaults: UserDefaults = Self.defaults) -> Bool {
        selectionCount(in: defaults) > 0
    }

    static func selectionCount(in defaults: UserDefaults = Self.defaults) -> Int {
        selectionSnapshot(in: defaults).totalCount
    }

    static func selectionSnapshot(in defaults: UserDefaults = Self.defaults) -> BlankSelectionSnapshot {
        guard let selection = loadSelection(from: defaults) else {
            return BlankSelectionSnapshot()
        }
        return BlankSelectionSnapshot(
            applicationCount: selection.applicationTokens.count,
            categoryCount: selection.categoryTokens.count,
            webDomainCount: selection.webDomainTokens.count
        )
    }

    static func loadSelection(from defaults: UserDefaults = Self.defaults) -> FamilyActivitySelection? {
        guard let data = defaults.data(forKey: Keys.selection) else { return nil }
        return try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
    }

    static func loadActiveState(now: Date = Date(), defaults: UserDefaults = Self.defaults) -> ActiveState {
        let isActive = defaults.bool(forKey: Keys.isBlankActive)
        let startedAt = date(forKey: Keys.blankActiveSince, defaults: defaults)
        let endsAt = date(forKey: Keys.blankActiveUntil, defaults: defaults)

        if isActive, let endsAt, now >= endsAt {
            return ActiveState(isActive: false, startedAt: startedAt, endsAt: endsAt)
        }

        return ActiveState(isActive: isActive, startedAt: startedAt, endsAt: endsAt)
    }



    // Session ownership prevents a late extension callback from releasing a new block.


    @discardableResult
    static func finishExpiredBlock(defaults: UserDefaults = Self.defaults, now: Date = Date()) -> Bool {
        guard defaults.bool(forKey: Keys.isBlankActive),
              let endsAt = date(forKey: Keys.blankActiveUntil, defaults: defaults),
              now >= endsAt else {
            return false
        }

        defaults.set(false, forKey: Keys.isBlankActive)
        defaults.removeObject(forKey: Keys.blankActiveSince)
        defaults.removeObject(forKey: Keys.blankActiveUntil)
        endActiveSession(defaults: defaults, now: now, endedReason: activeExpiredReason(defaults: defaults))
        return true
    }

    private static func activeExpiredReason(defaults: UserDefaults) -> BlankEndedReason {
        let activeSession = loadSessions(defaults: defaults).last { $0.isActive }
        return activeSession?.plannedDurationMinutes == nil ? .expired : .timer
    }



    private static func endActiveSession(defaults: UserDefaults, now: Date, endedReason: BlankEndedReason) {
        var sessions = loadSessions(defaults: defaults)
        guard let index = sessions.lastIndex(where: { $0.isActive }) else { return }
        sessions[index].end(at: now, endedReason: endedReason)
        saveSessions(sessions, defaults: defaults)
        appendUsageEvent(
            defaults: defaults,
            kind: .blockEnded,
            session: sessions[index],
            entryMode: sessions[index].entryMode ?? .app,
            endedReason: endedReason,
            now: now
        )
    }

    private static func loadSessions(defaults: UserDefaults) -> [BlankSession] {
        guard let data = defaults.data(forKey: Keys.sessions),
              let sessions = try? JSONDecoder().decode([BlankSession].self, from: data) else {
            return []
        }
        return sessions
    }

    private static func saveSessions(_ sessions: [BlankSession], defaults: UserDefaults) {
        guard let data = try? JSONEncoder().encode(sessions) else { return }
        defaults.set(data, forKey: Keys.sessions)
    }

    private static func appendUsageEvent(
        defaults: UserDefaults,
        kind: BlankUsageEventKind,
        session: BlankSession,
        entryMode: BlankEntryMode,
        endedReason: BlankEndedReason? = nil,
        now: Date,
        selectionSnapshot: BlankSelectionSnapshot? = nil,
        modeName: String? = nil
    ) {
        var events = loadUsageEvents(defaults: defaults)
        var event = BlankUsageEvent(
            kind: kind,
            sessionId: session.id,
            occurredAt: now,
            entryMode: entryMode,
            endedReason: endedReason,
            duration: kind == .blockStarted ? nil : session.duration,
            selectionSnapshot: selectionSnapshot ?? session.selectionSnapshot ?? Self.selectionSnapshot(in: defaults),
            modeName: modeName ?? session.modeName
        )
        event.plannedDurationMinutes = session.plannedDurationMinutes
        events.append(event)
        if events.count > 500 {
            events.removeFirst(events.count - 500)
        }
        saveUsageEvents(events, defaults: defaults)
    }

    private static func loadUsageEvents(defaults: UserDefaults) -> [BlankUsageEvent] {
        guard let data = defaults.data(forKey: Keys.usageEvents),
              let events = try? JSONDecoder().decode([BlankUsageEvent].self, from: data) else {
            return []
        }
        return events
    }

    private static func saveUsageEvents(_ events: [BlankUsageEvent], defaults: UserDefaults) {
        guard let data = try? JSONEncoder().encode(events) else { return }
        defaults.set(data, forKey: Keys.usageEvents)
    }

    private static func date(forKey key: String, defaults: UserDefaults) -> Date? {
        guard let timestamp = defaults.object(forKey: key) as? TimeInterval, timestamp > 0 else {
            return nil
        }
        return Date(timeIntervalSince1970: timestamp)
    }

    struct ActiveState {
        var isActive: Bool
        var startedAt: Date?
        var endsAt: Date?

    }

    enum Keys {
        static let appInstallId = "blankIdentityAppInstallId"
        static let isBlankActive = "isBlankActive"
        static let blankActiveSince = "blankActiveSince"
        static let blankActiveUntil = "blankActiveUntil"
        static let selection = "familyActivitySelection"
        static let sessions = "blankSessions"
        static let usageEvents = "blankUsageEvents"
    }
}
