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
settle_capture() {
  case "$1" in
    product-onboarding-*) sleep 10 ;;
    *) sleep 3 ;;
  esac
}
scenarios='action active active-empty active-error error empty signin history product-home product-home-active product-home-response product-home-error product-home-long product-control product-control-active product-shell-progress product-menu product-menu-active product-progress product-progress-active product-settings product-settings-active product-distractions product-distractions-active product-emergency product-emergency-active product-emergency-confirm-active product-automatic product-automatic-active product-notifications product-notifications-active'
if [ "${3:-all}" = home ]; then
  scenarios='product-home product-home-active product-home-response product-home-error product-home-long product-control product-control-active product-shell-progress'
fi
if [ "${3:-all}" = uniform ]; then
  scenarios='product-home product-home-active product-home-error product-home-long product-control product-control-active product-shell-progress product-progress-active product-distractions product-distractions-active product-schedule product-schedule-active product-emergency product-emergency-active product-emergency-confirm-active product-automatic product-automatic-active product-automatic-error product-notifications product-notifications-active product-account product-onboarding-account product-onboarding-device history'
fi
if [ "${3:-all}" = onboarding ]; then
  scenarios='product-home product-onboarding-account product-onboarding-device'
fi
for scenario in $scenarios; do
  xcrun simctl terminate "$device_id" "$bundle" 2>/dev/null || true
  SIMCTL_CHILD_BLANK_UI_SCENARIO="$scenario" xcrun simctl launch "$device_id" "$bundle" -AppleLanguages '(es)' -AppleLocale es_ES
  settle_capture "$scenario"
  xcrun simctl io "$device_id" screenshot "$output/phone-$scenario.png"
done
if [ "${3:-all}" = uniform ] || [ "${3:-all}" = onboarding ]; then
  large_scenarios='product-control product-shell-progress product-schedule product-automatic product-notifications product-onboarding-account product-onboarding-device'
  if [ "${3:-all}" = onboarding ]; then large_scenarios='product-onboarding-account product-onboarding-device'; fi
  for scenario in $large_scenarios; do
    xcrun simctl terminate "$device_id" "$bundle" 2>/dev/null || true
    SIMCTL_CHILD_BLANK_UI_SCENARIO="$scenario" xcrun simctl launch "$device_id" "$bundle" -UIPreferredContentSizeCategoryName UICTContentSizeCategoryAccessibilityXXXL
    settle_capture "$scenario"
    xcrun simctl io "$device_id" screenshot "$output/phone-$scenario-dynamic-type.png"
  done
  xcrun simctl ui "$device_id" appearance dark
  for scenario in product-onboarding-account product-onboarding-device; do
    xcrun simctl terminate "$device_id" "$bundle" 2>/dev/null || true
    SIMCTL_CHILD_BLANK_UI_SCENARIO="$scenario" xcrun simctl launch "$device_id" "$bundle"
    settle_capture "$scenario"
    xcrun simctl io "$device_id" screenshot "$output/phone-$scenario-dark.png"
  done
  xcrun simctl ui "$device_id" appearance light
