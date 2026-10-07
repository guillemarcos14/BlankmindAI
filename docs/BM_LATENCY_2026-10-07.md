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

Initial harness: 72/73 checks pass, no scope violations. The production release
evidence gate remains pending; it is not bypassed. Native macOS build/tests and
the two 100-turn real-provider evaluations are in progress.

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
Pending: complete provider comparison and native CI; private cloud transport and
20 physical cases before asserting end-to-end iPhone targets.
