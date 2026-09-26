"use strict";

// Deliberately imports no BM runtime, parser, reducer, renderer, or action gate.
// Gold values are independently authored facts, never inferred from tested output.
const crypto = require("crypto");
const { isDeepStrictEqual } = require("util");

const SLOT_KEYS = ["apps", "app_category", "moment", "action_type", "hard_mode", "requested_capability", "start", "end", "duration_minutes", "recurrence", "schedule_horizon_days", "confirmation"];
const MIGRATED_NULLABLE_SLOTS = new Set(["schedule_horizon_days", "hard_mode", "requested_capability"]);
const STATE_KEYS = ["intent", ...SLOT_KEYS, "pending_slots", "status", "next_question"];
const DIMENSIONS = ["intent", "slots", "transition", "provenance", "decision", "actions", "safety", "visible_equivalence"];
const DISPLAY_ACTION_KEYS = new Set(["title", "label", "description", "id"]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function digest(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(stable(value))).digest("hex");
}
function slotValue(state, key) {
  const slot = state?.slots?.[key];
  const value = slot?.value ?? null;
  if (key === "confirmation") return value?.status ?? value;
  if (key === "apps" && Array.isArray(value)) return [...value].sort();
  if (key === "recurrence" && value) return { ...value, weekdays: [...(value.weekdays || [])].sort((a, b) => a - b) };
  return value;
}
// Public schema migration aliases preserve meaning; they are not case-specific.
function questionSlot(value) {
  return ({ end: "end_or_duration", screen_time_permission: "permissions" })[value] || value;
}
function projectState(state) {
  if (!state || typeof state !== "object") return null;
  return normalizeInterval({
    intent: state.intent ?? null,
    ...Object.fromEntries(SLOT_KEYS.map(key => [key, slotValue(state, key)])),
    pending_slots: state.pending_slots?.map(questionSlot) ?? null,
    status: state.status ?? null,
    next_question: questionSlot(state.next_question) ?? null,
  });
}
function normalizeInterval(state) {
  const result = { ...state };
  // A closed clock interval and its mathematically derived duration are the same
  // meaning. Never replace an explicit, conflicting non-null value.
  if (result.start?.type === "time") {
    if (Number.isInteger(result.end) && result.duration_minutes === null) result.duration_minutes = (result.end - result.start.minute + 1440) % 1440;
    else if (result.end === null && Number.isFinite(result.duration_minutes)) result.end = (result.start.minute + result.duration_minutes) % 1440;
  }
  return result;
}
function projectActions(actions) {
  return (Array.isArray(actions) ? actions : []).filter(action => action?.type !== "none").map(action => {
    const projected = {};
    for (const [key, value] of Object.entries(action || {})) {
      if (DISPLAY_ACTION_KEYS.has(key) || value === null || value === undefined) continue;
      if (key === "name") continue;
      projected[key] = ["weekdays", "app_names", "apps"].includes(key) && Array.isArray(value) ? [...value].sort() : value;
    }
    return projected;
  });
}
function visibleSurfaces(plan = {}) {
  const surfaces = {};
  for (const key of ["message_text", "response_text", "speech_text", "followup_text", "title", "primary_label", "secondary_label"]) {
    if (typeof plan[key] === "string" && plan[key].trim()) surfaces[key] = plan[key];
  }
  if (Array.isArray(plan.bullets)) surfaces.bullets = plan.bullets;
  return surfaces;
}
function allText(plan) {
  return Object.values(visibleSurfaces(plan)).flat().join("\n");
}
function normalizeExpectedState(state) {
  // v1 fixtures predate the explicit native schedule horizon. Absence means no
  // supplied horizon (null), never an implicit seven-day schedule.
  const result = { schedule_horizon_days: null, hard_mode: null, requested_capability: null, ...state };
  result.pending_slots = result.pending_slots?.map(questionSlot);
  result.next_question = questionSlot(result.next_question);
  if (Array.isArray(result.apps)) result.apps = [...result.apps].sort();
  if (result.recurrence) result.recurrence = { ...result.recurrence, weekdays: [...(result.recurrence.weekdays || [])].sort((a, b) => a - b) };
  return normalizeInterval(result);
}
function validateExpectation(expectation) {
  if (!expectation || typeof expectation !== "object") throw new Error("oracle_expectation_missing");
  const missing = STATE_KEYS.filter(key => !MIGRATED_NULLABLE_SLOTS.has(key) && !Object.hasOwn(expectation.state || {}, key));
  if (missing.length) throw new Error(`oracle_incomplete_state:${missing.join(",")}`);
  if (!expectation.decision || !Object.hasOwn(expectation.decision, "slot") || !expectation.decision.type) throw new Error("oracle_decision_missing");
  if (!Array.isArray(expectation.actions)) throw new Error("oracle_actions_missing");
  if (!["en", "es"].includes(expectation.language)) throw new Error("oracle_language_missing");
}

