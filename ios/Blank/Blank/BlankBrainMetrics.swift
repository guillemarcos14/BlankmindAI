import Foundation

// Recorded protection is elapsed protected time, not phone use or time saved.
// Merge overlapping sessions and subtract recorded pauses before summing.
enum BlankBrainMetrics {
    static func protectedSeconds(sessions: [BlankSession], from start: Date, to end: Date) -> TimeInterval {
        var intervals: [(Date, Date)] = []
        for session in sessions {
            let a = max(session.startedAt, start)
            let b = min(session.endedAt ?? end, end)
            guard b > a else { continue }
            if let pause = session.pauseStartedAt {
                let resume = session.pauseEndedAt ?? session.endedAt ?? end
                if pause < b && resume > a {
                    if a < pause { intervals.append((a, min(pause, b))) }
                    if resume < b { intervals.append((max(resume, a), b)) }
                    continue
                }
            }
            intervals.append((a, b))
        }
        var previousEnd = Date.distantPast
        var result: TimeInterval = 0
        for (a, b) in intervals.sorted(by: { $0.0 < $1.0 }) where b > previousEnd {
            result += b.timeIntervalSince(max(a, previousEnd))
            previousEnd = b
        }
        return floor(result)
    }

    static func sessionCount(sessions: [BlankSession], from start: Date, to end: Date) -> Int {
        sessions.filter { $0.startedAt < end && ($0.endedAt ?? end) > start }.count
    }
}
