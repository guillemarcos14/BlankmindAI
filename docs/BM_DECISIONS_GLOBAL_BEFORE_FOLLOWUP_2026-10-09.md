# Decisions global: implementation and validation

Scope is Decisions in Blankmind. Apple publication and unrelated voice work are excluded by Guillem's explicit correction on 9 October. This is a reviewable implementation, not permission to disregard the existing quality or release gates.

## Runtime

Integrated from `50b3773` (QA110 integration) in `codex/backend-release-decisions-production-2026-10-09`. The corrected implementation supports four routes: recorded sleep yesterday, mean recorded sleep this calendar week, recorded protection yesterday, and recorded protection this calendar week. Production eligibility is global for authenticated account UUIDs, with no cohorts or per-user allowlist.

Final runtime is `fa0cbd8`: compact answers that ignore explicitly requested minutes or expose QA/fixture/internal source labels are rejected by the server and return to the existing planner. The final package and regression run contain this code. The broader `88d6992` comparison predates those last guards; its performance and quality verdicts are not transferred as certification of the final runtime.

Decisions separately selects metric and period. Eligibility and each selected predicate must be >=0.90; each opposite metric/period must be <0.10. The server maps that combination to one of the four closed routes. A fixed public domain description explains that Blankmind protection totals are durations; no account data is sent to the classifier. A lexical filter only rejects unrelated inputs; it cannot select sources or authorize effects. Unicode word boundaries cover Spanish accented endings. Input is limited to 1,500 characters; classifier uses one attempt and a five-second deadline. Rejection, timeout, invalid output and insufficient/conflicting sources retain the normal planner.

The server reads owner-scoped records and computes facts. Fresh native sleep is filtered by exact local calendar bounds, timezone and forget cutoff. When real native rows cover only other days, the requested period is read from account observations; simulated native rows and rows excluded by forgetting never bypass their scope into real account data. It preserves measured, declared and simulated provenance. Invalid units, duplicate/conflicting observations and incomplete reads fall back. The compact generator receives computed facts and bounded source IDs, not the full planner context. Hours/minutes conversions are computed by the server; explicit minute requests retain precision and request minutes only. A declared-only answer must identify that provenance and cannot positively describe it as measured; explicit negated measurement wording is allowed. Accepted responses cannot create actions, memory, observations, proposals or followups. Rejected native acceleration restores the full original sleep source and the normal three-read budget.

JWT/install verification, action authority, durable turns, native permission checks, replay and forgetting remain in the existing authenticated planner. This change does not activate generic Decisions read-ahead or Jev.

## Configuration and rollback

Default is OFF. The future validated global release uses `BM_RETRIEVAL_STEP_ENABLED=true` and `BM_DECISIONS_DATA_POLICY=authenticated-account-records`, with the configured Supabase URL exactly matching production `https://vhiikgyyfisejjwqtxfc.supabase.co`. The identical policy can be evaluated in the reserved isolated QA project `https://njqbovsmoowkhhsqmitn.supabase.co`; the site's authentication barrier remains required. Arbitrary hosts are rejected.

Keep `BM_RETRIEVAL_STEP_QA_ENABLED=false`, `BM_DECISIONS_QA_ENABLED=false`, `BM_JEV_SHADOW_ENABLED=false`, and `BM_JEV_PREFETCH_EXPERIMENT=false`. The old synthetic mode remains available solely for historical experiment replay, with its existing metadata and allowlist controls.

Rollback sets the global retrieval flag false and republishes the same compatible function package so running Netlify instances receive that configuration. Verify the deployed function hashes and authenticated smoke afterwards. Keep the last compatible package and database schema; no data rollback is necessary for this code-only change. No configuration or production deployment has been changed by this task.

## Evidence protocol

The first 66-case/140-turn run compares corrected runtime `095c8c8` with historical integration `50b3773`. It is diagnostic: original failures and a classifier timeout with unknown billed usage prevent certification. A second diagnostic run compares **the same runtime `ad81838` OFF versus ON**, using global account-records policy, alternating AB/BA order, independent identical account fixtures, real JWT/install authentication, actual local NDJSON handlers, real OpenAI/Decisions and real isolated PostgreSQL. The final 72-case/156-turn corpus introduces new main questions and numeric/native fixtures, plus deliberately retained short followup regression cases, sums/counts and forget-cutoff cases. It compares the final factorized classifier runtime OFF/ON on the same frozen commit. Four classifier calibration variants are retained: 48/66, 48/66, 51/66, then66/66, each with zero false accepts on the exposed authored set; this is calibration, not holdout certification.

Two subsequent frozen evaluations are retained: `1ce23c2` has 72 cases/156 turns, and final runtime `88d6992` has 74 cases/160 turns. The latter changes primary factual wording and numeric/native fixtures, preserves known negative and followup regression cases explicitly, and adds real-native partial-period cases in both languages. Post-turn queries verify that factual turns preserve all seeded personal observations and memories. No claimed physical/native measurement is generated by a real device in these tests: Apple Health-shaped inputs are authored fixtures.

The final OFF/ON source commits are identical. Two raw file hashes differ solely because Windows checked out the detached reference with CRLF while the edited candidate retained LF. `frozen-source-parity.json` checks all nine measured runtime source files against the same committed Git contents after CRLF normalization; original raw hashes remain in the reports.

