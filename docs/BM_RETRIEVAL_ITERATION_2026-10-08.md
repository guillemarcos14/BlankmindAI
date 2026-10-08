# Retrieval iteration — 2026-10-08

Implemented and evaluated; default off, no deployment. PR27.

## Result

The architecture is substantially faster and the final response-quality regression passes. The final repeat cannot close the complete measured cost gate because one classifier request timed out without usage. An explicitly inferred estimate from its identical previously metered payload agrees with the earlier fully metered cost reduction. No activation.

| Final regression: 20 matched questions, 40 turns | Repaired normal path | Candidate |
|---|---:|---:|
| First visible text, median | 7,431 ms | 2,149 ms (-71.1%) |
| Durable completion, median | 8,623 ms | 3,242 ms (-62.4%) |
| First text p95 | 16,028 ms | 11,645 ms (-27.3%) |
| Durable completion p95 | 17,323 ms | 13,717 ms (-20.8%) |
| Functional errors | 2/20 | 0/20 |
| Excellent, separate model | 17/20 | 20/20 |
| Acceptable / poor | 1 / 2 | 0 / 0 |
| Generative requests | 52 | 29 (+20 Decisions) |
| Complete measured-usage API estimate | $0.03173434 | Unknown |
| Known subtotal | $0.03173434 | $0.01353912 |
| Same-payload inferred total estimate | — | $0.01365202 (-57.0%) |

13/20 questions used the compact route, each with one generative request. Seven followed the normal path. The weekly-protection subgroup remained slower at its median first text (7,431→7,847 ms, +5.6%); the aggregate gain does not mean every question became faster.

The missing request is `new-validation-08`, Decisions input payload SHA `0d5b798d9a57e3fcbb421d0d92e709a5102b05423d39a6ba5e09007313234e4c`. The prior 40-pair run metered precisely the same payload at 1,129 input tokens, giving a $0.0001129 standard-rate estimate. This is inference, not recovered observed usage or an invoice. The original timeout and null total remain in evidence.

## Larger comparison and iteration history

- Development pilot: 20 old questions / 40 turns, baseline272008d, runtime8dfef6f. Exposed data used to calibrate routes. One candidate wording failure confused incomplete observations with actual physical protection. Preserved.
- First fresh authored corpus: 40 questions / 80 turns, runtime1bd2e4e. Candidate40/40 functional, model39 excellent +1 acceptable; baseline37/40 functional. One opaque citation defect escaped model review and fails the deterministic presentation check. Preserved.
- Main validation: 40 questions /80 turns, runtime82da10d against272008d. 20 previously executed +20 newly authored; candidate40/40 functional, model37 excellent +3 acceptable, no poor; baseline37/40 functional and4 poor. First text7,204→1,785 ms (-75.2%), completion8,726→3,053 ms (-65.0%), complete per-request API estimates$0.06106329→$0.02641570 (-56.7%), zero missing usage. All28 accelerated questions used one generation. Three normal-fallback responses exposed internal source references; corrected afterward.
- Final regression above: runtime39791af againsta60bb73, both variants share the citation renderer fix. 20 exposed questions, including the 45-minute source-label case, the exact empty-yesterday source case and an equivalent empty-week formulation. Candidate20/20 excellent; two baseline errors retained. This is regression confirmation, not a new sealed holdout.

Total this iteration: 120 matched pairs /240 real authenticated turns, all failures retained, plus classifier tests. No resampling or replacement of failures.

## What changed

The server distinguishes a known zero recorded-protection total from unknown physical activity and computes the exact sleep mean for the bounded source lookup. These general semantics are shared with the reference, preventing ordinary correctness fixes from masquerading as classifier gains. Monday local calendar-week bounds and measured/recorded scope remain explicit.

Decisions replaces the generative retrieval decision for four closed factual routes. Eligibility and the selected route require probability≥0.90; exactly one route may pass and every other route must be<0.10. Exposed-pilot threshold adjustment preceded fresh-case execution. Direct wording transformations, quotations, other people, advice, actions and comparisons are excluded. 80 negative classifier cases pass; one earlier failed quote case is preserved. The API has one attempt, auth deadline1s, classification deadline5s; timeout falls back without actions.

After a complete authorized read, the same gpt-5.6-luna only writes concise prose from computed numbers and scope. A compact final-only schema and `reasoning.effort=none` remove unnecessary output and reasoning work. The server constructs all null action/memory/tracking controls; source ownership, cutoff, full-read checks, normal fallback, citation validation and durable commit remain.

Opaque references stay in structured citations. The shared renderer cleans catalog references and partial citation markers from both streaming and final prose, preserving facts, clock times, Unicode and ordinary brackets. After measurement,52930e5/49a0cec add only preservation of explicitly user-quoted source strings and uppercase partial-label handling. Exact comparison against the measured source permits only those changes;14 tracked source files pass that check, and all recorded visible responses remain identical. Provider timing was not repeated after that compatibility guard; targeted real planner/stream parsing tests pass.

## Validation and limits

Frozen measured source checks14/14, quality digests bound to every isolated fixture, all five cleanup checks pass in each run. Harness78/78, zero repairs and no scope violations: `ph_1791455364715_f4cb7fe0`, against the pre-edit baseline `ph_1791450119683_ee66e6df`. CI37763869149 on e82c9eb passes contracts/runtime, PostgreSQL recovery and Android compile/unit tests.

Quality verdicts are from gpt-5.6-sol, not independent humans. Cases are authored by the implementing agent, one measured repetition per final case, no sealed human holdout. Local handlers use real OpenAI and private QA DB; deployed transport, physical iPhone and voice are not measured. General conversation/actions were not benchmarked. These results support the narrow architecture and do not certify overall production quality or response time.

Application cost includes every generation, repair, classifier and cache write; quality-review/setup overhead and infrastructure are excluded. Unknown usage never becomes zero. Prices verified Oct8 against [model rates](https://developers.openai.com/api/docs/models/gpt-5.6-luna) and [Decisions pricing](https://developers.openai.com/api/docs/guides/decisions).

All numeric request, quality, failure, cleanup and source evidence is in `BM_RETRIEVAL_ITERATION_EVIDENCE_2026-10-08.json`. Existing earlier reports remain unchanged.
