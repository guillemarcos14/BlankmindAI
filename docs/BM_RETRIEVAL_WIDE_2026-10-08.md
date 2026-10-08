# Expanded retrieval validation — 2026-10-08

Decision: **keep disabled**. Faster medians and lower narrow-route API cost do not establish response excellence, improved tail latency or safe general activation. No deployment, migration, TestFlight change or real-user activation. PR27 stays draft.

## What the broader test establishes

This task made **556 real handler turns**: 32 calibration, 364 original and 160 timing replay; reviewer calls are separate. Original final corpus: 160 new authored cases/364 real provider+private QA DB turns,80 factual and 80 outside the narrow scope;22 multi-turn conversations,182 turns per variant. Calibration 16 cases/32 turns is separate.179 distinct final input strings, no exact overlap with80 previous retrieval-corpus inputs. ES/EN are paired versions of80 scenario/profile families: correlated, nonrandom, authored by this agent, not independent human annotation or a sealed population sample. Original runtime 3e8362c and reference 49a0cec were retained without tuning to final outputs; all failures remain. Source/corpus 17 checks pass.

Original broad functional errors 10→9; closed factual 4→1; outside-scope/mixed conversations 6→8. Outside-scope cost increases 4.8%, despite aggregate cost decreasing 20.6%. Lower latency does not make wrong replies excellent. These are one-observation paired outcomes, not proof that every candidate-only failure was caused by its branch.

## Timing integrity

`tools/bm_retrieval_wide_benchmark.js` originally resets its JSON callback timer when generation clears a prior draft before a repair/another attempt. Thus full-corpus first-draft numbers are **final-attempt callback timings**, mixed with20 correctly measured NDJSON case pairs; do not call them first-ever visible output. Their error, durable completion and per-request cost results remain valid. Original draft texts and failures are preserved; earliest discarded JSON timestamps cannot be reconstructed.

Primary first-visible timing evidence is the explicitly labelled **80-case NDJSON timing replay**, 160/160 turns, complete=true. It repeats existing factual cases, never adds80 independent holdout cases and never replaces original failures. Same frozen runtime/fixtures, AB/AB/BA/BA order; actual assistant-app-stream handler, first nonempty NDJSON frame preserved across reset/repair. Includes early drafts later rejected; quality is evaluated separately. No deployed network/client/iPhone latency.

### NDJSON timing replay: first-ever nonempty draft and durable result

| Measure | Reference | Candidate | Change |
|---|---:|---:|---:|
| Completed / all | 77/80 | 80/80 | — |
| Errors | 3 | 0 | — |
| First draft p50 (definition below) | 7,122 ms | 2,277 ms | -68.0% |
| First draft p95 | 14,622 ms | 12,238 ms | -16.3% |
| Durable completion p50 | 8,625 ms | 3,750 ms | -56.5% |
| Durable completion p95 | 18,260 ms | 16,792 ms | -8.0% |
| Generative + classifier requests | 212+0 | 136+80 | — |
| Standard API cost estimate | $0.13144589 | $0.07378139 | -43.9% |
| Usage unknown requests | 0 | 0 | — |

Both-completed matched sensitivity set: 77 pairs.

### NDJSON timing replay: matched completed pairs

| Measure | Reference | Candidate | Change |
|---|---:|---:|---:|
| Completed / all | 77/77 | 77/77 | — |
| Errors | 0 | 0 | — |
| First draft p50 (definition below) | 7,122 ms | 2,369 ms | -66.7% |
| First draft p95 | 14,622 ms | 12,238 ms | -16.3% |
| Durable completion p50 | 8,625 ms | 3,809 ms | -55.8% |
| Durable completion p95 | 18,260 ms | 16,792 ms | -8.0% |
| Generative + classifier requests | 205+0 | 129+77 | — |
| Standard API cost estimate | $0.12667415 | $0.06964879 | -45.0% |
| Usage unknown requests | 0 | 0 | — |

NDJSON subgroup first/final p50/p95 are in the evidence.

### Original broad160-case run: callback timings labelled accurately

| Measure | Reference | Candidate | Change |
|---|---:|---:|---:|
| Completed / all | 172/182 | 173/182 | — |
| Errors | 10 | 9 | — |
| First draft p50 (definition below) | 6,104 ms | 4,025 ms | -34.1% |
| First draft p95 | 13,863 ms | 13,523 ms | -2.5% |
| Durable completion p50 | 7,403 ms | 5,530 ms | -25.3% |
| Durable completion p95 | 15,413 ms | 15,044 ms | -2.4% |
| Generative + classifier requests | 394+0 | 313+175 | — |
| Standard API cost estimate | $0.24607528 | $0.19532442 | -20.6% |
| Usage unknown requests | 0 | 0 | — |

