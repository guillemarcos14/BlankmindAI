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
    private var lastSyncedContent: Data?
    private var lastSyncedAt = Date.distantPast
    private var archiveOwner: String?
    private var syncedSessionPages: [Int: Data] = [:]
    private var syncedSignalIDs = Set<String>()
    var chatIsOpen = false
    private var executionInFlight = false
    private var backgroundStore: SessionStore?
    private var backgroundBlocker: ScreenTimeBlocker?
    private var backgroundPurchases: StoreKitPurchaseStore?

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
        defaults.set(owner, forKey:"blankBMBSignalOwner")
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
            "account": ["signed_in": true, "premium_access": purchases?.hasPremiumAccess == true,
                "active_product_ids": Array(purchases?.purchasedProductIds ?? []),
                "referral_trial_ends_at": purchases?.referralTrialEndsAt.map(iso.string(from:)) ?? "",
                "referral_count": purchases?.referralCount ?? 0,
                "demo_access": purchases?.demoProAccess == true]]
        if let first = retained.first { history["history_started_at"] = iso.string(from: first.startedAt) }
        var payload: [String: Any] = [
            "context_revision": contextRevision, "context_generated_at": iso.string(from: now),
            "chat_active_until": chatIsOpen ? iso.string(from: now.addingTimeInterval(90)) : "",
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
            let owner = AssistantAppSession.userID
            BlankSharedState.defaults.set(owner ?? "",forKey:"blankBMBSignalOwner")
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            guard owner == AssistantAppSession.userID, !Task.isCancelled else { return }
            notificationsAuthorized = settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional || settings.authorizationStatus == .ephemeral
            // Observing published changes must not mutate those same publishers.
            // Fresh turn snapshots reconcile native state separately.
            guard let payload = snapshot() else { return }
            let code = BlankSharedState.defaults.string(forKey: "blankAssistantConnectCode") ?? ""
            guard !code.isEmpty, owner != nil else { return }
            var content = payload
            content.removeValue(forKey: "context_revision")
            content.removeValue(forKey: "context_generated_at")
            content.removeValue(forKey: "chat_active_until")
            content["chat_is_open"] = chatIsOpen
            if var history = content["brain_snapshot"] as? [String: Any] {
                history.removeValue(forKey: "generated_at")
                content["brain_snapshot"] = history
            }
            if var presence = content["app_presence"] as? [String: Any] {
                presence.removeValue(forKey: "last_seen_at")
                content["app_presence"] = presence
            }
            content["owner"] = owner
            content["connection"] = code
            guard let digest = try? JSONSerialization.data(withJSONObject: content, options: [.sortedKeys]) else { return }
            guard digest != lastSyncedContent || Date().timeIntervalSince(lastSyncedAt) >= 60 else { return }
            let synced = await AssistantContextSyncClient().sync(connectCode: code, channel: "app", payload: payload)
            guard !Task.isCancelled, owner == AssistantAppSession.userID else { return }
            if synced { lastSyncedContent = digest; lastSyncedAt = Date(); await syncAllSessions(owner: owner) }
        }
    }

    private func syncAllSessions(owner: String?) async {
        guard let owner, owner == AssistantAppSession.userID, let store else { return }
        if archiveOwner != owner { archiveOwner = owner; syncedSessionPages = [:]; syncedSignalIDs = [] }
        let signals = (BlankSharedState.defaults.array(forKey:"blankBMBDeviceSignals") as? [[String: Any]] ?? []).filter { $0["owner"] as? String == owner && !syncedSignalIDs.contains($0["id"] as? String ?? "") }
        if !signals.isEmpty, let data = try? JSONSerialization.data(withJSONObject:["action":"bmb_sync_signals","app_install_id":BlankSharedState.appInstallId,"signals":signals]) {
            if let (_,response) = try? await AssistantAppClient().postAuthorized(path:"assistant-app",payload:data,timeout:8), response.statusCode == 200,
               owner == AssistantAppSession.userID, !Task.isCancelled { syncedSignalIDs.formUnion(signals.compactMap { $0["id"] as? String }) }
        }
        let all = store.brainSessions.sorted { $0.startedAt < $1.startedAt }
        for offset in stride(from: 0, to: all.count, by: 2000) {
            guard owner == AssistantAppSession.userID, !Task.isCancelled else { return }
            let iso = ISO8601DateFormatter()
            let rows: [[String: Any]] = all[offset..<min(offset + 2000, all.count)].map { s in
                var row: [String: Any] = ["id":s.id.uuidString,"started_at":iso.string(from:s.startedAt)]
                if let end = s.endedAt { row["ended_at"] = iso.string(from:end) }
                if let p = s.pauseStartedAt { row["pause_started_at"] = iso.string(from:p) }
                if let p = s.pauseEndedAt { row["pause_ended_at"] = iso.string(from:p) }
                if let reason = s.endedReason { row["ended_reason"] = reason.rawValue }
                if let mode = s.entryMode { row["entry_mode"] = mode.rawValue }
                return row
            }
            guard let digest = try? JSONSerialization.data(withJSONObject:rows,options:[.sortedKeys]) else { return }
            if syncedSessionPages[offset] == digest { continue }
            let payload: [String: Any] = ["action":"bmb_sync_sessions","app_install_id":BlankSharedState.appInstallId,
                "snapshot":["schema_version":1,"generated_at":iso.string(from:Date()),"timezone":TimeZone.current.identifier,
                    "history_complete":all.count<=2000,"sessions":rows]]
            guard let body = try? JSONSerialization.data(withJSONObject:payload) else { return }
            if let (_,response) = try? await AssistantAppClient().postAuthorized(path:"assistant-app",payload:body,timeout:8), response.statusCode == 200,
               owner == AssistantAppSession.userID, !Task.isCancelled { syncedSessionPages[offset] = digest }
        }
    }

    func executeAutonomous(actionID: String? = nil) async -> Bool {
        guard !executionInFlight, let owner = AssistantAppSession.userID else { return false }
        executionInFlight = true
        defer { executionInFlight = false }
        if store == nil {
            backgroundStore = SessionStore(); backgroundBlocker = ScreenTimeBlocker(); backgroundPurchases = StoreKitPurchaseStore()
            configure(store:backgroundStore!,blocker:backgroundBlocker!,purchases:backgroundPurchases!)
        }
        guard let store, let blocker else { return false }
        let code = BlankSharedState.defaults.string(forKey:"blankAssistantConnectCode") ?? ""
        let client = AssistantActionInboxClient(requestTimeout:5)
        if let receipt = AssistantActionReceiptStore.load(), receipt.actionId.hasPrefix("bmb_") {
            let ack = await client.acknowledgeLifecycle(receipt:receipt,connectCode:code,channel:"app")
            if ack == .acknowledged || ack == .stale { AssistantActionReceiptStore.clear(actionId:receipt.actionId) }
            return ack == .acknowledged
        }
        guard case .success(let maybeAction) = await client.poll(connectCode:code,channel:"app"),
              let action = maybeAction, action.autonomous == true, action.id.hasPrefix("bmb_"),
              actionID == nil || actionID == action.id, owner == AssistantAppSession.userID else { return false }
        blocker.refreshAuthorizationStatus()
        guard blocker.authorizationStatus == .approved, store.hasSelectedApps, !store.isVacationModeActive,
              store.schedulePausedUntil.map({ $0 <= Date() }) ?? true else {
            let receipt = AssistantActionReceipt(actionId:action.id,status:"failed",detail:"native_permission_selection_or_pause",executionStarted:false)
            AssistantActionReceiptStore.save(actionId:receipt.actionId,status:receipt.status,detail:receipt.detail,executionStarted:false)
            let ack = await client.acknowledgeLifecycle(receipt:receipt,connectCode:code,channel:"app")
            if ack == .acknowledged || ack == .stale { AssistantActionReceiptStore.clear(actionId:receipt.actionId) }
            return false
        }
        let mark = "blankBMBExecuted.\(owner).\(action.id)"
        guard !BlankSharedState.defaults.bool(forKey:mark) else { return false }
        guard await client.acknowledge(actionId:action.id,status:"confirmed",connectCode:code,channel:"app") == .acknowledged,
              await client.acknowledge(actionId:action.id,status:"execution_started",connectCode:code,channel:"app") == .acknowledged,
              owner == AssistantAppSession.userID else { return false }
        BlankSharedState.defaults.set(true,forKey:mark)
        // Recovery reports uncertainty rather than repeating an interrupted effect.
        AssistantActionReceiptStore.save(actionId:action.id,status:"failed",detail:"execution_interrupted",executionStarted:true)
        await blocker.restore(selection:store.selection)
        guard owner == AssistantAppSession.userID else { return false }
        let iso = ISO8601DateFormatter()
        var receipt: AssistantActionReceipt
        if action.type == "start_protection", let minutes = action.minutes, let requested = action.requestedDate {
            let result = store.applyAssistantProtection(actionId:action.id,requestedAt:requested,durationMinutes:minutes,hardMode:false)
            blocker.updateSelection(store.selection,isBlankActive:store.isBlankActive)
            receipt = AssistantActionReceipt(actionId:action.id,status:result.status,detail:result.detail,executionStarted:true,
                requestedAt:iso.string(from:result.requestedAt),startedAt:iso.string(from:result.startedAt),requestedDurationMinutes:result.requestedDurationMinutes,
                effectiveUntil:result.effectiveUntil.map(iso.string(from:)) ?? "",origin:"assistant_remote",result:result.result,startDelaySeconds:result.startDelaySeconds,mergedWithExisting:result.mergedWithExisting)
        } else if action.type == "set_daily_limit", let minutes = action.minutes {
            store.dailyLimitMinutes = minutes; store.dailyLimitEnabled = true; store.refreshDailyLimitMonitoring()
            receipt = AssistantActionReceipt(actionId:action.id,status:store.dailyLimitRegistered ? "verified":"failed",detail:"daily_limit_native_checked",executionStarted:true)
        } else if action.type == "enable_adult_filter" {
            store.adultContentBlockingEnabled = true
            blocker.updateAdvancedControls(allowOnlyModeEnabled:store.allowOnlyModeEnabled,adultContentBlockingEnabled:true)
            blocker.apply(isBlankActive:store.isBlankActive)
            receipt = AssistantActionReceipt(actionId:action.id,status:"verified",detail:"adult_filter_native_checked",executionStarted:true)
        } else { receipt = AssistantActionReceipt(actionId:action.id,status:"failed",detail:"unsupported_background_action",executionStarted:true) }
        AssistantActionReceiptStore.save(actionId:receipt.actionId,status:receipt.status,detail:receipt.detail,executionStarted:receipt.executionStarted,
            requestedAt:receipt.requestedAt,startedAt:receipt.startedAt,requestedDurationMinutes:receipt.requestedDurationMinutes,
            effectiveUntil:receipt.effectiveUntil,origin:receipt.origin,result:receipt.result,startDelaySeconds:receipt.startDelaySeconds,mergedWithExisting:receipt.mergedWithExisting)
        let ack = await client.acknowledge(actionId:receipt.actionId,status:receipt.status,connectCode:code,channel:"app",detail:receipt.detail,evidence:receipt)
        if ack == .acknowledged || ack == .stale { AssistantActionReceiptStore.clear(actionId:receipt.actionId) }
        sync()
        return ["verified","delayed"].contains(receipt.status)
    }
}
