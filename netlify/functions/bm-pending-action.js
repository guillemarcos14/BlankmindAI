"use strict";

const crypto = require("crypto");

const PENDING_ASSISTANT_ACTION_TYPES = new Set([
  "start_protection", "apply_schedule", "update_schedule", "delete_schedule", "delete_all_schedules", "set_daily_limit",
  "enable_allow_only", "enable_adult_filter", "pause_rules", "disable_pause", "apply_ai_plan",
  "open_app_picker", "request_screen_time_permission",
  "disable_allow_only", "disable_adult_filter", "disable_daily_limit",
]);

function cleanText(value, maxLength = 320) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function firstPendingAction(plan = {}) {
  return (Array.isArray(plan.actions) ? plan.actions : [])
    .find((item) => item && PENDING_ASSISTANT_ACTION_TYPES.has(item.type)) || null;
}

function pendingActionFromPlan(plan = {}, options = {}) {
  const action = firstPendingAction(plan);
  if (!action) return null;
  if (["update_schedule", "delete_schedule"].includes(action.type) && !cleanText(action.window_id, 80)) return null;
  if (["apply_schedule", "update_schedule"].includes(action.type) && (
    !Number.isInteger(action.start_minute)
    || !Number.isInteger(action.end_minute)
    || action.start_minute === action.end_minute
  )) return null;

  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const payload = {
    type: action.type,
    name: action.name || null,
    window_id: action.window_id || null,
    minutes: Number.isInteger(action.minutes) ? action.minutes : null,
    hard_mode: action.hard_mode === true,
    start_minute: Number.isInteger(action.start_minute) ? action.start_minute : null,
    end_minute: Number.isInteger(action.end_minute) ? action.end_minute : null,
    weekdays: Array.isArray(action.weekdays) ? action.weekdays : [],
    duration_days: Number.isInteger(action.duration_days) ? action.duration_days : null,
    hours: Number.isInteger(action.hours) ? action.hours : null,
    // App mentions are conversational context only. Native execution always
    // targets the one canonical distraction selection.
    app_names: [],
  };
  const immediateDurationMs = action.type === "start_protection" && Number.isInteger(action.minutes)
    ? action.minutes * 60 * 1000
    : null;
  const createdAt = new Date(now).toISOString();
  return {
    id: `${options.idPrefix || "wa"}_${now.toString(36)}_${crypto.randomBytes(6).toString("hex")}`,
    fingerprint: crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32),
    ...payload,
    status: "queued",
    summary: cleanText(plan.message_text || plan.response_text),
    created_at: createdAt,
    requested_at: createdAt,
    expires_at: new Date(now + (immediateDurationMs || 2 * 60 * 60 * 1000)).toISOString(),
  };
}

function isActivePendingAction(action, now = Date.now()) {
  if (!action || typeof action !== "object") return false;
  const expiresAt = Date.parse(action.expires_at || "");
  return Number.isFinite(expiresAt) && expiresAt > now
    && !["verified", "delayed", "failed", "dismissed", "expired", "superseded"].includes(action.status);
}

module.exports = {
  PENDING_ASSISTANT_ACTION_TYPES,
  firstPendingAction,
  pendingActionFromPlan,
  isActivePendingAction,
};
