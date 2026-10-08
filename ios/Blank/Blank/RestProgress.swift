import Foundation

struct RestCheckIn: Codable, Equatable, Identifiable {
    var id: String { day }
    let day: String
    let recordedAt: Date
    let score: Int
}

enum RestCheckInRepository {
    static func dayKey(_ date: Date, calendar: Calendar = .current) -> String {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
    static func key(owner: String) -> String { "blankRestCheckIns.v1." + owner }
    static func load(owner: String?, defaults: UserDefaults, now: Date = Date()) -> [RestCheckIn] {
        guard let owner, let data = defaults.data(forKey: key(owner: owner)),
              let rows = try? JSONDecoder().decode([RestCheckIn].self, from: data) else { return [] }
        return rows.filter { (1...5).contains($0.score) && $0.recordedAt <= now }
    }
    @discardableResult static func save(score: Int, owner: String?, defaults: UserDefaults,
                                      now: Date = Date(), calendar: Calendar = .current) -> Bool {
        guard let owner, (1...5).contains(score) else { return false }
        let day = dayKey(now, calendar: calendar)
        var rows = load(owner: owner, defaults: defaults, now: now).filter { $0.day != day }
        rows.append(RestCheckIn(day: day, recordedAt: now, score: score))
        guard let data = try? JSONEncoder().encode(Array(rows.sorted { $0.recordedAt < $1.recordedAt }.suffix(180))) else { return false }
        defaults.set(data, forKey: key(owner: owner))
        return true
    }
    static func delete(owner: String?, defaults: UserDefaults) {
        if let owner { defaults.removeObject(forKey: key(owner: owner)) }
    }
}

struct RestInterval: Equatable {
    var start: Date
    var end: Date
    static func merged(_ values: [RestInterval]) -> [RestInterval] {
        var result: [RestInterval] = []
        for value in values.filter({ $0.end > $0.start }).sorted(by: { $0.start < $1.start }) {
            if let last = result.last, value.start <= last.end {
                result[result.count - 1].end = max(last.end, value.end)
            } else { result.append(value) }
        }
        return result
    }
    static func minutes(_ values: [RestInterval]) -> Double {
        merged(values).reduce(0) { $0 + $1.end.timeIntervalSince($1.start) / 60 }
    }
}

struct RestSleepObservation {
    let start: Date
    let end: Date
    let value: Int
    let source: String
    let manual: Bool
}

struct RestNight: Identifiable {
    var id: Date { date }
    let date: Date // Local wake date; one main episode, never summed across providers.
    let start: Date
    let end: Date
    let asleep: [RestInterval]
    let awakeMinutes: Double?
    let stageMinutes: [Int: Double]
    let inBedMinutes: Double?
    let source: String
    let manual: Bool
    var sleepMinutes: Double { RestInterval.minutes(asleep) }
    static func build(_ observations: [RestSleepObservation], now: Date = Date(), calendar: Calendar = .current) -> [RestNight] {
        // SleepAnalysis: inBed=0, unspecified=1, awake=2, core=3, deep=4, REM=5.
        let valid = observations.filter { $0.end > $0.start && $0.end <= now && (0...5).contains($0.value) }
        var candidates: [Date: [RestNight]] = [:]
        for (source, rows) in Dictionary(grouping: valid, by: { $0.source }) {
            let sleep = rows.filter { $0.value == 1 || $0.value >= 3 }.sorted { $0.start < $1.start }
            var episodes: [[RestSleepObservation]] = []
            var latestEnd = Date.distantPast
            for sample in sleep {
                if episodes.isEmpty || sample.start.timeIntervalSince(latestEnd) > 2 * 3600 { episodes.append([]) }
                episodes[episodes.count - 1].append(sample)
                latestEnd = max(latestEnd, sample.end)
            }
            for episode in episodes {
                guard let start = episode.map(\.start).min(), let end = episode.map(\.end).max() else { continue }
                let intervals = RestInterval.merged(episode.map { RestInterval(start: $0.start, end: $0.end) })
                guard RestInterval.minutes(intervals) > 0, end.timeIntervalSince(start) <= 20 * 3600 else { continue }
                let related = rows.filter { $0.end > start && $0.start < end }
                func intervalsFor(_ value: Int) -> [RestInterval] {
                    related.filter { $0.value == value }.map { RestInterval(start: max(start, $0.start), end: min(end, $0.end)) }
                }
                let stages = Dictionary(uniqueKeysWithValues: (3...5).compactMap { value -> (Int, Double)? in
                    let segments = intervalsFor(value)
                    return segments.isEmpty ? nil : (value, RestInterval.minutes(segments))
                })
                let bed = related.filter { $0.value == 0 }.map { RestInterval(start: $0.start, end: $0.end) }
                let awake = intervalsFor(2)
                let night = RestNight(date: calendar.startOfDay(for: end), start: start, end: end, asleep: intervals,
                    awakeMinutes: awake.isEmpty ? nil : RestInterval.minutes(awake), stageMinutes: stages,
                    inBedMinutes: bed.isEmpty ? nil : RestInterval.minutes(bed), source: source,
                    manual: episode.contains { $0.manual })
                candidates[night.date, default: []].append(night)
            }
        }
        return candidates.compactMap { _, nights in
            nights.sorted {
                if $0.manual != $1.manual { return !$0.manual }
                if $0.stageMinutes.isEmpty != $1.stageMinutes.isEmpty { return !$0.stageMinutes.isEmpty }
                if $0.sleepMinutes != $1.sleepMinutes { return $0.sleepMinutes > $1.sleepMinutes }
                return $0.source < $1.source
            }.first
        }.sorted { $0.date < $1.date }
    }
}

struct RestHealthPoint: Identifiable {
    var id: Date { date }
    let date: Date
    let value: Double
    let count: Int
    let sources: [String]
}

struct RestHealthMetric: Identifiable {
    let id: String
    let title: String
    let family: String
    let unit: String
    let points: [RestHealthPoint]
    let note: String
    var isCategory: Bool = false
}

enum RestProgressMetric: String, CaseIterable, Identifiable {
    case perceived = "Morning rest", duration = "Sleep duration", regularity = "Sleep timing", interruptions = "Awake during sleep"
    var id: String { rawValue }
    var caption: String {
        switch self {
        case .perceived: return "morning check-in · 1–5"
        case .duration: return "main sleep episode · hours"
        case .regularity: return "sleep onset · local time"
        case .interruptions: return "estimated awake time between sleep samples · minutes"
        }
    }
}

struct RestProgressSnapshot {
    let days: [Date]
    let nights: [RestNight]
    let checkIns: [RestCheckIn]
    let now: Date
    let calendar: Calendar
    var currentStart: Date { days.first! }
    var baselineStart: Date { calendar.date(byAdding: .day, value: -28, to: currentStart)! }
    var weeklyNights: [RestNight] { nights.filter { $0.date >= currentStart && $0.date <= now } }
    var baselineNights: [RestNight] { nights.filter { $0.date >= baselineStart && $0.date < currentStart } }
    func ratings(from start: Date, to end: Date) -> [RestCheckIn] {
        let a = RestCheckInRepository.dayKey(start, calendar: calendar), b = RestCheckInRepository.dayKey(end, calendar: calendar)
        return checkIns.filter { $0.day >= a && $0.day < b }
    }
    var weeklyRatings: [RestCheckIn] { ratings(from: currentStart, to: calendar.date(byAdding: .day, value: 1, to: days.last!)!) }
    var baselineRatings: [RestCheckIn] { ratings(from: baselineStart, to: currentStart) }
    static func mean(_ values: [Double]) -> Double? {
        let valid = values.filter(\.isFinite)
        return valid.isEmpty ? nil : valid.reduce(0, +) / Double(valid.count)
    }
    var restChange: Double? {
        guard weeklyRatings.count >= 3, baselineRatings.count >= 7,
              let current = Self.mean(weeklyRatings.map { Double($0.score) }),
              let previous = Self.mean(baselineRatings.map { Double($0.score) }) else { return nil }
        return current - previous
    }
    var headline: String {
        guard let change = restChange else { return "How rested do you feel?" }
        if change >= 0.3 { return "You feel more rested" }
        if change <= -0.3 { return "You feel less rested" }
        return "Your morning rest is steady"
    }
    func chartValue(day: Date, metric: RestProgressMetric) -> Double? {
        let key = RestCheckInRepository.dayKey(day, calendar: calendar)
        if metric == .perceived { return checkIns.first { $0.day == key }.map { Double($0.score) } }
        guard let night = nights.first(where: { $0.date == day }) else { return nil }
        switch metric {
        case .duration: return night.sleepMinutes / 60
        case .interruptions: return night.awakeMinutes
        case .regularity:
            let minute = calendar.component(.hour, from: night.start) * 60 + calendar.component(.minute, from: night.start)
            return Double(minute < 12 * 60 ? minute + 24 * 60 : minute) / 60
        case .perceived: return nil
        }
    }
    func protectedMinutes(night: RestNight, sessions: [BlankSession], morning: Bool) -> Double {
        let start = morning ? night.end : night.start.addingTimeInterval(-3600)
        let end = morning ? min(now, night.end.addingTimeInterval(3600)) : night.start
        return BlankBrainMetrics.protectedSeconds(sessions: sessions, from: start, to: end) / 60
    }
    func association(sessions: [BlankSession], historyStart: Date?) -> (delta: Double, protected: Int, other: Int)? {
        // A night without a session is only a valid comparison after account history began.
        guard let historyStart else { return nil }
        var protected: [Double] = [], other: [Double] = []
        for night in nights where night.date >= baselineStart && night.end <= now && !night.manual {
            guard night.start.addingTimeInterval(-3600) >= historyStart,
                  let rating = checkIns.first(where: { $0.day == RestCheckInRepository.dayKey(night.date, calendar: calendar) }),
                  rating.recordedAt >= night.end else { continue }
            let minutes = protectedMinutes(night: night, sessions: sessions, morning: false)
            if minutes >= 45 { protected.append(Double(rating.score)) }
            else if minutes == 0 { other.append(Double(rating.score)) }
        }
        guard protected.count >= 5, other.count >= 5,
              let a = Self.mean(protected), let b = Self.mean(other) else { return nil }
        return (a - b, protected.count, other.count)
    }
    static func make(nights: [RestNight], checkIns: [RestCheckIn], now: Date = Date(), calendar: Calendar = .current) -> Self {
        let today = calendar.startOfDay(for: now)
        let days = (-6...0).compactMap { calendar.date(byAdding: .day, value: $0, to: today) }
        return Self(days: days, nights: nights, checkIns: checkIns, now: now, calendar: calendar)
    }
}