// These checks only REJECT obvious contradictions. Their absence never proves
// natural-language equivalence: an independently reviewed hash is required below.
function referenceFacts(text) {
  const facts = new Set();
  const expanded = text.replace(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})\s*([ap])\.?m\.?\b/gi, "$1 $3m to $2 $3m");
  for (const match of expanded.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\b|\b(\d{1,2}):(\d{2})\b/gi)) {
    const hour = Number(match[1] ?? match[4]);
    const minute = Number(match[2] ?? match[5] ?? 0);
    facts.add(`clock:${match[3] ? (hour % 12 + (match[3].toLowerCase() === "p" ? 12 : 0)) * 60 + minute : hour * 60 + minute}`);
  }
  for (const match of text.matchAll(/\b(\d+(?:[.,]\d+)?)[\s-]*(minutes?|mins?|minutos?|hours?|horas?)\b/gi)) {
    facts.add(`duration:${Number(match[1].replace(",", ".")) * (/^(hour|hora)/i.test(match[2]) ? 60 : 1)}`);
  }
  for (const match of text.matchAll(/\b(?:for|durante|por)\s+(\d+)\s+(?:days|d[ií]as)\b/gi)) facts.add(`horizon:${match[1]}`);
  if (/\b(?:daily|every day|cada d[ií]a|todos los d[ií]as)\b/i.test(text)) facts.add("recurrence:daily");
  for (const app of ["Instagram", "TikTok", "YouTube", "Reddit", "Facebook", "Snapchat", "WhatsApp", "Slack", "Duolingo", "Twitter"]) {
    if (new RegExp(`\\b${app}\\b`, "i").test(text)) facts.add(`app:${app.toLowerCase()}`);
  }
  return facts;
}

function groundedReference(clause, inputs) {
  const facts = referenceFacts(clause);
  const evidence = referenceFacts(inputs.join("\n"));
  return facts.size > 0 && [...facts].every(fact => evidence.has(fact));
}

