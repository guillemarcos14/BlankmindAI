# Jev for Blankmind

Reviewed 2026-10-07 against primary TypeSafe documentation and the current BM
latency profile. Recommendation: a promising auxiliary classifier, with the
strongest fit in conversation tagging. Production adoption is not approved or
implemented. No live Jev accuracy/latency benchmark was performed.

## Capability and fit

Jev returns closed-set choices, rubric scores and yes/no probabilities. It does
not generate replies. Multiple independent questions can share one request.
These primitives fit topic tags (sleep, focus, distractions, app support,
account, other/uncertain), turn type and identifying whether personal sources
are relevant. BM's generative planner still composes replies, resolves context,
grounds facts and prepares actions.
[Official introduction](https://docs.typesafe.ai/introduction),
[parallel questions](https://docs.typesafe.ai/patterns/fan-out).

| Area | Assessment for this codebase |
| --- | --- |
| Conversation tagging | Strong potential. Use a fixed taxonomy, uncertainty and optional multiple topics; keep tagging outside the response wait. |
| Latency | Conditional potential. Selecting likely sources before the planner might remove read passes. An extra serial classification call on a one-pass conversation would add time. |
| Cost | Savings only when replacing a paid classification/read pass or reducing context. Classification added to fields already returned by the main reply call increases total cost. |
| Reply generation | Keep the current generative model. Jev's answer space is bounded; it cannot write a natural personalized response. |
| Action authority | Keep current explicit authorization, proposal fingerprint, CAS, leases, parameter validation and native receipts. A topic label must never authorize execution. |

The final BM profile shows roughly 150–170 ms for app context preparation in
most cases, 2.1–3.0 seconds for many one-pass model calls, and 13.7 seconds across
four calls for a measured-sleep question. This makes source selection a credible
experiment. That is an inference from BM timing, not measured Jev performance.
[BM timing evidence](BM_LATENCY_PROFILE_2026-10-07.json),
[official intent-routing pattern](https://docs.typesafe.ai/patterns/intent-routing).

## Price and limits

Current published direct price for `jev-1.13.0`: **$0.042 per million input
tokens**, output free. At an assumed 2,000 total input tokens per classification
request, 100,000 requests cost about **$8.40** for Jev alone, before retries,
gateways or remaining generative calls. This is arithmetic, not observed billing.
Compare the full workflow, including fallback and existing prompt-cache discounts.
The current model accepts text; transcription and speech output remain separate.
[Official model reference](https://docs.typesafe.ai/models).

## Limitations relevant to Blank

TypeSafe reports strongest accuracy in English, so Spanish and short contextual
acceptances need separate evaluation. Its published limitations include literal
interpretation, option-order effects, adversarial text, dates/numbers and long
irrelevant context. Keep exact time arithmetic in code and classify a small
relevant state. Confidence measures the distribution's concentration; it is not
a guarantee that a label is correct.
[Model limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13),
[confidence definition](https://docs.typesafe.ai/confidence),
[language support](https://docs.typesafe.ai/models).

## Suggested pilot (not implemented)

Start with nonblocking shadow topic/turn tagging on 300 reviewed examples,
including English/Spanish, multi-topic turns, corrections, quoted requests,
acceptances, missing context and injection attempts. Pin the model version;
include other/uncertain rather than forcing a label. Compare against the current
planner's existing turn type plus a simple rule baseline.

Measure per-label precision/recall, macro-F1, uncertainty coverage, p50/p95,
failures and full request cost. Proposed adoption criteria: at least 95%
precision for automatically accepted topic tags with useful coverage, no
critical action/consent classification regression, and verified total savings
for any latency-critical routing. Calibrate thresholds on held-out examples;
do not borrow a vendor confidence number as an accuracy promise.

Only after tagging is useful, test source prefetch in parallel with current
context preparation. Leave the planner free to retrieve missing sources, and
fall back immediately on classifier timeout/uncertainty. Do not replace the
current BM authority or add a second personal-memory store. Jev access would be
needed for the live experiment; no account, purchase or external submission was
created in this study.
