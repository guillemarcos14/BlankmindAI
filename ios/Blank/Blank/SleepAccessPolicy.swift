import Foundation

// Read authorization is deliberately opaque in HealthKit. Only returned,
// non-manual sleep observations establish availability; absence stays unknown.
enum SleepAccessStatus: Equatable {
    case unchecked, checking, available, noData
    case failed(String)

    var hasData: Bool { self == .available }
}

struct SleepAccessObservation {
    let start: Date
    let end: Date
    let source: String
    let isAppleWatch: Bool
    let isAsleep: Bool
    let manuallyEntered: Bool
}

enum SleepAccessPolicy {
    static func usable(_ observations: [SleepAccessObservation], now: Date) -> [SleepAccessObservation] {
        let earliest = now.addingTimeInterval(-28 * 24 * 60 * 60)
        return observations.filter {
            $0.isAsleep && !$0.manuallyEntered && $0.end > $0.start
                && $0.end > earliest && $0.end <= now && $0.start < now
        }
    }

    static func canEnter(screenTimeApproved: Bool, sleep: SleepAccessStatus) -> Bool {
        screenTimeApproved && sleep.hasData
    }
}
