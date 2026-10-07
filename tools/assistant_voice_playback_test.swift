import Foundation

enum AssistantPendingProblem { case rateLimited, unknown }
enum AssistantAppError: Error {
    case invalidResponse
    case server(status: Int, code: String)
    var problem: AssistantPendingProblem { if case .server(429, _) = self { return .rateLimited }; return .unknown }
}
enum AssistantAppSession { static var userID: String? = "A" }
struct AssistantAppClient {
    func voice(turnId: String, requestId: UUID, onAudio: @escaping @MainActor (Data) async throws -> Void) async throws {}
}
@MainActor final class AudioFixture: AssistantVoiceAudioDriver {
    var starts = 0, stops = 0, chunks = 0, finishes = 0
    func start() throws { starts += 1 }
    func append(_ pcm: Data) async throws { chunks += 1 }
    func finish() async throws { finishes += 1 }
    func stop() { stops += 1 }
}
@main struct VoicePlaybackTests {
    @MainActor static func main() async throws {
        let turn = "22222222-2222-4222-8222-222222222222"
        let driver = AudioFixture()
        var blocked = false
        var release = false
        let playback = AssistantVoicePlayback(driver: driver, stream: { _, _, chunk in
            if blocked { while !release { try await Task.sleep(nanoseconds: 1_000_000) } }
            try await chunk(Data([0, 0]))
        })
        playback.play(turnID: turn, owner: "B")
        precondition(!playback.isBusy && driver.starts == 0, "Wrong owner cannot play")
        playback.play(turnID: "draft", owner: "A")
        precondition(!playback.isBusy, "Synthetic/draft turn cannot play")
        playback.play(turnID: turn, owner: "A")
        for _ in 0..<100 where playback.isBusy { try await Task.sleep(nanoseconds: 1_000_000) }
        precondition(driver.starts == 1 && driver.chunks == 1 && driver.finishes == 1 && !playback.isBusy)
        blocked = true
        playback.play(turnID: turn, owner: "A")
        try await Task.sleep(nanoseconds: 5_000_000)
        playback.stop(); release = true
        try await Task.sleep(nanoseconds: 5_000_000)
        precondition(driver.chunks == 1 && !playback.isBusy, "Cancelled stale stream must never reach the speaker")
        release = false
        playback.play(turnID: turn, owner: "A")
        try await Task.sleep(nanoseconds: 5_000_000)
        AssistantAppSession.userID = "B"; release = true
        try await Task.sleep(nanoseconds: 5_000_000)
        precondition(driver.chunks == 1 && playback.error == nil, "Account switch rejects old audio silently")
        AssistantAppSession.userID = "A"
        let failing = AssistantVoicePlayback(driver: driver, stream: { _, _, _ in throw AssistantAppError.server(status: 429, code: "limit") })
        failing.play(turnID: turn, owner: "A")
        try await Task.sleep(nanoseconds: 5_000_000)
        precondition(!failing.isBusy && failing.error?.contains("limit") == true)
        failing.reset(); precondition(failing.error == nil)
        let empty = AssistantVoicePlayback(driver: driver, stream: { _, _, _ in })
        empty.play(turnID: turn, owner: "A")
        try await Task.sleep(nanoseconds: 5_000_000)
        precondition(empty.error != nil && !empty.isBusy, "Empty stream is failure")
        print("Voice playback lifecycle PASS: owner, cancellation, stale callbacks, completion, quotas and empty stream")
    }
}