### Original80 factual cases

| Measure | Reference | Candidate | Change |
|---|---:|---:|---:|
| Completed / all | 76/80 | 79/80 | — |
| Errors | 4 | 1 | — |
| First draft p50 (definition below) | 7,204 ms | 2,048 ms | -71.6% |
| First draft p95 | 14,377 ms | 14,591 ms | 1.5% |
| Durable completion p50 | 8,506 ms | 3,620 ms | -57.4% |
| Durable completion p95 | 16,005 ms | 16,087 ms | 0.5% |
| Generative + classifier requests | 214+0 | 138+80 | — |
| Standard API cost estimate | $0.13205728 | $0.07581743 | -42.6% |
| Usage unknown requests | 0 | 0 | — |

### Original80 outside-scope/mixed conversations

| Measure | Reference | Candidate | Change |
|---|---:|---:|---:|
| Completed / all | 96/102 | 94/102 | — |
| Errors | 6 | 8 | — |
| First draft p50 (definition below) | 5,696 ms | 4,914 ms | -13.7% |
| First draft p95 | 12,854 ms | 13,281 ms | 3.3% |
| Durable completion p50 | 6,650 ms | 6,133 ms | -7.8% |
| Durable completion p95 | 14,428 ms | 14,501 ms | 0.5% |
| Generative + classifier requests | 180+0 | 175+95 | — |
| Standard API cost estimate | $0.11401800 | $0.11950699 | 4.8% |
| Usage unknown requests | 0 | 0 | — |

### Original matched completed turns (both variants)

| Measure | Reference | Candidate | Change |
|---|---:|---:|---:|
| Completed / all | 164/164 | 164/164 | — |
| Errors | 0 | 0 | — |
| First draft p50 (definition below) | 6,104 ms | 4,025 ms | -34.1% |
| First draft p95 | 13,863 ms | 13,523 ms | -2.5% |
| Durable completion p50 | 7,403 ms | 5,530 ms | -25.3% |
| Durable completion p95 | 15,323 ms | 15,044 ms | -1.8% |
| Generative + classifier requests | 359+0 | 284+157 | — |
| Standard API cost estimate | $0.22002303 | $0.17216122 | -21.8% |
| Usage unknown requests | 0 | 0 | — |

## Quality and exact failures

Deterministic presentation checks cover all final replies and actual NDJSON drafts, not internal JSON callbacks before the renderer. UUID defects occur in reference wide-6 and candidate wide-122, both normal/follow-up paths; candidate wide-122 is a paired regression. Both variants answered records rather than repeating the wording in wide-96. Original candidate wide-28/38 interprets invalid `hours` sleep records as minutes after compact preparation correctly rejects them; reference wide-25/35 omits the Monday-midnight sleep record. All raw outputs, exact fixture expectations, request hashes/usage, quality bindings and failure statuses remain in the evidence. Numeric parsers supplement semantic review; legitimate wording such as“427 sleep minutes” or“0 recorded minutes” is parsed with its units and not flagged as incorrect. Duplicate/invalid data and zero-scope warnings still require semantic judgement.

A separate gpt-5.6-sol reviewer selected 232 original turns of 364: all 80 factual cases, the frozen 24 negative cases and additional structural failures. Complete=false; all selected turns attempted=true. Evaluator attempt failures=1, preserved without retry. The metering adapter originally ignored the replacement Response for a streamed reviewer HTTP reply, consuming its body before JSON parsing; the adapter was corrected for remaining, unattempted reviews. Exact-input cache reuse is allowed; no review is transferred to changed replies or timing replay. It reviews the final reply, exact raw fixtures, period/timezone, actual actions and preceding conversation; discarded draft semantics are not model-reviewed, while visible NDJSON drafts receive deterministic presentation checks; bindings attach verdicts to original responses. This is model judgement, not human review, and not transferred to timing-replay outputs.

| Original sampled quality | Reference | Candidate |
|---|---:|---:|
| Judged | 117 | 114 |
| Excellent | 81 | 84 |
| Acceptable | 10 | 9 |
| Poor | 26 | 21 |
| Hard contradictions/unsafe claims | 10 | 10 |

| Sampled stratum | Reference excellent / judged | Candidate excellent / judged | Reference poor | Candidate poor |
|---|---:|---:|---:|---:|
| eligible | 62/80 | 66/79 | 10 | 5 |
| noneligible | 19/37 | 18/35 | 16 | 16 |
| accelerated | 0/0 | 39/46 | 0 | 1 |

Candidate-only poor/critical paired regressions in sampled original turns: 7; exact IDs/rationales are in the evidence. Verified exact reviewer-input digests: true.

