# Blankmind: measured rest loop

Objective: improve the authenticated user's Apple Watch measured sleep through management of the selected phone distractions. Phone protection, acceptance, engagement and perceived rest are not sleep outcomes. Conversation and broad Health context support this objective.

The user authorized this implementation on 2026-10-14. Preserve Home/Progress styling, voice, account identity, canonical inbox, verification, revocation and sample exploration. Work starts from integrated release `2e4ec8f`; baseline is `tmp/product-harness/baseline.json`. No production mutation or Apple submission is part of this implementation branch.

## Evidence

Persist source-tagged complete sleep episodes grouped by wake date, Health context summaries, optional subjective check-ins and available digital observations. Separate measured Watch, other Health, declared and synthetic records. Only non-manual measured Watch nights evaluate outcomes. Never fabricate phone usage from protection. Use supported EU activity-data authorization where available; unsupported OS/region/permission remains unavailable, not zero. All incoming data is scoped to the authenticated installation and sharing consent; forgetting/revoking cancels pending assessment and prevents old data from returning.

## Experiments

One active hypothesis and one changed schedule parameter. A fixed Watch metric (sleep continuity, distance to an explicit sleep-duration target, or sleep-time regularity), frozen personal baseline, verified schedule activation, comparable weekdays, explicit exclusions and seven comparable measured nights are required. Observe daily; assess after 7–14 days, wait if coverage is insufficient. Show deltas and coverage, never a clinically validated quality score or causal proof. REM/HRV support context, not independent success claims. Subjective feedback can constrain acceptability but cannot certify efficacy.

The model proposes hypotheses and explains evidence naturally. Deterministic code computes measurements, validates permissions and records outcomes. Recurring changes require a new, explicit rest-adjustment grant: days, time bounds, maximum shift, expiry and frequency. Keep direct user controls available; general wellness advice and non-rest learning objectives are retired from the assistant. Legacy global acceptance/adherence scores cannot seed the new loop. An optional global prior uses consented, deidentified measured experiment outcomes, never raw conversations, Health records or app identifiers; personal evidence takes precedence.

## Validation and release

Backend unit/integration and real SQL tests, native model tests, iOS simulator build, and the full harness with baseline/scope are required. Release needs migration, coordinated backend/cron publication, distribution entitlement for EU usage, signed app and iPhone verification. Test fixtures and simulator results do not certify real Watch collection, usage access or sleep improvement.

Implementation removes the unused second router, Jev runtime/benchmarks, the native BAI wrapper, old local memory and 1,537 lines of unused feature/forecast/score code. Historical database migrations and external messaging transport contracts remain; legacy adherence pools are excluded from BMB's source catalog and daily assessment. No old benchmark is a certificate for this source.

Watch nights use the local wake date, not the date sleep started. Background Health delivery and foreground refresh synchronize measured episodes; iOS can defer delivery. The monitor records the actually applied schedule shield intervals, and only closed matching intervals credit intervention nights. Usage joins retain complete measured bins and their exact timestamps; no prorating into fictitious pre-sleep minutes. Core outcomes use a 2-point continuity or 15-minute target/regularity decision threshold with at least 70% consistent nights, and reject a median sleep-duration loss over 30 minutes. These are explicit product heuristics, not clinical cutoffs or proof of causality.

The legacy production publisher intentionally disables cron. A coordinated rest release must apply `035`, include the new runtime, update the published privacy/labels, obtain the app-and-website-usage and Health background capabilities, and explicitly enable the existing `bmb-tick` schedule. Do not run the previous voice-only publication script and infer the loop is active.
