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

// Basic protection is independent of measured sleep and cloud AI consent.
extension SleepAccessPolicy {
    static func canEnterBasic(screenTimeApproved: Bool) -> Bool { screenTimeApproved }
}

enum RestAIConsent {
    static let didChange = Notification.Name("BlankRestAIConsentDidChange")
    static func allowed(owner: String?, defaults: UserDefaults = .standard) -> Bool {
        guard let owner, !owner.isEmpty else { return false }
        return defaults.integer(forKey: "blankRestAIConsent.v1." + owner) == 1
    }
    static func set(_ allowed: Bool, owner: String?, defaults: UserDefaults = .standard) {
        guard let owner, !owner.isEmpty else { return }
        defaults.set(allowed ? 1 : 0, forKey: "blankRestAIConsent.v1." + owner)
        NotificationCenter.default.post(name: didChange, object: nil)
    }
}
