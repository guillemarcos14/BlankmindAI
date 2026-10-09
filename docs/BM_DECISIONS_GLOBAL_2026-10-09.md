# Decisions global: implementation and validation

Scope is Decisions in Blankmind. Apple publication and unrelated voice work are excluded by Guillem's explicit correction on 9 October. This is a reviewable implementation, not permission to disregard the existing quality or release gates.

## Runtime

Integrated from `50b3773` (QA110 integration) in `codex/backend-release-decisions-production-2026-10-09`. Frozen corrected runtime `ad81838` supports four routes: recorded sleep yesterday, mean recorded sleep this calendar week, recorded protection yesterday, and recorded protection this calendar week. Production eligibility is global for authenticated account UUIDs, with no cohorts or per-user allowlist.

Decisions selects a conservative route (eligible and exactly one route >=0.90; all other routes <0.10). A lexical filter only rejects unrelated inputs; it cannot select sources or authorize effects. Unicode word boundaries cover Spanish accented endings. Input is limited to 1,500 characters; classifier uses one attempt and a five-second deadline. Rejection, timeout, invalid output and insufficient/conflicting sources retain the normal planner.

The server reads owner-scoped records and computes facts. Fresh native sleep is filtered by exact local calendar bounds, timezone and forget cutoff. It preserves measured, declared and simulated provenance. Invalid units, duplicate/conflicting observations and incomplete reads fall back. The compact generator receives computed facts and bounded source IDs, not the full planner context. Hours/minutes conversions are computed by the server; explicit minute requests retain precision. Accepted responses cannot create actions, memory, observations, proposals or followups. Rejected native acceleration restores the full original sleep source and the normal three-read budget.

JWT/install verification, action authority, durable turns, native permission checks, replay and forgetting remain in the existing authenticated planner. This change does not activate generic Decisions read-ahead or Jev.

## Configuration and rollback

Default is OFF. The future validated global release uses `BM_RETRIEVAL_STEP_ENABLED=true` and `BM_DECISIONS_DATA_POLICY=authenticated-account-records`, with the configured Supabase URL exactly matching production `https://vhiikgyyfisejjwqtxfc.supabase.co`. The identical policy can be evaluated in the reserved isolated QA project `https://njqbovsmoowkhhsqmitn.supabase.co`; the site's authentication barrier remains required. Arbitrary hosts are rejected.

Keep `BM_RETRIEVAL_STEP_QA_ENABLED=false`, `BM_DECISIONS_QA_ENABLED=false`, `BM_JEV_SHADOW_ENABLED=false`, and `BM_JEV_PREFETCH_EXPERIMENT=false`. The old synthetic mode remains available solely for historical experiment replay, with its existing metadata and allowlist controls.

Rollback sets the global retrieval flag false and republishes the same compatible function package so running Netlify instances receive that configuration. Verify the deployed function hashes and authenticated smoke afterwards. Keep the last compatible package and database schema; no data rollback is necessary for this code-only change. No configuration or production deployment has been changed by this task.

## Evidence protocol

The first 66-case/140-turn run compares corrected runtime `095c8c8` with historical integration `50b3773`. It is diagnostic: original failures and a classifier timeout with unknown billed usage prevent certification. The subsequent fresh run compares **the same runtime `ad81838` OFF versus ON**, using global account-records policy, alternating AB/BA order, independent identical account fixtures, real JWT/install authentication, actual local NDJSON handlers, real OpenAI/Decisions and real isolated PostgreSQL. Questions, numeric fixtures and native nightly values differ from the diagnostic corpus.

Report case counts separately from semantic diversity: repeated question templates across different source profiles are not independent unique conversations. Every generation, repair, fallback and classifier is metered. Unknown usage remains null; failed attempts and earlier credit-exhausted runs are preserved. Usage-rate estimates include cache writes; they are not invoices. Original exact request bodies remain in synthetic-only local reports; published evidence retains exact responses, raw fixture facts, preceding histories, usage, request hashes and failure metadata. No personal production rows were read.

Activation requires the frozen >=20% p50/p95 improvement in first text and final response, >=20% full known-cost improvement, no critical regression or deficient accelerated output, and the existing human/deployed/iPhone evidence. Noneligible slowdown limits are retained (<=10% p50, <=20% p95). Model review and Codex source inspection do not certify human approval. Do not discard failures or lower thresholds.

Provider rates verified 9 October: [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [Decisions](https://developers.openai.com/api/docs/guides/decisions), [Sol reviewer](https://developers.openai.com/api/docs/models/gpt-5.6-sol). The original shared ledger is `../Codigo-retrieval/tmp/retrieval-wide/budget.json`: Guillem authorized +5 USD, total ceiling **9 USD**. His later 6 USD balance replenishment does not raise this ceiling.

## Production preflight

Read-only schema checks on 9 October used `limit=0`: `assistant_app_turns` and `blankmind_identity_links` exist, but `bm_brain_memories`, `bmb_accounts`, `bmb_sessions`, `bmb_observations`, `bmb_followups`, `bmb_events` and `bmb_daily_reviews` returned404. Existing migrations026–028 and compatible backend dependencies need a separate validated integration; no new migration is introduced here and none has been applied. Production retrieval/Decisions flags are absent/OFF. QA currently also has retrieval OFF.

## Results

Final metrics and reviewed failures are recorded in the accompanying evidence JSON after the frozen evaluation completes. Local harness on `ad81838`: **83/83 PASS**, `--enforce-scope`, run `ph_1791547899109_e1d84f29`; 21 separate deterministic fault/authority/DST cases pass. Deployed candidate, physical device and production activation remain unverified.
