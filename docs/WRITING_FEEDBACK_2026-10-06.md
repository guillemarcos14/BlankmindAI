# Writing feedback: markup and physical haptics

Guillem confirms progressive replies on build104 but reports no tactile sensation; screenshot shows literal ** delimiters around Protection and hours. This is physical user feedback, not a simulator observation.

Backend/native reply presentation now remove emphasis delimiters from generated drafts, committed copy and old history, preserving Unicode/newlines, escaped literals, code and spaced multiplication operators. Presentation does not alter commands, user text, action metadata or memory. The backend patch can repair markup on104 without reinstalling. Native presentation also handles cached history.

Writing haptics retain one continuous player and all completion/idle/visibility/account/speech guards. Intensity0.16 was never physically calibrated; new profile0.55/sharpness0.3 is intended to be perceptible. The iOS engine uses init(audioSession:nil), explicit haptics-only/unmuted and manual lifecycle, avoiding dependence on dictation's shared recording session. Intensity or audio interference are plausible causes, not proven diagnoses of this device. Core Haptics sensation and system-wide haptic settings still need iPhone confirmation after distribution.

No alignment change: for long replies/list summaries, left alignment is the recommended reading treatment; centered short replies preserve the current visual language. User asked for opinion, not implementation.

Apple initializer reference: https://developer.apple.com/documentation/corehaptics/chhapticengine/init(audiosession:)

Validation and distribution receipts to follow. No new TestFlight uploaded yet.
