# BM app latency

Implementation branch `codex/bm-latency-2026-10-07`, base `4281705` (current
private QA onboarding + longitudinal release). Baseline was created before edits
at `tmp/product-harness/baseline.json`. No migrations or new environment variables.

## Changes

- Reuse the authenticated identity only within the current request and only for
  the same user/connect code. Snapshot upsert and the latest canonical snapshot
  remain authoritative; no cross-request cache or client-trusted identity.
- The app skips five unused legacy BAI enrichment reads. WhatsApp retains its
  existing enrichment. BMB can still query those sources on demand through its
  account-scoped catalog, including consent and forget cutoffs.
- Read channel events and semantic state together. Load personal memories,
  policy and open followups together; history waits for the forget cutoff.
  Independent model-selected source reads run together, preserving result order.
- Generate response_text after decision/action/memory authority and before
  secondary longitudinal fields. Drafts stay provisional. Tracking validation,
  leases, CAS, memory commit and native receipts still own the final result.
- Accept citations of the verified memories actually supplied to the model.
  Unknown, omitted and forgotten memory IDs remain rejected. Real baseline
  measurements exposed failures on otherwise grounded personal responses.

## Measurement

Backend `bm_turn_timing` uses monotonic request-local AsyncLocalStorage. It records
authentication, claim, snapshot, context, brain context, model, source reads,
prepare, queue, commit, presentation, database operations and transcription.
Only UUID turn IDs, fixed stage names, durations, status and token counts are
logged. Stage totals overlap (e.g. database within prepare); do not add them to
derive wall time. Failed requests also produce samples; telemetry cannot alter
the result. Empty draft resets/keepalives do not count as first text.

iOS `bm_client_timing` records preparation, main-actor first text delivery and
completion from a monotonic clock, separating transcription. Stream/fallback/JSON
and success/failure/cancellation remain distinguishable. No content, account IDs
or credentials. A switch of account/conversation during snapshot preparation
cancels before dispatching the old message. Console logs need a new iOS build.

## Reproducible evaluation

`tools/bm_latency_benchmark.js --run --source <checkout> --label <name> --count 100`
runs the real source handler, provider and isolated QA database using matched
synthetic fixtures. Five simple, three personal and two action cases repeat ten
times. Each turn starts without a previous generated proposal/transcript and
has the same verified goal/bedtime memories. No APNs token, device action or
external messaging is executed. Fixture cleanup is scoped to the synthetic
account. Credentials are supplied through the process environment, never reports.

`node tools/bm_latency_report.js tmp/latency/baseline.json tmp/latency/candidate.json`
computes p50/p90/p95, errors, calls and tokens by group. Error turns are excluded
from successful latency percentiles and reported separately. Proposed thresholds
remain <=2s p90 simple, >=30% reduction first-text p95, >=25% final p50, no increased
errors. Missing or unmet evidence is not a pass.

This measurement runs the production handler locally with real remote services.
It does **not** measure Netlify cold starts, iPhone rendering or Wi-Fi/mobile
latency. Twenty physical turns require an available signed build and iPhone.

## Validation and release

Two real-provider/QA evaluations completed, 100 turns each, with all synthetic
accounts cleaned. Final-source profiling also passed 10/10 directed cases.

| Metric | Baseline | Candidate |
| --- | ---: | ---: |
| First text median, all successful turns | 3330 ms | 2700 ms |
| First text p95, all successful turns | 17143 ms | 15040 ms |
| First text median, simple conversation | 3192 ms | 2458 ms |
| First text p90, simple conversation | 4268 ms | 3341 ms |
| Final response median | 4136 ms | 3581 ms |
| Failed test turns | 11/100 | 2/100 |
| Median database operations per turn | 23 | 15 |
| Mean provider tokens per successful turn | 6138 | 5961 |

First text improved 18.93% overall and 22.98% for simple conversations; final
median improved 13.41%. Proposed 2s/30%/25% targets remain **unmet**. Correcting
valid memory citations reduced failures; this is directed functional evaluation,
not an independent human review of every generated response. Raw tokens are not
a billing-cost estimate and do not account for caching or retry pricing.

Evidence: `BM_LATENCY_EVIDENCE_2026-10-07.json` and
`BM_LATENCY_PROFILE_2026-10-07.json`. The 100-turn comparison measured the initial
optimization candidate; final profiling covers the extra identity-match guard.
There is no cross-account cache in either candidate.

Native CI 37620146205 passed client/timing/recovery tests, Simulator build and
the complete Home UI suite. Screenshot capture is separate. Backend CI
37620145979 passed contract/runtime, PostgreSQL recovery and Android checks.
The initial local harness was run before a clean commit (72/73, scope clear);
Final clean-source harness passed 73/73 with no scope violations, report
`ph_1791376110422_9d14568f`. Private bundling produced all nine functions with
streaming metadata intact at source `a51abd0`; no publish was performed. Physical release
evidence remains 0/20; no production gate is bypassed.

## Physical measurement protocol

Use a signed private-QA build with the new client timing and the matching backend.
Collect `bm_client_timing` console events for five prompts (hello, brief advice,
personal goal, measured sleep, explicit 30-minute action), each on Wi-Fi and
mobile data, both first interaction and a following interaction: 20 total turns.
Record network and first/following conditions alongside the anonymous timing
rows manually. Verify real native receipts for action cases, interruptions and
same-UUID recovery; never substitute Simulator measurements. Compare the same
conditions and report failures alongside latency percentiles.

Deployment is separate: integrate this commit into a `codex/backend-release-*`
candidate, run the same scoped harness and private endpoint smoke before release.
Model, credentials, migrations and distribution policy are unchanged.

## Integration handoff

Objective: Reduce app input-to-first-text latency with traceable measurements.
Branch: codex/bm-latency-2026-10-07
Commit: see Git history for the validated final candidate.
Surfaces: app backend transport/context/BMB schema, iOS transport instrumentation,
regression tests, harness contract and benchmark/report tools.
Supabase migrations: none.
Environment variables: none new.
Pending: private cloud transport after integration and 20 physical cases before
asserting end-to-end iPhone targets. No deployment or TestFlight in this branch.
