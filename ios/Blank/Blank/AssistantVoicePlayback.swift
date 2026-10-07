import AVFoundation
import Combine
import Foundation

@MainActor protocol AssistantVoiceAudioDriver {
    func start() throws
    func append(_ pcm: Data) async throws
    func finish() async throws
    func stop()
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
    typealias Stream = (String, UUID, @escaping @MainActor (Data) async throws -> Void) async throws -> Void
    @Published private(set) var isBusy = false
    @Published private(set) var isPlaying = false
    @Published private(set) var turnID: String?
    @Published private(set) var error: String?
    private let driver: AssistantVoiceAudioDriver
    private let stream: Stream
    private let currentOwner: () -> String?
    private var task: Task<Void, Never>?
    private var generation = UUID()
    private var observers: [NSObjectProtocol] = []

    init(driver: AssistantVoiceAudioDriver? = nil, stream: Stream? = nil,
         currentOwner: @escaping () -> String? = { AssistantAppSession.userID }) {
        self.driver = driver ?? AssistantVoicePCMDriver()
        self.stream = stream ?? { turn, request, chunk in
            try await AssistantAppClient().voice(turnId: turn, requestId: request, onAudio: chunk)
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

    deinit { task?.cancel(); observers.forEach(NotificationCenter.default.removeObserver) }

    func play(turnID: String, owner: String) {
        stop()
        guard !owner.isEmpty, owner == currentOwner(), UUID(uuidString: turnID) != nil else { return }
        error = nil
        isBusy = true
        self.turnID = turnID
        let expected = generation
        task = Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                try await self.stream(turnID, UUID()) { [weak self] chunk in
                    guard let self, self.generation == expected, owner == self.currentOwner() else { throw CancellationError() }
                    try Task.checkCancellation()
                    if !self.isPlaying { try self.driver.start(); self.isPlaying = true }
                    try await self.driver.append(chunk)
                }
                guard self.generation == expected, owner == self.currentOwner() else { throw CancellationError() }
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
        driver.stop()
        isBusy = false; isPlaying = false; turnID = nil
    }

    func reset() { stop(); error = nil }
}
