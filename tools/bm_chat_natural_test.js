"use strict";
const assert = require("node:assert/strict");
const { naturalizeGroundedPlan } = require("../netlify/functions/bm-contextual-response");
const { chatText, hasValidatedCopy, copyIssues } = require("../netlify/functions/bm-conversation-copy");
const { semanticResponseContract, handler } = require("../netlify/functions/blanked-agent");
const { visibleReply } = require("../netlify/functions/assistant-app");
const { buildAgentContext } = require("../netlify/functions/bm-context");
const { advanceSemanticState } = require("../netlify/functions/bm-semantic-state");
async function main() {
  const old = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "synthetic";
  const action = { type: "start_protection", minutes: 25 };
  const plan = { response_text: "Blankmind: protección preparada para 25 minutos.", actions: [action],
    semantic_state: { intent: "block", language: "es" },
    response_contract: { operation: "semantic_block", facts: { duration_minutes: 25 }, required_duration_minutes: 25 } };
  let calls = 0;
  const render = text => naturalizeGroundedPlan({ prompt: "Bloquea 25 minutos", context: { channel: "app", language: "es" }, plan,
    fetchImpl: async (_url, options) => {
      calls++; const request = JSON.parse(options.body);
      assert(request.input[0].content.includes("Reply in Spanish"));
      assert(request.input[0].content.includes("never invent a notification tap"));
      assert(!JSON.parse(request.input[1].content).variation_hint);
      return { ok: true, json: async () => ({ output_text: text }) };
    } });
  try {
    const natural = await render("Blankmind tiene preparada tu protección de 25 minutos.");
    assert(natural.source.endsWith(":grounded_contextual_response"));
    assert.deepEqual(natural.plan.actions, [action]);
    assert(hasValidatedCopy(natural.plan));
    assert.equal(visibleReply(natural.plan, { language: "es" }, action), natural.plan.response_text);
    assert(!hasValidatedCopy({ ...natural.plan, message_text: "He bloqueado tus apps." }));
    assert(!hasValidatedCopy({ ...natural.plan, actions: [{ ...action, minutes: 50 }] }));
    assert.equal((await render("Blankmind tiene preparada tu protección de 50 minutos.")).plan.response_text, chatText(plan.response_text));
    assert.equal((await render("He bloqueado tus apps 25 minutos en Blankmind.")).plan.response_text, chatText(plan.response_text));
    assert.equal(calls, 3);
    const device = { channel: "app", screen_time_authorized: true, has_selected_apps: true,
      brain_request: { route: "control", execute: true, language: "es" } };
    const state = advanceSemanticState({ prompt: "Block my distractions now for 25 minutes once", context: device, language: "es" });
    assert.equal(state.decision.type, "ready");
    const contract = semanticResponseContract(state, device);
    assert.equal(contract.execution_flow, "in_app_auto_apply");
    assert.deepEqual(contract.required_phrases, []);
    const actual = { ...plan, response_contract: contract, actions: state.actions };
    const renderActual = text => naturalizeGroundedPlan({ prompt: "Bloquea mis distracciones", context: device, plan: actual,
      fetchImpl: async () => ({ ok: true, json: async () => ({ output_text: text }) }) });
    const valid = await renderActual("Voy a intentar bloquear tus distracciones durante 25 minutos, solo esta vez. Te diré si ha funcionado.");
    assert(hasValidatedCopy(valid.plan), valid.source);
    assert.equal(visibleReply(valid.plan, device, state.actions[0]), valid.plan.response_text);
    for (const text of [
      "Voy a intentar bloquear tus distracciones durante 25 minutos, solo esta vez. Pulsa la notificación.",
      "Voy a intentar bloquear tus distracciones durante 25 minutos, solo esta vez. Pulsa el botón.",
      "Confirmación: 25 minutos, solo esta vez.",
      "He bloqueado tus distracciones durante 25 minutos, solo esta vez.",
      "Voy a intentar bloquear tus distracciones durante 25 minutos, solo esta vez, y después otros 50 minutos.",
    ]) assert(!hasValidatedCopy((await renderActual(text)).plan), text);
    const contextual = buildAgentContext({ ...device, language: "es", brain_request: { route: "conversation", execute: true, language: "en" } });
    assert.deepEqual(contextual.brain_request, { route: "conversation", execute: false, language: "en" });
    assert.equal(chatText("Got it: from 18:30 to 19:00."), "Got it, from 18:30 to 19:00.");
    assert.deepEqual(copyIssues("From 18:30 to 19:00."), []);
    assert(copyIssues("Action: apply the canonical schema;").length);
    const cancelled = advanceSemanticState({ prompt: "Forget the block", previousState: state.state, context: device });
    assert.equal(cancelled.state.intent, "cancelled");
    assert.deepEqual(cancelled.actions, []);
    assert.deepEqual(advanceSemanticState({ prompt: "30 minutes", previousState: cancelled.state, context: device }).actions, []);
    const pending = advanceSemanticState({ prompt: "Block my distractions now once", context: device, language: "es" }).state;
    const oldFetch = global.fetch;
    let conversationCalls = 0;
    try {
      global.fetch = async (_url, options) => {
        conversationCalls++;
        const request = JSON.parse(options.body);
        assert(request.input.some(item => item.content.includes("Write every visible response in English")));
        return { ok: true, json: async () => ({ output_text: "That sounds tiring. What pulled you into scrolling?" }) };
      };
      const result = await handler({ httpMethod: "POST", body: JSON.stringify({ prompt: "I had a rough morning scrolling",
        context: { ...device, semantic_state: pending, brain_request: { route: "conversation", execute: false, language: "en" } } }) });
      const body = JSON.parse(result.body);
      assert.equal(result.statusCode, 200);
      assert.equal(conversationCalls, 1, "A conversational detour should not run action extraction");
      assert.equal(body.plan.message_text, "That sounds tiring. What pulled you into scrolling?");
      assert.deepEqual(body.plan.actions, []);
      assert.deepEqual(body.plan.semantic_state, pending, "A detour consumed or changed the pending action");
    } finally { global.fetch = oldFetch; }
    console.log("App natural response: Spanish generation, immutable duration/actions, false execution rejection PASS (mock)");
  } finally { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
