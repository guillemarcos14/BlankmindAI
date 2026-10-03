// Tests execute production window models, extension predicate, interval generation
// and selection observer. Only Apple-only persistence/monitor effects are fixtures.
private func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() { fatalError(message) }
}

@main
struct ProtectionTests {
    static func main() throws {
        expect(UnblankHoldCadence.pulseTimes(duration: 20) == [0, 1, 3, 6, 10, 15], "Hold pulses must slow down without changing the 20-second hold")
        expect(UnblankHoldCadence.pulseTimes(duration: 25) == [0, 1, 3, 6, 10, 15, 21], "Intervals must increase by one second")
        expect(UnblankHoldCadence.pulseTimes(duration: 0).isEmpty, "Inactive hold must not vibrate")
        expect(UnblankHoldCadence.pulseTimes(duration: .infinity).isEmpty, "Reject unbounded cadence")
        let precise = InboxDateFixture(requestedAt: "2026-10-01T12:00:00.123Z").requestedDate
        let wholeSecond = InboxDateFixture(requestedAt: "2026-10-01T12:00:00Z").requestedDate
        expect(precise != nil && wholeSecond != nil, "Server milliseconds must not prevent native blocking")
        expect(abs(precise!.timeIntervalSince(wholeSecond!) - 0.123) < 0.001, "Preserve the action's exact start time")
        expect(InboxDateFixture(requestedAt: "invalid").requestedDate == nil, "Reject malformed server dates")
        expect(InboxDateFixture(requestedAt: nil).requestedDate == nil, "Reject missing action metadata")
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        func date(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
            calendar.date(from: DateComponents(year: 2026, month: 9, day: day, hour: hour, minute: minute))!
        }
        let work = BlankHabitWindow(name: "Work", startMinute: 9 * 60, endMinute: 17 * 60, weekdays: [2, 3, 4, 5, 6])
        expect(work.contains(date(25, 10), calendar: calendar), "Friday work window missing")
        expect(!work.contains(date(26, 10), calendar: calendar), "Weekday window incorrectly blocks Saturday")
        expect(!work.contains(date(25, 17), calendar: calendar), "Window end must be exclusive")
        expect(DeviceActivityTimerScheduler.recurringIntervals(for: work).count == 1, "Weekday windows need a native interval")

        let night = BlankHabitWindow(name: "Friday night", startMinute: 23 * 60, endMinute: 7 * 60, weekdays: [6])
        expect(night.contains(date(25, 23, 30), calendar: calendar), "Friday night start missing")
        expect(night.contains(date(26, 6), calendar: calendar), "Overnight window must use its start weekday")
        expect(!night.contains(date(26, 23, 30), calendar: calendar), "Saturday must not start Friday's window")
        expect(!night.contains(date(26, 7), calendar: calendar), "Overnight end must be exclusive")
        expect(DeviceActivityTimerScheduler.recurringIntervals(for: night).count == 2, "Overnight monitor needs both sides of midnight")

        let once = BlankHabitWindow(name:"Tonight",startMinute:1350,endMinute:420,expiresAt:date(26,7),
            startsAt:date(25,22,30),endsAt:date(26,7),timeZoneIdentifier:"UTC")
        expect(!once.contains(date(25,22,29),calendar:calendar),"Once block started early")
        expect(once.contains(date(26,6),calendar:calendar),"Once block lost its overnight end")
        expect(!once.contains(date(26,7),calendar:calendar),"Once block end is inclusive")
        expect(!once.contains(date(26,23),calendar:calendar),"Once block silently recurred")
        let onceRestored = try JSONDecoder().decode(BlankHabitWindow.self,from:JSONEncoder().encode(once))
        expect(onceRestored.startsAt == once.startsAt && onceRestored.endsAt == once.endsAt && onceRestored.timeZoneIdentifier == "UTC","Once scope lost on relaunch")
        let extensionOnce = try JSONDecoder().decode(StoredWindow.self,from:JSONEncoder().encode(once))
        expect(extensionOnce.contains(date(26,6),calendar:calendar) && !extensionOnce.contains(date(26,23),calendar:calendar),"Extension changed once scope")
        let madrid = BlankHabitWindow(name:"Madrid",startMinute:9*60,endMinute:10*60,weekdays:[6],timeZoneIdentifier:"Europe/Madrid")
        expect(madrid.contains(date(25,7,30),calendar:calendar) && !madrid.contains(date(25,9,30),calendar:calendar),"Recurring schedule lost its own timezone")
        let continuous = try JSONDecoder().decode(BlankHabitWindow.self,from:JSONEncoder().encode(madrid))
        expect(continuous.expiresAt == nil && continuous.timeZoneIdentifier == "Europe/Madrid","Continuous horizon acquired an expiry")
        let overnightMadrid = BlankHabitWindow(name:"Madrid night",startMinute:1350,endMinute:420,timeZoneIdentifier:"Europe/Madrid")
        let deadline = ScheduleEndFixture(BlankFocusSchedule(enabled:true,windows:[overnightMadrid]))
        let iso = ISO8601DateFormatter()
        expect(deadline.scheduleEndDate(containing:iso.date(from:"2027-03-28T04:00:00Z")!,calendar:calendar) == iso.date(from:"2027-03-28T05:00:00Z"),"Spring DST moved the 07:00 deadline")
        expect(deadline.scheduleEndDate(containing:iso.date(from:"2026-10-25T04:00:00Z")!,calendar:calendar) == iso.date(from:"2026-10-25T06:00:00Z"),"Fall DST moved the 07:00 deadline")
        expect(ScheduleEndFixture(BlankFocusSchedule(enabled:true,windows:[once])).scheduleEndDate(containing:date(26,6),calendar:calendar) == once.endsAt,"Once deadline reconstructed from today's clock")

        var expiring = work
        expiring.expiresAt = date(25, 12)
        expect(expiring.contains(date(25, 11), calendar: calendar), "Expiry shortened a live window")
        expect(!expiring.contains(date(25, 12), calendar: calendar), "Expired window remains active")
        let overlap = BlankFocusSchedule(enabled: true, windows: [expiring, work])
        expect(overlap.contains(date(25, 13), calendar: calendar), "One expired window unlocked an overlapping live window")

        // The independently compiled extension must agree with app calendar rules.
        for window in [work, night, expiring] {
            let data = try JSONEncoder().encode(window)
            let extensionWindow = try JSONDecoder().decode(StoredWindow.self, from: data)
            for day in 20...28 {
                for hour in 0...23 {
                    let instant = date(day, hour)
                    expect(window.contains(instant, calendar: calendar) == extensionWindow.contains(instant, calendar: calendar), "App and extension disagree at \(instant)")
                }
            }
        }
        let legacy = Data(#"{"name":"Legacy","enabled":true,"startMinute":540,"endMinute":1020,"weekdays":[2,3,4,5,6]}"#.utf8)
        let restored = try JSONDecoder().decode(BlankHabitWindow.self, from: legacy)
        expect(restored.expiresAt == nil && restored.weekdays == work.weekdays, "Installed schedule lost backwards compatibility")
        let roundTrip = try JSONDecoder().decode(BlankHabitWindow.self, from: JSONEncoder().encode(expiring))
        expect(roundTrip.expiresAt == expiring.expiresAt && roundTrip.id == expiring.id, "Window expiry or identity lost during persistence")

        let state = SelectionFixture()
        state.isBlankActive = true
        state.selection = 2
        expect(state.selection == 1 && state.saved == 0, "Open picker changed active protection")
        state.isBlankActive = false
        BlankSharedState.sharedActive = true
        state.selection = 2
        expect(state.selection == 1, "Widget protection bypassed selection lock")
        BlankSharedState.sharedActive = false
        DeviceActivityTimerScheduler.hasIndependentProtection = true
        state.selection = 2
        expect(state.selection == 1 && state.limits == 0, "Scheduled or daily-limit shield bypassed selection lock")
        DeviceActivityTimerScheduler.hasIndependentProtection = false
        state.selection = 2
        expect(state.selection == 2 && state.saved == 1 && state.schedules == 1 && state.limits == 1, "Legal selection must update every monitor")
        state.selection = 2
        expect(state.saved == 1, "Equivalent selection update should be inert")
        let identity = IdentityFixture()
        expect(identity.matches(code: "code-A", channel: "app", owner: "account-A"), "The app channel matches its account identity")
        identity.assistantConnectCode = "code-B"
        expect(!identity.matches(code: "code-A", channel: "app", owner: "account-A"), "An old connection's poll must not execute after linking a new account")
        identity.assistantConnectCode = "code-A"
        AssistantAppSession.userID = "account-B"
        expect(!identity.matches(code: "code-A", channel: "app", owner: "account-A"), "Changed account accepted a stale action")
        AssistantAppSession.userID = "account-A"
        expect(!identity.matches(code: "code-A", channel: "whatsapp", owner: "account-A"), "External channel accepted an app action")
        let requestedSchedule = PendingPlanSchedule(name: "Work", startMinute: 540, endMinute: 600, weekdays: [2], durationDays: 7)
        let activatingActions: [AssistantPendingAction] = [
            .startProtection(minutes: 30, hardMode: false, appNames: []),
            .setDailyLimit(minutes: 20, appNames: []), .allowOnly, .adultFilter,
            .applySchedule(name: "Work", startMinute: 540, endMinute: 600, weekdays: [2], durationDays: 7, appNames: []),
            .updateSchedule(windowId: "window", name: "Work", startMinute: 540, endMinute: 600, weekdays: [2]),
            .disablePause, .applyAIPlan, .openAppPicker(appNames: []),
            .configureAndOpenAppPicker(appNames: [], durationMinutes: 30, hardMode: false, schedule: nil),
            .configureAndOpenAppPicker(appNames: [], durationMinutes: nil, hardMode: false, schedule: requestedSchedule),
            .configureAndOpenDailyLimitPicker(appNames: [], minutes: 20)
        ]
        for action in activatingActions {
            expect(identity.requiresPermission(action), "Protection or picker escaped Screen Time permission preflight: \(action)")
        }
        let nonActivatingActions: [AssistantPendingAction] = [.deleteSchedule(windowId: "window"), .deleteAllSchedules, .pauseRules(hours: 1), .requestScreenTimePermission]
        for action in nonActivatingActions {
            expect(!identity.requiresPermission(action), "Removal or permission-only action must not enter protection preflight twice")
        }
        let suite = "blank-manual-unlock-tests-\(UUID().uuidString)"
        let unlockDefaults = UserDefaults(suiteName: suite)!
        defer { unlockDefaults.removePersistentDomain(forName: suite) }
        let startedAt = date(20, 9)
        let firstLaunch = ManualUnlockFixture(defaults: unlockDefaults, startedAt: startedAt)
        firstLaunch.scheduleManualUnlock(after: 60, now: startedAt)
        firstLaunch.scheduleManualUnlock(after: 60, now: startedAt.addingTimeInterval(30))
        expect(firstLaunch.delayedManualUnlockAt == startedAt.addingTimeInterval(60), "Repeated request restarted cooldown")
        let reopened = ManualUnlockFixture(defaults: unlockDefaults, startedAt: startedAt)
        expect(!reopened.finishManualUnlockIfDue(now: startedAt.addingTimeInterval(59)), "Reopened app unlocked before deadline")
        expect(reopened.finishManualUnlockIfDue(now: startedAt.addingTimeInterval(90)), "Closed-app elapsed time was lost")
        expect(!reopened.finishManualUnlockIfDue(now: startedAt.addingTimeInterval(91)) && reopened.unlocks == 1, "Unlock executed twice")
        let next = ManualUnlockFixture(defaults: unlockDefaults, startedAt: startedAt)
        next.scheduleManualUnlock(after: 60, now: startedAt)
        let replacement = ManualUnlockFixture(defaults: unlockDefaults, startedAt: startedAt.addingTimeInterval(30))
        expect(!replacement.finishManualUnlockIfDue(now: startedAt.addingTimeInterval(90)) && replacement.delayedManualUnlockAt == nil, "Old cooldown unlocked a different session")
        replacement.hardBlankActive = true
        replacement.scheduleManualUnlock(after: 0, now: startedAt)
        expect(replacement.delayedManualUnlockAt == nil, "Hard protection accepted manual unlock")
        replacement.hardBlankActive = false
        replacement.scheduleManualUnlock(after: 60, now: startedAt)
        replacement.cancelManualUnlock()
        expect(unlockDefaults.object(forKey: "blankManualUnlockAt") == nil && !replacement.finishManualUnlockIfDue(now: startedAt.addingTimeInterval(90)), "Cancelled cooldown survived restart")
        print("iOS protection: schedule parity, selection locking, persistent manual unlock/restart/expiry/cancellation/session identity passed")
    }
}
