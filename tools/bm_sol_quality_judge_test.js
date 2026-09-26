"use strict";

const assert = require("assert");
const { DEFAULT_MODEL, buildJudgeInput, checkpointSummary, digest, flattenReport, functionalFailures, judgeConcurrency, judgeTurn, oracleReviews, reviewDigest, reviewTurns, summarize } = require("./bm_sol_quality_judge");

async function run() {
  let requestBody = null;
  let requestCount = 0;
  const fetchImpl = async (_url, options) => {
    requestCount += 1;
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        model: DEFAULT_MODEL,
        output_text: JSON.stringify({
          verdict: "excellent",
          understanding: 5,
          context: 5,
          usefulness: 5,
          naturalness: 5,
          minimality: 5,
          hard_contradiction: false,
          unsafe_claim: false,
          rationale: "The response preserves the requested app and asks only for the missing duration.",
        }),
      }),
    };
  };
  const review = await judgeTurn({
    input: "Block Instagram now",
    actual: { visible: "For how long should I block Instagram?", actions: [] },
    expected: { pending_slots: ["end_or_duration"] },
    status: "passed",
    channel: "whatsapp",
  }, [], { apiKey: "test", fetchImpl });
  assert.strictEqual(requestBody.model, "gpt-5.6-sol");
  assert.strictEqual(requestBody.reasoning.effort, "low");
  assert.strictEqual(requestBody.max_output_tokens, 900);
  const systemPrompt = requestBody.input.find(item => item.role === "system").content;
  assert.match(systemPrompt, /does not prove queue persistence, notification delivery, or device execution/, "planner history cannot prove transport or device effects");
  assert.doesNotMatch(systemPrompt, /evidence that it was already queued/, "the evaluator must not promote prepared actions into persisted queue evidence");
  assert.match(systemPrompt, /permission-only action may advance/, "permission setup without an executable plan may continue once prerequisites are met");
  assert.strictEqual(requestCount, 1);
  assert.strictEqual(review.verdict, "excellent");
  assert.strictEqual(digest({ a: 1 }), digest({ a: 1 }));
  assert.notStrictEqual(reviewDigest({ input: "x" }), reviewDigest({ input: "x" }, [], "another-model"));
  assert.strictEqual(summarize([{ review }]).release_eligible, true);
  const completeTurn = { dimensions: Object.fromEntries(["intent", "slots", "transition", "provenance", "decision", "actions", "safety"].map(key => [key, "passed"])) };
  assert.strictEqual(checkpointSummary([completeTurn, completeTurn], [{ review }]).summary.release_eligible, false, "a perfect partial checkpoint cannot approve release");
  assert.strictEqual(checkpointSummary([completeTurn, completeTurn], [{ review }, { review: null }]).summary.release_eligible, false, "a placeholder is not a completed review");
  assert.strictEqual(checkpointSummary([completeTurn], [{ review }], "provider timeout").summary.release_eligible, false, "infrastructure failure keeps the gate closed");
  assert.strictEqual(checkpointSummary([completeTurn], [{ review }]).summary.release_eligible, true, "a complete passing review can approve its exact scope");
  assert.strictEqual(checkpointSummary([], []).complete, false, "empty review scope cannot be complete");
  const unsafe = { ...review, verdict: "acceptable", unsafe_claim: true };
  assert.strictEqual(summarize([{ review: unsafe }]).release_eligible, false);
  assert.strictEqual(summarize([{ review: { ...review, hard_contradiction: true } }]).release_eligible, false, "evidence wording must never relax the hard contradiction gate");
  const binding = { response_sha256: "a".repeat(64), expectation_sha256: "b".repeat(64) };
  assert.deepStrictEqual(oracleReviews([{ review, review_binding: binding, language: "en" }])[0], {
    ...binding,
    reviewer: "gpt-5.6-sol:low",
    rationale: review.rationale,
    verdict: "equivalent",
    language: "en",
  });
  assert.strictEqual(oracleReviews([{ review: unsafe, review_binding: binding, language: "en" }])[0].verdict, "not_equivalent");
  const appInput = buildJudgeInput({ trace: { context: { has_selected_apps: true, selected_app_names: ["Instagram"] } } });
  assert.deepStrictEqual(appInput.app_context.selected_app_names, ["Instagram"]);
  const remoteInput = buildJudgeInput({ actual: { visible: "Tap the notification.", actions: [] } });
  assert.strictEqual(remoteInput.app_context.has_selected_apps, null);
  assert.strictEqual(remoteInput.app_context.selected_app_names, null);
  const replayInput = buildJudgeInput({ evaluation_context: { has_selected_apps: true, selected_app_names: ["Instagram"] } });
  assert.strictEqual(replayInput.app_context.has_selected_apps, true);
  assert.deepStrictEqual(replayInput.app_context.selected_app_names, ["Instagram"]);
  const setupInput = buildJudgeInput({ actual: { actions: [{ type: "request_screen_time_permission" }] } });
  assert.deepStrictEqual(setupInput.emitted_actions, [{ type: "request_screen_time_permission" }]);
  assert.match(setupInput.action_contract.action_weekdays, /Sunday=1/);
  assert.match(setupInput.action_contract.set_daily_limit, /No future start, automatic expiry, or hard mode/);
  assert.match(setupInput.action_contract.cancellation, /does not prove/);
  assert.match(setupInput.action_contract.evidence, /Current emitted_actions is authoritative/);
  assert.match(setupInput.action_contract.setup_precedence, /permission.*false.*request_screen_time_permission/);
  const presenceReview=buildJudgeInput({actual:{decision:{type:"setup",slot:"app_presence"}},trace:{context:{app_presence_recent:false},final_plan:{review_only_actions:true}}});
  assert.equal(presenceReview.review_only_actions,true);
  assert.equal(presenceReview.app_context.app_presence_recent,false);
  assert.deepEqual(presenceReview.current_decision,{type:"setup",slot:"app_presence"});
  const flattened = flattenReport({ runs: [{ id: "replay", channel: "sms", turns: [
    { turn: 1, input: "Do it", actual: { visible: "Tap the notification.", actions: [{ type: "start_protection" }] } },
    { turn: 2, input: "Yes", actual: { visible: "It is already waiting.", actions: [] } },
  ] }] });
  assert.deepStrictEqual(flattened[1].history[1].emitted_actions, [{ type: "start_protection" }]);
  assert.strictEqual(functionalFailures([{ dimensions: { intent: "passed", slots: "passed", transition: "passed", provenance: "passed", decision: "passed", actions: "passed", safety: "passed", visible_equivalence: "unverified" } }]).length, 0);
  assert.strictEqual(functionalFailures([{ dimensions: { intent: "passed", slots: "failed" } }]).length, 1);

  let retryCount = 0;
  const retryReview = await judgeTurn({ input: "Move it later", actual: { visible: "Done." } }, [], {
    apiKey: "test",
    fetchImpl: async () => {
      retryCount += 1;
      return {
        ok: true,
        json: async () => retryCount === 1
          ? { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: '{"verdict":"excellent"' }
          : { model: DEFAULT_MODEL, status: "completed", output_text: JSON.stringify({ ...review, model_requested: undefined, model_returned: undefined, reasoning_effort: undefined }) },
      };
    },
  });
  assert.strictEqual(retryCount, 2);
  assert.strictEqual(retryReview.verdict, "excellent");

  assert.strictEqual(judgeConcurrency(), 1);
  assert.strictEqual(judgeConcurrency("8"), 8);
  for (const invalid of [0, 9, 1.5, "no", undefined]) {
    if (invalid !== undefined) assert.throws(() => judgeConcurrency(invalid), /invalid_judge_concurrency/);
  }
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const inputs = Array.from({ length: 12 }, (_, index) => ({
    conversation_id: `conversation-${index}`, turn: 1, input: `Request ${index}`,
    channel: "ios", status: "unverified", expected: { language: "en" },
    actual: { visible: { message_text: `Reply ${index}` }, actions: [] },
    history: [], review_binding: binding,
  }));
  const fixtureReview = turn => ({ ...review, rationale: turn.input });
  const sequential = await reviewTurns(inputs, { judgeImpl: async turn => fixtureReview(turn) });
  let active = 0, peak = 0;
  const checkpoints = [];
  const concurrent = await reviewTurns(inputs, {
    concurrency: 8,
    judgeImpl: async turn => {
      active += 1; peak = Math.max(peak, active);
      await delay(12 - Number(turn.input.split(" ")[1]));
      active -= 1;
      return fixtureReview(turn);
    },
    onCheckpoint: (reviews, error) => checkpoints.push({ reviews: structuredClone(reviews), error }),
  });
  assert.strictEqual(peak, 8, "bounded workers use but never exceed requested concurrency");
  assert.deepStrictEqual(concurrent, sequential, "out-of-order completion preserves sequential result order and content");
  assert.strictEqual(checkpoints.at(-1).reviews.length, inputs.length);
  for (const checkpoint of checkpoints) {
    const positions = checkpoint.reviews.map(item => Number(item.conversation_id.split("-")[1]));
    assert.deepStrictEqual(positions, [...positions].sort((a, b) => a - b), "partial checkpoints retain input order");
    assert.strictEqual(checkpoint.error, null);
  }

  const duplicates = [inputs[0], { ...inputs[0], conversation_id: "same-review-another-run" }, inputs[1], inputs[2], { ...inputs[2], conversation_id: "same-third-review" }];
  let duplicateCalls = 0;
  const deduplicated = await reviewTurns(duplicates, { concurrency: 8, judgeImpl: async turn => {
    duplicateCalls += 1; await delay(3); return fixtureReview(turn);
  } });
  assert.strictEqual(duplicateCalls, 3, "in-flight identical hashes share one request");
  assert.deepStrictEqual(deduplicated.map(item => item.reused), [false, true, false, false, true]);
  let resumeCalls = 0;
  const cachedReviews = await reviewTurns(duplicates, { concurrency: 8, previousReviews: deduplicated, judgeImpl: async () => { resumeCalls += 1; throw new Error("cache must avoid request"); } });
  assert.strictEqual(resumeCalls, 0);
  assert.ok(cachedReviews.every(item => item.reused));
  assert.notStrictEqual(reviewDigest(inputs[0]), reviewDigest(inputs[0], [{ role: "user", content: "Earlier context differs" }]), "history participates in cache identity");
  const historyChanged = { ...inputs[0], history: [{ role: "user", content: "Earlier context differs" }] };
  await reviewTurns([historyChanged], { previousReviews: deduplicated, judgeImpl: async turn => { resumeCalls += 1; return fixtureReview(turn); } });
  assert.strictEqual(resumeCalls, 1, "a changed history invalidates the cached review");

  const started = [];
  const interruptedCheckpoints = [];
  await assert.rejects(reviewTurns(inputs, {
    concurrency: 3,
    judgeImpl: async turn => {
      started.push(turn.conversation_id);
      if (turn.conversation_id === "conversation-1") { await delay(1); throw new Error("mock judge unavailable"); }
      await delay(8); return fixtureReview(turn);
    },
    onCheckpoint: (reviews, error) => interruptedCheckpoints.push({ reviews: structuredClone(reviews), error }),
  }), /mock judge unavailable/);
  assert.strictEqual(started.length, 3, "an error stops dispatch but drains requests already started");
  const saved = interruptedCheckpoints.at(-1);
  assert.deepStrictEqual(saved.reviews.map(item => item.conversation_id), ["conversation-0", "conversation-2"]);
  assert.strictEqual(saved.error, "mock judge unavailable", "later completions cannot erase the failure from checkpoint");
  let recoveredCalls = 0;
  const recovered = await reviewTurns(inputs, { concurrency: 8, previousReviews: saved.reviews, judgeImpl: async turn => { recoveredCalls += 1; return fixtureReview(turn); } });
  assert.strictEqual(recoveredCalls, inputs.length - saved.reviews.length);
  assert.deepStrictEqual(recovered.map(item => item.review), sequential.map(item => item.review), "resume recovers only missing reviews without changing the result");

  let checkpointCalls = 0, checkpointStarted = 0;
  await assert.rejects(reviewTurns(inputs, { concurrency: 2,
    judgeImpl: async turn => { checkpointStarted += 1; await delay(2); return fixtureReview(turn); },
    onCheckpoint: () => { checkpointCalls += 1; throw new Error("mock checkpoint write failure"); },
  }), /mock checkpoint write failure/);
  assert.strictEqual(checkpointStarted, 2, "failed persistence stops scheduling new paid requests");
  assert.strictEqual(checkpointCalls, 1, "do not hide or loop on a checkpoint failure");
  console.log("BM Sol quality judge tests passed: bounded concurrency, ordered identical results, shared in-flight cache, resumable failure checkpoints and persistence errors");
}

run().catch(error => { console.error(error); process.exitCode = 1; });
