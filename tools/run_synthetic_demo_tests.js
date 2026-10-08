"use strict";
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { spawnSync } = require("node:child_process");
const root = path.join(__dirname, "..");
const domain = fs.readFileSync(path.join(root, "ios/Blank/Blank/BlankDomainModels.swift"), "utf8");
const metrics = fs.readFileSync(path.join(root, "ios/Blank/Blank/BlankBrainMetrics.swift"), "utf8");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "blank-demo-"));
const assert = require("node:assert/strict");
const { normalizeUserContext } = require("../netlify/functions/bm-context");
const context = normalizeUserContext({ sleep_data_available: true, sleep_minutes: 425,
    health_signal_reasons: "Sleep is synthetic QA data; activity, permissions and protection are real.",
    personal_profile: { sleep_source: "synthetic_qa", sleep_is_synthetic: true, sleep_nights: [{date: "2026-10-08", sleep_minutes: 425, source: "synthetic_qa"}] } });
assert.equal(context.personal_profile.sleep_source, "synthetic_qa");
assert.equal(context.personal_profile.sleep_is_synthetic, true);
assert.match(context.health_signal_reasons, /synthetic/);
const { personalContextView } = require("../netlify/functions/bm-personal-context-view");
assert.equal(personalContextView(context).person.goals_and_preferences.sleep_nights[0].source, "synthetic_qa");
const read = name => fs.readFileSync(path.join(root, "ios/Blank/Blank/" + name), "utf8");
assert.doesNotMatch(read("ContentView.swift"), /SyntheticDemoView/);
assert.doesNotMatch(read("ReportView.swift"), /demoData|reportSessions|reportEvents/);
assert.doesNotMatch(read("SetupView.swift"), /fullScreenCover|showingSyntheticDemo/);
for (const name of ["ContentView.swift", "HomeView.swift", "ReportView.swift"]) assert.match(read(name), /HealthKitStore.shared/);
assert.match(read("HealthKitStore.swift"), /self.refreshRequestID == requestID, owner == AssistantAppSession.userID/);
assert.match(read("HealthKitStore.swift"), /self.sourceGeneration == generation/);
assert.match(read("BlankBrain.swift"), /health.sleepProvenance/);
assert.match(read("SetupView.swift"), /postAssistantChannel\("complete_onboarding"\)/);
const test = `
enum BlankSharedState { static let defaults = UserDefaults.standard }
func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() { fatalError(message) }
}
var calendar = Calendar(identifier: .gregorian)
calendar.timeZone = TimeZone(identifier: "Europe/Madrid")!
let formatter = ISO8601DateFormatter()
for timestamp in ["2026-10-08T10:00:00Z", "2026-10-07T22:00:01Z", "2026-10-25T00:00:01Z", "2026-03-29T01:00:01Z"] {
    let now = formatter.date(from: timestamp)!
    let before = UserDefaults.standard.dictionaryRepresentation()
    let data = SyntheticSleepSource.applying(to: [], now: now, calendar: calendar)
    check(data.count == 14, "14 completed nights expected")
    check(data.allSatisfy { $0.date <= now && $0.sleepMinutes! > 0 }, "Invalid night")
    check(data.allSatisfy { calendar.date(bySettingHour: 7, minute: 30, second: 0, of: $0.date)! <= now }, "Future wake")
    check(data.allSatisfy { $0.deepSleepMinutes! + $0.remSleepMinutes! + $0.coreSleepMinutes! == $0.sleepMinutes! }, "Stage totals")
    check(data.allSatisfy { $0.steps == nil && $0.workoutMinutes == nil && $0.restingHeartRate == nil && $0.hrvSDNN == nil }, "Invented activity")
    check(NSDictionary(dictionary: before).isEqual(to: UserDefaults.standard.dictionaryRepresentation()), "Generated sleep persisted")
    var real = HealthDaySummary(date: data.last!.date)
    real.steps = 1234; real.workoutMinutes = 17; real.restingHeartRate = 62; real.hrvSDNN = 37
    real.sleepMinutes = 999; real.deepSleepMinutes = 998
    let merged = SyntheticSleepSource.applying(to: [real], now: now, calendar: calendar).last!
    check(merged.steps == 1234 && merged.workoutMinutes == 17 && merged.restingHeartRate == 62 && merged.hrvSDNN == 37, "Real metrics changed")
    check(merged.sleepMinutes != 999 && merged.deepSleepMinutes == 75, "Mixed sleep sources")
    var stale = real; stale.date = calendar.date(byAdding: .day, value: -40, to: real.date)!
    let older = SyntheticSleepSource.applying(to: [stale], now: now, calendar: calendar).first!
    check(older.sleepMinutes == nil && older.deepSleepMinutes == nil && older.steps == 1234, "Old measured sleep mixed in")
}
let suite = "sleep-source-" + UUID().uuidString
check(SyntheticSleepSource.allowsDistributedSource(privateQA: true, receiptName: "sandboxReceipt"), "Private TestFlight unavailable")
for receipt in [nil, "receipt", "sandboxReceipt"] as [String?] {
    check(!SyntheticSleepSource.allowsDistributedSource(privateQA: false, receiptName: receipt), "Public build enabled synthetic sleep")
}
check(!SyntheticSleepSource.allowsDistributedSource(privateQA: true, receiptName: "receipt"), "Public receipt enabled synthetic sleep")
check(!SyntheticSleepSource.allowsDistributedSource(privateQA: true, receiptName: nil), "Missing receipt enabled synthetic sleep")
let defaults = UserDefaults(suiteName: suite)!
SyntheticSleepSource.setEnabled(true, owner: "A", defaults: defaults)
check(SyntheticSleepSource.enabled(owner: "A", defaults: defaults) == SyntheticSleepSource.allowed, "Owner setting")
check(!SyntheticSleepSource.enabled(owner: "B", defaults: defaults), "Account leaked")
check(!SyntheticSleepSource.enabled(owner: nil, defaults: defaults), "Guest leaked")
SyntheticSleepSource.setEnabled(false, owner: "A", defaults: defaults)
check(!SyntheticSleepSource.enabled(owner: "A", defaults: defaults), "Disable failed")
defaults.removePersistentDomain(forName: suite)
print("Sleep source: completed nights/DST, real activity, exclusive source, account scope and release gating passed")
`;

try {
    const source = path.join(directory, "main.swift"), binary = path.join(directory, "tests");
    fs.writeFileSync(source, domain.slice(0, domain.indexOf("struct DigitalWellnessPlanItem")) + "\n" + metrics + "\n" + test);
    for (const flags of [["-D", "DEBUG"], ["-D", "BLANK_PRIVATE_STAGE_QA"], []]) {
    const compile = spawnSync("swiftc", ["-swift-version", "5", ...flags, source, "-o", binary], { encoding: "utf8" });
    if (compile.error || compile.status !== 0) throw new Error(compile.stderr || compile.error?.message || "Swift compilation failed");
    const result = spawnSync(binary, [], { encoding: "utf8" });
    process.stdout.write(result.stdout || "");
    if (result.status !== 0) throw new Error(result.stderr || "Synthetic sleep failed");
    }
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
