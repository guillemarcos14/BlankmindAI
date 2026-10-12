@main struct WidgetControlTests {
    static func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
        if !condition() { fatalError(message) }
    }
    static func main() throws {
        let name = "blank-widget-tests-\(UUID().uuidString)"
        let d = UserDefaults(suiteName: name)!
        defer { d.removePersistentDomain(forName: name) }
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        expect(!BlankSharedState.startQuickBlock(defaults: d, now: start), "No selection must fail closed")
        var selection = FamilyActivitySelection(); selection.applicationTokens = ["instagram"]
        d.set(try JSONEncoder().encode(selection), forKey: BlankSharedState.Keys.selection)
        expect(BlankSharedState.startQuickBlock(defaults: d, now: start), "Configured quick block starts")
        expect(!BlankSharedState.startQuickBlock(defaults: d, now: start.addingTimeInterval(1)), "Repeated start must not replace session")
        d.set(true, forKey: "blankHardBlankActive")
        expect(BlankSharedState.requestWidgetUnlock(defaults: d, now: start) == nil, "Hard protection cannot unlock")
        d.set(false, forKey: "blankHardBlankActive")
        let deadline = BlankSharedState.requestWidgetUnlock(defaults: d, now: start)!
        expect(deadline == start.addingTimeInterval(60), "Exact 60-second deadline")
        expect(BlankSharedState.requestWidgetUnlock(defaults: d, now: start.addingTimeInterval(10)) == deadline, "Repeated tap must not extend deadline")
        let reopened = UserDefaults(suiteName: name)!
        expect(BlankSharedState.widgetUnlockDeadline(defaults: reopened) == deadline, "Deadline survives process restart")
        expect(!BlankSharedState.finishWidgetUnlockIfDue(defaults: d, now: deadline.addingTimeInterval(-1)), "Never release early")
        expect(d.bool(forKey: BlankSharedState.Keys.isBlankActive), "Protection stays on during cooldown")
        // Simulate a newer block while the old monitor callback is queued.
        d.set(start.addingTimeInterval(30).timeIntervalSince1970, forKey: BlankSharedState.Keys.blankActiveSince)
        expect(!BlankSharedState.finishWidgetUnlockIfDue(defaults: d, now: deadline), "Old callback cannot unlock newer block")
        expect(d.object(forKey: BlankSharedState.Keys.widgetUnlockAt) == nil, "Stale request cannot revive later")
        d.set(start.timeIntervalSince1970, forKey: BlankSharedState.Keys.blankActiveSince)
        _ = BlankSharedState.requestWidgetUnlock(defaults: d, now: start)
        expect(BlankSharedState.finishWidgetUnlockIfDue(defaults: d, now: deadline), "Due deadline releases original session")
        expect(!BlankSharedState.finishWidgetUnlockIfDue(defaults: d, now: deadline), "Callback replay is idempotent")
        expect(!d.bool(forKey: BlankSharedState.Keys.isBlankActive), "Shared protection becomes inactive")
        let sessions = try JSONDecoder().decode([BlankSession].self, from: d.data(forKey: BlankSharedState.Keys.sessions)!)
        expect(sessions.count == 1 && sessions[0].endedReason == .control, "Regular widget unlock consumes no emergency or relapse")
        expect(!BlankSharedState.startQuickBlock(defaults: d, now: deadline.addingTimeInterval(59)), "Persisted reblock cooldown remains enforced")
        expect(BlankSharedState.startQuickBlock(defaults: d, now: deadline.addingTimeInterval(60)), "Reblock resumes at deadline")
        let next = deadline.addingTimeInterval(60)
        d.set(next.addingTimeInterval(10).timeIntervalSince1970, forKey: BlankSharedState.Keys.blankActiveUntil)
        _ = BlankSharedState.requestWidgetUnlock(defaults: d, now: next)
        expect(BlankSharedState.finishWidgetUnlockIfDue(defaults: d, now: next.addingTimeInterval(60)), "Earlier timed expiry wins")
        expect(BlankSharedState.widgetUnlockDeadline(defaults: d) == nil, "Expired sessions clear pending unlock")
        print("Widget cooldown: configuration, duplicate tap, hard protection, persistence, early release, session ownership, replay, metrics and reblock passed")
    }
}