Author audit found an oracle defect in mixed-context metadata: expected.minutes=424 describes the week while first questions may ask yesterday (raw record489). The raw poor accelerated verdict inwide-160 is a confirmed evaluator false positive: both variants correctly give489 minutes. It remains in raw model counts; one of the seven raw paired regressions is therefore not an established candidate error. Contextual model totals must be treated as exploratory, and no corrected model scores or new paid review are substituted. Model flags are evidence to inspect, not ground truth: duplicate-record interpretation and minimal zero wording can be debatable. Exact raw fixtures, rationale and reply remain available; unambiguous UUID, wrong-unit, wrong-period and empty-response defects independently block the quality gate. No excellent-response certification for all app traffic. Some original turns are semantically unjudged by the model, and replay responses have only deterministic/author review unless separately labelled. Presentation/authority failure cannot be averaged away by model scores.

## Human review delivered, still pending

[24 blind paired answers](BM_RETRIEVAL_HUMAN_REVIEW_2026-10-08.md),16 factual and 8 advice/action/context, ES/EN balanced, fixed selection before final closure. Rubric asks correctness, provenance/limits, context, usefulness and naturalness, then E/A/D and A/B/tie. No timing, price, model verdict or variant labels. Key is separately in ignored tmp/retrieval-wide/human-unblind.json. No human scores collected. About20 minutes; first pair 60–90 seconds.

## Existing app/QA integration

20 original case pairs plus the timing replay exercise the existing authenticated NDJSON handler locally with actual provider and DB. No native device execution. Current QA 109 sleep fix cb460ed/deploy 6ac7738de460d6ac930c03a2 remains: read-only checks show anonymous page/function401,10/10 packaged function hashes and retrieval/Decisions flags absent/off. The old experiment does not consume the iPhone current_sleep projection. An isolated prepared [integration patch](BM_RETRIEVAL_QA_INTEGRATION_2026-10-08.patch) preserves that newer source and bypasses compact sleep when fresh iPhone nights are available.14-night real/synthetic normalization and actual planner-input tests pass; forced route checks4/4 pass; git apply --check passes. Overlay tests use injected classification/generation, not a deployed or timed candidate/current_sleep experiment. No full old-branch deployment. Physical iPhone/voice and fresh-current-sleep acceleration remain untested.

21 deterministic fault/authority/DST cases pass separately: auth/provider failures/timeouts, malformed classification, source schema/read failures, incomplete pagination, invalid/duplicate data, unsafe final controls and 23/25-hour days. They are fault injections, not real-provider reliability samples. Five scoped delete/identity cleanup operations pass per complete benchmark; auth-owned BMB rows have ON DELETE CASCADE.

## Consumption, artifacts and validation

Shared synthetic ceiling 4 USD; ledger known estimate $3.76498337, reserved conservative upper $3.76498337, requests 1613. Application, calibration and reviewer overhead are labelled separately; compare variants on application calls only. Every model/classifier/repair/fallback is metered at the provider HTTP boundary. Null usage never becomes zero. This run's complete cost estimates do not recover the earlier iteration's unknown usage and are not invoice charges. Prices verified Oct 8: [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [Decisions](https://developers.openai.com/api/docs/guides/decisions), [Sol reviewer](https://developers.openai.com/api/docs/models/gpt-5.6-sol).

Frozen criteria/corpus: [protocol](BM_RETRIEVAL_WIDE_PROTOCOL_2026-10-08.md); post-discovery instrumentation correction: [timing amendment](BM_RETRIEVAL_TIMING_AMENDMENT_2026-10-08.md). [Full evidence](BM_RETRIEVAL_WIDE_EVIDENCE_2026-10-08.json) retains original/calibration/replay requests, outputs, review and cleanup. Budget includes synthetic paid calls only; no purchases. Harness/CI closure is recorded after clean-source validation.

Keep both private experiment flags off and retain the synthetic allowlist/normal fallback for reversal. The frozen ≥20% p95 gain and zero poor/critical-regression requirements are not satisfied by faster medians alone; do not apply this to the whole app. Human review is pending, and a fresh future corpus would be needed after any runtime correction.

## Validation closure

Clean evidence/tool source `bff047b`: harness **79/79**, `ph_1791463747482_8edd8915`, baseline `baseline-wide.json`, enforced full commit scope against frozen `3e8362c` (24 paths, zero violations). The earlier dirty-tree release-gate failure is preserved as an intermediate validation, not a runtime regression. [CI37779447701](https://github.com/guillemarcos14/BlankmindAI/actions/runs/37779447701) passes PostgreSQL recovery, runtime/contracts and Android compile/unit tests. This final closure only records documentation; source runtime and measured answers remain frozen. Latest draft-PR checks show any subsequent documentation-head validation separately.