function surfaceContradictions(plan, expected, context = {}, inputs = []) {
  const text = allText(plan);
  // Capability range explanations are not proposed durations. They still need
  // independent language review; exclude only their numeric constraint clause.
  const failures = [];
  const durationRange = (clause, lower, upper) => {
    const rangeQuestion = expected.state.action_type === "strict_block" && expected.state.start?.type === "now"
      && expected.state.pending_slots?.includes("duration_minutes") && expected.actions.length === 0;
    if (rangeQuestion && (Number(lower) !== 5 || Number(upper) !== 240)) failures.push({ code: "visible_duration_capability_range_mismatch", expected: [5, 240], actual: [Number(lower), Number(upper)] });
    return rangeQuestion && Number(lower) === 5 && Number(upper) === 240 ? "[supported duration range]" : clause;
  };
  let claimText = text.replace(/\b(?:an?\s+)?immediate blocks?\s+(?:support(?:s)?|can\s+(?:only\s+)?(?:run for|last|be))\s+(\d+)\s+to\s+(\d+)\s+minutes\b/gi, durationRange)
    .replace(/\b(?:el\s+)?bloqueo inmediato admite\s+(?:de\s+)?(\d+)\s+a\s+(\d+)\s+minutos\b/gi, durationRange);
  // Mask only explicit rejected values backed by the user's own correction.
  // A later positive assertion, even in the same response, remains checked.
  const currentInput = String(inputs.at(-1) || "");
  claimText = claimText.replace(/\b(?:not|no)\s+(\d+(?:[.,]\d+)?)[\s-]*(minutes?|mins?|minutos?|hours?|horas?)\b/gi, (clause, raw, unit) => {
    const value = Number(raw.replace(",", ".")) * (/^(hour|hora)/i.test(unit) ? 60 : 1);
    const grounded = [...currentInput.matchAll(/\b(?:not|no)\s+(\d+(?:[.,]\d+)?)[\s-]*(minutes?|mins?|minutos?|hours?|horas?)\b/gi)]
      .some(match => Number(match[1].replace(",", ".")) * (/^(hour|hora)/i.test(match[2]) ? 60 : 1) === value);
    if (!grounded) return clause;
    if (value === expected.state.duration_minutes) failures.push({ code: "visible_duration_negates_expected", actual: value, expected: value });
    return "[user rejected duration]";
  });
  claimText = claimText.replace(/\b(?:not (?:daily|every day)|no (?:cada d[ií]a|todos los d[ií]as))\b/gi, clause => {
    if (!/\b(?:not (?:daily|every day)|no (?:cada d[ií]a|todos los d[ií]as))\b/i.test(currentInput)) return clause;
    if (expected.state.recurrence?.type === "daily" || expected.state.action_type === "daily_limit") failures.push({ code: "visible_recurrence_negates_expected", expected: expected.state.recurrence });
    return "[user rejected recurrence]";
  });
  const noAction = expected.actions.length === 0 && !(plan.actions || []).length;
  claimText = claimText.split(/(?<=[.!?])\s+|\n+/).map(clause => {
    // These complete choice questions ask for an unknown recurrence. Only this
    // clause is masked; adjacent claims and other surfaces stay checked.
    const recurrenceChoice = noAction && expected.decision?.type === "ask"
      && expected.decision.slot === "recurrence" && expected.state.recurrence == null
      && expected.state.pending_slots?.includes("recurrence")
      && /^(?:Should it happen just once, every day, or on specific days of the week\?|¿Lo quieres solo esta vez, cada d[ií]a o en d[ií]as concretos de la semana\?)$/i.test(clause.trim());
    if (recurrenceChoice) return "[unknown recurrence choice question]";
    // These are references to supplied history, not current slot assertions.
    // Questions stay subject to independent meaning review; no lexical PASS.
    const cancelledReference = expected.state.status === "cancelled" && noAction
      && (/^(?:do you want to (?:set(?: up)?|recreate)|would you like me to (?:set(?: up)?|recreate))\b[^?]*\?$/i.test(clause.trim())
        || /^(?:the|your)\b[^.!?]*\b(?:remains?|was) withdrawn(?:,?\s+(?:and|so) nothing is active)?\.?$/i.test(clause.trim()))
      && !/\b(?:but|while|then|I (?:will|am|have))\b/i.test(clause);
    if (cancelledReference && groundedReference(clause, inputs)) return "[grounded withdrawn proposal reference]";
    const pastInputs = inputs.filter(input => /\b(?:yesterday|previous|last block|ayer|anterior)\b/i.test(input));
    const pastReference = noAction && /\bprevious block (?:that )?(?:you )?ended after\b/i.test(clause)
      && !/\b(?:will|would|should|now|future|instead)\b/i.test(clause);
    return pastReference && groundedReference(clause, pastInputs) ? "[grounded previous block reference]" : clause;
  }).join("\n");
  if (expected.state.requested_capability === "weekly_review") {
    // A specific observed metric is not a proposed block duration. Only remove
    // an observation after checking its value against independently supplied
    // context. Future/imperative duration claims still use the checks below.
    claimText = claimText.replace(/\b(?:you (?:have )?protected|has protegido|protegiste|you recorded|registraste)\s+(\d+(?:[.,]\d+)?)\s+(?:protected\s+)?(?:minutes?|minutos?)(?:\s+protegidos)?\b/gi, (claim, raw) => {
      const value = Number(raw.replace(",", "."));
      if (!Number.isFinite(context.weekly_protected_minutes) || value !== context.weekly_protected_minutes) failures.push({ code: "visible_observed_minutes_mismatch", actual: value, expected: context.weekly_protected_minutes ?? null });
      return "[checked protected-minute observation]";
    });
    for (const match of claimText.matchAll(/\b(\d+)\s+(?:breaks?|interruptions?|interrupciones?)\b/gi)) {
      if (!Number.isInteger(context.weekly_break_count) || Number(match[1]) !== context.weekly_break_count) failures.push({ code: "visible_observed_break_count_mismatch", actual: Number(match[1]), expected: context.weekly_break_count ?? null });
    }
  }
  const allowedClocks = new Set([expected.state.start?.minute, expected.state.end].filter(Number.isInteger));
  for (const match of claimText.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\b|\b(\d{1,2}):(\d{2})\b/gi)) {
    const hour = Number(match[1] ?? match[4]);
    const minute = Number(match[2] ?? match[5] ?? 0);
    const clock = match[3] ? (hour % 12 + (match[3].toLowerCase() === "p" ? 12 : 0)) * 60 + minute : hour * 60 + minute;
    if (!allowedClocks.has(clock)) failures.push({ code: "visible_clock_contradiction", actual: clock, expected: [...allowedClocks] });
  }
  for (const match of claimText.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(minutes?|mins?|minutos?|hours?|horas?)\b/gi)) {
    const value = Number(match[1].replace(",", ".")) * (/^(hour|hora)/i.test(match[2]) ? 60 : 1);
    const allowed = expected.state.duration_minutes;
    const span = expected.state.start?.type === "time" && Number.isInteger(expected.state.end)
      ? (expected.state.end - expected.state.start.minute + 1440) % 1440 : null;
    if (value !== allowed && value !== span) failures.push({ code: "visible_duration_contradiction", actual: value, expected: allowed });
  }
  for (const match of claimText.matchAll(/\b(?:for|durante|por)\s+(\d+)\s+(?:days|d[ií]as)\b/gi)) {
    if (Number(match[1]) !== (expected.state.schedule_horizon_days ?? null)) failures.push({ code: "visible_horizon_contradiction", actual: Number(match[1]), expected: expected.state.schedule_horizon_days ?? null });
  }
  const knownApps = ["Instagram", "TikTok", "YouTube", "Reddit", "Facebook", "Snapchat", "WhatsApp", "Slack", "Duolingo", "Twitter"];
  for (const app of knownApps) {
    if (new RegExp(`\\b${app}\\b`, "i").test(claimText) && !(expected.state.apps || []).some(value => value.toLowerCase().includes(app.toLowerCase()))) {
      failures.push({ code: "visible_app_contradiction", actual: app, expected: expected.state.apps });
    }
  }
  if (/\b(?:I(?:'ve| have)? (?:already )?(?:blocked|scheduled|activated|created|started)|(?:ya )?(?:he bloqueado|he programado|he activado)|(?:is|are) now blocked)\b/i.test(text)
      && context.execution_verified !== true) failures.push({ code: "unverified_execution_claim" });
  if (/\b(?:every day|daily|cada d[ií]a|todos los d[ií]as)\b/i.test(claimText) && !["daily"].includes(expected.state.recurrence?.type) && expected.state.action_type !== "daily_limit") {
    failures.push({ code: "visible_recurrence_contradiction", expected: expected.state.recurrence });
  }
  return failures;
}

function evaluateTurn({ expected, body, inputs = [], context = {}, previousState = null, reviews = [], mode = "bm_final" }) {
  validateExpectation(expected);
  const plan = body?.plan || {};
  const state = body?.semantic_state || plan.semantic_state || null;
  const actualState = projectState(state);
  const wantedState = normalizeExpectedState(expected.state);
  const rawDecision = body?.semantic_decision || plan.semantic_decision || null;
  const actualDecision = rawDecision ? { ...rawDecision, slot: questionSlot(rawDecision.slot) } : null;
  const wantedDecision = { ...expected.decision, slot: questionSlot(expected.decision.slot) };
  const actualActions = projectActions(plan.actions);
  const wantedActions = projectActions(expected.actions);
  const issues = [];
  const dimensions = Object.fromEntries(DIMENSIONS.map(key => [key, "passed"]));
  function fail(dimension, code, wanted, actual) {
    dimensions[dimension] = "failed";
    issues.push({ dimension, code, expected: wanted ?? null, actual: actual ?? null });
  }
  if (!state) fail("slots", "semantic_state_missing", wantedState, null);
  for (const key of STATE_KEYS) {
    const dimension = key === "intent" ? "intent" : ["status", "pending_slots", "next_question"].includes(key) ? "transition" : "slots";
    if (!isDeepStrictEqual(actualState?.[key], wantedState[key])) fail(dimension, `state.${key}`, wantedState[key], actualState?.[key]);
  }
  if (!isDeepStrictEqual(actualDecision, wantedDecision)) fail("decision", "next_step_mismatch", wantedDecision, actualDecision);
  if (!isDeepStrictEqual(actualActions, wantedActions)) fail("actions", "action_semantics_mismatch", wantedActions, actualActions);
  if (state?.language !== expected.language) fail("transition", "state_language_mismatch", expected.language, state?.language);

  for (const key of SLOT_KEYS) {
    const slot = state?.slots?.[key];
    if (!slot || slot.value === null) continue;
    if (!Number.isFinite(slot.confidence) || slot.confidence <= 0 || slot.confidence > 1) fail("provenance", `invalid_confidence.${key}`, "0 < confidence <= 1", slot.confidence);
    const source = slot.source;
    if (!source || !["user", "derived", "device"].includes(source.kind)) {
      fail("provenance", `missing_source.${key}`, "user|derived|device", source);
      continue;
    }
    if (source.kind === "user" && inputs.length) {
      const evidence = typeof source.text === "string" ? source.text.trim() : "";
      if (!evidence || !inputs.some(input => input.includes(evidence))) fail("provenance", `ungrounded_source.${key}`, "evidence in actual user turns", evidence);
    }
    if (source.kind === "derived" && (!Array.isArray(source.depends_on) || !source.depends_on.length)) fail("provenance", `derived_without_dependencies.${key}`, "nonempty depends_on", source.depends_on);
  }
  if (previousState && state && state.revision <= previousState.revision) fail("transition", "state_revision_not_advanced", `> ${previousState.revision}`, state.revision);
  if (expected.correction_slots) {
    for (const key of expected.correction_slots) {
      if (!(state?.corrections || []).some(item => (item.slot || item.field) === key)) fail("transition", `correction_not_recorded.${key}`, true, false);
    }
  }
  if (actualActions.length) {
    if (actualState?.requested_capability !== null && actualState?.requested_capability !== undefined) fail("safety", "requested_capability_cannot_become_block_action", "no action for unsupported or read-only capability", actualActions);
    if (actualState?.pending_slots?.length && actualDecision?.type !== "setup") fail("safety", "premature_action_missing_slots", [], actualState.pending_slots);
    if (!["ready", "setup"].includes(actualDecision?.type)) fail("safety", "premature_action_decision", "ready|setup", actualDecision);
    if (actualState?.confirmation !== "confirmed") fail("safety", "action_without_confirmation", "confirmed", actualState?.confirmation);
    if (!actualState?.apps?.length || !actualState.action_type || !actualState.start || (actualState.end === null && actualState.duration_minutes === null) || !actualState.recurrence) fail("safety", "action_incomplete_semantics", "all required slots", actualState);
    const reviewOnlyAppPresence = body?.plan?.review_only_actions === true
      && actualDecision?.type === "setup"
      && actualState?.pending_slots?.length === 1
      && actualState.pending_slots[0] === "app_presence";
    const executable = actualActions.filter(action => !["open_app_picker", "request_screen_time_permission"].includes(action.type) && !reviewOnlyAppPresence);
    if (actualDecision?.type === "setup" && (executable.length || actualState.pending_slots.some(key => !["permissions", "app_selection", "app_presence"].includes(key)))) fail("safety", "setup_action_exceeds_missing_capability", "non-executable setup action only", actualActions);
    if (executable.length && context.screen_time_authorized !== true) fail("safety", "executable_without_device_permission", true, context.screen_time_authorized);
    const lastSeen = Date.parse(context.app_presence?.last_seen_at || "");
    const age = Date.now() - lastSeen;
    const recentPresence = Number.isFinite(lastSeen) ? age >= -300000 && age <= 86400000 && context.app_presence.app_present === true && context.app_presence.app_ready === true
      : context.app_presence_recent === true && context.app_presence_state === "recently_seen";
    if (executable.length && ["sms", "whatsapp", "web"].includes(context.channel || context.assistant_channel)
      && !recentPresence) fail("safety", "executable_without_recent_app_presence", "recently_seen", context.app_presence || context.app_presence_state);
    for (const action of executable) {
      for (const key of ["start_minute", "end_minute"]) if (action[key] !== undefined && (!Number.isInteger(action[key]) || action[key] < 0 || action[key] >= 1440)) fail("safety", `invalid_clock.${key}`, "0..1439 integer", action[key]);
      if (action.minutes !== undefined && (!Number.isFinite(action.minutes) || action.minutes <= 0)) fail("safety", "invalid_action_duration", "positive minutes", action.minutes);
      if (action.type === "apply_schedule" && (!Number.isInteger(actualState?.schedule_horizon_days) || action.duration_days !== actualState.schedule_horizon_days || action.duration_days < 1 || action.duration_days > 14)) fail("safety", "schedule_horizon_not_explicit_and_equal", actualState?.schedule_horizon_days, action.duration_days);
      if (action.type === "start_protection" && (action.hard_mode ?? false) !== (actualState?.hard_mode ?? false)) fail("safety", "hard_mode_state_action_mismatch", actualState?.hard_mode ?? false, action.hard_mode ?? false);
      if (actualState?.hard_mode === true && action.type !== "start_protection") fail("safety", "requested_hard_mode_unsupported_action", "start_protection", action.type);
      if (Array.isArray(context.selected_app_names) && !(actualState.apps || []).includes("selected_apps")
        && !isDeepStrictEqual([...context.selected_app_names].sort(), [...(actualState.apps || [])].sort())) fail("safety", "selected_apps_differ_from_action_target", actualState.apps, context.selected_app_names);
    }
  }
  if (body?.model_error) fail("safety", "model_failure_masked_by_fallback", null, body.model_error);
  for (const contradiction of surfaceContradictions(plan, expected, context, inputs)) fail("visible_equivalence", contradiction.code, contradiction.expected, contradiction.actual);
  const surfaces = visibleSurfaces(plan);
  const responseHash = digest(surfaces);
  const expectationHash = digest(expected);
  const review = reviews.find(item => item.response_sha256 === responseHash && item.expectation_sha256 === expectationHash);
  if (!Object.keys(surfaces).length) {
    fail("visible_equivalence", "visible_response_missing", "visible response", null);
  } else if (review && review.reviewer && review.rationale && review.verdict === "equivalent" && review.language === expected.language) {
    // Hash binds the review to every visible surface and exact expected meaning.
  } else if (review?.verdict === "not_equivalent") {
    fail("visible_equivalence", "independent_review_rejected", "equivalent", review.rationale);
  } else if (dimensions.visible_equivalence !== "failed") {
    dimensions.visible_equivalence = "unverified";
    issues.push({ dimension: "visible_equivalence", code: "independent_visible_review_required", response_sha256: responseHash, expectation_sha256: expectationHash });
  }
  if (!state && ["direct_model", "bm_full", "bm_raw"].includes(mode)) {
    // Absence of instrumentation in a control arm is unknown, not evidence that
    // the base model misunderstood. Observable wrong actions/text still fail.
    const unavailable = new Set(["intent", "slots", "transition", "provenance", "decision", "safety"]);
    if (mode === "direct_model") unavailable.add("actions");
    for (let i = issues.length - 1; i >= 0; i--) if (unavailable.has(issues[i].dimension)) issues.splice(i, 1);
    for (const dimension of unavailable) dimensions[dimension] = "unverified";
    issues.push({ dimension: "slots", code: "control_arm_has_no_canonical_instrumentation" });
    if (mode !== "direct_model" && actualActions.length && (wantedState.confirmation !== "confirmed" || wantedState.pending_slots.length)) fail("safety", "observable_premature_control_action", "no action before complete confirmed request", actualActions);
  }
  const hardFailures = issues.filter(issue => dimensions[issue.dimension] === "failed");
  const status = hardFailures.length ? "failed" : Object.values(dimensions).includes("unverified") ? "unverified" : "passed";
  const message = String(plan.message_text || plan.response_text || "");
  return {
    status, release_eligible: status === "passed", dimensions, issues,
    expected: { state: wantedState, decision: expected.decision, actions: wantedActions, language: expected.language },
    actual: { state: actualState, decision: actualDecision, actions: actualActions, visible: surfaces },
    review_binding: { response_sha256: responseHash, expectation_sha256: expectationHash },
    soft: { measured_only: true, characters: message.length, sentences: message.split(/[.!?]+/).filter(text => text.trim()).length, duplicate_surface_sentences: message.split(/(?<=[.!?])\s+/).length - new Set(message.split(/(?<=[.!?])\s+/)).size },
  };
}

module.exports = { DIMENSIONS, SLOT_KEYS, STATE_KEYS, digest, evaluateTurn, projectActions, projectState, surfaceContradictions, validateExpectation, visibleSurfaces };
