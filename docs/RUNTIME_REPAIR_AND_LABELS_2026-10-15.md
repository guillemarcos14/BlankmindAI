# Current-route repair and gated labels replacement — 15 October 2026

Subsequent free candidate corrections and current readiness: [LOCAL_AGENT_REGRESSIONS_2026-10-15.md](LOCAL_AGENT_REGRESSIONS_2026-10-15.md). The original deployed repair and real pilot results below remain unchanged.

## Published repair

Production is `6ad0a30668dd3a2c10b068ba`, immutable production-context deployment built from `4053519976df350fda9627cac0ff55b0eac36b69`. The current route now uses a distinct pause schema requiring integer `hours` from 1 to 168 and `minutes=null`. Both the current JSON route and the gated tools route share that contract. The normal reasoning policy is unchanged.

Full-memory deletion now requires conservative, explicit whole-message authorization. A category request cannot acquire `forget_all` authority merely because the model emits it. Ambiguity returns once to the agent for a natural clarification, with no memory, action, tracking or rest effects; failed clarification fails closed. The independent test that previously allowed full deletion for “help” was corrected to require an explicit request.

The exact deployed draft passed 8/8 authenticated checks: access/isolation plus two-hour pauses and ambiguous forgetting in ES/EN. Two real synthetic memories per account remained unchanged after each ambiguous request. Cleanup passed 12/12. Draft and published infrastructure each passed 4/4 with cleanup 12/12. This is synthetic server validation; no native action was verified or applied on an iPhone. All 27 functions remain, including 19 unrelated ZIP digests unchanged; the 17 static files, environment definitions and cron are preserved. The new publisher requires the actual deployed regression receipt before publication.

Before deployment, the real provider/database pilot passed 12/12 for the repaired current route and 12/12 for tools. Independent review accepted 12/12 current-route turns and 11/12 tools turns. The tools rejection concerned an overly narrow explanation of an ambiguous category. Its chat median also regressed. This is a repair pilot, not a 200-pair optimization certificate. Production repair evidence is in `Extra/Codigo-runtime-fix/tmp/runtime-fix-20261015/`; the original local pilot and negative harness are also retained in `Extra/Codigo-agent-final40/tmp/runtime-fix-20261015/`.

## New labels candidate, not published

The prior post-commit topic/type classifier added metadata without removing generative work. Its automatic invocation and advisory metadata reads are removed from the candidate. Historical SQL and diagnostic helpers remain for reproducibility and do not run on the request path.

With the independent labels gate enabled in private QA, the agent extracts original observation values, units, dates, metric and literal evidence, but its schema omits `measurement`. One batched Decisions request supplies `routine_statement` or `declared` for those new observations. The existing observation stores and reuses the classification. Decisions cannot change extracted values, dates, provenance, action permissions or rest efficacy. Refusal, low confidence, missing literal evidence or provider failure returns the original turn once to the canonical generator. No classifier runs for a turn without new observations or to reclassify existing records. Proactive reasoning stays canonical.

Four distinct, pre-authored ES/EN routine/episode pairs passed with actual provider IDs and persisted SQL effects: baseline 4/4 and candidate 4/4. The candidate actually removed the generated measurement field and made four batched Decisions requests. It did **not** remove an entire model call: each variant used four generations. Cost increased from $0.00298243 to $0.00427377; first-text p50 increased from 3376 to 3579 ms and p95 from 4319 to 4980 ms. Therefore this substitution must remain OFF.

Independent review v4 rejected four routine cases in both variants because it incorrectly required a yesterday occurrence for the usual-habit cases. Those receipts are preserved. New v5 inputs expose each case's pre-authored structured observation expectation and distinguish statement timestamps from event dates; the unchanged eight turns then passed 8/8 review (4/4 per variant). No source output or failed review was overwritten. This does not repair the measured cost/latency regression or supply missing coverage. All labels receipts and both reviews are in `Extra/Codigo-runtime-fix/tmp/labels-replacement-20261015/`.

## Remaining gates and budget

Tools, retrieval and labels are OFF. The later labels source has a new fingerprint: the earlier tools pilot is stale for that source, although it remains valid evidence for the exact published repair. Current assessors reject insufficient distinct pairs, language/group/audio coverage and metrics; the tools report additionally identifies stale source. Retrieval has no complete current-source 200-pair/audio/total-cost certificate. No manifest approval, threshold, model policy or required coverage was weakened.

Final shared ledger: known $34.20500233, conservative reserved total $39.685206255, remaining $0.314793745 under the final $40 cap. Every opaque reservation is retained, including $0.25 for the four deployed regression turns whose remote usage is not exposed. No concurrent paid ledger writers, quota changes, new keys or subscription changes occurred. The remaining allowance is below the benchmark's $1 minimum new voice reservation; unknown prior voice reserves cannot be reused or released. Full paid certification remains blocked.

No native source changed and build 119 remains current. Windows exposed no connected iPhone/Watch or device-control tooling; Codex browser inventory contained no Mac/iPhone session. Physical pause/enforcement, playback and revocation remain untested. Historical real ES/EN voice evidence applies to its original immutable deployment; it is not a new physical or audio benchmark for this repair. No Watch sleep efficacy is claimed; sufficient comparable measured nights are required.

Free local validation: 46/46 harness checks with the original baseline and enforced scope. PostgreSQL/runtime CI is recorded separately in the final receipt. PR50 remains a draft for the unapproved optimizations. The published safety repair and unpublished labels candidate are separate outcomes; the requested full activation is not complete.
