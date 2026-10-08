import AVFoundation
import Combine
import Foundation

@MainActor protocol AssistantVoiceAudioDriver {
    var playbackSeconds: Double { get }
    func start() throws
    func append(_ pcm: Data) async throws
    func finish() async throws
    func stop()
}

struct AssistantVoiceCue {
    let start: Double
    let end: Int
}

// A small PCM queue applies backpressure to the HTTP reader. Audio is kept in
// memory only; each buffer is released after the speaker has consumed it.
@MainActor final class AssistantVoicePCMDriver: AssistantVoiceAudioDriver {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let format = AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 1)!
    private var queuedFrames = 0
    private var generation = UUID()
    private var ownsAudioSession = false
    var playbackSeconds: Double {
        guard let time = player.lastRenderTime, let position = player.playerTime(forNodeTime: time) else { return 0 }
        return max(0, Double(position.sampleTime) / position.sampleRate)
    }

    init() {
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: format)
    }

    func start() throws {
        stop()
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .spokenAudio)
        try session.setActive(true)
        ownsAudioSession = true
        #endif
        try engine.start()
        player.play()
    }

    func append(_ pcm: Data) async throws {
        guard !pcm.isEmpty, pcm.count % 2 == 0, pcm.count <= 8192 else { throw AssistantAppError.invalidResponse }
        let expected = generation
        while queuedFrames >= 48000 {
            try await Task.sleep(nanoseconds: 20_000_000)
            guard expected == generation else { throw CancellationError() }
        }
        try Task.checkCancellation()
        guard expected == generation, engine.isRunning else { throw CancellationError() }
        let frames = pcm.count / 2
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames)),
              let samples = buffer.floatChannelData?[0] else { throw AssistantAppError.invalidResponse }
        buffer.frameLength = AVAudioFrameCount(frames)
        pcm.withUnsafeBytes { bytes in
            let raw = bytes.bindMemory(to: UInt8.self)
            for index in 0..<frames {
                let bits = UInt16(raw[index * 2]) | UInt16(raw[index * 2 + 1]) << 8
                samples[index] = Float(Int16(bitPattern: bits)) / 32768
            }
        }
        queuedFrames += frames
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.generation == expected else { return }
                self.queuedFrames = max(0, self.queuedFrames - frames)
            }
        }
    }

    func finish() async throws {
        let expected = generation
        while queuedFrames > 0 {
            try await Task.sleep(nanoseconds: 20_000_000)
            guard expected == generation, engine.isRunning else { throw CancellationError() }
        }
        try Task.checkCancellation()
    }

    func stop() {
        generation = UUID()
        queuedFrames = 0
        player.stop()
        engine.stop()
        #if os(iOS)
        if ownsAudioSession {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            ownsAudioSession = false
        }
        #endif
    }
}

@MainActor final class AssistantVoicePlayback: ObservableObject {
    typealias Stream = (String, UUID, @escaping @MainActor (AssistantVoiceCue) throws -> Void,
                       @escaping @MainActor (Data) async throws -> Void) async throws -> Void
    @Published private(set) var isBusy = false
    @Published private(set) var isPlaying = false
    @Published private(set) var turnID: String?
    @Published private(set) var error: String?
    @Published private(set) var visibleText = ""
    private let driver: AssistantVoiceAudioDriver
    private let stream: Stream
    private let currentOwner: () -> String?
    private var task: Task<Void, Never>?
    private var revealTask: Task<Void, Never>?
    private var generation = UUID()
    private var observers: [NSObjectProtocol] = []

