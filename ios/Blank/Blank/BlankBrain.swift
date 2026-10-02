import Combine
import Foundation
import UserNotifications

// The same observed state is used from any screen and immediately before a
// chat turn. The model never owns native permissions or protection state.
@MainActor
final class BlankBrain {
    static let shared = BlankBrain()
    private weak var store: SessionStore?
    private weak var blocker: ScreenTimeBlocker?
    private weak var purchases: StoreKitPurchaseStore?
    private var subscriptions = Set<AnyCancellable>()
    private var syncTask: Task<Void, Never>?
    private var notificationsAuthorized = false

    func configure(store: SessionStore, blocker: ScreenTimeBlocker, purchases: StoreKitPurchaseStore) {
        guard self.store !== store else { return }
        self.store = store
        self.blocker = blocker
        self.purchases = purchases
        subscriptions.removeAll()
        Publishers.Merge3(store.objectWillChange, blocker.objectWillChange, purchases.objectWillChange)
            .debounce(for: .milliseconds(300), scheduler: RunLoop.main)
            .sink { [weak self] _ in self?.sync() }
            .store(in: &subscriptions)
        NotificationCenter.default.publisher(for: AssistantAppSession.didChangeNotification)
            .sink { [weak self] _ in self?.sync() }.store(in: &subscriptions)
        sync()
    }

    // A new account must never inherit a previous account's local sessions.
    // Legacy local history is adopted once by the first authenticated account.
    static func scopedSessions(_ sessions: [BlankSession], owner: String?, defaults: UserDefaults = BlankSharedState.defaults, now: Date = Date()) -> [BlankSession] {
        guard let owner else { return [] }
        let firstKey = "blankBrainFirstHistoryOwner"
        let ownersKey = "blankBrainSessionOwners"
        let activeKey = "blankBrainActiveHistoryOwner"
        var owners = defaults.dictionary(forKey: ownersKey) as? [String: String] ?? [:]
        if defaults.string(forKey: firstKey) == nil {
            defaults.set(owner, forKey: firstKey)
            sessions.forEach { owners[$0.id.uuidString] = owner }
        }
        if defaults.string(forKey: activeKey) != owner {
            let previous = defaults.string(forKey: activeKey) ?? defaults.string(forKey: firstKey) ?? owner
            for session in sessions where owners[session.id.uuidString] == nil && session.startedAt < now {
                owners[session.id.uuidString] = previous
            }
            defaults.set(owner, forKey: activeKey)
            defaults.set(now.timeIntervalSince1970, forKey: "blankBrainHistoryStart.\(owner)")
        }
        for session in sessions where owners[session.id.uuidString] == nil { owners[session.id.uuidString] = owner }
        if (defaults.dictionary(forKey: ownersKey) as? [String: String] ?? [:]) != owners { defaults.set(owners, forKey: ownersKey) }
        return sessions.filter { owners[$0.id.uuidString] == owner }
    }

    func freshSnapshot() async -> [String: Any]? {
        let owner = AssistantAppSession.userID
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard owner == AssistantAppSession.userID else { return nil }
        notificationsAuthorized = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional || settings.authorizationStatus == .ephemeral
        blocker?.refreshAuthorizationStatus()
        store?.applyScheduleWindow()
        return snapshot()
    }

