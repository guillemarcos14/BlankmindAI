import Foundation

func check(_ value: Bool, _ message: String) { if !value { fatalError(message) } }
let now = ISO8601DateFormatter().date(from: "2026-10-15T08:00:00Z")!
var row: [String: Any] = ["owner":"A","source":"native_schedule_shield","uncertain":false,
    "started_at":"2026-10-15T06:00:00Z","ended_at":"2026-10-15T07:00:00Z",
    "plan":["start_minute":360,"end_minute":420,"timezone":"UTC"]]
check(FunnelPolicy.completedBlock(row,owner:"A",now:now),"Actual full interval counts")
check(!FunnelPolicy.completedBlock(row,owner:"B",now:now),"No cross-account blocks")
check(FunnelPolicy.completedBlock(row.merging(["started_at":"2026-10-15T06:30:00Z"],uniquingKeysWith:{$1}),owner:"A",now:now),"A real late start that reaches the planned end can complete")
for patch in [["uncertain":true], ["ended_at":"2026-10-15T06:10:00Z"], ["ended_at":"2026-10-15T09:00:00Z"], ["source":"scheduled"]] as [[String:Any]] {
    check(!FunnelPolicy.completedBlock(row.merging(patch,uniquingKeysWith:{$1}),owner:"A",now:now),"No early, uncertain, future or scheduled completion")
}
row.removeValue(forKey:"ended_at")
check(!FunnelPolicy.completedBlock(row,owner:"A",now:now),"Active does not mean completed")
check(FunnelPolicy.canConverse(implemented:false,premium:false),"Free configuration has no counter cutoff")
check(!FunnelPolicy.canConverse(implemented:true,premium:false),"Ongoing conversation requires premium")
check(FunnelPolicy.canConverse(implemented:true,premium:true),"Paid conversation is unlimited")
check(FunnelPolicy.offerSummary(completed:true,active:false,premium:false,seen:false),"First reopening offers free summary")
check(!FunnelPolicy.offerSummary(completed:false,active:false,premium:false,seen:false),"Scheduled only never triggers summary")
check(!FunnelPolicy.offerSummary(completed:true,active:true,premium:false,seen:false),"No interruption during active protection")
check(!FunnelPolicy.offerSummary(completed:true,active:false,premium:false,seen:true),"Dismissal prevents repetitive promotion")
print("PASS native funnel: completed versus scheduled/active, real evidence, account isolation, free initial conversation and non-repetitive summary")
let suite = "funnel-test-" + UUID().uuidString
let defaults = UserDefaults(suiteName: suite)!
let free = UUID(), other = UUID()
defaults.set("A", forKey: "blankBMBSignalOwner")
defaults.set(free.uuidString, forKey: "funnel.window.A")
check(BlankSharedState.commercialWindowAllowed(free, defaults: defaults, now: now), "Free window never expires")
check(!BlankSharedState.commercialWindowAllowed(other, defaults: defaults, now: now), "Additional window requires real entitlement")
defaults.set(now.addingTimeInterval(600).timeIntervalSince1970, forKey: "funnel.premiumUntil.A")
check(BlankSharedState.commercialWindowAllowed(other, defaults: defaults, now: now), "Paid extension window is allowed")
check(!BlankSharedState.commercialWindowAllowed(other, defaults: defaults, now: now.addingTimeInterval(601)), "Expired premium cannot start new windows while the app is closed")
defaults.set("B", forKey: "blankBMBSignalOwner")
check(!BlankSharedState.commercialWindowAllowed(free, defaults: defaults, now: now), "Account switch cannot inherit free/premium window")
defaults.removePersistentDomain(forName: suite)
