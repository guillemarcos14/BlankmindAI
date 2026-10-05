# UI refinements — 2026-10-05, second pass

## Implemented
- Home display: Helvetica Neue medium 36pt instead of 32pt; scaled 34pt row pitch keeps the existing compact footprint and reduces the optical gap. Dynamic Type, scroll, palette and gestures are preserved.
- Chat: removed the English/Spanish dictation review caption. Audio recording, waveform, transcript, sending and error handling are unchanged.
- Settings: Emergency is first; Assistant shortcut removed. Blankmind label, accessibility detail, destination and settings implementation are unchanged.
- Emergency: content group is centered horizontally and vertically across the viewport. Back remains at the top; large content can scroll. Unlock allowance, confirmation and protection checks are unchanged.
- Simulator screenshot coverage includes inactive/active Emergency.

## Validation
Local product harness: 68/69, baseline/scope has no violations. The existing release_gate_quick requirement fails on insufficient replay evidence and physical-device cases. git diff --check passed.

Native compilation and new screenshot review are pending. GitHub push was rejected by automatic approval review because this session did not explicitly authorize the external upload. Changes remain local; no new build or TestFlight distribution.

## Approved and implemented — a9ca624
Guillem approved the proposal and requested compilation/upload to TestFlight. The ambiguous Blankmind card has been replaced with two clear entries:

1. **Automatic protection**: whether Blankmind may act, what it may change, allowed hours and maximum block duration. Show actions in plain language; keep daily/weekly budgets, minimum interval and permission expiry in Advanced. Keep pause for 24 hours and revoke permission visible. Recent activity belongs here.
2. **Notifications**: whether to receive notices, which kinds and allowed hours. Keep frequency budgets in Advanced. State plainly that notifications do not grant permission to block.

The two destinations share the existing account settings and versioned save API. Opening either loads both sets of preferences so saving preserves the other section. Preferences cannot be saved before a successful load; failed loads offer Try again. Activity loading failure does not prevent editing successfully loaded preferences. No backend deployment is required.

Local validation: 68/69; existing release evidence requirement remains unmet. Push was rejected again by automatic review because it treats TestFlight authorization separately from private source upload to GitHub. Explicit GitHub authorization is pending; native build/archive/upload must use the new candidate, not the previous Mac checkout.
