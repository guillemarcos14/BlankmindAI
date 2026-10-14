import Foundation

enum Authorization { case approved, denied }
enum AssistantAppError: LocalizedError {
    case authenticationRequired, timeout, installationNotVerified, invalidResponse
    var code: String { String(describing: self) }
    var errorDescription: String? { code }
}
enum AssistantAppSession { static var userID: String? = "owner" }
enum BlankSharedState {
    static let defaults = UserDefaults(suiteName: "rest-setup-test-" + UUID().uuidString)!
    static let appInstallId = "test-install"
}
enum OnboardingStep: Int { case account, device }
enum BlankmindAppPresence {
    static func payload(appReady: Bool) -> [String: Any] { ["app_present": true, "app_ready": appReady] }
}
@MainActor final class HealthFixture {
    var aiSharingAllowed = true
    var sleepDataAvailable = true // Explicit sample, zero measured Health records.
    var sleepProvenance = "Fictional sample sleep, not measured Health"
    var completedOwner: String?
    func sleepContextProfile() -> [String: Any] { ["sleep_source": "synthetic_qa"] }
    func completeRestSetup(owner: String) { completedOwner = owner }
}
@MainActor final class ScreenTimeFixture { var authorizationStatus = Authorization.approved; var hasAuthorization: Bool { authorizationStatus == .approved } }
@MainActor final class SessionFixture {
    var hasSelectedApps = false
    var selectionCount = 0
    var finished = false
    func finishSetup() { finished = true }
}
@MainActor final class PurchaseFixture { func registerReferredActivation(referredUserId: String) async {} }
@MainActor enum Network {
    static var error: AssistantAppError?
    static var delay = false
    static var changeOwner = false
    static var ready = true
    static var codes: [String] = []
    static var payloads: [[String: Any]] = []
    static func reset() {
        error = nil; delay = false; changeOwner = false; ready = true
        codes = []; payloads = []; AssistantAppSession.userID = "owner"
    }
}
@MainActor struct AssistantAppClient {
    func activate() async throws -> String {
        if Network.delay { try await Task.sleep(nanoseconds: 100_000_000) }
        if let error = Network.error { throw error }
        if Network.changeOwner { AssistantAppSession.userID = "other" }
        return "FRESH12345"
    }
    func postAuthorizedJSON(path: String, payload: Data, timeout: TimeInterval) async throws -> [String: Any] {
        let body = try JSONSerialization.jsonObject(with: payload) as! [String: Any]
        Network.codes.append(body["connect_code"] as! String)
        return ["ok": true, "ready": Network.ready]
    }
}
@MainActor struct AssistantContextSyncClient {
    func sync(connectCode: String, channel: String, payload: [String: Any]) async -> Bool {
        Network.codes.append(connectCode); Network.payloads.append(payload)
        return true
    }
}
@MainActor final class SetupFixture {
    var completionInFlight = false
    var completionTask: Task<Void, Never>?
    var canAutomaticallyComplete = true
    var automaticCompletionAttempted = true
    var message: String?
    var deviceReady = true
    var notificationReady = false
    var savedStepRaw = OnboardingStep.device.rawValue
    var healthOnboardingVersion = 0
    var onFinishForQA: (() -> Void)?
    let healthKitStore = HealthFixture()
    let screenTimeBlocker = ScreenTimeFixture()
    let sessionStore = SessionFixture()
    let purchaseStore = PurchaseFixture()
    func refreshDeviceState() async {}
    func currentAnonymousUserId() -> String { "test-anonymous" }
    // PRODUCTION_METHODS
}
@main struct Tests {
    @MainActor static func check(_ condition: @autoclosure () -> Bool, _ message: String) {
        precondition(condition(), message)
    }
    @MainActor static func main() async {
        Network.reset()
        let sample = SetupFixture()
        await sample.completeSetup()
        check(sample.sessionStore.finished, "Sample without Health/Watch/apps/notifications must complete")
        check(sample.healthKitStore.completedOwner == "owner", "Verified setup must unlock the same owner")
        check(Network.codes == ["FRESH12345", "FRESH12345"], "Use activation's code, never a stale AppStorage value")
        check(Network.payloads[0]["sleep_data_available"] as? Bool == true, "Sample availability must reach the backend")

        Network.reset(); Network.error = .timeout
        let retry = SetupFixture()
        retry.startCompletion()
        await retry.completionTask?.value
        check(!retry.sessionStore.finished && !retry.completionInFlight, "Failure cannot mark setup complete or disable retry")
        check(retry.message == "timeout", "Keep the typed failure instead of a generic setup error")
        Network.error = nil
        retry.startCompletion()
        await retry.completionTask?.value
        check(retry.sessionStore.finished, "Explicit retry must complete after a recoverable failure")

        Network.reset(); Network.delay = true
        let scene = SetupFixture()
        scene.startCompletion()
        scene.canAutomaticallyComplete = false // Screen/scene update while network is in flight.
        await scene.completionTask?.value
        check(scene.sessionStore.finished, "A scene update must not cancel an already started setup")

        Network.reset(); Network.delay = true
        let cancelled = SetupFixture()
        cancelled.startCompletion()
        cancelled.completionTask?.cancel()
        await cancelled.completionTask?.value
        check(!cancelled.sessionStore.finished && cancelled.message == nil, "Leaving setup must not show a fake server failure")

        Network.reset(); Network.changeOwner = true
        let owner = SetupFixture()
        await owner.completeSetup()
        check(!owner.sessionStore.finished && Network.codes.isEmpty, "Account changes must stop before context or completion")

        Network.reset(); Network.ready = false
        let unverified = SetupFixture()
        await unverified.completeSetup()
        check(!unverified.sessionStore.finished && unverified.healthKitStore.completedOwner == nil, "A backend rejection cannot unlock AI")

        Network.reset()
        let noConsent = SetupFixture(); noConsent.healthKitStore.aiSharingAllowed = false
        await noConsent.completeSetup()
        check(!noConsent.sessionStore.finished && Network.codes.isEmpty, "Sample data cannot bypass AI consent")
        let noScreenTime = SetupFixture(); noScreenTime.deviceReady = false
        await noScreenTime.completeSetup()
        check(!noScreenTime.sessionStore.finished && Network.codes.isEmpty, "Sample data cannot bypass Screen Time")
        print("Rest setup: sample without Health, fresh identity, retry, scene change, cancellation, account isolation, backend refusal and consent passed")
    }
}
