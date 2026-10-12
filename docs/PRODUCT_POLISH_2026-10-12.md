# Product improvements, 12 October 2026

Base: App Store preparation 99b95e7 (includes PR28/30/31/33). Branch: codex/product-gestures-unlock-voice-2026-10-12.

- Left-edge rightward swipe performs one back action. Control groups and Progress detail return one level; root routes restore navigation history. Authored sheets dismiss independently; onboarding device returns to account. Vertical, centre, short and right-edge gestures do not navigate. System-owned Apple/Screen Time dialogs retain system controls.
- Control > Protection > Unlock protection ends a regular block immediately as an unbroken session with reason `control`, including indefinite widget blocks. No emergency is spent and it does not count as a manual relapse in product metrics; hard protection retains Emergency. Confirmation uses existing native controls. The 60-second reblock deadline is persisted in App Group and enforced by app and widget, including relaunch. Previous hold/emergency paths remain.
- Home and standalone chat use TextKit to lay out the canonical reply, preserve word positions during speech and fade newly reached text over 180 ms. Only visible lines contribute to height; replies remain scrollable. Reduce Motion reveals immediately; completed text remains selectable, with scalable Neue Montreal and visible-text accessibility labels.
- Home reserves 48 additional points above the card's lower edge. Long output scrolls inside that inset; navigation and voice stay fixed.

## ElevenLabs, activation deferred at Guillem's request

The backend adapter is implemented but inactive. Set BM_VOICE_PROVIDER=elevenlabs only after configuring ELEVENLABS_API_KEY in protected server environment and choosing an available ELEVENLABS_VOICE_ID together. Default candidate JBFqnCBsd6RMkjVDRZzb; multilingual_v2 and PCM24k retain the app audio contract. Native original-text character timestamps replace the extra Whisper alignment request. No key exists in the app; authentication, committed-turn isolation, quotas, deletion checks and cancellation remain. Missing credentials do not consume quota; malformed or mismatched alignment falls back to text. No provider generation, backend deployment or activation was performed.

Reference: [ElevenLabs timestamp API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps).

## Validation

Backend voice and alignment tests pass locally, including ElevenLabs fixtures, grapheme boundaries and missing-key/mismatch handling. Product harness passes 82/82 with the pre-edit baseline and enforce-scope. Physical Screen Time/audio quality and signed distribution require a later iPhone build; CI does not certify them.

- Runtime source `151d64ad288713f62cb057ee3f6d863d770ee7e7`: [native Swift tests, Simulator build and six affected UI flows](https://github.com/guillemarcos14/BlankmindAI/actions/runs/38239994393) pass. Tests verify long-reply text and >=47pt of lower card clearance, nested route/group/sheet back, settled regular unlock, Control, Progress and accessibility form editing. Final Home captures pass and were inspected on Pro/compact/accessibility text under `tmp/product-polish-visuals-151d64a`.
- [Complete gate](https://github.com/guillemarcos14/BlankmindAI/actions/runs/38240000083) passes all three jobs: contract/runtime, PostgreSQL and Android.
- The initial full suite on `2ba4e19` passed 16/17 cases; the original long-reply assertion still queried a static-text element and failed after the TextKit change. A first six-case confirmation on `4197916` retained two failures (unsettled enabled state and missing card AX container). Original result bundles remain in `tmp/product-polish-ui-*`; neither failed run is described as passing. The corrected six cases all pass on `151d64a`; unchanged coverage remains from the initial diagnostic run.
- Initial batched visual inspection covers Control/Protection/account, Home idle/active/long, compact iPhone and accessibility text. Source-tagged captures and UI attachments are under `tmp/product-polish-visuals-2ba4e19` and `tmp/product-polish-ui-151d64a`.

## Deferred voice setup

Guillem selected Spanish Spain `dNjJKg63Fr5AXwIdkATa` and American English `WtA85syCrJwasGeHGH2p`. The adapter selects `ELEVENLABS_VOICE_ID_ES` / `ELEVENLABS_VOICE_ID_EN` using the response language persisted on each completed turn, not the current device locale. Migration 034 adds a nullable checked language column and must precede deployment of the new assistant writer. Legacy turns without a recorded language fall back to text, without guessing an accent or using the rejected George voice. Fixtures cover both voices and canonical text; no live generation of these two voices is claimed. The earlier George sample remains separate evidence.

The new restricted QA credential was created with explicit confirmation, encrypted locally with Windows DPAPI, and validated with the earlier George sample (69 characters, 4.6904 seconds). Reading/decrypting it for the newly selected voice tests was rejected by automatic security review (`blocked by policy`); it was not retried through another mechanism. Selected voices have not been stored in Netlify or activated. `getblank`'s existing key returned 401 `invalid_api_key` and its old voice ID was malformed; QA had neither variable. Finish credential handoff, consent/disclosure and private QA integration before activation.

Guillem does not know whether an ElevenLabs credential already exists and requested that setup be done together at the end. Start with account access; then inspect existing protected server configuration, choose/audition an available voice, add ElevenLabs to the applicable consent/privacy disclosure and validate a private QA deployment before activation. No live provider quality, credential presence or new distribution is claimed by this implementation.
