# Blank for iPhone

This is the native iOS MVP for Blank.

## What works on iPhone

- Pair a physical NFC tag with Core NFC.
- Toggle Blank mode with the paired tag.
- Persist Blank state locally with `UserDefaults`.
- Select apps and categories with Apple's Screen Time picker.
- Shield the selected apps while Blank mode is active using `ManagedSettings`.

## Important Apple limitations

App blocking on iPhone uses Apple's Screen Time APIs:

- `FamilyControls`
- `ManagedSettings`
- `DeviceActivity` if scheduled monitoring is added later

To test real app blocking on a physical iPhone, the Apple Developer account and app identifier need the Family Controls entitlement approved by Apple. NFC also requires a real device; it does not work in the iOS Simulator.

## How to test

1. Open `ios/Blank/Blank.xcodeproj` in Xcode on macOS.
2. Select the `Blank` target and set your Team in Signing & Capabilities.
3. Keep the app bundle identifier as `com.blanknfc.app.ios` unless Apple forces a change.
4. Add/confirm these capabilities:
   - Near Field Communication Tag Reading
   - Family Controls
5. Select the `BlankDeviceActivityMonitor` target, use the same Team, and keep `com.blanknfc.app.ios.deviceactivity`.
6. Run on a physical iPhone.
7. In setup, authorize Screen Time access, scan the NFC tag, select apps, then finish setup.

If Family Controls is not approved for your developer account, the app can still run for UI/NFC testing, but iOS will not shield other apps.

For App Store Connect copy, privacy answers, review notes, screenshots, and the first archive checklist, use `docs/IOS_APP_STORE_PREP.md`.
