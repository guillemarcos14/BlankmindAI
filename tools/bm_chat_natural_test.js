"use strict";
const assert = require("node:assert/strict");
const { naturalizeGroundedPlan } = require("../netlify/functions/bm-contextual-response");
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
    assert.equal((await render("Blankmind tiene preparada tu protección de 50 minutos.")).plan.response_text, plan.response_text);
    assert.equal((await render("He bloqueado tus apps 25 minutos en Blankmind.")).plan.response_text, plan.response_text);
    assert.equal(calls, 3);
    console.log("App natural response: Spanish generation, immutable duration/actions, false execution rejection PASS (mock)");
  } finally { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