Report case counts separately from semantic diversity: repeated question templates across different source profiles are not independent unique conversations. Every generation, repair, fallback and classifier is metered. Unknown usage remains null; failed attempts and earlier credit-exhausted runs are preserved. Usage-rate estimates include cache writes; they are not invoices. Original exact request bodies remain in synthetic-only local reports; published evidence retains exact responses, raw fixture facts, preceding histories, usage, request hashes and failure metadata. No personal production rows were read. First text means the first retained nonempty draft after an explicit draft reset; first-ever emitted text is separately retained. Earlier measurements with different reset handling remain diagnostic, not substituted final evidence.

Activation requires the frozen >=20% p50/p95 improvement in first text and final response, >=20% full known-cost improvement, no critical regression or deficient accelerated output, and the existing human/deployed/iPhone evidence. Noneligible slowdown limits are retained (<=10% p50, <=20% p95). Model review and Codex source inspection do not certify human approval. Do not discard failures or lower thresholds.

Provider rates verified 9 October: [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [Decisions](https://developers.openai.com/api/docs/guides/decisions), [Sol reviewer](https://developers.openai.com/api/docs/models/gpt-5.6-sol). The original shared ledger is `../Codigo-retrieval/tmp/retrieval-wide/budget.json`: Guillem authorized +5 USD, total ceiling **9 USD**. His later 6 USD balance replenishment does not raise this ceiling.

## Production preflight

Read-only schema checks on 9 October used `limit=0`: `assistant_app_turns` and `blankmind_identity_links` exist, but `bm_brain_memories`, `bmb_accounts`, `bmb_sessions`, `bmb_observations`, `bmb_followups`, `bmb_events` and `bmb_daily_reviews` returned404. Existing migrations026–028 and compatible backend dependencies need a separate validated integration; no new migration is introduced here and none has been applied. Production retrieval/Decisions flags are absent/OFF. QA currently also has retrieval OFF.

## Results

Implementation is complete in draft [PR32](https://github.com/guillemarcos14/BlankmindAI/pull/32). **Decisions remains OFF; activation gates are not passed.** Evidence is in `BM_DECISIONS_GLOBAL_EVIDENCE_2026-10-09.json`, with all original failed attempts and earlier variants retained.

| Frozen runtime | Evaluation | OFF / ON complete responses | Compact responses |
| --- | --- | --- | --- |
| `88d6992` | 74 authored cases, 160 total turns, full comparison | 79/80 / 80/80 | 45 accepted; manual copy inspection found three defects |
| `fa0cbd8` | 24 reused regression cases, 60 total turns | 29/30 / 30/30 | 24/24 excellent according to Sol; requested units/internal labels pass Codex inspection |

Both use real providers, actual authenticated local NDJSON handlers and isolated real database records. Both preserve personal record integrity and finish cleanup5/5. Neither measures deployed Netlify or iPhone performance. The last regression set is deliberately reused and cannot certify independent broad quality.

The `88d6992` factual cohort comprises 50 turns per variant (49 successful OFF, 50 ON). First text p50/p95: 6,289/15,739 ms -> 1,614/10,459 ms (-74.3%/-33.5%). Final p50/p95: 7,306/17,062 ms -> 2,401/11,724 ms (-67.1%/-31.3%). Full usage-estimated factual cost: $0.09632991 -> $0.03131691 (-67.5%), including classification, repairs and fallbacks, zero unknown usage in this run. Errors remain separate gates, not successful latency samples. However, outside-scope p50 first text slowed28.0% and final11.2%, exceeding the frozen10% limits. No performance thresholds are lowered.

Sol's original broad verdicts are OFF53 excellent/12 acceptable/15 poor, ON65/2/13. The source audit preserves all verdicts and documents four demonstrated evaluator disagreements: a contextless referent, sleep minutes misread as screen time, and two verified forget commits whose proof was absent from the original reviewer input. It also records three copy defects the model missed and actual contextual failures. The revised v2 reviewer input names the fixture metric and prior tombstone separately and sends verified post-turn state. No adjusted aggregate or human approval is claimed.

The final regression review is complete60/60 with v2 digest binding. ON has26 excellent/1 acceptable/3 poor; all three deficient answers are normal-flow followups (missing yesterday record despite stored data, unsupported uncertainty about measured provenance, and acknowledging a language preference instead of translating the prior answer). These remain blockers; the24 compact answers are not a substitute for broad conversational quality.

Local harness on final runtime `fa0cbd8`: **83/83 PASS**, `--enforce-scope`, run `ph_1791553919896_1e91c65e`; 21 deterministic fault/authority/DST cases pass. [CI37939904983](https://github.com/guillemarcos14/BlankmindAI/actions/runs/37939904983) passes contract/runtime, PostgreSQL recovery and Android. All ten function bundles are packaged with a clean source tree (`package-fa0cbd8ded69-1791553926364.json`), **dry run only**, no deploy ID or remote-hash certification. Human review of24 blinded pairs is prepared in `BM_DECISIONS_HUMAN_REVIEW_2026-10-09.md`, not completed. The existing200-unique-conversation/20-physical-trace release evidence and production schema are absent.

Shared ledger closes with known estimated usage **$8.24431641**, conservative reservation **$8.37466156**, ceiling **$9**. Unknown earlier failed usage remains reserved; this is not a provider invoice. No production/QA configuration, deployment or migration was changed.

The original `3397468` accelerated reply `final09-007` falsely described a declared sleep entry as measured. It is retained verbatim in the evidence; subsequent provenance validation rejects it. In `1ce23c2`, a guard also rejected correct negative measurement wording, and protection answers sometimes converted explicitly requested minutes to hours. Those outcomes are retained; `88d6992` accepts explicit negations while rejecting positive measured claims and strengthens requested-unit instructions. A prior global run had four functional paired regressions; the later guard run has five service failures (four OFF, one ON). They are not silently rerun or removed.
