# iOS TestFlight and Family Controls

## Reality Check

Production app blocking must use Apple's Screen Time stack:

- `FamilyControls` for authorization and app/category selection.
- `ManagedSettings` for shielding selected apps and domains.
- `DeviceActivity` later if scheduled monitoring windows are needed.

The app in `ios/Blank` uses this architecture. Real shielding requires the Family Controls entitlement on the app identifier.

## Current iOS Build Scope

Implemented in the native SwiftUI app:

- Screen Time authorization request.
- FamilyActivityPicker app/category/domain selection.
- ManagedSettings shielding while Blank is active.
- NFC tag pairing and same-tag deactivation.
- Manual Blank activation with NFC required for normal exit.
- Timer sessions with a persisted end date and initial DeviceActivity scheduling.
- Emergency unlock phrase.
- Local setup state, sessions, weekly report, modes, background theme, and daily schedule.
- Reset and relink NFC flows.

Still requires a physical iPhone and Apple approval state:

- Family Controls distribution entitlement approval from Apple. The request was submitted on 2026-07-09 from Team ID `GS54UV79RG`.
- Real NFC validation on device; NFC does not work in Simulator.
- TestFlight install pass on at least a few real iPhones.
- Final App Review wording and screenshots.

## Apple Entitlement Request

Submitted from the Apple Developer account holder on 2026-07-09. Apple confirmed submission and said they will review the request and contact the account soon with a status update.

Project rationale:

```text
Blank is a digital wellbeing app that lets users voluntarily block their own distracting apps using a physical NFC tag as the activation/deactivation control.

The app uses FamilyControls so users can select the apps, app categories, and web domains they want to shield. It uses ManagedSettings to apply those shields only while the user has activated Blank mode with their paired NFC tag.

Blank does not monitor children, sell parental-control services, collect app usage content, read messages, read screen contents, or transmit selected apps to a server in this MVP. Selected tokens, paired tag state, and Blank mode state are stored locally on the device.

The user can deactivate Blank mode with the paired NFC tag and can reset the paired tag from inside the app when Blank mode is inactive.
```

## TestFlight Setup

1. Open `ios/Blank/Blank.xcodeproj` in Xcode.
2. Select the `Blank` target.
3. Set Team to `GUILLEM ARCOS GONZALEZ - GS54UV79RG`.
4. Keep the app bundle identifier as `com.blanknfc.app.ios`.
5. Select the `BlankDeviceActivityMonitor` target and keep its bundle identifier as `com.blanknfc.app.ios.deviceactivity`.
6. Use the same Team for both targets.
7. Add capabilities:
   - Family Controls.
   - Near Field Communication Tag Reading.
8. Confirm `Blank.entitlements` is attached to Debug and Release.
9. Confirm `BlankDeviceActivityMonitor.entitlements` is attached to Debug and Release for the extension.
10. Archive from Xcode.
11. Upload to App Store Connect.
12. Add internal testers first.
13. Test on physical iPhone; NFC does not work in Simulator.

The copy, metadata, privacy answers, review notes, and asset checklist for App Store Connect are in `docs/IOS_APP_STORE_PREP.md`.

## First QA Script

1. Launch app on a physical iPhone.
2. Authorize Screen Time.
3. Select at least one app/category/domain.
4. Scan an NFC tag to pair it.
5. Finish setup.
6. Start Blank manually.
7. Confirm selected apps/domains are shielded.
8. Scan the paired NFC tag and confirm shields clear.
9. Start Blank again and verify the emergency phrase clears shields.
10. Start Blank with a short timer and confirm shields clear after expiration.
11. Create a second mode, edit its selection, switch back to the default mode.
12. Enable a daily schedule and verify it persists after restart.
13. Relink NFC, then verify the old tag is rejected and the new tag works.

## Timer Caveat

The current timer flow stores its end date locally and attempts to schedule a DeviceActivity timer. The `BlankDeviceActivityMonitor` extension is wired as a Device Activity Monitor Extension target in `ios/Blank/Blank.xcodeproj` and embedded in the app.

Before relying on timer expiration in TestFlight, confirm:

- `BlankDeviceActivityMonitor/Info.plist` uses `com.apple.deviceactivity.monitor-extension`.
- `BlankDeviceActivityMonitor.entitlements` has Family Controls enabled.
- The extension bundle identifier is a child of the app bundle identifier, for example `com.blanknfc.app.ios.deviceactivity`.
- Both app and extension use the same Apple Developer Team.
- Timer expiration clears ManagedSettings shields when the app is backgrounded.

Foqos is the reference implementation for this extension-based step.

## App Review Notes

Use this review note:

```text
Blank is controlled by a physical NFC tag. During setup, the reviewer should authorize Screen Time access, scan an NFC tag, choose one or more apps/categories using the Apple Family Activity picker, then finish setup.

When Blank mode is activated with the paired tag, the app applies ManagedSettings shields to the selected apps/categories. Scanning the same tag again deactivates Blank mode and clears the shields.

Blank stores setup state locally and does not collect screen contents, messages, passwords, contacts, or browsing history.
```

## iOS QA Pass

- App launches and setup starts.
- Screen Time authorization succeeds or shows a clear error.
- NFC scan registers a physical tag.
- Selected apps/categories persist after app restart.
- Matching tag toggles Blank mode.
- Wrong tag is rejected.
- Shielded apps are blocked while Blank mode is active.
- Shields clear after deactivation.
- Forget tag resets setup when not blanked.
