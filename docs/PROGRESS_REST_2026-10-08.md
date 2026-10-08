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

Delivery evidence will be appended after final checks. No new archive or TestFlight upload is part of the implementation result.

### Validation checkpoint

- Final native source: d692ebd; product harness ph_1791470401563_70ec1962 passed 77/77 with baseline and scope enforcement.
- Native rest/conversation/protection checks and simulator compilation passed on d692ebd in iOS run37794243888. The first UI pass located a context-presentation failure and a stale risk-action expectation; the final confirmation follows their correction.
- BM Harness Gate run37794258300 passed on d692ebd (contracts, PostgreSQL, Android).
- Shared MinimalHomeDesign, assets and global style files are unchanged against c3dd08a.
- Apple developer clinical-record capability, updated provisioning and physical read permissions remain separate release requirements. No signed archive, deployment or TestFlight upload was performed.
