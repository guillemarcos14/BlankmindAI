# Free local corrections; activation still blocked — 15 October 2026

Subsequent completed corpus, coverage and free candidate optimizations: [FREE_AGENT_PREPARATION_2026-10-15.md](FREE_AGENT_PREPARATION_2026-10-15.md). The 47-check receipt below remains evidence of its original source; the new task has a separate baseline and 53-check receipt.

This continuation changes only the unpublished candidate on PR50. Production remains `6ad0a30668dd3a2c10b068ba`, native build 119 is unchanged, and tools/retrieval/labels remain OFF. The prior runtime repair and its real provider results are described in `RUNTIME_REPAIR_AND_LABELS_2026-10-15.md`; this document records subsequent local corrections, not a new provider certificate.

## Corrections and evidence

| Area | Failure reproduced locally | Candidate behavior now covered |
|---|---|---|
| Tools | An ambiguous `forget_all` followed by the forced compact clarification became `respond`; the authorization validator required `ask` and rejected the entire turn. | The server-owned clarification intent survives the compact no-effect envelope. Real planner/generator tests pass in ES/EN with two generations, `tool_choice=none` on clarification, no memory deletion and no action. |
| Tools clarification | The preserved real English pilot offered a closed list of three habit categories. | Tool instructions and the safety clarification now require an open scope question, including possible memories/observations. This prompt change has **not** received a new real-provider or independent semantic review; the original negative review remains valid for its source. |
| Retrieval | ASCII word boundaries excluded `dormí`; `this calendar week` and `protected` also missed supported preparation. | Unicode-aware rejection filter passes ten ES/EN duration/session/break requests. Decisions still selects the metric/period; keywords never authorize a read. Unrelated/action/translation/third-party turns bypass the extra call. |
| Retrieval counts | Matching a digit inside a signed/decimal number could accept an unsupported count. The sentinel metric `none` could reach protection preparation. | Exact unsigned integer tokens are required; negative/decimal counts fail back. `none` returns before reads. Local dated-count tests preserve zero, incomplete-record scope and Madrid period boundaries. |
| Labels | Malformed observations could be returned as completed or throw before classification fallback. The canonical generative prompt still asked for the delegated measurement classification. | Malformed observations return to the canonical generator without a classifier call. The delegated prompt removes that classification instruction and schema field; values, units, evidence, dates and all authority stay in the agent. Tools+labels composition and one bounded fallback pass in both languages. |

Negative local receipts are retained at `tmp/local-regressions-20261015/before.json` and `labels-before.json`. The repaired full harness passed **47/47**, original baseline and enforced scope, with no repairs. `validation.json` records a child-process network guard probe, zero provider spend and identical budget/activation-manifest hashes before and after. `harness.json` records each check. These are mocked-provider functional tests, not latency, paid-provider quality, physical-device or measured-sleep evidence.

## Reproduce without paid calls

From this checkout, create a fresh baseline before any future edits:

```powershell
node tools/product_harness.js --contract tools/product_harness_contract.json --write-baseline tmp/local-regressions-20261015/baseline.json --mode plan
```

Run free validation after edits, then inspect readiness:

```powershell
node tools/bm_agent_local_validation.js
node --require ./tools/local_offline_guard.cjs tools/bm_agent_readiness.js
```

The validation runner propagates a preload into Node children that rejects fetch, HTTP(S), HTTP/2 and TCP/TLS socket connections; tests install their explicit mocks. It substitutes a fixture OpenAI key, removes inherited provider/service credentials, never invokes a benchmark/reviewer/voice/publisher, and verifies the shared ledger and activation manifest are byte-identical. It requires the preserved baseline and central ledger; it fails if either is absent. No paid pilot/reviewer PowerShell script is executed.

## Candidate prepared, no activation certificate

`bm-agent-runtime.json` has been regenerated from the actual candidate Functions. `bm_agent_readiness.js` verifies that fingerprint, adapts the preserved real tools/retrieval/labels receipts without altering them, and assesses them using the original evaluator defaults. All three reject `stale_source`, insufficient pairs, languages/audio/groups and metrics. Previous positive pilots cannot certify the new source. The activation manifest, evaluator thresholds and authorization controls are unchanged.

The existing report command is prepared for **future genuine current-source receipts**:

```powershell
node tools/bm_agent_report.js <real-feature-receipts.json> <independent-blind-review.json> <assessment.json>
```

For each feature, the original gate still requires at least 200 distinct paired cases, at least 50 paired audio cases, both languages/all groups, real provider IDs, complete costs including retries/voice/background, independent review and an improvement without any global or subgroup regression. Freeze final source before collecting such receipts. Keep every historical failure and never edit its source hashes. Run the existing original certification process only when its budget and physical prerequisites can actually be satisfied; the report command alone cannot manufacture that evidence or turn a feature on.

No new paid test is authorized for this continuation. The final shared $40 ledger remains known **$34.20500233**, conservative reserved **$39.685206255**, remaining **$0.314793745**, with all **15** opaque reservations intact. Its SHA-256 is `c7eb8bac69377fa1dd5a8188526ebd24b01f0bcb63c37e2c9fa43ed0fce8d878`. The remainder is below the existing $1 minimum new voice reservation. Never release unknown reserves or increase the ceiling. The real labels cost/latency regression and tools subgroup regressions have not been disproved by these free fixes.

Physical iPhone/Watch action, enforcement, playback/revocation and sufficient comparable measured Watch nights remain pending. No Xcode, MacinCloud, device, production mutation or sleep efficacy result is claimed. The candidate is ready for gated evaluation; full activation remains blocked.
