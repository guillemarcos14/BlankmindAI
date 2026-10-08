# Rest-focused Progress · 2026-10-08

## Behavior

Progress now centers on perceived morning rest, measured sleep trends, physical context relative to the individual's reference, and the association with recorded disconnection. Existing atmospheric header, navigation, Neue Montreal, adaptive colors, 16pt card corners, spacing and main scroll shell remain in use. No global theme changes.

The morning check-in is collapsed by default to keep the overview compact. All health context opens within the existing Progress scroll shell, preserving the atmospheric header, and Back returns to the overview. A 1–5 morning check-in saves once per local calendar day and authenticated account, allows updating today, retains at most 180 entries, and is removed on successful account deletion. Sign-out/account switches clear the visible context; returning owners keep their own check-ins. Check-ins never go to a server in this feature.

Current week is the last seven local days. Reference is the preceding 28 days, with at least three current and seven reference observations for numerical changes. Sparse/missing records remain unknown. Trend selection covers perceived rest, duration, local sleep onset and estimated awake time; line segments do not bridge missing days.

Sleep samples are reconciled into main episodes by source and local wake date. Overlapping durations and duplicate providers do not get summed. Recorded waking is not assumed to be complete. The pulse row uses only samples inside measured sleep intervals; HRV is labeled as a daily metric. The real-app synthetic sleep option remains explicitly marked, does not create physical metrics or check-ins, and cannot produce a protection/rest association.

Recorded protection is clipped to the hour before onset and first hour after waking, merges overlapping sessions and subtracts pauses. An association needs five measured nights with at least 45 protected minutes and five with no recorded protection, matching check-ins after waking, and observation after the owner started using this version. Intermediate protection is excluded. Neither causation nor actual screen-off time is claimed.

## Health coverage

RestHealthCatalog covers 199 sample types plus five directly readable characteristics (204 identifiers in the catalogue). Age is derived from birthdate; biological sex, blood type, Fitzpatrick skin type and wheelchair use appear only when readable, without inventing sample timestamps. These fields use [Apple’s characteristic read APIs](https://developer.apple.com/documentation/healthkit/hkcharacteristictype). RestHealthCatalog enumerates stable quantity and category types, symptoms, reproductive data, nutrition, hearing/environment, movement, clinical record types, workouts, ECG, audiograms and state of mind, with runtime availability guards. There is no read-all HealthKit permission: each supported type is requested explicitly. Newer identifiers absent from the compiled SDK and special per-object/series/activity-summary workflows are not automatically available. No promise that every metric exists or has read authorization.

Trend context is read locally for the preceding 35 days; clinical records include available history beyond that window, with six sample queries at a time, 12-second query timeouts, a 90-second overall timeout and up to 10,000 latest samples per type. Cumulative metrics use native HealthKit daily statistics. Discrete metrics show daily sample averages and sources. Structured record entries show up to 100 recent names/details and sources. Clinical original FHIR documents and ECG waveforms remain in Apple Health. Read-denial is opaque and is never inferred from zero results.

Clinical Health Records capability and purpose string are included. Signed distribution requires a matching Apple provisioning profile; the existing build109 profile is not presumed compatible. No backend schema/migration/deployment or expanded AI transmission is introduced. Existing BM health consent and pipelines are preserved separately.

## Validation and delivery

Baseline: c3dd08a (current QA109 sleep correction), dedicated branch codex/progress-rest-2026-10-08. Harness baseline saved before edits in tmp/product-harness/baseline.json.

Native tests cover duplicate/provider reconciliation, wake dates and DST, missing awake samples, account-scoped check-ins/update/delete, non-overlapping reference windows, sparse history, protection overlaps/pauses and unknown comparison history. iOS CI includes the actual model tests, simulator build, existing navigation suite plus Progress trend/detail navigation, and native Progress screenshots on normal, active, empty, detail, accessibility and compact iPhone variants.

Final implementation is committed on the dedicated branch and attached as [PR31](https://github.com/guillemarcos14/BlankmindAI/pull/31). No new archive or TestFlight upload was performed.

### Final evidence

- Native source: `390c6f0`. [iOS run37804182260](https://github.com/guillemarcos14/BlankmindAI/actions/runs/37804182260) passed the native model checks, simulator compilation and all three affected XCTest flows: Progress trend/detail/back/chat, minimum touch target and native control dismissal, and edge navigation. The complete earlier suite passed twelve unaffected cases and exposed the two corrected failures; it is not represented as a complete final-source fourteen-case run.
- [BM Harness Gate37804189035](https://github.com/guillemarcos14/BlankmindAI/actions/runs/37804189035) passed all three jobs: contracts/runtime, PostgreSQL conversation recovery and Android compilation/unit tests.
- Product harness `ph_1791474996421_8e5e41fe` passed 77/77 with the original baseline and scope enforcement. One intermediate dirty-worktree run was rejected by the semantic replay clean-source requirement despite48/48 replay turns passing; the committed-source validation passed.
- [Native capture run37802037961](https://github.com/guillemarcos14/BlankmindAI/actions/runs/37802037961) passed on `0bbd4df`, with eleven native PNGs (normal, empty, context detail, active, dark, accessibility text and compact iPhone). A single batched confirmation inspected normal/detail/compact/active/accessibility captures after the initial repair batch. The subsequent characteristic-reader addition keeps these fixture renders unchanged because the simulator guest has no readable characteristics; actual personal-trait rendering and permissions remain physical-device checks.
- Captures and XCTest bundles are retained under ignored `tmp/progress-final-native`, `tmp/progress-passing-xcresult` and `tmp/progress-characteristics-xcresult`; CI retains the downloadable artifacts. Earlier failure bundles are preserved under `tmp/progress-final-xcresult`.
- Shared MinimalHomeDesign, assets and global style files are unchanged against `c3dd08a`. All-context navigation stays within the existing scroll shell. Explicit rectangular content shapes fix taps in the otherwise transparent center of a plain HStack button, and the metric menu has a44pt label/touch target.
- Signed distribution needs the Apple Health Records capability and matching provisioning. Simulator fixtures prove layout/navigation, not actual read permission or physiological/clinical accuracy. No backend deployment, expanded cloud/AI transmission or physical read validation is claimed.
