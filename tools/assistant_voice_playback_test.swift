import Foundation

enum AssistantPendingProblem { case rateLimited, unknown }
enum AssistantAppError: Error {
    case invalidResponse
    case server(status: Int, code: String)
    var problem: AssistantPendingProblem { if case .server(429, _) = self { return .rateLimited }; return .unknown }
}
enum AssistantAppSession { static var userID: String? = "A" }
struct AssistantAppClient {
    func voice(turnId: String, requestId: UUID, onCue: @escaping @MainActor (AssistantVoiceCue) throws -> Void, onAudio: @escaping @MainActor (Data) async throws -> Void) async throws {}
}
@MainActor final class AudioFixture: AssistantVoiceAudioDriver {
    var playbackSeconds = 0.0
    var holdFinish = false
    var starts = 0, stops = 0, chunks = 0, finishes = 0
    func start() throws { starts += 1 }
    func append(_ pcm: Data) async throws { chunks += 1 }
    func finish() async throws {
        finishes += 1
        while holdFinish { try await Task.sleep(nanoseconds: 1_000_000) }
    }
    func stop() { stops += 1 }
}
@main struct VoicePlaybackTests {
    @MainActor static func main() async throws {
        let turn = "22222222-2222-4222-8222-222222222222"
        let driver = AudioFixture()
        var blocked = false
        var release = false
        let playback = AssistantVoicePlayback(driver: driver, stream: { _, _, _, chunk in
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
        let failing = AssistantVoicePlayback(driver: driver, stream: { _, _, _, _ in throw AssistantAppError.server(status: 429, code: "limit") })
        failing.play(turnID: turn, owner: "A")
        try await Task.sleep(nanoseconds: 5_000_000)
        precondition(!failing.isBusy && failing.error?.contains("limit") == true)
        failing.reset(); precondition(failing.error == nil)
        let empty = AssistantVoicePlayback(driver: driver, stream: { _, _, _, _ in })
        empty.play(turnID: turn, owner: "A")
        try await Task.sleep(nanoseconds: 5_000_000)
        precondition(empty.error != nil && !empty.isBusy, "Empty stream is failure")
        let alignedDriver = AudioFixture()
        alignedDriver.holdFinish = true
        var downloaded = false
        let aligned = AssistantVoicePlayback(driver: alignedDriver, stream: { _, _, cue, chunk in
            try cue(AssistantVoiceCue(start: 0.1, end: 5))
            try cue(AssistantVoiceCue(start: 0.5, end: 14))
            for _ in 0..<12 { try await chunk(Data(repeating: 0, count: 8000)) }
            while !downloaded { try await Task.sleep(nanoseconds: 1_000_000) }
        })
        aligned.play(turnID: turn, owner: "A", text: "Hola mundo. 👋")
        try await Task.sleep(nanoseconds: 10_000_000)
        precondition(aligned.isBusy && !aligned.isPlaying && aligned.visibleText.isEmpty && alignedDriver.starts == 0,
                     "Downloading must not reveal text or play incomplete audio")
        downloaded = true
        try await Task.sleep(nanoseconds: 30_000_000)
        precondition(aligned.isPlaying && aligned.visibleText.isEmpty, "Silence before the first word remains blank")
        alignedDriver.playbackSeconds = 0.11
        try await Task.sleep(nanoseconds: 30_000_000)
        precondition(aligned.visibleText == "Hola ", "Only the word reached by the speaker clock is visible")
        alignedDriver.playbackSeconds = 0.49
        try await Task.sleep(nanoseconds: 30_000_000)
        precondition(aligned.visibleText == "Hola ", "A future word must not appear early")
        alignedDriver.playbackSeconds = 0.51
        try await Task.sleep(nanoseconds: 30_000_000)
        precondition(aligned.visibleText == "Hola mundo. 👋", "Canonical punctuation and Unicode survive alignment")
        aligned.stop()
        alignedDriver.holdFinish = false
        let invalid = AssistantVoicePlayback(driver: alignedDriver, stream: { _, _, cue, chunk in
            try cue(AssistantVoiceCue(start: 0.1, end: 2))
            try await chunk(Data(repeating: 0, count: 8000))
        })
        invalid.play(turnID: turn, owner: "A", text: "Incomplete")
        try await Task.sleep(nanoseconds: 10_000_000)
        precondition(!invalid.isBusy && invalid.error != nil && alignedDriver.starts == 1,
                     "Incomplete timings must fall back without starting audio")
        print("Voice playback PASS: lifecycle, buffering, audio-clock word reveal, Unicode and invalid timing fallback")
    }
}
