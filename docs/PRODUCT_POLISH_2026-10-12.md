# Product improvements, 12 October 2026

Base: App Store preparation 99b95e7 (includes PR28/30/31/33). Branch: codex/product-gestures-unlock-voice-2026-10-12.

- Left-edge rightward swipe performs one back action. Control groups and Progress detail return one level; root routes restore navigation history. Authored sheets dismiss independently; onboarding device returns to account. Vertical, centre, short and right-edge gestures do not navigate. System-owned Apple/Screen Time dialogs retain system controls.
- Control > Protection > Unlock protection ends a regular block immediately as a manual, unbroken session, including indefinite widget blocks. No emergency is spent; hard protection retains Emergency. Confirmation uses existing native controls. The 60-second reblock deadline is persisted in App Group and enforced by app and widget, including relaunch. Previous hold/emergency paths remain.
- Home and standalone chat use TextKit to lay out the canonical reply, preserve word positions during speech and fade newly reached text over 180 ms. Only visible lines contribute to height; replies remain scrollable. Reduce Motion reveals immediately; completed text remains selectable, with scalable Neue Montreal and visible-text accessibility labels.
- Home reserves 48 additional points above the card's lower edge. Long output scrolls inside that inset; navigation and voice stay fixed.

## ElevenLabs, activation deferred at Guillem's request

The backend adapter is implemented but inactive. Set BM_VOICE_PROVIDER=elevenlabs only after configuring ELEVENLABS_API_KEY in protected server environment and choosing an available ELEVENLABS_VOICE_ID together. Default candidate JBFqnCBsd6RMkjVDRZzb; multilingual_v2 and PCM24k retain the app audio contract. Native original-text character timestamps replace the extra Whisper alignment request. No key exists in the app; authentication, committed-turn isolation, quotas, deletion checks and cancellation remain. Missing credentials do not consume quota; malformed or mismatched alignment falls back to text. No provider generation, backend deployment or activation was performed.

Reference: [ElevenLabs timestamp API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps).

## Validation

Backend voice and alignment tests pass locally, including ElevenLabs fixtures and missing-key/mismatch handling. Swift runtime tests and native build/UI are executed on macOS CI; Windows has no Swift compiler. Product harness uses the pre-edit baseline and enforce-scope. Physical Screen Time/audio quality and signed distribution require a later iPhone build; CI does not certify them.
