# Small Blank widget

Base: product improvements f84c244 (PR34), including App Store preparation 99b95e7. Branch: codex/widget-small-control-2026-10-12.

The 2x2 widget uses the app's original MinimalAtmosphere asset, with a darker protected state. The only visible control is a recessed circular padlock at the lower right, 40% of widget width with a 9% inset and a minimum 44pt touch target. The entire remaining surface opens Home, including when the app was left in a section. There is no title, descriptive text, separate Home icon or disabled action label. The countdown replaces the padlock inside the circle.

The button reads current shared protection rather than trusting the rendered entry. It starts the saved distraction selection, or requests a 60-second delayed regular unlock. Protection remains active during that countdown. A DeviceActivity interval starts at the rounded-up deadline and spans 15 minutes, matching the existing expiry scheduling pattern; the START callback performs the release. The app and widget provider also reconcile due state. Repeated requests retain the original deadline, and the callback validates the original session timestamp and hard-protection state before changing shields. A rejected monitoring registration rolls back a new request, retaining protection.

Only the unnamed manual-protection store is cleared. Independent recurring/daily-limit protections remain in force. Regular unlock ends the session with reason control, without emergency consumption or a relapse event. The existing 60-second restriction on restarting protection is retained and displayed in the same circular countdown. App-prepared timed blocks also register their existing native expiry monitors.

The interactive extension requires iOS17; the main app's deployment target remains unchanged. Existing Lock Screen widget placements are retained. All interaction remains within WidgetKit/AppIntents, not a long-press recognizer or in-process background sleep.

## Validation

Native shared-state tests exercise missing configuration, duplicate start, hard protection, a 60-second deadline, repeated unlock, process restart, no early release, stale session callback, replay, recorded session reason, restart cooldown and earlier timed expiry. Existing protection tests remain enabled.

The macOS renderer uses the production SwiftUI material and button at 158pt @3x, the original atmosphere/font, and a fixed 00:42 countdown fixture. These images check rendering; they do not certify WidgetKit tap routing or Screen Time callbacks on a physical iPhone. Simulator compilation, native tests and physical validation are separate layers. No archive, TestFlight or App Store submission is part of this change.

- Runtime `dec483a`: native tests, Simulator compilation and all four widget render fixtures pass in [iOS CI](https://github.com/guillemarcos14/BlankmindAI/actions/runs/38245882926). Idle/active/cooldown were inspected; the final active rendering matches the earlier inspected surface byte-for-byte. Main-app UI regression and capture status are tracked in that workflow separately.
- Product harness passes 82/82 with the original baseline and enforce-scope (`ph_1791806284597_d0f4e0eb`). The [complete PR gate](https://github.com/guillemarcos14/BlankmindAI/actions/runs/38246146212) passes contracts/runtime, PostgreSQL and Android.
- [PR36](https://github.com/guillemarcos14/BlankmindAI/pull/36) is a draft stacked on PR34. No merge, archive, signed build, installation, distribution or physical WidgetKit/Screen Time validation is claimed.
