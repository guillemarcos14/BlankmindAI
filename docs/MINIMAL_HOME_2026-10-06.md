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
