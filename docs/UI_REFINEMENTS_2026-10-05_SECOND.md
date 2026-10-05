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

## Proposal only — awaiting Guillem's approval
Replace the ambiguous Blankmind card with two clear entries:

1. **Automatic protection**: whether Blankmind may act, what it may change, allowed hours and maximum block duration. Show actions in plain language; keep daily/weekly budgets, minimum interval and permission expiry in Advanced. Keep pause for 24 hours and revoke permission visible. Recent activity belongs here.
2. **Notifications**: whether to receive notices, which kinds and allowed hours. Keep frequency budgets in Advanced. State plainly that notifications do not grant permission to block.

No changes to this card or its settings have been implemented.
