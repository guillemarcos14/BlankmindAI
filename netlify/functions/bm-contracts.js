"use strict";

const crypto = require("crypto");

const ACTION_TYPES = Object.freeze([
  "start_protection",
  "apply_schedule",
  "update_schedule",
  "delete_schedule",
  "delete_all_schedules",
  "enable_allow_only",
  "enable_adult_filter",
  "disable_allow_only",
  "disable_adult_filter",
  "disable_daily_limit",
  "set_daily_limit",
  "pause_rules",
  "disable_pause",
  "open_app_picker",
  "request_screen_time_permission",
  "apply_ai_plan",
  "none",
]);

const ACTION_SET = new Set(ACTION_TYPES);

function clean(value, maxLength = 240) {
  return String(value == null ? "" : value).trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function numberOrNull(value, min, max) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function fingerprint(value) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex")
    .slice(0, 24);
}

function normalizeWeekdays(value) {
  if (!Array.isArray(value)) return null;
  return Array.from(new Set(value
    .map((item) => numberOrNull(item, 1, 7))
    .filter((item) => item != null)))
    .slice(0, 7);
}

function normalizeAction(candidate) {
  const source = candidate && typeof candidate === "object" ? candidate : {};
  const legacyType = clean(source.type, 64);
  const type = legacyType === "activate_mode"
    ? "start_protection"
    : legacyType === "switch_mode" ? "open_app_picker" : legacyType;
  if (!ACTION_SET.has(type)) return null;
  return {
    type,
    minutes: numberOrNull(source.minutes, 5, 240),
    hard_mode: source.hard_mode === true ? true : source.hard_mode === false ? false : null,
    name: clean(source.name, 48) || null,
    window_id: clean(source.window_id, 80) || null,
    start_minute: numberOrNull(source.start_minute, 0, 1439),
    end_minute: numberOrNull(source.end_minute, 0, 1439),
    weekdays: normalizeWeekdays(source.weekdays),
    duration_days: numberOrNull(source.duration_days, 1, 14),
    hours: numberOrNull(source.hours, 1, 168),
  };
}

function normalizeActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions.map(normalizeAction).filter(Boolean).slice(0, 4);
}

function normalizePlan(plan = {}) {
  const source = plan && typeof plan === "object" ? plan : {};
  const actions = normalizeActions(source.actions);
  return {
    intent: clean(source.intent, 64) || "general",
    title: clean(source.title, 96) || null,
    response_text: clean(source.response_text, 700),
    message_text: clean(source.message_text || source.response_text, 700),
    speech_text: clean(source.speech_text || source.message_text || source.response_text, 900),
    followup_text: clean(source.followup_text, 320),
    recommendation_id: clean(source.recommendation_id, 160) || null,
    actions,
    requires_selected_apps: source.requires_selected_apps === true,
    requires_screen_time_authorization: source.requires_screen_time_authorization === true,
  };
}

function validatePlan(plan) {
  const source = plan && typeof plan === "object" ? plan : {};
  const rawActions = Array.isArray(source.actions) ? source.actions : [];
  const rawActionTypes = rawActions.map((action) => {
    const type = clean(action?.type, 64);
    return type === "activate_mode" ? "start_protection" : type === "switch_mode" ? "open_app_picker" : type;
  });
  const unknownActionTypes = rawActionTypes.filter((type) => type && !ACTION_SET.has(type));
  const malformedActionCount = rawActions.filter((action) => !action || typeof action !== "object" || Array.isArray(action) || !clean(action.type, 64)).length;
  const normalized = normalizePlan(source);
  const errors = [];
  const warnings = [];
  if (!normalized.response_text && !normalized.message_text) errors.push("missing_response");
  if (rawActions.length > 4) errors.push("too_many_actions");
  if (malformedActionCount) errors.push("invalid_action");
  if (unknownActionTypes.length) errors.push("unknown_action_type");
  if (normalized.actions.some((action) => action.type === "none") && normalized.actions.length > 1) {
    errors.push("none_must_be_only_action");
  }
  return { valid: errors.length === 0, errors, warnings, unknownActionTypes, plan: normalized };
}

function actionNeedsSetup(action, context = {}) {
  if (!action || action.type === "none") return false;
  if (["open_app_picker", "request_screen_time_permission"].includes(action.type)) return false;
  if (["delete_schedule", "delete_all_schedules"].includes(action.type)) return false;
  if (action.type === "update_schedule") return context.screen_time_authorized !== true;
  if (action.type === "apply_ai_plan") return context.has_selected_apps !== true || context.screen_time_authorized !== true;
  return context.has_selected_apps !== true || context.screen_time_authorized !== true;
}

function planFingerprint(plan) {
  return fingerprint(normalizePlan(plan));
}

module.exports = {
  ACTION_TYPES,
  actionNeedsSetup,
  clean,
  fingerprint,
  normalizeAction,
  normalizeActions,
  normalizePlan,
  planFingerprint,
  stableValue,
  validatePlan,
};
