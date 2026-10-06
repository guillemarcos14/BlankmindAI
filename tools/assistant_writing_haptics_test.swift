import Foundation

@MainActor final class FakeWritingPlayback: AssistantWritingHapticPlayback {
    var onStopped: (() -> Void)?
    var starts = 0
    var stops = 0
    var fails = false
    func start() throws {
        starts += 1
        if fails { throw NSError(domain: "fixture", code: 1) }
    }
    func stop() { stops += 1; onStopped = nil }
}

@main struct WritingHapticsTests {
    @MainActor static func main() {
        var time: TimeInterval = 100
        let motor = FakeWritingPlayback()
        let haptics = AssistantWritingHaptics(makePlayback: { motor }, clock: { time })
        func check(_ condition: Bool, _ message: String) { if !condition { fatalError(message) } }
        haptics.update(text: "", enabled: true)
        check(motor.starts == 0, "Waiting for first text cannot vibrate")
        haptics.update(text: "H", enabled: true)
        time += 0.2
        haptics.update(text: "Hola", enabled: true)
        check(motor.starts == 1, "Writing must sustain one continuous player, not impacts per token")
        time += 0.2; haptics.poll()
        check(motor.stops == 0, "Recent writing stopped early")
        haptics.update(text: "Hola", enabled: true)
        time += 0.2; haptics.poll()
        check(motor.stops == 1, "Repeated drafts cannot prolong writing vibration")
        haptics.update(text: "Hola 👋", enabled: true)
        check(motor.starts == 2, "Fresh writing can resume after a stall")
        haptics.update(text: "Hola 👋 mundo", enabled: false)
        check(motor.stops == 2, "Hidden or inactive chat cannot vibrate")
        haptics.update(text: "Nuevo", enabled: true)
        let staleStop = motor.onStopped
        haptics.stop()
        haptics.update(text: "Otra respuesta", enabled: true)
        staleStop?()
        check(motor.stops == 3, "Old engine callback stopped a new reply")
        motor.onStopped?()
        let interruptedStarts = motor.starts
        haptics.update(text: "Otra respuesta completa", enabled: true)
        check(motor.starts == interruptedStarts, "Interrupted hardware must not retry every token")
        haptics.stop()
        motor.fails = true
        haptics.update(text: "Fallido", enabled: true)
        let failedStarts = motor.starts
        haptics.update(text: "Fallido de nuevo", enabled: true)
        check(motor.starts == failedStarts, "Unavailable motor cannot block or repeatedly retry the stream")
        let unsupported = AssistantWritingHaptics(makePlayback: { nil }, clock: { time })
        unsupported.update(text: "Simulator", enabled: true)
        unsupported.stop()
        print("writing haptics: continuous playback, idle stop, visibility, reset/end, stale callbacks, interruptions and unavailable hardware passed")
    }
}
