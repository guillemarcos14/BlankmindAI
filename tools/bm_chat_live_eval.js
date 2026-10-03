"use strict";
// Bounded synthetic provider checks. Calls planners only, never queues native actions.
const fs = require("node:fs");
const { extractRequest } = require("../netlify/functions/bm-brain");
const { advanceSemanticState } = require("../netlify/functions/bm-semantic-state");
const { handler } = require("../netlify/functions/blanked-agent");
const { copyIssues, hasValidatedCopy } = require("../netlify/functions/bm-conversation-copy");
async function main() {
  if (!process.argv.includes("--run") || !process.env.OPENAI_API_KEY) throw Error("explicit_live_run_and_model_key_required");
  const device = { channel: "app", language: "en", has_selected_apps: true, screen_time_authorized: true,
    brain_snapshot: { local_date: "2026-10-02", timezone: "Europe/Madrid" }, recent_messages: [] };
  const pending = advanceSemanticState({ prompt: "Block my distractions now once", context: device }).state;
  const records = [];
  const cases = [
    { prompt: "¿Qué recuerdas de mí?", route: "memory", execute: false, language: "es", render: false },
    { prompt: "30 minutes", route: "control", execute: true, language: "en", state: pending, render: true, action: "start_protection" },
    { prompt: "Actually, I had a rough morning and kept scrolling", route: "conversation", execute: false, language: "en", state: pending, render: true },
    { prompt: "Forget the block", route: "control", execute: false, language: "en", state: pending, render: true, cancelled: true },
    { prompt: "Bloquea mis distracciones ahora durante 25 minutos solo esta vez", route: "control", execute: true, language: "es", render: true, action: "start_protection" },
    { prompt: "What usually pulls me back into scrolling when I'm tired?", route: "conversation", execute: false, language: "en", render: true },
    { prompt: "Mi amigo dijo 'bloquea mis apps 30 minutos'. ¿Qué opinas?", route: "conversation", execute: false, language: "es", render: true },
    { prompt: "Block my distractions now", route: "control", execute: true, language: "en", render: true, ask: true },
  ];
  const caseIndex = process.argv.indexOf("--case");
  const selected = caseIndex < 0 ? cases : [cases[Number(process.argv[caseIndex + 1]) - 1]];
  for (const test of selected) {
    const context = { ...device, semantic_state: test.state, recent_messages: [] };
    const record = { prompt: test.prompt };
    try {
      const query = await extractRequest(test.prompt, context, { observeRequest: value => { record.provider_request = value; } });
      record.query = query;
      record.passed = query.route === test.route && query.execute === test.execute && query.response_language === test.language
        && (test.route !== "memory" || query.memory === null);
      if (test.render) {
        const providerFetch = global.fetch;
        global.fetch = async (url, options) => {
          const response = await providerFetch(url, options);
          const request = JSON.parse(options.body);
          if (request.max_output_tokens === 320 && response.ok) {
            const body = await response.clone().json();
            record.generated_copy = body.output_text || (body.output || []).flatMap(item => item.content || []).map(item => item.text || "").join(" ");
          }
          return response;
        };
        context.language = query.response_language;
        context.brain_request = { route: query.route, execute: query.execute, language: query.response_language };
        let response;
        try { response = await handler({ httpMethod: "POST", body: JSON.stringify({ prompt: test.prompt, context }) }); }
        finally { global.fetch = providerFetch; }
        const body = JSON.parse(response.body), plan = body.plan || {};
        record.source = body.source;
        record.reply = plan.message_text || plan.response_text;
        record.actions = plan.actions;
        record.issues = copyIssues(record.reply || "");
        record.passed &&= response.statusCode === 200 && !body.model_error && record.issues.length === 0;
        if (test.action) record.passed &&= plan.actions?.[0]?.type === test.action && hasValidatedCopy(plan);
        else record.passed &&= plan.actions?.length === 0;
        if (test.ask) record.passed &&= plan.semantic_state?.pending_slots?.length > 0;
        if (test.cancelled) record.passed &&= plan.semantic_state?.intent === "cancelled" && plan.semantic_state?.status === "cancelled";
        if (test.state && test.route === "conversation") record.passed &&= JSON.stringify(plan.semantic_state) === JSON.stringify(test.state);
      }
    } catch (error) { record.error = error.message; record.passed = false; }
    records.push(record);
    console.log((record.passed ? "PASS " : "FAIL ") + "natural_case_" + records.length);
    if (record.error && records.length === 1) break;
  }
  const report = { generated_at: new Date().toISOString(), scope: "synthetic_real_provider_no_native_execution",
    records, passed: records.length === selected.length && records.every(row => row.passed) };
  fs.mkdirSync("tmp/brain", { recursive: true });
  fs.writeFileSync("tmp/brain/live-natural.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: "tmp/brain/live-natural.json", passed: report.passed, cases: records.length }));
  process.exitCode = report.passed ? 0 : 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
