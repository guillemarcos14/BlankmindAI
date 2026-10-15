import Foundation

func check(_ value: Bool, _ message: String) { if !value { fatalError(message) } }
let now = ISO8601DateFormatter().date(from: "2026-10-15T08:00:00Z")!
let terms: [String:[String:Any]] = ["monthly":["period_unit":"month","period_value":1,"free_trial_days":3], "annual":["period_unit":"year","period_value":1,"free_trial_days":3]]
check(FunnelPolicy.approvedProduct(id:"monthly",periodUnit:"month",periodValue:1,actualTrialDays:3,terms:terms),"Approved monthly subscription with actual three-day trial can load")
check(FunnelPolicy.approvedProduct(id:"annual",periodUnit:"year",periodValue:1,actualTrialDays:nil,terms:terms),"Annual base price remains available when Apple returns no introductory offer")
check(!FunnelPolicy.approvedProduct(id:"monthly",periodUnit:"year",periodValue:1,actualTrialDays:3,terms:terms),"Do not sell an unexpected billing period")
check(!FunnelPolicy.approvedProduct(id:"annual",periodUnit:"year",periodValue:1,actualTrialDays:30,terms:terms),"Do not inherit a different trial")
check(!FunnelPolicy.approvedProduct(id:"unknown",periodUnit:"month",periodValue:1,actualTrialDays:3,terms:terms),"Unapproved products stay unavailable")
check(FunnelPolicy.purchaseTerms(price:"2,99 €",period:"month",eligibleTrialDays:3)=="3 days free, then 2,99 € / month · auto-renews","Eligible offer includes actual localized renewal price")
check(FunnelPolicy.purchaseTerms(price:"$19.99",period:"year",eligibleTrialDays:nil)=="$19.99 / year · auto-renews","Ineligible accounts are never promised a free trial")
var row: [String: Any] = ["owner":"A","source":"native_schedule_shield","uncertain":false,
    "started_at":"2026-10-15T06:00:00Z","ended_at":"2026-10-15T07:00:00Z",
    "plan":["start_minute":360,"end_minute":420,"timezone":"UTC"]]
check(FunnelPolicy.completedBlock(row,owner:"A",now:now),"Actual full interval counts")
check(!FunnelPolicy.completedBlock(row,owner:"B",now:now),"No cross-account blocks")
check(FunnelPolicy.completedBlock(row.merging(["started_at":"2026-10-15T06:30:00Z"],uniquingKeysWith:{$1}),owner:"A",now:now),"A real late start that reaches the planned end can complete")
for patch in [["uncertain":true], ["ended_at":"2026-10-15T06:10:00Z"], ["ended_at":"2026-10-15T06:59:59Z"], ["ended_at":"2026-10-15T09:00:00Z"], ["source":"scheduled"]] as [[String:Any]] {
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
let deleted = UUID()
check(FunnelPolicy.freeWindowID(stored: deleted, windows: [free]) == free, "Reopening after deleting and recreating the free window cannot disable its replacement")
check(FunnelPolicy.freeWindowID(stored: free, windows: [other, free]) == free, "An existing free slot is preserved when extra windows are present")
check(FunnelPolicy.freeWindowID(stored: free, windows: []) == nil, "No window is fabricated after deletion")
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
