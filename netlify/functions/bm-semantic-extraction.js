"use strict";

// The model extracts evidence. It cannot emit actions or authorize a proposal.
const { validateSemanticPatch } = require("./bm-semantic-state");
const { readModelJson, runBoundedAttempts } = require("./bm-model-request");
const object = properties => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const values = {
  apps: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", minLength: 1, maxLength: 80 } },
  app_category: { type: "string", minLength: 1, maxLength: 179 },
  moment: { type: "string", minLength: 1, maxLength: 179 },
  action_type: { type: "string", enum: ["strict_block", "daily_limit"] },
  hard_mode: { type: "boolean" },
  start: { anyOf: [object({ type: { type: "string", enum: ["now"] } }), object({ type: { type: "string", enum: ["time"] }, minute: { type: "integer", minimum: 0, maximum: 1439 } })] },
  end: { type: "integer", minimum: 0, maximum: 1439 },
  // Evidence must be able to represent an unsupported request verbatim. Native
  // limits belong to validateSemanticPatch/reducer/action gates; constraining
  // extraction to 1–14 made a request for 40 days impossible to express.
  duration_minutes: { type: "integer" },
  schedule_horizon_days: { type: "integer" },
  recurrence: object({ type: { type: "string", enum: ["once", "daily", "weekly"] }, weekdays: { type: "array", maxItems: 7, items: { type: "integer", minimum: 1, maximum: 7 } } }),
};
const schema = {
  type: "object", additionalProperties: false,
  required: ["fields", "ambiguities"],
  properties: {
    // Each slot has its real JSON type. There is no second JSON document hidden
    // inside a string, so an ordinary value such as "mornings" needs no re-parse.
    fields: { type: "array", maxItems: 10, items: { anyOf: Object.entries(values).map(([slot, value]) => object({
      slot: { type: "string", enum: [slot] }, value, evidence: { type: "string", maxLength: 600 },
    })) } },
    ambiguities: { type: "array", maxItems: 8, items: { type: "string", maxLength: 100 } },
  },
};

function requestFor(prompt, state, context = {}) {
  const facts = state ? Object.fromEntries(Object.entries(state.slots || {}).map(([key, slot]) => [key, slot?.value ?? null])) : {};
  return {
    model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
    input: [
      { role: "system", content: "Extract only facts asserted or corrected in the current user message. Prior state and conversation explain ellipsis but are not new evidence. Each evidence must be an exact substring of the current message. Do not invent missing values. Do not choose between ambiguous alternatives. Do not output actions or confirmation. Values are JSON: apps=[names], moment=string, app_category=string, action_type=strict_block|daily_limit, start={type:now} or {type:time,minute:0..1439}, end=minute integer, duration_minutes=integer, recurrence={type:once|daily|weekly,weekdays:[1=Monday..7=Sunday]}. Duration and clock time are different fields. Unknown values are omitted. A correction replaces the old value." },
      { role: "user", content: JSON.stringify({ current_message: prompt, previous: { intent: state?.intent || "general", facts, next_question: state?.next_question || null }, recent_messages: (context.recent_messages || []).filter(message => ["user", "assistant"].includes(message.role)).slice(-8) }) },
    ],
    text: { format: { type: "json_schema", name: "bm_semantic_evidence", strict: true, schema } },
    max_output_tokens: 700,
  };
}

function parseCandidate(body, prompt) {
  const text = body.output_text || (body.output || []).flatMap(item => item.content || []).map(item => item.type === "output_text" ? item.text : "").join("");
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed.fields) || parsed.fields.length > 10 || !Array.isArray(parsed.ambiguities)) throw new Error("invalid_semantic_extraction_shape");
  const candidate = { set: {}, evidence: {} };
  for (const field of parsed.fields) {
    if (!field || !Object.hasOwn(values, field.slot)) throw new Error("invalid_semantic_extraction_slot");
    if (!Object.hasOwn(field, "value") || Object.keys(field).some(key => !["slot", "value", "evidence"].includes(key))) throw new Error("invalid_semantic_extraction_field");
    if (Object.hasOwn(candidate.set, field.slot)) throw new Error("duplicate_semantic_extraction_slot");
    if (typeof field.evidence !== "string" || !field.evidence.trim() || !prompt.includes(field.evidence)) throw new Error("ungrounded_semantic_extraction_evidence");
    candidate.set[field.slot] = field.value;
    candidate.evidence[field.slot] = field.evidence;
  }
  return { candidate, ambiguities: parsed.ambiguities };
}

