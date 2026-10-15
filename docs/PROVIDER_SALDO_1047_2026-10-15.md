# Real-provider evaluation on integrated PR51 — 15 October 2026

**No route is approved. Tools, retrieval and labels remain OFF.** This campaign executed 58 distinct real paired cases and 116 independent reviews without changing the original acceptance requirements. The observed regressions block approval; the remaining allowance is preserved rather than extending a failing version to a full certificate.

## Scope and immutable evidence

Guillem authorized using up to USD 10.47 of the existing OpenAI balance and explicitly selected integrated PR51. The cumulative shared authorization remains USD 55. `BM_PROVIDER_SPEND_LIMIT_FILE` tightens both inference and reviewer reservations to the smaller of the shared cap and the campaign's initial conservative reservation plus USD 10.47. Unknown usage remains reserved. One paid process ran at a time; no top-up, provider credential, provider quota or subscription was changed.

The measured backend is frozen PR51 `c6ea8027ce632d0b7298d3e794312510910619cf`, also matching the Functions fingerprint of PR51 `809039b`. The earliest batches identify scratch commit `bee165a`; its complete backend fingerprint is identical to the completed PR51 revision. Original source commits and receipts were preserved, not rewritten. Live concurrent edits initially failed preflight before provider dispatch; subsequent calls used an isolated checkout. Baseline and candidate use identical backend sources and independent synthetic fixtures, with the selected feature enabled only for the candidate's isolated QA identity. Existing baseline retrieval behavior is retained.

Version-2 corpora and original authored gold are unchanged. Review input v6 uses independent `gpt-5.6-sol`; runtime generation is `gpt-5.6-luna` and Decisions is `gpt-6-luna`. Cases cover ES/EN and chat/query/action/memory. Directed additions test compound observations/corrections and absent, zero and sparse recorded sleep. These are local authenticated handlers against real private QA SQL and real providers; deployed transport, native execution, physical playback and Watch efficacy were not measured.

Private QA alone received the exact additive migration 037 required by PR51. Its three tables have RLS and no anon/authenticated table access; the existing QA user was preserved. Synthetic Sandbox grant rows are commercial **test fixtures**, not Apple purchases or real entitlements; their synthetic account is deleted after each batch. Production schema, deployment, native distribution and activation manifests were not changed.

## Measured results

P50/p95 use the existing gate's percentile definition. These small samples are diagnostics, not 200-case certificates or production savings.

| Route | Distinct pairs | Candidate fully accepted turns | First text p50/p95 ms, baseline → candidate | Runtime USD, baseline → candidate |
|---|---:|---:|---|---|
| tools | 16 | 12/16 | 2878/3930 → 2782/3678 | 0.01024928 → 0.01015934 |
| retrieval | 22 | 11/22 | 2719/4390 → 2866/4171 | 0.01228798 → at least 0.01637093; candidate total unknown |
| labels | 20 | 12/20 | 2717/4517 → 3077/5032 | 0.01455740 → 0.01715230 |

Baseline fully accepted counts are respectively 10/16, 9/22 and 14/20. HTTP/transaction/minimum-state checks completed for all 116 turns; that does not override semantic review failures.

- **Tools:** the modest global improvement does not satisfy subgroup requirements. In this sample chat cost rises from USD 0.00230956 to 0.00339362; English p50 rises from 2656 to 2782 ms. Query responses also omit the dates/coverage required by the authored gold. No subgroup exception was applied.
- **Retrieval:** median first text worsens and known candidate runtime cost already exceeds the complete baseline cost. One real Decisions request times out without a request ID or numeric usage; its reservation stays intact and total candidate cost is unknown. Missing/zero/sparse data are distinguished, but responses do not satisfy the original date/coverage review criterion.
- **Labels:** median, p95 and runtime cost worsen. Independent review rejects a queued block described as done (`v2-labels-es-action-block-15`) and extra text-form bedtime observations, including both correction cases. Compound-routine cases pass, but do not cancel those failures. Original negative reviews remain unchanged.

All three original assessors return `approved=false`. Each still needs 200 distinct measured pairs, at least 50 per language, 50 actual paired audio cases, required group/audio coverage, exact sources/unique provider IDs, independent quality review, complete costs and improvement without global/subgroup regression. Actual paired audio in this campaign is **zero**. Existing voice-key access, 800-character probe guard and unknown billed voice USD remain unresolved; no synthetic timings, zero-cost voice or physical-device receipts were substituted.

## Cost and reproducibility

There were **279** new provider requests: 116 reviews and 163 runtime requests. There are 278 unique returned provider request IDs; the timeout has none. Known runtime cost is USD **0.08077723**, independent review USD **1.60749260**, combined **1.68826983**. An additional **0.00032070** remains reserved for unknown timeout usage. Conservative consumption of this campaign's USD 10.47 cap is **1.68859053**, leaving **8.78140947**. These are measured usage priced with verified rates, not a claim about the billing UI's settlement time.

Rates were checked against official [Luna pricing](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [Sol pricing](https://developers.openai.com/api/docs/models/gpt-5.6-sol) and [Decisions pricing](https://developers.openai.com/api/docs/guides/decisions). Cache writes and retries are included. All 15 previous opaque reservations remain unchanged; the timeout adds one explicitly indexed reservation already included in the shared total. Shared known spend is USD **35.89327216**, conservative reserved total **41.373796785**, under the unchanged USD 55 ceiling.

[Tracked evidence index](evidence/provider-saldo1047-2026-10-15.json) contains per-route/global/subgroup metrics, negative review rationales, exact backend hashes and SHA-256 references to all 96 immutable raw/review/request receipt files. Originals and complete measured rows remain in `tmp/provider-saldo1047-20261015/`, including `campaign-report.json`, `budget-before.json`, `budget-after.json`, `spend-limit.json`, `qa-schema.json` and offline audit receipts. The campaign is stopped; existing outputs must not be overwritten.

The tool update adds same-source checks before even free preflight, an additional shared campaign spend guard and read-only aggregation that rejects duplicate pairs, stale source and mismatched original reviews. No Functions, gold criteria, reviewer thresholds or activation gate changed. Free validation passes 54/54 harness checks using the original task baseline, enforced scope and blocked network; it also includes all three CLI preflights, three negative preflight cases and five offline audits using immutable real receipts. The frozen complete PR51 source separately passes its 54-check local harness after installing its locked dependencies.

To recompute the report without provider calls:

```powershell
node --require ./tools/local_offline_guard.cjs tools/bm_agent_campaign_report.js tmp/provider-saldo1047-20261015 ../Codigo-provider-saldo1047
node tools/bm_agent_local_validation.js --directory tmp/provider-saldo1047-20261015 --baseline tmp/provider-saldo1047-20261015/baseline.json
```

Correction of the observed regressions, followed by a new source-bound evaluation and an authorized fully metered audio path, remains necessary before activation. Additional uncorrected paid samples are not treated as a substitute for those requirements.