    init(driver: AssistantVoiceAudioDriver? = nil, stream: Stream? = nil,
         currentOwner: @escaping () -> String? = { AssistantAppSession.userID }) {
        self.driver = driver ?? AssistantVoicePCMDriver()
        self.stream = stream ?? { turn, request, cue, chunk in
            try await AssistantAppClient().voice(turnId: turn, requestId: request, onCue: cue, onAudio: chunk)
        }
        self.currentOwner = currentOwner
        #if os(iOS)
        for name in [AVAudioSession.interruptionNotification, AVAudioSession.routeChangeNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] notification in
                if name == AVAudioSession.interruptionNotification {
                    guard notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt == AVAudioSession.InterruptionType.began.rawValue else { return }
                } else {
                    guard let reason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                          reason != AVAudioSession.RouteChangeReason.categoryChange.rawValue else { return }
                }
                Task { @MainActor in self?.stop() }
            })
        }
        #endif
    }

    deinit { task?.cancel(); revealTask?.cancel(); observers.forEach(NotificationCenter.default.removeObserver) }

    func play(turnID: String, owner: String, text: String? = nil) {
        stop()
        guard !owner.isEmpty, owner == currentOwner(), UUID(uuidString: turnID) != nil else { return }
        error = nil
        isBusy = true
        visibleText = ""
        self.turnID = turnID
        let expected = generation
        task = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                var cues: [AssistantVoiceCue] = []
                var audio = Data()
                try await self.stream(turnID, UUID(), { cue in
                    guard self.generation == expected, owner == self.currentOwner(), audio.isEmpty,
                          cue.start.isFinite, cue.start >= (cues.last?.start ?? 0),
                          cue.end > (cues.last?.end ?? 0), cue.end <= (text?.utf16.count ?? 4000),
                          cues.count < 4000 else { throw AssistantAppError.invalidResponse }
                    cues.append(cue)
                }) { [weak self] chunk in
                    guard let self, self.generation == expected, owner == self.currentOwner() else { throw CancellationError() }
                    try Task.checkCancellation()
                    if text != nil {
                        guard !chunk.isEmpty, chunk.count <= 8192, chunk.count % 2 == 0,
                              audio.count + chunk.count <= 12000000 else { throw AssistantAppError.invalidResponse }
                        audio.append(chunk)
                        return
                    }
                    if !self.isPlaying { try self.driver.start(); self.isPlaying = true }
                    try await self.driver.append(chunk)
                }
                guard self.generation == expected, owner == self.currentOwner() else { throw CancellationError() }
                if let text {
                    guard !audio.isEmpty, cues.last?.end == text.utf16.count,
                          cues.allSatisfy({ $0.start < Double(audio.count) / 48000 }) else { throw AssistantAppError.invalidResponse }
                    try self.driver.start()
                    self.isPlaying = true
                    let timeline = cues
                    self.revealTask = Task { @MainActor [weak self] in
                        var index = 0
                        while let self, self.generation == expected, owner == self.currentOwner(), index < timeline.count {
                            let position = self.driver.playbackSeconds
                            while index < timeline.count && timeline[index].start <= position {
                                self.visibleText = String(text.prefix(utf16: timeline[index].end))
                                index += 1
                            }
                            try? await Task.sleep(nanoseconds: 20_000_000)
                            if Task.isCancelled { return }
                        }
                    }
                    for offset in stride(from: 0, to: audio.count, by: 8192) {
                        guard self.generation == expected, owner == self.currentOwner() else { throw CancellationError() }
                        try await self.driver.append(audio.subdata(in: offset..<min(offset + 8192, audio.count)))
                    }
                }
                guard self.isPlaying else { throw AssistantAppError.invalidResponse }
                try await self.driver.finish()
                guard self.generation == expected else { return }
                self.stop()
            } catch {
                guard self.generation == expected else { return }
                self.stop()
                if !(error is CancellationError), owner == self.currentOwner() {
                    let limited = (error as? AssistantAppError)?.problem == .rateLimited
                    self.error = limited ? "Voice limit reached. Your reply is available as text."
                        : "Couldn't play the voice. Your reply is available as text."
                }
            }
        }
    }

    func stop() {
        generation = UUID()
        task?.cancel(); task = nil
        revealTask?.cancel(); revealTask = nil
        driver.stop()
        isBusy = false; isPlaying = false; turnID = nil
    }

    func reset() { stop(); error = nil }
}

private extension String {
    func prefix(utf16 count: Int) -> Substring {
        let offset = utf16.index(utf16.startIndex, offsetBy: count)
        guard let end = String.Index(offset, within: self) else { return self[...] }
        return self[..<end]
    }
}
