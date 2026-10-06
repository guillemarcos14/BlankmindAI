import Foundation
import Combine
import CoreHaptics

@MainActor protocol AssistantWritingHapticPlayback: AnyObject {
    var onStopped: (() -> Void)? { get set }
    func start() throws
    func stop()
}

// One perceptible continuous waveform, rather than one impact per token.
// The system can interrupt or disable it without affecting the conversation.
@MainActor private final class CoreWritingHapticPlayback: AssistantWritingHapticPlayback {
    var onStopped: (() -> Void)?
    private let engine: CHHapticEngine
    private var player: CHHapticAdvancedPatternPlayer?

    init() throws {
        // Haptics-only engine must not inherit the dictation recording session.
        #if os(iOS)
        engine = try CHHapticEngine(audioSession: nil)
        #else
        engine = try CHHapticEngine()
        #endif
        engine.playsHapticsOnly = true
        engine.isMutedForHaptics = false
        engine.isAutoShutdownEnabled = false
        engine.stoppedHandler = { [weak self] _ in
            Task { @MainActor in self?.onStopped?() }
        }
        engine.resetHandler = { [weak self] in
            Task { @MainActor in self?.onStopped?() }
        }
    }

    func start() throws {
        try engine.start()
        let event = CHHapticEvent(eventType: .hapticContinuous, parameters: [
            CHHapticEventParameter(parameterID: .hapticIntensity, value: 0.55),
            CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.3),
        ], relativeTime: 0, duration: 30)
        let pattern = try CHHapticPattern(events: [event], parameters: [])
        let player = try engine.makeAdvancedPlayer(with: pattern)
        player.loopEnabled = true
        player.loopEnd = 30
        self.player = player
        try player.start(atTime: CHHapticTimeImmediate)
    }

    func stop() {
        onStopped = nil
        try? player?.stop(atTime: CHHapticTimeImmediate)
        player = nil
        engine.stop(completionHandler: nil)
    }
}

@MainActor final class AssistantWritingHaptics: ObservableObject {
    private let makePlayback: @MainActor () throws -> AssistantWritingHapticPlayback?
    private let clock: () -> TimeInterval
    private var playback: AssistantWritingHapticPlayback?
    private var monitor: Task<Void, Never>?
    private var lastText = ""
    private var lastProgress: TimeInterval = 0
    private var generation: UUID?
    private var blocked = false

    init(makePlayback: @escaping @MainActor () throws -> AssistantWritingHapticPlayback? = {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return nil }
        return try CoreWritingHapticPlayback()
    }, clock: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) {
        self.makePlayback = makePlayback
        self.clock = clock
    }

    func update(text: String, enabled: Bool) {
        guard enabled, !text.isEmpty else { stop(); return }
        guard text != lastText else { return }
        lastText = text
        lastProgress = clock()
        guard !blocked, playback == nil else { return }
        do {
            guard let player = try makePlayback() else { blocked = true; return }
            let id = UUID()
            generation = id
            playback = player
            player.onStopped = { [weak self] in
                guard let self, self.generation == id else { return }
                self.stop()
                self.blocked = true // Wait for the next reply after interruption.
            }
            try player.start()
            monitor = Task { @MainActor [weak self] in
                while !Task.isCancelled {
                    do { try await Task.sleep(nanoseconds: 100_000_000) } catch { return }
                    guard let self, self.playback != nil else { return }
                    self.poll()
                }
            }
        } catch {
            stop()
            blocked = true
        }
    }

    // Stop within 450 ms of stalled/finished writing even if the final database
    // result is delayed. Keepalive frames and repeated drafts cannot prolong it.
    func poll() {
        if playback != nil && clock() - lastProgress >= 0.35 { stop() }
    }

    func stop() {
        generation = nil
        monitor?.cancel()
        monitor = nil
        playback?.stop()
        playback = nil
        lastText = ""
        blocked = false
    }
}