const TRANSIENT_NETWORK_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "EPIPE",
]);

function extractionErrorCode(error) {
  return error?.name === "TimeoutError" ? "semantic_model_timeout" : error?.message || "semantic_model_failed";
}

async function extractWithModel({ prompt, previousState, context = {}, fetchImpl = fetch }) {
  if (!process.env.OPENAI_API_KEY) return { enabled: false, extraction: null, source: "deterministic_semantic_extraction" };
  const request = requestFor(prompt, previousState, context);
  request.input[0].content += " Return each slot at most once. If alternatives conflict, omit that slot and report the ambiguity. Quantities describing a past event are observations, not requested future action parameters. Copy requested quantities exactly, including unsupported values: never clamp, truncate or replace them to fit device capabilities. The separate action validator decides what the device supports.";
  const retryable = error => error?.name === "TimeoutError"
    || TRANSIENT_NETWORK_CODES.has(error?.model_request_metrics?.cause_code)
    || ["duplicate_semantic_extraction_slot", "ungrounded_semantic_extraction_evidence", "semantic_model_incomplete", "semantic_model_http_502", "semantic_model_http_503", "semantic_model_http_504"].includes(error?.message);
  const repair = error => {
    if (error.message === "duplicate_semantic_extraction_slot") request.input.push({ role: "system", content: "The previous extraction repeated a slot and was rejected. Return at most one entry per slot. Omit conflicting alternatives; report their ambiguity instead." });
    if (error.message === "ungrounded_semantic_extraction_evidence") request.input.push({ role: "system", content: "The previous extraction was rejected because an evidence quote was not an exact substring of current_message. Copy evidence literally from current_message, preserving capitalization, accents, whitespace and punctuation. Do not paraphrase or normalize it. Omit any field whose evidence cannot be copied exactly." });
    if (error.message === "semantic_model_incomplete") request.max_output_tokens = 1400;
  };
  try {
    const completed = await runBoundedAttempts({ budgetMs: 20000, hedgeAfterMs: 12000, minRemainingMs: 1000,
      shouldRetry: retryable, repair,
      isFatal: error => /^semantic_model_http_(?:401|403|429)$/.test(error?.message || ""),
      attemptFn: async ({ timeoutMs, signal, observeMetrics }) => {
        const { body, metrics } = await readModelJson({ request, fetchImpl, timeoutMs, signal, observeMetrics, errorPrefix: "semantic_model" });
        try {
          if (body.status === "incomplete") throw new Error("semantic_model_incomplete");
          const { candidate, ambiguities } = parseCandidate(body, prompt);
          // Rejected fields retain their current meaning: the reducer filters
          // them. They do not disqualify faithful extraction of unsupported input.
          const validation = validateSemanticPatch(candidate, { prompt, state: previousState, context });
          return { value: { candidate, ambiguities, validation, model: body.model }, metrics };
        } catch (error) { error.model_request_metrics = metrics; throw error; }
      },
    });
    const { candidate, ambiguities, validation, model } = completed.value;
    const attemptErrors = completed.errors.sort((a,b) => a.attempt-b.attempt).map(item => extractionErrorCode(item.error));
    const attemptMetrics = completed.execution.attempts.flatMap(item => item.request_metrics ? [item.request_metrics] : []);
    return { enabled: true, extraction: candidate, source: `openai:${model || request.model}:semantic`,
      model_requested: request.model, model_returned: model || null, rejected: validation.rejected, ambiguities,
      attempt_count: completed.execution.attempts.length, attempt_errors: attemptErrors, attempt_metrics: attemptMetrics,
      trace: { request, candidate, validation, attempt_count: completed.execution.attempts.length, attempt_errors: attemptErrors,
        attempt_metrics: attemptMetrics, attempt_execution: completed.execution } };
  } catch (error) {
    const execution = error.bounded_attempt_execution || { winner_attempt: null, attempts: [] };
    const errors = (error.bounded_attempt_errors || []).sort((a,b) => a.attempt-b.attempt);
    error.semantic_attempt_count = execution.attempts.length || 1;
    error.semantic_attempt_errors = errors.length ? errors.map(item => extractionErrorCode(item.error)) : [extractionErrorCode(error)];
    error.semantic_attempt_metrics = execution.attempts.flatMap(item => item.request_metrics ? [item.request_metrics] : []);
    error.semantic_attempt_execution = execution;
    throw error;
  }
}

module.exports = { extractWithModel, requestFor, parseCandidate, schema };
