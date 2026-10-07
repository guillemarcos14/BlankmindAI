"use strict";
// Request-local metrics. No cross-account cache, request body or error message.
const { AsyncLocalStorage } = require("node:async_hooks");
const { performance } = require("node:perf_hooks");
const storage = new AsyncLocalStorage();
const STAGES = new Set(["authentication", "claim", "snapshot", "context", "brain_context", "source_reads", "model", "prepare", "queue", "commit", "presentation", "database", "transcription"]);
const elapsed = start => Math.round((performance.now() - start) * 100) / 100;
async function span(stage, work) {
  const trace = storage.getStore();
  if (!trace || !STAGES.has(stage)) return work();
  const start = performance.now();
  try { return await work(); }
  finally {
    const metric = trace.stages[stage] ||= { calls: 0, total_ms: 0 };
    metric.calls++; metric.total_ms = Math.round((metric.total_ms + elapsed(start)) * 100) / 100;
  }
}
function firstText(text) {
  const trace = storage.getStore();
  if (trace && trace.first_text_ms == null && typeof text === "string" && text.trim()) trace.first_text_ms = elapsed(trace.start);
}
function usage(value) {
  const trace = storage.getStore();
  if (!trace) return;
  for (const key of ["input_tokens", "output_tokens", "total_tokens"]) {
    if (Number.isSafeInteger(value?.[key]) && value[key] >= 0) trace.usage[key] = (trace.usage[key] || 0) + value[key];
  }
  const cached = value?.input_tokens_details?.cached_tokens;
  if (Number.isSafeInteger(cached) && cached >= 0) trace.usage.cached_input_tokens = (trace.usage.cached_input_tokens || 0) + cached;
}
async function run({ turnId, action }, work, publish = sample => console.info(JSON.stringify(sample))) {
  const trace = { start: performance.now(), first_text_ms: null, stages: {}, usage: {} };
  return storage.run(trace, async () => {
    let status = 503;
    try { const result = await work(); status = result.statusCode; return result; }
    finally {
      const sample = { event: "bm_turn_timing", schema_version: 1,
        action: action === "transcribe" ? "transcribe" : "send",
        ...(typeof turnId === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(turnId) ? { turn_id: turnId } : {}),
        status: Number.isInteger(status) ? status : 503,
        first_text_ms: trace.first_text_ms, elapsed_ms: elapsed(trace.start), stages: trace.stages, usage: trace.usage };
      try { publish(sample); } catch (_) { /* Metrics cannot break a turn. */ }
    }
  });
}
module.exports = { span, firstText, usage, run };
