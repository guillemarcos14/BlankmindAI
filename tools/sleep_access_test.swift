import Foundation

func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() { fatalError(message) }
}
@main struct SleepAccessTests {
    static func main() {
let now = Date(timeIntervalSince1970: 1_790_000_000)
func observation(age: TimeInterval = 86400, duration: TimeInterval = 7 * 3600,
                 asleep: Bool = true, manual: Bool = false, watch: Bool = true) -> SleepAccessObservation {
    SleepAccessObservation(start: now.addingTimeInterval(-age - duration), end: now.addingTimeInterval(-age),
        source: "fixture", isAppleWatch: watch, isAsleep: asleep, manuallyEntered: manual)
}
check(SleepAccessPolicy.usable([], now: now).isEmpty, "No observations must remain unavailable")
check(SleepAccessPolicy.usable([observation(asleep: false)], now: now).isEmpty, "In-bed or awake is not recorded sleep")
check(SleepAccessPolicy.usable([observation(manual: true)], now: now).isEmpty, "Manual records cannot establish wearable sleep")
check(SleepAccessPolicy.usable([observation(age: 30 * 86400)], now: now).isEmpty, "Old history must not unlock access")
check(SleepAccessPolicy.usable([observation(age: -86400)], now: now).isEmpty, "Future records must not unlock access")
check(SleepAccessPolicy.usable([observation(duration: 0), observation(duration: -1)], now: now).isEmpty, "Invalid intervals")
check(SleepAccessPolicy.usable([observation()], now: now).count == 1, "Recorded Watch sleep unlocks data availability")
check(SleepAccessPolicy.usable([observation(watch: false)], now: now).count == 1, "Other measured sleep sources remain usable")
for state in [SleepAccessStatus.unchecked, .checking, .noData, .failed("Locked")] {
    check(!SleepAccessPolicy.canEnter(screenTimeApproved: true, sleep: state), "Unverified or unavailable data cannot unlock Home")
}
check(!SleepAccessPolicy.canEnter(screenTimeApproved: false, sleep: .available), "Health cannot replace Screen Time")
check(SleepAccessPolicy.canEnter(screenTimeApproved: true, sleep: .available), "Apps and notifications are not entry requirements")
print("Sleep access: recorded data, absence, manual/stale/future intervals and both mandatory gates passed")

    }
}
