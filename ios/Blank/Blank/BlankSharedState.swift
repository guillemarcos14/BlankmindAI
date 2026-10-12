import FamilyControls
import Foundation

enum BlankSharedState {
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

    static func startQuickBlock(defaults: UserDefaults = Self.defaults, now: Date = Date()) -> Bool {
        guard defaults.double(forKey: "blankManualReblockAt") <= now.timeIntervalSince1970 else { return false }
        guard !defaults.bool(forKey: Keys.isBlankActive) else { return false }
        guard hasConfiguredBlock(in: defaults) else { return false }
        let durationMinutes = pendingWidgetTimerMinutes(defaults: defaults)
        defaults.set(true, forKey: Keys.isBlankActive)
        defaults.set(now.timeIntervalSince1970, forKey: Keys.blankActiveSince)
        if let durationMinutes {
            defaults.set(now.addingTimeInterval(TimeInterval(durationMinutes * 60)).timeIntervalSince1970, forKey: Keys.blankActiveUntil)
        } else {
            defaults.removeObject(forKey: Keys.blankActiveUntil)
        }
        defaults.removeObject(forKey: Keys.pendingWidgetTimerMinutes)
        defaults.removeObject(forKey: "blankQuickBlockDurationMinutes")
        appendSession(defaults: defaults, now: now, entryMode: .widget, plannedDurationMinutes: durationMinutes)
        return true
    }

    // Session ownership prevents a late extension callback from releasing a new block.
    static func widgetUnlockDeadline(defaults: UserDefaults = Self.defaults) -> Date? {
        guard defaults.bool(forKey: Keys.isBlankActive),
              !defaults.bool(forKey: "blankHardBlankActive"),
              let owner = date(forKey: Keys.widgetUnlockSessionSince, defaults: defaults),
              owner == date(forKey: Keys.blankActiveSince, defaults: defaults) else { return nil }
        return date(forKey: Keys.widgetUnlockAt, defaults: defaults)
    }

    @discardableResult
    static func requestWidgetUnlock(defaults: UserDefaults = Self.defaults, now: Date = Date()) -> Date? {
        guard loadActiveState(now: now, defaults: defaults).isActive,
              !defaults.bool(forKey: "blankHardBlankActive"),
              let owner = date(forKey: Keys.blankActiveSince, defaults: defaults) else { return nil }
        if let pending = widgetUnlockDeadline(defaults: defaults) { return pending }
        // Do not restart a countdown already requested in the app.
        let manualOwner = defaults.double(forKey: "blankManualUnlockSessionSince")
        let manualDeadline = date(forKey: "blankManualUnlockAt", defaults: defaults)
        let deadline = manualOwner == owner.timeIntervalSince1970
            ? (manualDeadline ?? now.addingTimeInterval(60)) : now.addingTimeInterval(60)
        defaults.set(owner.timeIntervalSince1970, forKey: Keys.widgetUnlockSessionSince)
        defaults.set(deadline.timeIntervalSince1970, forKey: Keys.widgetUnlockAt)
        return deadline
    }

    static func cancelWidgetUnlock(defaults: UserDefaults = Self.defaults) {
        defaults.removeObject(forKey: Keys.widgetUnlockAt)
        defaults.removeObject(forKey: Keys.widgetUnlockSessionSince)
    }

    @discardableResult
    static func finishWidgetUnlockIfDue(defaults: UserDefaults = Self.defaults, now: Date = Date()) -> Bool {
        guard let deadline = widgetUnlockDeadline(defaults: defaults), now >= deadline else { return false }
        // A timed session that ends first retains its original completion reason.
        if finishExpiredBlock(defaults: defaults, now: now) { return true }
        defaults.set(false, forKey: Keys.isBlankActive)
        defaults.removeObject(forKey: Keys.blankActiveSince)
        defaults.removeObject(forKey: Keys.blankActiveUntil)
        defaults.removeObject(forKey: Keys.pendingWidgetTimerMinutes)
        defaults.removeObject(forKey: "blankManualUnlockAt")
        defaults.removeObject(forKey: "blankManualUnlockSessionSince")
        defaults.set(now.addingTimeInterval(60).timeIntervalSince1970, forKey: "blankManualReblockAt")
        cancelWidgetUnlock(defaults: defaults)
        endActiveSession(defaults: defaults, now: now, endedReason: .control)
        return true
    }

    static func pendingWidgetTimerMinutes(defaults: UserDefaults = Self.defaults) -> Int? {
        guard defaults.object(forKey: Keys.pendingWidgetTimerMinutes) != nil else { return nil }
        let minutes = defaults.integer(forKey: Keys.pendingWidgetTimerMinutes)
        guard minutes > 0 else { return nil }
        return min(max(minutes, 5), 240)
    }

    static func setPendingWidgetTimerMinutes(_ minutes: Int?, defaults: UserDefaults = Self.defaults) {
        if let minutes {
            defaults.set(min(max(minutes, 5), 240), forKey: Keys.pendingWidgetTimerMinutes)
        } else {
            defaults.removeObject(forKey: Keys.pendingWidgetTimerMinutes)
        }
    }

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
        defaults.removeObject(forKey: Keys.pendingWidgetTimerMinutes)
        cancelWidgetUnlock(defaults: defaults)
        endActiveSession(defaults: defaults, now: now, endedReason: activeExpiredReason(defaults: defaults))
        return true
    }

    private static func activeExpiredReason(defaults: UserDefaults) -> BlankEndedReason {
        let activeSession = loadSessions(defaults: defaults).last { $0.isActive }
        return activeSession?.plannedDurationMinutes == nil ? .expired : .timer
    }

    private static func appendSession(
        defaults: UserDefaults,
        now: Date,
        entryMode: BlankEntryMode,
        plannedDurationMinutes: Int? = nil
    ) {
        let snapshot = selectionSnapshot(in: defaults)
        let session = BlankSession(
            profileId: canonicalProtectionId,
            strategy: .manual,
            startedAt: now,
            entryMode: entryMode,
            selectionSnapshot: snapshot,
            modeName: canonicalProtectionName,
            plannedDurationMinutes: plannedDurationMinutes
        )
        var sessions = loadSessions(defaults: defaults)
        if let index = sessions.lastIndex(where: { $0.isActive }) {
            sessions[index].end(at: now, endedReason: .unknown)
            appendUsageEvent(
                defaults: defaults,
                kind: .blockEnded,
                session: sessions[index],
                entryMode: entryMode,
                endedReason: .unknown,
                now: now
            )
        }
        sessions.append(session)
        saveSessions(sessions, defaults: defaults)
        appendUsageEvent(
            defaults: defaults,
            kind: .blockStarted,
            session: session,
            entryMode: entryMode,
            now: now,
            selectionSnapshot: snapshot,
            modeName: canonicalProtectionName
        )
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
            entryMode: sessions[index].entryMode ?? .widget,
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
        static let pendingWidgetTimerMinutes = "blankPendingWidgetTimerMinutes"
        static let widgetUnlockAt = "blankWidgetUnlockAt"
        static let widgetUnlockSessionSince = "blankWidgetUnlockSessionSince"
    }
}
