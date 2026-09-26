"use strict";

const assert = require("assert");
const { digest, evaluateTurn, visibleSurfaces, surfaceContradictions } = require("./bm_semantic_oracle");
const { captureSource, mapConcurrent, replay, validateDataset } = require("./bm_semantic_replay");

const input = "Block Instagram from 10 am to 11 am every day for 7 days, for 60 minutes per session.";
const expected = {
  state: { intent: "block", apps: ["Instagram"], app_category: null, moment: null, action_type: "strict_block", start: { type: "time", minute: 600 }, end: 660, duration_minutes: 60, recurrence: { type: "daily", weekdays: [1, 2, 3, 4, 5, 6, 7] }, schedule_horizon_days: 7, confirmation: "confirmed", pending_slots: [], status: "ready", next_question: null },
  decision: { type: "ready", slot: null }, actions: [{ type: "apply_schedule", start_minute: 600, end_minute: 660, weekdays: [1, 2, 3, 4, 5, 6, 7], duration_days: 7 }], language: "en",
};
const source = { kind: "user", turn: 1, text: input };
const slot = value => value === null ? null : { value, source: { ...source }, confidence: 1 };
function fixture() {
  const slots = Object.fromEntries(Object.entries(expected.state).filter(([key]) => !["intent", "pending_slots", "status", "next_question"].includes(key)).map(([key, value]) => [key, slot(key === "confirmation" ? { status: "confirmed", fingerprint: "test-confirmation" } : structuredClone(value))]));
  return { semantic_state: { version: 1, revision: 1, turn: 1, language: "en", intent: "block", slots, status: "ready", pending_slots: [], next_question: null, corrections: [] }, semantic_decision: { type: "ready", slot: null },
    plan: { message_text: "Review Instagram from 10:00 AM to 11:00 AM every day in Blankmind.", actions: structuredClone(expected.actions) }, source: "test_fixture" };
}
function review(body, verdict = "equivalent") {
  return { response_sha256: digest(visibleSurfaces(body.plan)), expectation_sha256: digest(expected), reviewer: "unit-test-review-fixture", rationale: "Test-only review fixture binds to the stated app, window, recurrence and proposal, not execution.", verdict, language: "en" };
}
async function main() {
  const original = fixture();
  const reviews = [review(original)];
  const run = (body, overrides = {}) => evaluateTurn({ expected, body, inputs: [input], context: { screen_time_authorized: true }, reviews, ...overrides });
  assert.equal(run(original).status, "passed", "independently reviewed equivalent fixture passes");
  assert.equal(run(original, { reviews: [] }).status, "unverified", "no green without surface meaning review");
  const mutations = [
    ["state start minute", body => { body.semantic_state.slots.start.value.minute = 601; }],
    ["state end minute", body => { body.semantic_state.slots.end.value = 720; }],
    ["state duration", body => { body.semantic_state.slots.duration_minutes.value = 90; }],
    ["state app", body => { body.semantic_state.slots.apps.value = ["TikTok"]; }],
    ["intent", body => { body.semantic_state.intent = "advice"; }],
    ["recurrence", body => { body.semantic_state.slots.recurrence.value = { type: "once", weekdays: [] }; }],
    ["state horizon", body => { body.semantic_state.slots.schedule_horizon_days.value = 8; }],
    ["action horizon", body => { body.plan.actions[0].duration_days = 8; }],
    ["unrequested hard mode", body => { body.semantic_state.slots.hard_mode = slot(true); }],
    ["capability converted to block", body => { body.semantic_state.slots.requested_capability = slot("allow_only"); }],
    ["confirmation", body => { body.semantic_state.slots.confirmation = null; }],
    ["missing canonical state", body => { delete body.semantic_state; }],
    ["wrong next step", body => { body.semantic_decision = { type: "ask", slot: "apps" }; }],
    ["premature action", body => { body.semantic_state.pending_slots = ["recurrence"]; }],
    ["stale next question", body => { body.semantic_state.next_question = "apps"; }],
    ["wrong conversation status", body => { body.semantic_state.status = "cancelled"; }],
    ["fabricated provenance", body => { body.semantic_state.slots.start.source.text = "user never wrote this"; }],
    ["missing provenance", body => { delete body.semantic_state.slots.apps.source; }],
    ["invalid confidence", body => { body.semantic_state.slots.start.confidence = 1.5; }],
    ["ungrounded derivation", body => { body.semantic_state.slots.end.source = { kind: "derived" }; }],
    ["action start minute", body => { body.plan.actions[0].start_minute = 601; }],
    ["action end minute", body => { body.plan.actions[0].end_minute = 661; }],
    ["action duration", body => { body.plan.actions[0].minutes = 90; }],
    ["action wrong app", body => { body.plan.actions[0].app_names = ["TikTok"]; }],
    ["action weekdays", body => { body.plan.actions[0].weekdays = [1, 2]; }],
    ["extra action", body => { body.plan.actions.push({ type: "start_protection", minutes: 90 }); }],
    ["visible wrong clock", body => { body.plan.message_text = "Review Instagram from 10:00 AM to 12:00 PM every day in Blankmind."; }],
    ["visible wrong duration", body => { body.plan.message_text += " The block lasts 90 minutes."; }],
    ["visible wrong app", body => { body.plan.message_text += " TikTok is included."; }],
    ["visible wrong horizon", body => { body.plan.message_text += " Repeat for 8 days."; }],
    ["false execution claim", body => { body.plan.message_text += " I have already blocked Instagram."; }],
    ["hidden speech contradiction", body => { body.plan.speech_text = "Review Instagram for 4 hours."; }],
    ["wrong state language", body => { body.semantic_state.language = "es"; }],
    ["model failure masked by fallback", body => { body.model_error = "model_timeout"; }],
    ["empty visible response", body => { body.plan.message_text = ""; }],
    ["word salad with expected keywords", body => { body.plan.message_text = "Instagram 10:00 AM 11:00 AM every day. Purple bananas review Tuesday's invisible philosophy."; }],
    ["wrong visible language", body => { body.plan.message_text = "Revisa Instagram de 10:00 AM a 11:00 AM cada día en Blankmind."; }],
  ];
  const outcomes = [];
  for (const [name, mutate] of mutations) {
    const body = structuredClone(original);
    mutate(body);
    const result = run(body);
    assert.notEqual(result.status, "passed", `mutation escaped actual evaluator: ${name}`);
    outcomes.push({ name, status: result.status, causes: result.issues.map(issue => issue.code) });
  }
  const reworded = fixture();
  reworded.plan.message_text = "In Blankmind, review a daily Instagram block between 10:00 AM and 11:00 AM.";
  assert.equal(run(reworded, { reviews: [review(reworded)] }).status, "passed", "reviewed paraphrase accepted without exact wording asserts");
  assert.equal(run(original, { previousState: { revision: 1 } }).status, "failed", "unchanged revision rejected");
  assert.equal(run(original, { reviews: [review(original, "not_equivalent")] }).status, "failed", "independent negative review fails");
  assert.equal(run(original, { context: { screen_time_authorized: false } }).status, "failed", "permission required independently of runtime");
  assert.equal(run(original, { context: { channel: "sms", screen_time_authorized: true, app_presence_recent: false } }).status, "failed", "recent presence required independently of runtime");
  assert.equal(run(original, { context: { screen_time_authorized: true, selected_app_names: ["TikTok"] } }).status, "failed", "known native selection must match actual target");
  const capabilityBypass = fixture();
  capabilityBypass.semantic_state.slots.requested_capability = slot("allow_only");
  assert.ok(run(capabilityBypass, { expected: { ...expected, state: { ...expected.state, requested_capability: "allow_only" } } }).issues.some(issue => issue.code === "requested_capability_cannot_become_block_action"), "capability execution gate is independent of gold equality");
  const clearedExpected = { ...expected, state: { ...expected.state, start: null, end: null, duration_minutes: null, recurrence: null, schedule_horizon_days: null, apps: null }, actions: [] };
  const referenceIssues = (text, gold = clearedExpected, inputs = [], extra = {}) => surfaceContradictions({ message_text: text, actions: [], ...extra }, gold, {}, inputs);
  // Asking which recurrence the person wants does not assert any option.
  // Only the complete canonical choice question gets this narrow exception.
  const recurrenceQuestionExpected = { ...clearedExpected,
    state: { ...clearedExpected.state, recurrence: null, pending_slots: ["recurrence"], status: "collecting", next_question: "recurrence" },
    decision: { type: "ask", slot: "recurrence" }, actions: [] };
  const recurrenceQuestions = [
    ["en", "Should it happen just once, every day, or on specific days of the week?"],
    ["es", "¿Lo quieres solo esta vez, cada día o en días concretos de la semana?"],
  ];
  const recurrenceIssue = issues => issues.some(issue => issue.code === "visible_recurrence_contradiction");
  for (const [language, question] of recurrenceQuestions) {
    const gold = { ...recurrenceQuestionExpected, language };
    assert.deepEqual(referenceIssues(question, gold), [], "recurrence options are not an asserted daily schedule");
    const assertion = language === "en" ? "It will happen every day." : "Será cada día.";
    assert.ok(recurrenceIssue(referenceIssues(assertion, gold)), "an actual daily assertion still contradicts absent recurrence");
    assert.ok(recurrenceIssue(referenceIssues(`${question} ${assertion}`, gold)), "the following assertion is not masked with the question");
    assert.ok(recurrenceIssue(referenceIssues(`${assertion} ${question}`, gold)), "the preceding assertion is still checked");
    assert.ok(recurrenceIssue(referenceIssues(question, gold, [], { speech_text: assertion })), "contradiction on another visible surface remains checked");
    assert.ok(recurrenceIssue(referenceIssues(question.replace(/\?$/, `, ${assertion}?`), gold)), "an extra claim inside the question is not exempt");
    assert.ok(recurrenceIssue(referenceIssues(question.replace(/\?$/, "."), gold)), "choice words without a question are not exempt");
    assert.ok(recurrenceIssue(referenceIssues(question, { ...gold, decision: { type: "ready", slot: null } })), "ready is not asking for recurrence");
    assert.ok(recurrenceIssue(referenceIssues(question, { ...gold, decision: { type: "ask", slot: "start" } })), "another missing slot is not exempt");
    assert.ok(recurrenceIssue(referenceIssues(question, { ...gold, state: { ...gold.state, pending_slots: [] } })), "recurrence must actually be pending");
    assert.ok(recurrenceIssue(referenceIssues(question, { ...gold, state: { ...gold.state, recurrence: { type: "once", weekdays: [] } } })), "a known once recurrence is not exempt");
    assert.ok(recurrenceIssue(referenceIssues(question, { ...gold, actions: [{ type: "start_protection", minutes: 45 }] })), "expected executable proposals disable the exception");
    assert.ok(recurrenceIssue(referenceIssues(question, gold, [], { actions: [{ type: "start_protection", minutes: 45 }] })), "observed executable proposals disable the exception");

    const body = fixture();
    body.semantic_state.language = language;
    body.semantic_state.status = "collecting";
    body.semantic_state.pending_slots = ["recurrence"];
    body.semantic_state.next_question = "recurrence";
    for (const key of Object.keys(body.semantic_state.slots)) {
      const value = gold.state[key];
      body.semantic_state.slots[key] = slot(key === "confirmation" ? { status: "confirmed", fingerprint: "test-confirmation" } : value ?? null);
    }
    body.semantic_decision = gold.decision;
    body.plan = { message_text: question, response_text: question, speech_text: question, actions: [] };
    const assessment = evaluateTurn({ expected: gold, body, inputs: [input], reviews: [] });
    assert.equal(assessment.dimensions.visible_equivalence, "unverified", "a lexical exception cannot grant visible PASS without an exact review");
    assert.equal(assessment.status, "unverified");
    body.model_error = "semantic_model_timeout";
    const degraded = evaluateTurn({ expected: gold, body, inputs: [input], reviews: [] });
    assert.equal(degraded.dimensions.safety, "failed", "real provider timeout is independent of the lexical false positive");
    assert.equal(degraded.status, "failed");
  }
  for (const text of ["Okay, not 30 minutes. How long should it last?", "Got it—not 30 minutes. What exact end time?", "Okay, not every day. Which days?", "Got it—not daily. Once or specific days?"]) {
    const inputs = [text.includes("30") ? "Not 30 minutes." : "Not daily."];
    assert.deepEqual(referenceIssues(text, clearedExpected, inputs), [], "explicit grounded correction is not a positive slot claim");
  }
  assert.ok(referenceIssues("Not 30 minutes.").some(issue => issue.code === "visible_duration_contradiction"), "unbacked rejection is not exempt");
  assert.ok(referenceIssues("Not 30 minutes. I will block for 30 minutes.", clearedExpected, ["Not 30 minutes."]).some(issue => issue.code === "visible_duration_contradiction"), "positive duration after a negation is still rejected");
  assert.ok(referenceIssues("Not daily. I will repeat every day.", clearedExpected, ["Not daily."]).some(issue => issue.code === "visible_recurrence_contradiction"), "positive recurrence after a negation is still rejected");
  assert.ok(referenceIssues("Not 30 minutes.", { ...clearedExpected, state: { ...clearedExpected.state, duration_minutes: 30 } }, ["Not 30 minutes."]).some(issue => issue.code === "visible_duration_negates_expected"), "negation cannot contradict retained gold");
  assert.ok(referenceIssues("Not daily.", expected, ["Not daily."]).some(issue => issue.code === "visible_recurrence_negates_expected"));
  const rangeExpected = { ...clearedExpected, state: { ...clearedExpected.state, action_type: "strict_block", start: { type: "now" }, duration_minutes: 2, pending_slots: ["duration_minutes"] } };
  for (const verb of ["can run for", "can last", "can be", "can only last", "support"]) {
    assert.deepEqual(referenceIssues(`Immediate blocks ${verb} 5 to 240 minutes. What exact duration?`, rangeExpected), [], "native supported range is not the requested duration");
  }
  assert.deepEqual(referenceIssues("El bloqueo inmediato admite de 5 a 240 minutos. ¿Qué duración quieres?", rangeExpected), []);
  for (const text of ["Immediate blocks support 2 to 240 minutes.", "Immediate blocks can last 5 to 300 minutes.", "Immediate blocks can last 5 to 240 minutes. I will block for 240 minutes."]) {
    assert.ok(referenceIssues(text, rangeExpected).length, "wrong range or proposed range endpoint remains a contradiction");
  }
  const pastInput = ["I broke the block yesterday after 15 minutes."];
  assert.deepEqual(referenceIssues("You’re describing a previous block that ended after 15 minutes. We can discuss a future proposal.", clearedExpected, pastInput), []);
  for (const [text, inputs] of [["A previous block ended after 16 minutes.", pastInput], ["A previous block ended after 15 minutes.", []], ["A previous block ended after 15 minutes. I will block for 15 minutes.", pastInput]]) {
    assert.ok(referenceIssues(text, clearedExpected, inputs).some(issue => issue.code === "visible_duration_contradiction"), "history must be grounded and cannot authorize a new duration");
  }
  const cancelledExpected = { ...clearedExpected, state: { ...clearedExpected.state, intent: "cancelled", status: "cancelled" } };
  const cancelledInputs = ["Block Instagram from 10 AM to 11 AM daily for 7 days.", "Cancel this request.", "Yes."];
  assert.deepEqual(referenceIssues("Would you like me to recreate the 10 - 11 AM Instagram block for 7 days?", cancelledExpected, cancelledInputs), [], "question about the withdrawn plan does not reactivate it");
  assert.deepEqual(referenceIssues("The 45-minute daily limit remains withdrawn, and nothing is active.", cancelledExpected, ["Set a 45-minute daily limit.", "Cancel this request."]), []);
  for (const text of ["Would you like me to recreate the 10 - 12 PM Instagram block for 7 days?", "Would you like me to recreate the 10 - 11 AM TikTok block for 7 days?", "Would you like me to recreate the 10 - 11 AM Instagram block for 8 days?", "Would you like me to recreate the 10 - 11 AM Instagram block for 7 days? I have already blocked Instagram.", "The daily limit remains withdrawn, but I will repeat every day."]) {
    assert.ok(referenceIssues(text, cancelledExpected, cancelledInputs).length, "historical language cannot hide a new or fabricated claim");
  }
  assert.ok(referenceIssues("Would you like me to recreate the 10 - 11 AM Instagram block for 7 days?", cancelledExpected, []).length, "withdrawn-reference exemption requires prior user facts");
  assert.ok(referenceIssues("Okay, not 30 minutes.", clearedExpected, ["Not 30 minutes."], { speech_text: "I will block for 30 minutes." }).some(issue => issue.code === "visible_duration_contradiction"), "all visible surfaces remain checked");
  const weeklyExpected = { ...expected, state: { ...expected.state, requested_capability: "weekly_review", start: null, end: null, duration_minutes: null } };
  const weeklyContext = { weekly_protected_minutes: 120, weekly_break_count: 2 };
  assert.deepEqual(surfaceContradictions({ message_text: "You protected 120 minutes this week, with 2 breaks." }, weeklyExpected, weeklyContext), [], "correct observed metrics are not future block slots");
  assert.deepEqual(surfaceContradictions({ message_text: "Has protegido 120 minutos esta semana, con 2 interrupciones." }, weeklyExpected, weeklyContext), [], "Spanish observation grounded in exact context");
  assert.deepEqual(surfaceContradictions({ message_text: "This week you recorded 120 protected minutes and 2 breaks." }, weeklyExpected, weeklyContext), [], "recorded protected minutes are checked as observations");
  assert.ok(surfaceContradictions({ message_text: "This week you recorded 121 protected minutes and 2 breaks." }, weeklyExpected, weeklyContext).some(issue => issue.code === "visible_observed_minutes_mismatch"));
  assert.ok(surfaceContradictions({ message_text: "You protected 121 minutes this week, with 2 breaks." }, weeklyExpected, weeklyContext).some(issue => issue.code === "visible_observed_minutes_mismatch"));
  assert.ok(surfaceContradictions({ message_text: "You protected 120 minutes this week, with 3 breaks." }, weeklyExpected, weeklyContext).some(issue => issue.code === "visible_observed_break_count_mismatch"));
  assert.ok(surfaceContradictions({ message_text: "You protected 120 minutes this week." }, weeklyExpected, {}).some(issue => issue.code === "visible_observed_minutes_mismatch"), "missing metric is not zero or invented evidence");
  assert.ok(surfaceContradictions({ message_text: "I would block for 120 minutes." }, weeklyExpected, weeklyContext).some(issue => issue.code === "visible_duration_contradiction"), "known observed number does not authorize a future duration");
  const reviewInput = "Review my last week.";
  const reviewExpected = { state: { intent: "advice", apps: null, app_category: null, moment: null, action_type: null, hard_mode: null, requested_capability: "weekly_review", start: null, end: null, duration_minutes: null, recurrence: null, schedule_horizon_days: null, confirmation: null, pending_slots: [], status: "idle", next_question: null }, decision: { type: "none", slot: null }, actions: [], language: "en" };
  const reviewBody = { semantic_state: { version: 1, revision: 1, turn: 1, language: "en", intent: "advice", status: "idle", pending_slots: [], next_question: null, slots: { requested_capability: { value: "weekly_review", source: { kind: "user", turn: 1, text: reviewInput }, confidence: 1 } } }, semantic_decision: reviewExpected.decision, plan: { message_text: "You protected 120 minutes this week, with 2 breaks.", actions: [] } };
  const metricReview = { response_sha256: digest(visibleSurfaces(reviewBody.plan)), expectation_sha256: digest(reviewExpected), reviewer: "unit-test-review-fixture", rationale: "Test-only grounded observation, not a proposed block.", verdict: "equivalent", language: "en" };
  const metricRun = body => evaluateTurn({ expected: reviewExpected, body, inputs: [reviewInput], context: weeklyContext, reviews: [metricReview] });
  assert.equal(metricRun(reviewBody).status, "passed", "actual evaluator accepts independently reviewed grounded weekly metrics");
  for (const [name, text] of [["observed metric minutes", "You protected 121 minutes this week, with 2 breaks."], ["observed metric break count", "You protected 120 minutes this week, with 3 breaks."]]) {
    const body = structuredClone(reviewBody); body.plan.message_text = text; const result = metricRun(body);
    assert.equal(result.status, "failed", `metric mutation escaped: ${name}`);
    outcomes.push({ name, status: result.status, causes: result.issues.map(issue => issue.code) });
  }
  const protectionInput = "Start protection now for 30 minutes, just once.";
  const protectionExpected = { ...structuredClone(expected), state: { ...structuredClone(expected.state), apps: ["selected_apps"], start: { type: "now" }, end: null, duration_minutes: 30, recurrence: { type: "once", weekdays: [] }, schedule_horizon_days: null }, actions: [{ type: "start_protection", minutes: 30, hard_mode: false }] };
  const protectionBody = fixture();
  for (const key of ["apps", "start", "end", "duration_minutes", "recurrence", "schedule_horizon_days"]) protectionBody.semantic_state.slots[key] = slot(protectionExpected.state[key]);
  for (const item of Object.values(protectionBody.semantic_state.slots)) if (item) item.source.text = protectionInput;
  protectionBody.plan = { message_text: "Review protection for your selected distractions for 30 minutes, just once.", actions: structuredClone(protectionExpected.actions) };
  const protectionReviews = [{ ...review(protectionBody), expectation_sha256: digest(protectionExpected), rationale: "Test-only independent review fixture: canonical selected-distractions protection, 30-minute single proposal; no execution claim." }];
  const protectionRun = body => evaluateTurn({ expected: protectionExpected, body, inputs: [protectionInput], context: { screen_time_authorized: true }, reviews: protectionReviews });
  assert.equal(protectionRun(protectionBody).status, "passed", "single-selection protection baseline passes");
  for (const [name, mutate] of [
    ["unexpected named target", body => { body.plan.actions[0].app_names = ["Other"]; }],
    ["wrong selection target slot", body => { body.semantic_state.slots.apps.value = ["Other"]; }],
    ["native hard-mode flip", body => { body.plan.actions[0].hard_mode = true; }],
  ]) {
    const body = structuredClone(protectionBody); mutate(body); const result = protectionRun(body);
    assert.equal(result.status, "failed", `single-selection mutation escaped: ${name}`);
    outcomes.push({ name, status: result.status, causes: result.issues.map(issue => issue.code) });
  }
  assert.throws(() => run(original, { expected: { ...expected, state: { intent: "block" } } }), /oracle_incomplete_state/);
  let active = 0;
  let peak = 0;
  const order = await mapConcurrent(Array.from({ length: 200 }, (_, i) => i), 7, async i => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, i % 3));
    active--;
    return i;
  });
  assert.equal(peak, 7, "batch concurrency bounded and used");
  assert.deepEqual(order, Array.from({ length: 200 }, (_, i) => i), "batch results stable ordering");
  const dataset = { version: 1, id: "runner-unit", split: "development", conversations: [{ id: "a", channel: "ios", context: { screen_time_authorized: true }, turns: [{ input, expect: expected }, { input, expect: expected }] }] };
  validateDataset(dataset);
  const report = await replay(dataset, { repeats: 2, modes: ["bm_final"], concurrency: 2 }, async request => {
    const body = fixture();
    body.semantic_state.revision = (request.context.semantic_state?.revision || 0) + 1;
    return body;
  }, reviews);
  assert.equal(report.summary.passed, 4);
  assert.equal(report.variability.length, 2);
  const failed = await replay(dataset, { repeats: 1, modes: ["bm_final"], concurrency: 2 }, async () => { throw new Error("intentional timeout"); });
  assert.equal(failed.summary.failed, 2, "batch preserves every failure turn");
  assert.equal(failed.release_eligible, false);
  // Mock only Git and the provider; capture actual bytes, including a renderer
  // dependency that the old seven-file snapshot omitted.
  const fs = require("fs"), path = require("path");
  const provenanceRoot = path.resolve(__dirname, "../tmp/bm-semantic/provenance-fixture");
  fs.mkdirSync(path.join(provenanceRoot, "netlify/functions/nested"), { recursive: true });
  fs.mkdirSync(path.join(provenanceRoot, "tools"), { recursive: true });
  const renderer = "netlify/functions/bm-contextual-response.js";
  fs.writeFileSync(path.join(provenanceRoot, renderer), "renderer-at-start");
  fs.writeFileSync(path.join(provenanceRoot, "netlify/functions/nested/contract.json"), '{"native":true}');
  fs.writeFileSync(path.join(provenanceRoot, "tools/oracle.js"), "oracle-at-start");
  fs.writeFileSync(path.join(provenanceRoot, "package.json"), '{"name":"snapshot-fixture"}');
  let gitHead = "a".repeat(40), gitDirty = "";
  const capture = () => captureSource({ root: provenanceRoot, git: args => args[0] === "rev-parse" ? gitHead : gitDirty });
  const oneTurn = { ...dataset, conversations: [{ ...dataset.conversations[0], turns: dataset.conversations[0].turns.slice(0, 1) }] };
  const replayWithCapture = adapter => replay(oneTurn, { repeats: 1, modes: ["bm_final"], concurrency: 1 }, adapter, reviews, null, { captureSource: capture });
  const cleanReport = await replayWithCapture(async () => fixture());
  assert.equal(cleanReport.release_eligible, true);
  assert.equal(cleanReport.source_snapshot[renderer], digest("renderer-at-start"));
  assert.equal(cleanReport.source_snapshot["netlify/functions/nested/contract.json"], digest('{"native":true}'));
  assert.equal(cleanReport.source_snapshot["package.json"], digest('{"name":"snapshot-fixture"}'));
  const changedCommit = await replayWithCapture(async () => { gitHead = "b".repeat(40); return fixture(); });
  assert.equal(changedCommit.revision, "a".repeat(40), "end-of-run commit must not replace the tested starting revision");
  assert.equal(changedCommit.source_changed_during_replay, true);
  assert.equal(changedCommit.release_eligible, false);
  gitDirty = " M netlify/functions/bm-contextual-response.js";
  const dirtyReport = await replayWithCapture(async () => { gitDirty = ""; return fixture(); });
  assert.equal(dirtyReport.source_dirty, true, "a mid-run commit cannot make a dirty start clean evidence");
  assert.equal(dirtyReport.release_eligible, false);
  const changedBytes = await replayWithCapture(async () => { fs.writeFileSync(path.join(provenanceRoot, renderer), "renderer-changed"); return fixture(); });
  assert.equal(changedBytes.source_snapshot[renderer], digest("renderer-at-start"));
  assert.equal(changedBytes.source_changed_during_replay, true, "source bytes changing without a commit invalidate replay evidence");
  assert.equal(changedBytes.release_eligible, false);
  const output = { evaluator: "bm-semantic-oracle-mutation-v1", mutations: outcomes.length, rejected: outcomes.filter(item => item.status === "failed").length, review_invalidated: outcomes.filter(item => item.status === "unverified").length, escaped: 0, outcomes, batch_concurrency_peak: peak, batch_jobs: 200 };
  const outAt = process.argv.indexOf("--out");
  if (outAt >= 0) {
    const fs = require("fs"); const path = require("path"); const file = process.argv[outAt + 1];
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);
  }
  console.log(`Semantic oracle: ${outcomes.length} mutations prevented from passing; ${output.rejected} hard rejections, ${output.review_invalidated} require fresh independent text review. Batch: 200 jobs, peak concurrency ${peak}.`);
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { fixture, expected, review };
