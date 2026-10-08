"use strict";
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { spawnSync } = require("node:child_process");
const root = path.join(__dirname, "..");
const domain = fs.readFileSync(path.join(root, "ios/Blank/Blank/BlankDomainModels.swift"), "utf8");
const metrics = fs.readFileSync(path.join(root, "ios/Blank/Blank/BlankBrainMetrics.swift"), "utf8");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "blank-demo-"));
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
    let data = SyntheticDemoData(now: now, calendar: calendar)
    check(data.health.count == 14 && data.sessions.count == 14, "14 days expected")
    check(data.events.count == 14, "Missing sample events")
    check(data.sessions.allSatisfy { $0.endedAt! < now && $0.duration > 0 }, "Future or empty session")
    check(data.health.allSatisfy { $0.date <= now && $0.sleepMinutes! > 0 }, "Invalid sample night")
    check(data.health.allSatisfy { $0.deepSleepMinutes! + $0.remSleepMinutes! + $0.coreSleepMinutes! == $0.sleepMinutes! }, "Inconsistent sleep stages")
    let weekly = BlankWeeklySessionAggregator.aggregate(sessions: data.sessions,
        weekStart: BlankWeeklySessionAggregator.startOfWeek(for: now, calendar: calendar), now: now, calendar: calendar)
    check(weekly.totalFocusTime > 0 && weekly.completedSessionCount > 0, "Empty current week")
    check(weekly.estimatedTimeSaved <= weekly.totalFocusTime, "Recovered time exceeds protection")
    check(NSDictionary(dictionary: before).isEqual(to: UserDefaults.standard.dictionaryRepresentation()), "Demo persisted data")
}
print("Synthetic demo: 14 nights, stage totals, current week, midnight/DST and no persistence passed")
`;
try {
    const source = path.join(directory, "main.swift"), binary = path.join(directory, "tests");
    fs.writeFileSync(source, domain.slice(0, domain.indexOf("struct DigitalWellnessPlanItem")) + "\n" + metrics + "\n" + test);
    const compile = spawnSync("swiftc", ["-swift-version", "5", source, "-o", binary], { encoding: "utf8" });
    if (compile.error || compile.status !== 0) throw new Error(compile.stderr || compile.error?.message || "Swift compilation failed");
    const result = spawnSync(binary, [], { encoding: "utf8" });
    process.stdout.write(result.stdout || "");
    if (result.status !== 0) throw new Error(result.stderr || "Synthetic demo failed");
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
