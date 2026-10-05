# UI refinements — 2026-10-05, second pass

## Implemented
- Home display: Helvetica Neue medium 36pt instead of 32pt; scaled 34pt row pitch keeps the existing compact footprint and reduces the optical gap. Dynamic Type, scroll, palette and gestures are preserved.
- Chat: removed the English/Spanish dictation review caption. Audio recording, waveform, transcript, sending and error handling are unchanged.
- Settings: Emergency is first; Assistant shortcut removed. Blankmind is replaced by Automatic protection and Notifications, each opening its own preferences.
- Emergency: content group is centered horizontally and vertically across the viewport. Back remains at the top; large content can scroll. Unlock allowance, confirmation and protection checks are unchanged.
- Simulator screenshot coverage includes inactive/active Emergency.

## Validation
Local product harness: 68/69, baseline/scope has no violations. The existing release_gate_quick requirement fails on insufficient replay evidence and physical-device cases. git diff --check passed.

Guillem explicitly authorized GitHub upload; final candidate 2566f82 is pushed to PR #15. MacinCloud FF368 compiled Debug successfully and generated the signed archive Blankmind 1.9 (101). codesign deep/strict passes; embedded build 101 and the private staging API URL are verified. qa100/qa101.xcconfig differ from their preceding configurations only in CURRENT_PROJECT_VERSION.

Final archive: /Users/user301201/blankmind-release-20261005/Blankmind101-Settings-2566f82.xcarchive.

Guillem reconnected Apple after No Accounts. Xcode confirms App upload complete / Blankmind 1.9 (101) uploaded through TestFlight Internal Only. Evidence: tmp/testflight101-uploaded.png. Build 100 was also uploaded; 101 includes the final accessibility fix. Apple processing/tester availability is not verified. No physical-device protection evidence is claimed.

The first visual pass reviewed Settings, both preferences in light/active appearance, centered Emergency and Home. It found Distractions truncated at maximum Dynamic Type; 2566f82 lowers the Home minimum scale factor to 0.5. Final CI 37301072348 passed all native tests, Simulator build and screenshots; the confirmation image shows the full Distractions label at maximum Dynamic Type. Evidence: tmp/settings-split-2566f82/phone-product-menu-dynamic-type.png. BM/PostgreSQL/Android gate 37301072342 passed. Earlier full iOS CI 37299551142/37299544931 passed; evidence tmp/settings-split-b7b6a4a.

## Approved and implemented — a9ca624
Guillem approved the proposal and requested compilation/upload to TestFlight. The ambiguous Blankmind card has been replaced with two clear entries:

1. **Automatic protection**: whether Blankmind may act, what it may change, allowed hours and maximum block duration. Show actions in plain language; keep daily/weekly budgets, minimum interval and permission expiry in Advanced. Keep pause for 24 hours and revoke permission visible. Recent activity belongs here.
2. **Notifications**: whether to receive notices, which kinds and allowed hours. Keep frequency budgets in Advanced. State plainly that notifications do not grant permission to block.

The two destinations share the existing account settings and versioned save API. Opening either loads both sets of preferences so saving preserves the other section. Preferences cannot be saved before a successful load; failed loads offer Try again. Activity loading failure does not prevent editing successfully loaded preferences. No backend deployment is required.

Local validation: 68/69; existing production release evidence requirement remains unmet. Baseline/diff-base f9c056e/enforced scope has no violations. No backend deployment. TestFlight 101 upload is complete.
