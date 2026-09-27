"use strict";

const assert = require("node:assert/strict");
const { naturalizeGroundedPlan } = require("../netlify/functions/bm-contextual-response");

function freeze(value) {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) freeze(nested);
    Object.freeze(value);
  }
  return value;
}

async function main() {
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "offline-contextual-response-fixture";
  let calls = 0;
  try {
    const forbiddenFetch = async () => { calls++; throw new Error("semantic_block_must_not_request_rewrite"); };
    for (const language of ["en", "es"]) {
      for (const decision of ["ask", "confirm", "setup", "ready"]) {
        for (const actionType of ["strict_block", "daily_limit"]) {
          const text = language === "es" ? "Revisa esta propuesta de 30 minutos." : "Review this 30-minute proposal.";
          const actions = decision === "ready" ? [{ type: actionType === "daily_limit" ? "set_daily_limit" : "start_protection", minutes: 30 }]
            : decision === "setup" ? [{ type: "request_screen_time_permission" }] : [];
          const plan = freeze({
            title: "Proposal", response_text: text, message_text: text, speech_text: text,
            followup_text: "", bullets: [], actions,
            semantic_state: { intent: "block", language, slots: { duration_minutes: { value: 30 }, action_type: { value: actionType } } },
            semantic_decision: { type: decision },
            response_contract: { operation: `semantic_${decision}`, facts: { duration_minutes: 30 } },
          });
          const before = JSON.stringify(plan);
          const { response_contract: _contract, ...expected } = plan;
          const result = await naturalizeGroundedPlan({ prompt: "fixture", plan, context: { language }, fetchImpl: forbiddenFetch });
          assert.equal(result.source, "grounded_canonical_response");
          assert.deepEqual(result.plan, expected, `${language}/${decision}/${actionType}: preserve every public field`);
          assert.equal(result.plan.semantic_state, plan.semantic_state, "do not rebuild or mutate validated state");
          assert.equal(result.plan.actions, plan.actions, "do not rebuild or mutate executable proposals");
          assert.equal(JSON.stringify(plan), before);
        }
      }
    }
    assert.equal(calls, 0, "both languages bypass the provider even with an API key configured");

    const immutable = await naturalizeGroundedPlan({
      prompt: "Cancel", context: { language: "en" }, fetchImpl: forbiddenFetch,
      plan: { actions: [], semantic_state: { intent: "block" }, response_text: "The instruction was withdrawn.",
        response_contract: { operation: "semantic_cancelled", immutable_reply: true } },
    });
    assert.equal(immutable.source, "grounded_execution_boundary", "immutable boundary retains priority");
    assert.equal(calls, 0);

    // All provider calls below are local mocks. Non-block and non-semantic
    // operations retain personalization and cannot inherit the block shortcut.
    for (const [operation, intent] of [
      ["semantic_ask_action_type", "advice"],
      ["semantic_ask_start", undefined],
      ["semantic_ask_start", "general"],
      ["weekly_recommendation", "block"],
      ["schedule_update", "block"],
    ]) {
      let requested = null;
      const result = await naturalizeGroundedPlan({
        prompt: "Help with my routine", context: { language: "en", personal_profile: { weak_moment: "after lunch" } },
        plan: { response_text: "Review the existing routine.", message_text: "Review the existing routine.", speech_text: "Review the existing routine.", actions: [],
          semantic_state: intent ? { intent, language: "en" } : { language: "en" },
          response_contract: { operation, facts: { weak_moment: "after lunch" } } },
        fetchImpl: async (_url, options) => {
          calls++;
          requested = JSON.parse(options.body);
          assert.ok(options.signal instanceof AbortSignal, "remaining model calls keep their timeout signal");
          return { ok: true, json: async () => ({ status: "completed", output_text: "Let's review the after-lunch routine together." }) };
        },
      });
      assert.ok(requested, `${operation}/${intent}: retains the contextual model`);
      const input = JSON.parse(requested.input.find(item => item.role === "user").content);
      assert.equal(input.personal_context.person.goals_and_preferences.weak_moment, "after lunch");
      assert.equal(result.source, "openai:" + (process.env.OPENAI_MODEL || "gpt-5.6-luna") + ":grounded_contextual_response");
      assert.equal(result.plan.response_text, "Let's review the after-lunch routine together.");
      assert.equal(result.plan.message_text, result.plan.response_text);
      assert.equal(result.plan.speech_text, result.plan.response_text);
      assert.deepEqual(result.plan.actions, []);
      assert.equal(Object.hasOwn(result.plan, "response_contract"), false);
    }
    assert.equal(calls, 5);
    console.log("BM contextual response: 16 canonical block cases, immutable priority, and 5 retained contextual model routes PASS (mock only)");
  } finally {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
