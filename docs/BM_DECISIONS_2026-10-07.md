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
failed/unknown gate keeps the experimental feature off. Results will be recorded
without selecting favorable cases or replacing provider failures.

## Official sources checked 2026-10-07

[Decisions API guide](https://developers.openai.com/api/docs/guides/decisions),
[typed request contract](https://developers.openai.com/api/reference/python/resources/decisions/methods/create),
[existing generator rates](https://developers.openai.com/api/docs/models/gpt-5.6-luna).