fi
if [ "${3:-all}" != onboarding ]; then
xcrun simctl ui "$device_id" appearance dark
xcrun simctl terminate "$device_id" "$bundle" 2>/dev/null || true
SIMCTL_CHILD_BLANK_UI_SCENARIO=product-home xcrun simctl launch "$device_id" "$bundle"
sleep 3
xcrun simctl io "$device_id" screenshot "$output/phone-product-home-dark.png"
xcrun simctl ui "$device_id" appearance light
xcrun simctl terminate "$device_id" "$bundle" 2>/dev/null || true
SIMCTL_CHILD_BLANK_UI_SCENARIO=product-home xcrun simctl launch "$device_id" "$bundle" -UIPreferredContentSizeCategoryName UICTContentSizeCategoryAccessibilityXXXL
sleep 3
xcrun simctl io "$device_id" screenshot "$output/phone-product-chat-dynamic-type.png"
xcrun simctl terminate "$device_id" "$bundle" 2>/dev/null || true
SIMCTL_CHILD_BLANK_UI_SCENARIO=product-home-response xcrun simctl launch "$device_id" "$bundle" -AppleLanguages '(es)' -AppleLocale es_ES -UIPreferredContentSizeCategoryName UICTContentSizeCategoryAccessibilityXXXL
sleep 3
xcrun simctl io "$device_id" screenshot "$output/phone-dynamic-type.png"
xcrun simctl terminate "$device_id" "$bundle" 2>/dev/null || true
SIMCTL_CHILD_BLANK_UI_SCENARIO=product-home-error xcrun simctl launch "$device_id" "$bundle" -AppleLanguages '(es)' -AppleLocale es_ES -UIPreferredContentSizeCategoryName UICTContentSizeCategoryAccessibilityXXXL
sleep 3
xcrun simctl io "$device_id" screenshot "$output/phone-dynamic-type-error.png"
fi

# A second actual iPhone viewport checks the reference's fixed voice/nav chrome
# against a short display; this remains a native render, never a browser facsimile.
runtime=$(xcrun simctl list runtimes -j | python3 -c 'import json,sys; print(next(r["identifier"] for r in json.load(sys.stdin)["runtimes"] if r.get("isAvailable") and "iOS" in r["name"]))')
xcrun simctl shutdown "$device_id"
compact=$(xcrun simctl create 'Blank Home Compact' com.apple.CoreSimulator.SimDeviceType.iPhone-SE-3rd-generation "$runtime")
xcrun simctl boot "$compact"
xcrun simctl bootstatus "$compact" -b
xcrun simctl install "$compact" "$app"
if [ "${3:-all}" != onboarding ]; then
SIMCTL_CHILD_BLANK_UI_SCENARIO=product-home-response xcrun simctl launch "$compact" "$bundle" -AppleLanguages '(en)' -AppleLocale en_US
sleep 8
xcrun simctl io "$compact" screenshot "$output/phone-compact-home.png"
xcrun simctl terminate "$compact" "$bundle"
SIMCTL_CHILD_BLANK_UI_SCENARIO=product-home-error xcrun simctl launch "$compact" "$bundle" -UIPreferredContentSizeCategoryName UICTContentSizeCategoryAccessibilityXXXL
sleep 8
xcrun simctl io "$compact" screenshot "$output/phone-compact-dynamic-error.png"
fi
if [ "${3:-all}" = uniform ] || [ "${3:-all}" = onboarding ]; then
  compact_scenarios='product-control product-schedule product-notifications product-onboarding-account product-onboarding-device'
  if [ "${3:-all}" = onboarding ]; then compact_scenarios='product-onboarding-account product-onboarding-device'; fi
  for scenario in $compact_scenarios; do
    xcrun simctl terminate "$compact" "$bundle" 2>/dev/null || true
    SIMCTL_CHILD_BLANK_UI_SCENARIO="$scenario" xcrun simctl launch "$compact" "$bundle" -AppleLanguages '(en)' -AppleLocale en_US
    settle_capture "$scenario"
    xcrun simctl io "$compact" screenshot "$output/phone-compact-$scenario.png"
  done
  for scenario in product-onboarding-account product-onboarding-device; do
    xcrun simctl terminate "$compact" "$bundle" 2>/dev/null || true
    SIMCTL_CHILD_BLANK_UI_SCENARIO="$scenario" xcrun simctl launch "$compact" "$bundle" -UIPreferredContentSizeCategoryName UICTContentSizeCategoryAccessibilityXXXL
    settle_capture "$scenario"
    xcrun simctl io "$compact" screenshot "$output/phone-compact-$scenario-dynamic-type.png"
  done
fi
xcrun simctl list devices -j > "$output/simulator.json"
printf '%s\n' 'Synthetic Debug fixtures; production SwiftUI; no native blocking validation.' > "$output/README.txt"
xcrun simctl shutdown "$compact"
