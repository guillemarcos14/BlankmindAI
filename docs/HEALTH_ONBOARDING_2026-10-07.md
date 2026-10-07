# Screen Time + Health onboarding

Decision approved by Guillem on 2026-10-07. Branch `codex/health-onboarding-2026-10-07`, base `4b23676`. Apple account sign-in remains. Atmospheric Home material, fonts, native permissions and accessibility remain.

## Entry
Screen Time approval and actual recent recorded sleep are mandatory. The full existing Health read list remains (sleep/activity/workouts/mindfulness/cardiovascular/respiratory signals); no write permissions. Completing the Apple permission sheet is not proof of read authorization. Query the last 28 days and require at least one non-manual, past, positive-duration asleep interval. No arbitrary 10/14-night cutoff: the agreed criterion was zero versus usable data. Available data does not establish sufficient coverage for every analysis, device use every night, stress, diagnosis, improvement or causality. Track Watch provenance separately; other recorded sleep sources remain usable.

Empty data, request/query failure and timeout stay in preparation. Review access provides native in-app instructions; sleep setup opens Apple's official guide; check again reads without repeating onboarding. Resume on foreground, preserve setup progress, check fresh data on launch, and return to preparation if Screen Time is revoked or sleep becomes unavailable. A blocked/locked-device query is not reported as rejection. Simulator-only preview shortcuts are excluded from physical iPhone builds.

## First conversation
After native setup, Home Chat offers Choose apps using the existing native reusable picker. Selecting apps does not execute a block. With a list, offer notifications with Not now, persisted by account. Denial can open app Settings and does not prevent chat or in-app blocking. Existing Settings remain available. No synthetic transcript or generated AI is needed for these deterministic setup messages, and existing pending action/selection workflows remain authoritative.

## Backend
Authenticated `complete_onboarding` opts into version6 and requires Screen Time plus fresh (<10min) native sleep availability. App entry is separate from action execution readiness. Version6 does not require app selection, notification permission or push token for entry; legacy apps and external channels retain their prior contract. Continue validating identity/install ownership. Only availability and check timestamp travel in the setup context, not sleep records or extra metrics. Existing consent rules continue to govern Health-derived uploads/AI; Health permission is not automatically AI consent.

## Validation and release
New pure Swift policy tests cover absence, in-bed/awake, manual/stale/future/invalid records and mandatory gates. Backend tests cover normalized context, freshness, nonboolean claims and legacy/external contracts. XCTest covers preparation recovery, first-chat selection, notification deferral and accessibility text. Run native build and captures on macOS CI; physical Screen Time/Health sheets and Watch provenance need an iPhone with recorded sleep.

Verified: all 10 Home/onboarding UI tests, native tests and Simulator build passed in run `37609663316`. Its screenshot step reached the original 15-minute limit after 49 native images; capture budget is now 20 minutes. Backend/Android/PostgreSQL CI passed on final native source `19fe5e2` in run `37612924706`. The product harness passed 71/71 checks with baseline and enforced scope (`ph_1791371795004_37f3f9ca`). A targeted final capture/accessibility confirmation is run `37612917281`.

No production deployment, API agreement, migration or TestFlight upload is part of this implementation. Publish coordinated backend + iOS candidate through release before testing real access: old backend correctly rejects version6 until updated.
