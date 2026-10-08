import Foundation

func check(_ value: @autoclosure () -> Bool, _ message: String) {
    if !value() { fatalError(message) }
}
var calendar = Calendar(identifier: .gregorian)
calendar.timeZone = TimeZone(identifier: "Europe/Madrid")!
let iso = ISO8601DateFormatter()
func date(_ value: String) -> Date { iso.date(from: value)! }
let now = date("2026-10-08T10:00:00Z")
let start = date("2026-10-07T21:30:00Z"), end = date("2026-10-08T05:30:00Z")
let rows = [
    RestSleepObservation(start: start, end: end, value: 1, source: "watch", manual: false),
    RestSleepObservation(start: start, end: end, value: 3, source: "watch", manual: false),
    RestSleepObservation(start: start, end: end, value: 3, source: "watch", manual: false),
    RestSleepObservation(start: start, end: end, value: 1, source: "ring", manual: false),
    RestSleepObservation(start: start, end: end, value: 1, source: "manual", manual: true),
    RestSleepObservation(start: start, end: end.addingTimeInterval(90000), value: 1, source: "future", manual: false)
]
let nights = RestNight.build(rows, now: now, calendar: calendar)
check(nights.count == 1, "Duplicate providers created extra nights")
check(nights[0].sleepMinutes == 480 && nights[0].stageMinutes[3] == 480, "Overlapping stages or unspecified sleep double counted")
check(nights[0].date == calendar.startOfDay(for: end), "Sleep assigned to bedtime instead of wake date")
check(nights[0].source == "watch" && !nights[0].manual, "Manual or less detailed source preferred")
check(nights[0].awakeMinutes == nil, "Missing awake data became zero")
let nap = RestSleepObservation(start: end.addingTimeInterval(5 * 3600), end: end.addingTimeInterval(6 * 3600), value: 1, source: "watch", manual: false)
check(RestNight.build(rows + [nap], now: now, calendar: calendar)[0].sleepMinutes == 480, "Nap inflated main sleep episode")
for pair in [("2026-10-24T21:00:00Z", "2026-10-25T07:00:00Z", 600.0),
             ("2026-03-28T22:00:00Z", "2026-03-29T06:00:00Z", 480.0)] {
    let a = date(pair.0), b = date(pair.1)
    let night = RestNight.build([RestSleepObservation(start: a, end: b, value: 1, source: "watch", manual: false)], now: b, calendar: calendar)[0]
    check(night.sleepMinutes == pair.2, "DST sleep used wall-clock hours")
}
let suite = "rest-progress-" + UUID().uuidString, owner = "A"
let defaults = UserDefaults(suiteName: suite)!
check(!RestCheckInRepository.save(score: 4, owner: nil, defaults: defaults, now: now, calendar: calendar), "Guest check-in persisted")
check(!RestCheckInRepository.save(score: 6, owner: owner, defaults: defaults, now: now, calendar: calendar), "Invalid score persisted")
check(RestCheckInRepository.save(score: 3, owner: owner, defaults: defaults, now: now, calendar: calendar), "Save failed")
check(RestCheckInRepository.save(score: 5, owner: owner, defaults: defaults, now: now, calendar: calendar), "Update failed")
let saved = RestCheckInRepository.load(owner: owner, defaults: defaults, now: now)
check(saved.count == 1 && saved[0].score == 5, "Same-day update duplicated rating")
check(RestCheckInRepository.load(owner: "B", defaults: defaults, now: now).isEmpty, "Rating leaked across accounts")
RestCheckInRepository.delete(owner: owner, defaults: defaults)
check(RestCheckInRepository.load(owner: owner, defaults: defaults, now: now).isEmpty, "Account deletion retained ratings")
defaults.removePersistentDomain(forName: suite)
let empty = RestProgressSnapshot.make(nights: [], checkIns: [], now: now, calendar: calendar)
check(empty.restChange == nil && empty.chartValue(day: empty.days[0], metric: .duration) == nil, "Missing data became improvement or zero")
let ratings = (0..<35).map { offset -> RestCheckIn in
    let day = calendar.date(byAdding: .day, value: -offset, to: now)!
    return RestCheckIn(day: RestCheckInRepository.dayKey(day, calendar: calendar), recordedAt: day, score: offset < 7 ? 4 : 3)
}
let snap = RestProgressSnapshot.make(nights: nights, checkIns: ratings, now: now, calendar: calendar)
check(snap.weeklyRatings.count == 7 && snap.baselineRatings.count == 28 && snap.restChange == 1, "Reference windows overlap or truncate")
let sparse = RestProgressSnapshot.make(nights: nights, checkIns: Array(ratings.prefix(2)), now: now, calendar: calendar)
check(sparse.restChange == nil, "Sparse history produced confident conclusion")
let session = BlankSession(profileId: UUID(), strategy: .manual, startedAt: start.addingTimeInterval(-3600), endedAt: start,
    pauseStartedAt: start.addingTimeInterval(-1200), pauseEndedAt: start.addingTimeInterval(-600))
check(snap.protectedMinutes(night: nights[0], sessions: [session, session], morning: false) == 50, "Protection overlaps/pauses double counted")
check(snap.association(sessions: [session], historyStart: nil) == nil, "Unknown protection history treated as unprotected")
check(snap.association(sessions: [session], historyStart: now) == nil, "Pre-account sleep included in comparison")
print("Rest Progress: source reconciliation, DST, unknown data, check-in isolation/deletion, baseline and protection passed")
