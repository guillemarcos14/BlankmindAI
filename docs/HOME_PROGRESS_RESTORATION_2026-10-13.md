# Home and Progress restoration — 2026-10-13

Guillem requires the existing native appearance, with ElevenLabs replacing only the spoken reply provider. The basic-access presentation introduced in 2957e2b replaced Home and hid Progress when measured sleep was missing; this was outside the requested visual scope.

## Change

Home always renders the existing AssistantAppView panel and 70-point microphone. Progress always renders the existing RestProgressContent cards, charts and empty states. Fonts, colors, atmosphere, assets, dimensions, navigation, voice gestures and ElevenLabs transport remain intact. Sample disclosure remains visible only for an explicitly selected sample source.

The presentation no longer grants AI access. Home passes its existing restAIAvailable policy into the assistant: history, recording and send wait for access, and an explicit attempt opens the existing SetupView. Revocation clears visible turns and invalidates in-flight completion. No backend, credentials, Health source, provisioning, version or build number changes.

## Evidence

- Home visual body matches 151d64a byte-for-byte after removing the nonvisual access guard: SHA256 2c01412991d4d3a0e6a380389ae900d7517879d3c257b787e333d40ff3576fab.
- Progress content matches 2957e2b^ byte-for-byte. Existing back gesture retained.
- Native regression covers the original microphone/panel and Progress controls with no sleep, absence of fabricated positive results, and access setup on microphone tap. Conversation test checks no history/send transport while access is unavailable, preserving the draft.
- First native run 38393062554 failed in the extracted test fixture because its new properties were absent; repaired in d9c68e6. Original logs retained in GitHub.
- Initial harness while source was dirty: 88/89; clean f9c98cd: 89/89 with baseline and enforced scope. Final candidate verification follows below.

## Device status

Public TestFlight 1.9(112) still contains the rejected presentation. This correction needs a new signed build and TestFlight upload before iPhone validation. QA113 is reserved; check current Apple numbering before a public build. No App Review submission. MacinCloud is not available in this chat yet.

## Confirmed restoration validation

- Native source d9c68e6 is identical to the final 009d312 application source; subsequent changes repaired test fixtures and expectations only. Simulator build, native logic and full UI suite pass in run 38394109196. The targeted basic suite also passes in run 38394118987. Both runs continue their screenshot export at this recording; no claim of overall workflow completion.
- Downloaded native captures from run 38393347485 (cancelled after the test compilation failure, with simulator build and screenshot generation preserved) compare against the pre-voice 151d64a captures: Home 1206x2622 is identical, zero differing pixels. Progress differs in 406 pixels confined to x=169..968, y=2497..2501 in the time-dependent chart axis; all remaining pixels are identical. Screenshot references and JSON comparisons are in tmp/visual-restoration.
- Final code/test candidate 009d312: product harness 89/89, baseline enforced scope, ph_1791892839383_60a042e4.
- Failed test-fixture runs and cancelled superseded work remain in GitHub; no failed result was rewritten.
- Device distribution is blocked solely on opening MacinCloud in this chat. The source correction is validated; it is not yet in TestFlight112.
