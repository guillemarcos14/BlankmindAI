# Minimal App Home

Requested by Guillem on 2026-10-06: reproduce only the centre phone of
`C:/Users/Guillem/Desktop/b07ac7231f97ea8e3e7b33f2fb1d4704.jpg` as the native Home.
Use the actual atmosphere and Neue Montreal face from the local `blankmind-web`
project (the “Minimal Web” chat). Keep the reference's top icon navigation,
selected underline, bottom-rounded panel, centred response and round voice button.

Three top-level destinations, in reference order: Control, Chat, Progress.
Chat opens by default; Control includes existing settings, distractions and
schedules. Existing section interiors are retained. Back from a Control detail
returns to Control. Chat's latest response survives switching sections.

The existing authenticated conversation, audio capture/transcription, durable
drafts, retries and canonical action confirmation remain the implementation.
Recording stops when leaving Chat. Text input is available by tapping the centre
message or holding the voice button and choosing Write a message. Protection
holds move to Control; the 3-second block and 20-second unlock plus 60-second
cooldown preserve the original native policy, including hard protection.

Home-specific tokens and vector glyphs live in `MinimalHomeDesign.swift`.
The background pixels and font come unchanged from the supplied web; PNG
metadata records the source material's origin.
The image is shaded for ivory text contrast. No wearable integration is added.

Validation: baseline created before editing; native CI renders default, response,
error, long response, active protection, Control and Progress, plus dark mode,
maximum Dynamic Type and a compact iPhone SE. UI tests exercise the three actual
tabs, settings/detail/back, and scrolling long responses with fixed voice chrome.
These Debug fixtures are synthetic, with no account/network/Screen Time mutation.
Physical voice and Screen Time verification remain separate from Simulator QA.

Current token authority: [DESIGN.md](../DESIGN.md) and its schema-2
[sidecar](../.impeccable/design.json), extracted from native source. Home uses
ivory ink, cool lower ground, green-gray waveform ink and the bundled
`NeueMontreal-Regular` face. The former orb Home remains historical in
`HOME_ORB_2026-10-03.md`; its gestures and menu are superseded.

Native CI on source `b6f3c65` (run `37444032673`) passed the simulator build,
production-method conversation recovery tests, and both Home UI tests. Those
tests verify actual 44-point tab hit areas, Control/settings/detail/back routing,
return to Chat from Progress, and a fixed voice button during long-response scroll.
Local assistant API and audio-input contract tests passed. The product harness
reports 68/69 with no scope violations; its pre-existing production release gate
still lacks the required replay/physical-device evidence. This change does not
publish a new TestFlight or modify the backend.

Run `37444032673` produced all 14 native PNGs, including iPhone SE, dark mode
and accessibility text sizes. Its capture step timed out during final simulator
cleanup after the last image, so the overall run is not green. The PNGs are in
`.impeccable/review/`; capture timeout is now 15 minutes with a 30-minute job
budget, and metadata is saved before shutting down the last Simulator.

Final independent native review: **ship** for the approved Home and main
navigation. All 14 captures were opened and accepted, including reference
fidelity, error/recovery, long replies, compact layout, dark mode and maximum
Dynamic Type. [Review report](../tmp/minimal-home-finish-review.md) and
[native captures](../.impeccable/review/) record this Simulator verdict.
It does not certify physical microphone, Screen Time effects or hardware
performance; the pre-existing release gate still lacks replay and physical
device evidence (0/20). No green rerun or deployment is claimed.