    func snapshot(now: Date = Date()) -> [String: Any]? {
        guard let store, let blocker, let owner = AssistantAppSession.userID else { return nil }
        let system = store.digitalWellnessV3
        let defaults = BlankSharedState.defaults
        let currentRevision = Int64(now.timeIntervalSince1970 * 1_000_000)
        let previousRevision = (defaults.object(forKey: "blankAssistantContextRevision") as? NSNumber)?.int64Value ?? 0
        let nextRevision = previousRevision < Int64.max ? previousRevision + 1 : previousRevision
        let contextRevision = max(currentRevision, nextRevision)
        defaults.set(contextRevision, forKey: "blankAssistantContextRevision")
        let iso = ISO8601DateFormatter()
        let all = store.brainSessions.sorted { $0.startedAt < $1.startedAt }
        let retained = Array(all.suffix(2000))
        let calendar = Calendar.current
        let dayFormat = DateFormatter()
        dayFormat.calendar = Calendar(identifier: .gregorian)
        dayFormat.timeZone = calendar.timeZone
        dayFormat.dateFormat = "yyyy-MM-dd"
        let sessionRows: [[String: Any]] = retained.map { session in
            var row: [String: Any] = ["id": session.id.uuidString, "started_at": iso.string(from: session.startedAt)]
            if let value = session.endedAt { row["ended_at"] = iso.string(from: value) }
            if let value = session.pauseStartedAt { row["pause_started_at"] = iso.string(from: value) }
            if let value = session.pauseEndedAt { row["pause_ended_at"] = iso.string(from: value) }
            if let value = session.endedReason { row["ended_reason"] = value.rawValue }
            if let value = session.entryMode { row["entry_mode"] = value.rawValue }
            return row
        }
        var history: [String: Any] = ["schema_version": 1, "generated_at": iso.string(from: now),
            "timezone": calendar.timeZone.identifier, "local_date": dayFormat.string(from: now), "week_starts_on": calendar.firstWeekday,
            "history_complete": all.count <= 2000, "sessions": sessionRows,
            "account": ["signed_in": true, "premium_access": purchases?.hasPremiumAccess == true]]
        if let first = retained.first { history["history_started_at"] = iso.string(from: first.startedAt) }
        var payload: [String: Any] = [
            "context_revision": contextRevision, "context_generated_at": iso.string(from: now),
            "anonymous_user_id": defaults.string(forKey: "blankOnboardingAnonymousUserId") ?? "",
            "profile_name": defaults.string(forKey: "blankBrainFirstHistoryOwner") == owner ? (defaults.string(forKey: "blankOnboardingName") ?? "") : "",
            "age_range": defaults.string(forKey: "blankBrainFirstHistoryOwner") == owner ? (defaults.string(forKey: "blankOnboardingAgeRange") ?? "") : "",
            "is_blank_active": store.isBlankActive, "has_selected_apps": store.hasSelectedApps,
            "selection_count": store.selectionCount, "screen_time_authorized": blocker.authorizationStatus == .approved,
            "notification_authorized": notificationsAuthorized,
            "emergency_unlocks_remaining": store.emergencyUnlocksRemaining,
            "vacation_mode_active": store.isVacationModeActive,
            "adherence_score": system.profile.adherenceScore,
            "weekly_protected_minutes": system.profile.weeklyProtectedMinutes,
            "weekly_break_count": system.profile.weeklyBreakCount,
            "risk_window": system.forecast.riskWindow,
            "recommended_duration_minutes": system.plan.recommendedDurationMinutes,
            "weekly_goal": system.plan.weeklyGoal, "single_distraction_block": true,
            "protection_target": "selected_distractions",
            "app_presence": BlankmindAppPresence.payload(appReady: store.hasSelectedApps && blocker.authorizationStatus == .approved),
            "device_execution_ready": store.hasSelectedApps && blocker.authorizationStatus == .approved,
            "schedule": store.assistantScheduleContext(), "allow_only_mode_enabled": store.allowOnlyModeEnabled,
            "adult_content_blocking_enabled": store.adultContentBlockingEnabled,
            "daily_limit_enabled": store.dailyLimitEnabled, "daily_limit_minutes": store.dailyLimitMinutes,
            "memory": ["weak_hours": BlankedAgentMemory.rememberedWeakHours(system: system), "last_plan_outcome": ""], "brain_snapshot": history]
        if let value = system.profile.strongestWindow { payload["strongest_hour"] = value }
        return payload
    }

    func sync() {
        syncTask?.cancel()
        syncTask = Task {
            guard let payload = await freshSnapshot(), !Task.isCancelled else { return }
            let owner = AssistantAppSession.userID
            let code = BlankSharedState.defaults.string(forKey: "blankAssistantConnectCode") ?? ""
            guard !code.isEmpty, owner != nil else { return }
            _ = await AssistantContextSyncClient().sync(connectCode: code, channel: "app", payload: payload)
        }
    }
}
