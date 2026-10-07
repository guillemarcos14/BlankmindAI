# OpenAI Decisions experiment — 2026-10-07

User objective: lower input-to-output latency first, with lower total application
cost and fewer model calls, while preserving quality and action authority.

## Frozen experiment

Baseline is current integrated Blankmind source `29c0b06`, including latency,
onboarding, Voice and disabled Jev. Candidate runtime is `753553b`, based on the
same source. The generative model stays `gpt-5.6-luna` in both variants. Decisions
uses dedicated `POST /v1/decisions`, model `gpt-6-luna`; this is not a generative
model migration or a replacement for action authorization.

Seven batched predicate questions select at most three authorized sources or
abstain. Source threshold .95 and deletion/override threshold .1 were fixed before
evaluation. Classification overlaps memory/settings/followup reads. After the
memory cutoff is known, normal source readers enforce owner, consent and forgetting.
The planner receives actual source results before its first request and can still
request any missing source or page. No read is suppressed, no final phase is forced,
and no classification can write a fact, proposal or native action.

Default is disabled. Local experimental flag requires the fixed private QA URL,
server allowlist and a second check of server-controlled synthetic-user metadata.
Whole classification including that identity check is bounded at 1000ms, each
source read at 200ms. One provider attempt; error/refusal falls back to the normal
planner. No deploy, cloud flag change, migration or TestFlight is required for
this local comparison. The published Voice backend remains untouched.

## Measurement protocol

300 predefined authored synthetic ES/EN source-selection cases; no independent
human annotation certification. The initial request falsely treated missing data
as unsafe and abstained on all source selections. Its 300 outputs are preserved.
The unsafe question was narrowed to explicit deletion or classifier override;
the revised request runs 100 adjustment and 200 previously exposed heldout cases.
This reused holdout is not a new sealed validation set. Thresholds stay unchanged.

120 matched pairs, 120 turns per variant: 12 workflow classes in both languages,
five repetitions per template. Advice, social, stored goal/bedtime, missing sleep,
recorded protection, complete/incomplete block, quotation and forgetting. Each
language has balanced baseline/candidate-first ordering across the experiment.
Independently reset identical fixtures; token renewed before every pair. Real
providers and actual private QA DB, exact local handlers. This measures streaming
handler first text and durable final, not deployed Netlify transport or physical
iPhone display/audio latency. All app/provider failures remain in the evidence.

The transport meter preserves streamed chunks and records usage for each actual
request, including repairs/incomplete replies, cache reads and cache writes.
Standard Responses rates are $0.20 input / $0.02 cached input / $0.25 cache writes /
$1.20 output per million tokens; dedicated Decisions input is $0.10 per million,
without cache/output charges. Unknown billed requests remain explicit and prevent
an exact total estimate. Estimates based on usage and rates are not an invoice.
The old Jev aggregate ignored cache-write counters; do not reuse its dollar totals
as an equivalent comparison to this new per-request measurement.

Exact queued action type/minutes are read after timing ends; forgetting must leave
a durable tombstone. A separate provider reviews synthetic replies and supplied
action parameters. Neither a queued attempt nor that model review certifies a
physical device block, independent human quality or production readiness.

Targets are first-text median and known complete estimated cost at most 80% of
baseline, no worse first-text/final p95, no worse errors/quality/authority. Any
failed/unknown gate keeps the experimental feature off. All failures are retained.

## Completed result: keep disabled

120 turns per variant, 60 per language, 108 pairs successful in both variants.
Latency percentiles below use successful turns; errors and their full request
usage remain counted separately. This is a small repeated-template experiment,
not a production distribution or statistical proof about all Decisions designs.

| Metric | Integrated baseline | Decisions |
| --- | ---: | ---: |
| First text p50 | 3016.77 ms | 3371.96 ms (+11.8%) |
| First text p95 | 17733.91 ms | 17646.65 ms (-0.5%) |
| Durable final p50 | 4400.72 ms | 5058.30 ms (+14.9%) |
| Durable final p95 | 18880.24 ms | 18954.92 ms (+0.4%) |
| Successful / failed turns | 110 / 10 | 109 / 11 |
| Generative requests, including repairs | 193 | 195 |
| Additional Decisions requests | 0 | 119 (113 completed) |
| Median DB calls | 15 | 15 |
| Estimated application cost, 120 turns | $0.12025844 | at least $0.14078910 (+17.1%) |

Six Decisions requests timed out without usage. Candidate total cost is unknown;
the known subtotal already exceeds baseline. Cache writes and failed turns are
included. Reviewer overhead, standalone classifier trials and access probe are
outside application cost. Known dedicated Decisions spend across classifier,
pilot and main trials plus probe is $0.10803140; this is not an invoice.

On the 108 mutually successful pairs, first-text median ratio is 1.1161 (+11.6%).
Neither median speed nor cost target passes. The slight first-text p95 improvement
does not compensate for worse median/final latency, extra calls and more errors.
All observed failed app turns returned HTTP 503; existing planner/observation
repair cases dominate. These are measured failures, not replaced samples.

Revised source selection on the previously exposed 200-case holdout: ES precision
47.83%, recall 61.11%; EN precision 47.37%, recall 50%. Exact source-set match
88%/89% is dominated by negative cases and does not establish retrieval accuracy.
The initial all-abstaining trial and subsequent 100-case adjustment are preserved.

Second-model reply review: acceptable/excellent 90% baseline versus 85.83%
Decisions, hard flags 1 versus 4. This is advisory model judgement, not human
validation. The original review omitted verified forgetting tombstones and falsely
flagged two baseline acknowledgements; the 20 affected records (8 distinct review
inputs) were reviewed again with that receipt. Both reviews are preserved. All
20 complete-block turns have verified queued start_protection / 30 minutes / once;
all 20 forgetting turns have durable tombstones. No physical block is certified.
Known goal and bedtime were seeded; sleep/protection histories were empty, so this
experiment does not certify retrieval over nonempty personal histories.

All five QA cleanup checks passed. All seven frozen runtime hashes were identical
at the end; the baseline checkout advanced only by a TestFlight documentation file.
After measurement, usage validation was tightened to reject malformed output-token
metadata; valid provider behavior is unchanged, measured candidate stays 753553b.

Machine evidence: [all trials and reviews](BM_DECISIONS_EVIDENCE_2026-10-07.json).
PR: [draft 25](https://github.com/guillemarcos14/BlankmindAI/pull/25).
Default-off prototype retained for review; no server flags, deployment, migration,
production or TestFlight change. Decisions is fast for typed answers, but this
prefetch integration did not reliably replace the planner's retrieval rounds.

## Official sources checked 2026-10-07

[Decisions API guide](https://developers.openai.com/api/docs/guides/decisions),
[typed request contract](https://developers.openai.com/api/reference/python/resources/decisions/methods/create),
[existing generator rates](https://developers.openai.com/api/docs/models/gpt-5.6-luna).
