# Free corpus, local validation and candidate work reduction — 15 October 2026

PR50 contains a prepared candidate, not an activation certificate. Production remains `6ad0a30668dd3a2c10b068ba`; native build 119 and all three production feature gates remain unchanged/OFF. No benchmark, independent paid reviewer, voice provider, deployment or physical device was used in this task. The published repair and earlier negative provider results remain preserved.

## Authored corpus and coverage

New immutable version-2 plans live in `tools/datasets/bm_agent_prepared_2026-10-15/`. The historical version-1 builder, datasets and paid receipts are unchanged. `bm_agent_corpus_v2.js` builds the new plans reproducibly; plans explicitly say `provider_real=false`, `executed=false`, `certified=false`.

| Feature | Distinct planned cases | ES / EN | Chat / query / action / memory | Planned paired response audio |
|---|---:|---:|---:|---:|
| tools | 200 | 100 / 100 | 50 / 50 / 50 / 50 | 64 |
| retrieval | 200 | 100 / 100 | 50 / 50 / 50 / 50 | 64 |
| labels | 200 | 100 / 100 | 50 / 50 / 50 / 50 | 64 |

Each language/group cell has 25 cases, including eight planned audio cases. A scenario is identified by its input, initial data/context and authored expectations, not merely a changed ID. The same isolated scenarios intentionally compare each feature independently. Coverage reports remain `approved=false` with **zero executed pairs**. Planned audio is not generated audio, a recording, a latency observation or a bill.

The plans cover all 15 supported native commands, original parameter bounds, overnight weekly/continuous windows, Calendar weekdays, one/two/168-hour pauses and permission/picker UI. Queries distinguish sleep duration/weekly mean, protection duration, session count and break count over measured/declared/missing/zero/sparse fixtures. Memory cases include 44 ES/EN routine/episode/compound/correction observation cases, literal preferences, genuine full forgetting and ambiguous forgetting that must preserve seeded memories. Preference storage may use stable memory or canonical observations; its classifier-work expectation is conditional rather than assuming a model representation.

`source-lock.json` binds each complete authored plan to the actual normalized Functions fingerprint. Preflight rejects edited corpora, changed source, insufficient coverage and attempts to cycle/repeat cases beyond the plan. The v2 benchmark records initial state and requires independent review input **v6**, which includes the authored forgetting, date and no-effect criteria. Historical review versions 1–5 retain their original inputs; old negative reviews were not rewritten.

## Candidate optimizations and correctness

| Change | Free evidence | Limit |
|---|---|---|
| Equivalent read queries share one in-flight request even if JSON field order differs. | Two equivalent requests become one read; pages, forgetting scope and other users/turns remain separate. | No cross-turn/user data cache. |
| Cached read objects appear once in subsequent model context. | Actual planner test retains one automatic history source and one distinct requested source, without a repeated copy. Matched function-call outputs remain intact. | Different source queries/pages are retained. |
| Independent history, rest-context and prepared retrieval reads overlap for gated reactive candidates. | Dependency-barrier tests for tools/retrieval/labels prove overlap and preserve evidence order. | Proactive reads retain their original sequencing. No provider or wall-clock latency claim; default production routing remains OFF. |
| Labels classifies one exact evidence fragment once per turn, then maps the classification to the original observations. | Compound bedtime/wake extraction uses one question instead of two, preserving values, units, dates and literal evidence. Mixed routine/occurrence uncertainty returns to canonical interpretation. | No cross-turn cache; an ordinary single observation still requires its classifier call. |
| Read tools require a nonempty `call_id`. | Malformed calls fail through the existing single JSON repair, never an unmatched protocol continuation. | No extra retry budget. |

These changes reduce identifiable work. They do **not** overturn the earlier real labels cost/latency regression or tools subgroup regression. No generative reasoning policy, rest objective, permission, confidence threshold or evidence gate was relaxed.

## Free validation completed

The guarded full harness passes **53/53** with this task's original baseline and `--enforce-scope`. Additional checks audit 600 authored plan entries, 150 native parameter cases/all 15 commands, 44 observation extraction/classification mocks, 50 ES/EN selection mocks, 50 prepared queries through the actual seeder/source reader/preparation with a local database double, and 35 provider/protocol fault scenarios. These are local contract/fault tests, not 600 measured provider pairs or independent semantic approval.

The strict v2 state auditor recomputes observation persistence from an applied SQL effect plus matching canonical values/provenance/literal evidence. It checks the previous **local** day for declared occurrences, actual forgetting scope, unchanged initial state for no-effect turns, and no memory changes for device-only actions. An approving fixture judge or a forged `observations_persisted=true` cannot override a wrong date or missing commit. Routines remain statement records rather than dated daily measurements. Existing PostgreSQL recovery tests run separately in CI.

Receipts are in `tmp/free-completion-20261015/`: `work-reuse-before.json`, `context-before.json`, `harness.json`, `validation.json`, `cli-preflight-final.json`, `readiness-final.json` and final `closure.json`. Negative pre-fix cases, intermediate source locks and the previous task's receipts are preserved. Network access is blocked in Node validation children; the runner uses dummy credentials and compares ledger/gate hashes before and after. New provider calls and spend are **zero**.

## Reproduce free checks

Before future edits, create a NEW baseline/output directory; do not overwrite a prior task's baseline or source lock. For this completed task:

```powershell
node tools/bm_agent_local_validation.js --directory tmp/free-completion-20261015 --baseline tmp/free-completion-20261015/baseline.json
node --require ./tools/local_offline_guard.cjs tools/bm_agent_readiness.js tmp/free-completion-20261015/readiness.json
```

The actual benchmark's new preflight mode returns before provider configuration, calls or ledger mutation. This command was checked for each of tools/retrieval/labels; substitute the feature and matching case file together:

```powershell
node --require ./tools/local_offline_guard.cjs tools/bm_retrieval_wide_benchmark.js --preflight-only --agent-feature tools --cases tools/datasets/bm_agent_prepared_2026-10-15/tools.json --plan-lock tools/datasets/bm_agent_prepared_2026-10-15/source-lock.json --pairs 200 --budget-file ../Codigo-retrieval/tmp/retrieval-wide/budget.json
```

Preflight success means that an unexecuted plan matches the current source. It never creates measured rows, a quality review, costs, audio or an activation approval. If Functions change, retain the old lock and create a new preparation artifact after revalidation; do not relabel old provider receipts.

## Remaining blocks

The original gates still require 200 **genuinely measured** distinct pairs per feature, at least 50 actual paired audio cases, language/group coverage, real provider IDs, complete costs including retries/background/voice, independent review, exact source and an improvement with no global/subgroup regression. No certificate or manifest approval has been produced. Each feature remains independently OFF.

Final shared ledger is byte-identical: known **$34.20500233**, conservatively reserved **$39.685206255**, remaining **$0.314793745** under the final **$40** cap; all **15** opaque reserves remain intact. Hash: `c7eb8bac69377fa1dd5a8188526ebd24b01f0bcb63c37e2c9fa43ed0fce8d878`. There is no authorization for new paid calls. The $1 minimum new voice reservation exceeds the remainder. The existing 800-character voice cap also remains: 64 planned audio pairs must not be presented as executable/measured within that small probe cap. Exact billed voice USD is still unknown; reservations cannot be converted into an invented measured cost or reused.

Physical iPhone/Watch control, enforcement, playback/revocation and adequate comparable measured Watch nights remain untested. These local changes cannot establish sleep efficacy. Do not deploy or enable the candidate on the strength of prepared coverage or mocked measurements.
