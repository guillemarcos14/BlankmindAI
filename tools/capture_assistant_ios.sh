#!/usr/bin/env bash
set -euo pipefail

# Debug-only fixtures render the production SwiftUI view without user accounts,
# network requests, push registration or Screen Time mutations.
app="${1:?built simulator app path required}"
output="${2:-tmp/ios-visual}"
mkdir -p "$output"
device_id=$(xcrun simctl list devices available -j | python3 -c '
import json,sys
devices=[d for group in json.load(sys.stdin)["devices"].values() for d in group if d["name"].startswith("iPhone")]
preferred=sorted(devices,key=lambda d:("Pro" not in d["name"],d["name"]),reverse=False)
if not preferred: raise SystemExit("No iPhone simulator available")
print(preferred[0]["udid"])
')
xcrun simctl boot "$device_id" || true
xcrun simctl bootstatus "$device_id" -b
xcrun simctl status_bar "$device_id" override --time '9:41' --batteryState charged --batteryLevel 100
xcrun simctl install "$device_id" "$app"
bundle=$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Info.plist")
for scenario in action active active-empty active-error error empty signin history product-home product-home-active product-home-response product-home-error product-home-long product-control product-control-active product-shell-progress product-menu product-menu-active product-progress product-progress-active product-settings product-settings-active product-distractions product-distractions-active product-emergency product-emergency-active product-automatic product-automatic-active product-notifications product-notifications-active; do
  xcrun simctl terminate "$device_id" "$bundle" 2>/dev/null || true
  SIMCTL_CHILD_BLANK_UI_SCENARIO="$scenario" xcrun simctl launch "$device_id" "$bundle" -AppleLanguages '(es)' -AppleLocale es_ES
  sleep 3
  xcrun simctl io "$device_id" screenshot "$output/phone-$scenario.png"
done
xcrun simctl ui "$device_id" appearance dark
xcrun simctl terminate "$device_id" "$bundle" 2>/dev/null || true
SIMCTL_CHILD_BLANK_UI_SCENARIO=product-home xcrun simctl launch "$device_id" "$bundle"
sleep 3
xcrun simctl io "$device_id" screenshot "$output/phone-product-home-dark.png"
xcrun simctl ui "$device_id" appearance light
xcrun simctl terminate "$device_id" "$bundle" 2>/dev/null || true
SIMCTL_CHILD_BLANK_UI_SCENARIO=product-menu xcrun simctl launch "$device_id" "$bundle" -UIPreferredContentSizeCategoryName UICTContentSizeCategoryAccessibilityXXXL
sleep 3
xcrun simctl io "$device_id" screenshot "$output/phone-product-menu-dynamic-type.png"
xcrun simctl terminate "$device_id" "$bundle" 2>/dev/null || true
SIMCTL_CHILD_BLANK_UI_SCENARIO=action xcrun simctl launch "$device_id" "$bundle" -AppleLanguages '(es)' -AppleLocale es_ES -UIPreferredContentSizeCategoryName UICTContentSizeCategoryAccessibilityXXXL
sleep 3
xcrun simctl io "$device_id" screenshot "$output/phone-dynamic-type.png"
xcrun simctl terminate "$device_id" "$bundle" 2>/dev/null || true
SIMCTL_CHILD_BLANK_UI_SCENARIO=error xcrun simctl launch "$device_id" "$bundle" -AppleLanguages '(es)' -AppleLocale es_ES -UIPreferredContentSizeCategoryName UICTContentSizeCategoryAccessibilityXXXL
sleep 3
xcrun simctl io "$device_id" screenshot "$output/phone-dynamic-type-error.png"

# A second actual iPhone viewport checks the reference's fixed voice/nav chrome
# against a short display; this remains a native render, never a browser facsimile.
runtime=$(xcrun simctl list runtimes -j | python3 -c 'import json,sys; print(next(r["identifier"] for r in json.load(sys.stdin)["runtimes"] if r.get("isAvailable") and "iOS" in r["name"]))')
compact=$(xcrun simctl create 'Blank Home Compact' com.apple.CoreSimulator.SimDeviceType.iPhone-SE-3rd-generation "$runtime")
xcrun simctl boot "$compact"
xcrun simctl bootstatus "$compact" -b
xcrun simctl install "$compact" "$app"
SIMCTL_CHILD_BLANK_UI_SCENARIO=product-home-response xcrun simctl launch "$compact" "$bundle" -AppleLanguages '(en)' -AppleLocale en_US
sleep 3
xcrun simctl io "$compact" screenshot "$output/phone-compact-home.png"
xcrun simctl terminate "$compact" "$bundle"
SIMCTL_CHILD_BLANK_UI_SCENARIO=product-home-error xcrun simctl launch "$compact" "$bundle" -UIPreferredContentSizeCategoryName UICTContentSizeCategoryAccessibilityXXXL
sleep 3
xcrun simctl io "$compact" screenshot "$output/phone-compact-dynamic-error.png"
xcrun simctl shutdown "$compact"
xcrun simctl list devices -j > "$output/simulator.json"
printf '%s\n' 'Synthetic Debug fixtures; production SwiftUI; no native blocking validation.' > "$output/README.txt"
