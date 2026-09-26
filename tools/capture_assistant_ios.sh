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
for scenario in action active error empty signin history; do
  xcrun simctl terminate "$device_id" "$bundle" 2>/dev/null || true
  SIMCTL_CHILD_BLANK_UI_SCENARIO="$scenario" xcrun simctl launch "$device_id" "$bundle" -AppleLanguages '(es)' -AppleLocale es_ES
  sleep 3
  xcrun simctl io "$device_id" screenshot "$output/phone-$scenario.png"
done
xcrun simctl terminate "$device_id" "$bundle" 2>/dev/null || true
SIMCTL_CHILD_BLANK_UI_SCENARIO=action xcrun simctl launch "$device_id" "$bundle" -AppleLanguages '(es)' -AppleLocale es_ES -UIPreferredContentSizeCategoryName UICTContentSizeCategoryAccessibilityXXXL
sleep 3
xcrun simctl io "$device_id" screenshot "$output/phone-dynamic-type.png"
xcrun simctl terminate "$device_id" "$bundle" 2>/dev/null || true
SIMCTL_CHILD_BLANK_UI_SCENARIO=error xcrun simctl launch "$device_id" "$bundle" -AppleLanguages '(es)' -AppleLocale es_ES -UIPreferredContentSizeCategoryName UICTContentSizeCategoryAccessibilityXXXL
sleep 3
xcrun simctl io "$device_id" screenshot "$output/phone-dynamic-type-error.png"
xcrun simctl list devices -j > "$output/simulator.json"
printf '%s\n' 'Synthetic Debug fixtures; production SwiftUI; no native blocking validation.' > "$output/README.txt"
