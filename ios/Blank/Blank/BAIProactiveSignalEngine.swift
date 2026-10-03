import Foundation

// BMB owns proactive decisions and notifications. This compatibility entry point
// only synchronizes observations; it never calls the legacy planner or posts alerts.
struct BAIProactiveSignalEngine {
    @MainActor static func evaluate(system: DigitalWellnessV3System, healthSummaries: [HealthDaySummary],
        selectionCount: Int, screenTimeAuthorized: Bool, isBlankActive: Bool,
        now: Date = Date(), defaults: UserDefaults = BlankSharedState.defaults) async {
        BlankBrain.shared.sync()
    }
}
