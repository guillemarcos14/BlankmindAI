"use strict";

const { clean, fingerprint } = require("./bm-contracts");
const { normalizeBrainSnapshot } = require("./bm-brain-data");

const MEMORY_KEYS = new Set([
  "main_apps",
  "weak_hours",
  "bedtime_minute",
  "breakfast_end_minute",
  "lunch_end_minute",
  "pattern_cluster",
  "last_plan_outcome",
  "last_intent",
  "last_topic",
  "last_bm_topic",
  "last_bai_topic",
  "pending_blocking",
  "conversation_state",
  "user_context",
]);

const SCALAR_KEYS = [
  "channel",
  "assistant_channel",
  "language",
  "locale",
  "trigger",
  "mode",
  "web_preview",
  "single_distraction_block",
  "protection_target",
  "has_selected_apps",
  "screen_time_authorized",
  "notification_authorized",
  "is_blank_active",
  "emergency_unlocks_remaining",
  "vacation_mode_active",
  "weekly_break_count",
  "weekly_protected_minutes",
  "recommended_duration_minutes",
  "risk_window",
  "recommendation_id",
  "autonomy_consent",
  "device_execution_ready",
  "selection_count",
  "allow_only_mode_enabled",
  "adult_content_blocking_enabled",
  "daily_limit_enabled",
  "daily_limit_minutes",
  "weekly_goal",
  "strongest_hour",
  "adherence_score",
  "pickup_pressure_score",
  "behavior_chain",
  "recommended_difficulty",
  "signal_type",
  "threshold_minutes",
  "risk_hour",
  "weak_hour",
  "risk_score",
  "relapse_risk_score",
  "sleep_minutes",
  "sleep_delta_minutes",
  "sleep_deficit_minutes",
  "social_use_delta_percent",
  "app_use_delta_percent",
  "screen_time_delta_percent",
  "break_count_today",
  "relapse_count_today",
  "unlock_count_today",
  "category",
  "dominant_category",
  "health_signal_reasons",
  "app_presence_state",
  "app_presence_recent",
  "app_ready",
  "anonymous_user_id",
  "canonical_user_id",
  "profile_name",
  "age_range",
  "context_generated_at",
  "chat_active_until",
  "context_revision",
];

const ARRAY_KEYS = ["authorized_action_types", "selected_app_names"];
const OBJECT_ARRAY_KEYS = ["recent_plan_outcomes", "learned_memory_signals", "recent_wellness_signals"];
const OBJECT_KEYS = ["schedule", "app_presence"];
const GENERIC_OBJECT_KEYS = ["personal_profile", "latest_insight"];

const APP_PRESENCE_RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;
const SHORT_TERM_CONVERSATION_TTL_MS = 2 * 60 * 60 * 1000;

function normalizeStringArray(value, maxItems = 8, maxLength = 80) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => typeof item === "string" ? item : item && typeof item === "object" ? item.name : "")
    .map((item) => clean(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeSchedule(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};

  if (typeof value.enabled === "boolean") result.enabled = value.enabled;
  for (const key of ["start_minute", "end_minute", "paused_until", "expires_at"]) {
    if (Number.isFinite(value[key])) result[key] = value[key];
  }
  if (Array.isArray(value.windows)) {
    result.windows = value.windows.slice(0, 32).map((window) => {
      if (!window || typeof window !== "object" || Array.isArray(window)) return null;
      const normalized = {};
      for (const key of ["id", "name"]) {
        const cleanValue = clean(window[key], 80);
        if (cleanValue) normalized[key] = cleanValue;
      }
      if (typeof window.enabled === "boolean") normalized.enabled = window.enabled;
      for (const key of ["start_minute", "end_minute"]) {
        if (Number.isFinite(window[key])) normalized[key] = Math.round(window[key]);
      }
      if (Number.isFinite(window.expires_at)) normalized.expires_at = window.expires_at;
      if (["once","weekly","continuous"].includes(window.recurrence)) normalized.recurrence = window.recurrence;
      for (const key of ["starts_at","ends_at","timezone"]) if (typeof window[key] === "string") normalized[key] = clean(window[key],80);
      if (Array.isArray(window.weekdays)) normalized.weekdays = window.weekdays.filter((day) => Number.isInteger(day) && day >= 1 && day <= 7).slice(0, 7);
      return Object.keys(normalized).length ? normalized : null;
    }).filter(Boolean);
  }
  return result;
}

function normalizeAppPresence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  if (typeof value.app_present === "boolean") result.app_present = value.app_present;
  if (typeof value.app_ready === "boolean") result.app_ready = value.app_ready;
  for (const key of ["last_seen_at", "platform", "app_version", "build_number", "source"]) {
    const cleanValue = clean(value[key], 100);
    if (cleanValue) result[key] = cleanValue;
  }
  return result;
}

function deriveAppPresence(value, now = Date.now()) {
  const presence = normalizeAppPresence(value);
  const lastSeenAt = Date.parse(presence.last_seen_at || "");
  const ageMs = Number.isFinite(lastSeenAt) && lastSeenAt <= now + 5 * 60 * 1000 ? Math.max(0, now - lastSeenAt) : null;
  const state = ageMs == null
    ? "never_seen"
    : ageMs <= APP_PRESENCE_RECENT_WINDOW_MS
      ? "recently_seen"
      : "stale";
  return {
    state,
    recent: state === "recently_seen",
    ready: state === "recently_seen" && presence.app_present === true && presence.app_ready === true,
    age_hours: ageMs == null ? null : Math.round(ageMs / (60 * 60 * 1000) * 10) / 10,
    last_seen_at: presence.last_seen_at || "",
    platform: presence.platform || "",
    app_version: presence.app_version || "",
  };
}

function normalizeAutonomyGrant(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const grant = {
    active: value.active === true,
    action_types: normalizeStringArray(value.action_types, 16, 64),
  };
  const source = clean(value.source, 80);
  const expiresAt = clean(value.expires_at, 64);
  if (source) grant.source = source;
  if (expiresAt) grant.expires_at = expiresAt;
  return grant;
}

function normalizeMemory(memory = {}) {
  if (!memory || typeof memory !== "object" || Array.isArray(memory)) return {};
  return Object.keys(memory).reduce((result, key) => {
    if (!MEMORY_KEYS.has(key)) return result;
    const value = memory[key];
    if (key === "pending_blocking") {
      const pending = normalizePendingBlocking(value);
      if (pending) result[key] = pending;
      return result;
    }
    if (key === "user_context") {
      const context = normalizeUserContext(value);
      if (Object.keys(context).length) result[key] = context;
      return result;
    }
    if (key === "conversation_state") {
      const state = normalizeConversationState(value);
      if (state) result[key] = state;
      return result;
    }
    if (Array.isArray(value)) result[key] = value.slice(0, 8).map((item) => clean(item, 80)).filter(Boolean);
    else if (typeof value === "number" && Number.isFinite(value)) result[key] = Math.round(value);
    else if (typeof value === "boolean") result[key] = value;
    else if (typeof value === "string") result[key] = clean(value, 120);
    return result;
  }, {});
}

function normalizeUserContext(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const key of SCALAR_KEYS) {
    if (value[key] !== undefined) {
      if (key === "selection_count" || key.endsWith("_minutes") || key.endsWith("_hour")) {
        if (Number.isFinite(value[key])) result[key] = Math.round(value[key]);
      } else if (key.endsWith("_score")) {
        if (Number.isFinite(value[key])) result[key] = Math.round(value[key] * 1000) / 1000;
      } else if (typeof value[key] === "boolean") {
        result[key] = value[key];
      } else if (typeof value[key] === "number" && Number.isFinite(value[key])) {
        result[key] = value[key];
      } else if (typeof value[key] === "string") {
        result[key] = clean(value[key], 180);
      }
    }
  }
  if (Array.isArray(value.selected_app_names)) result.selected_app_names = normalizeStringArray(value.selected_app_names, 8, 60);
  if (value.schedule) result.schedule = normalizeSchedule(value.schedule);
  const brainSnapshot = normalizeBrainSnapshot(value.brain_snapshot);
  if (brainSnapshot) result.brain_snapshot = brainSnapshot;
  if (value.app_presence) result.app_presence = normalizeAppPresence(value.app_presence);
  for (const key of GENERIC_OBJECT_KEYS) {
    const normalized = normalizeObject(value[key]);
    if (Object.keys(normalized).length) result[key] = normalized;
  }
  for (const key of OBJECT_ARRAY_KEYS) {
    const normalized = normalizeObjectArray(value[key]);
    if (normalized.length) result[key] = normalized;
  }
  if (Array.isArray(value.recent_messages)) result.recent_messages = normalizeConversation(value.recent_messages);
  if (value.memory && typeof value.memory === "object" && !Array.isArray(value.memory)) {
    const nestedMemory = normalizeMemory({ ...value.memory, user_context: undefined });
    if (Object.keys(nestedMemory).length) result.memory = nestedMemory;
  }
  result.metrics = normalizeObject(value.metrics);
  result.signals = normalizeObject(value.signals);
  return result;
}

function normalizePendingBlocking(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {};
  if (Array.isArray(value.apps)) result.apps = value.apps.slice(0, 8).map((app) => clean(app, 80)).filter(Boolean);
  if (typeof value.action === "string") result.action = clean(value.action, 40);
  for (const field of ["start", "end", "recurrence"]) {
    if (!value[field] || typeof value[field] !== "object" || Array.isArray(value[field])) continue;
    result[field] = { ...value[field] };
  }
  if (value.apps_confirmed === true) result.apps_confirmed = true;
  const updatedAt = clean(value.updated_at, 64);
  if (updatedAt && Number.isFinite(Date.parse(updatedAt))) result.updated_at = updatedAt;
  return Object.keys(result).length ? result : null;
}

function normalizeConversation(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(message => message && ["user", "assistant"].includes(message.role)).slice(-8).map((message) => ({
    role: clean(message?.role, 24) || "user",
    content: clean(message?.content || message?.text, 420),
  })).filter((message) => message.content);
}

function normalizeConversationState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {};
  for (const key of ["topic", "pending_slot"]) {
    const cleanValue = clean(value[key], 48);
    if (cleanValue) result[key] = cleanValue;
  }
  for (const key of ["pending_question", "last_user_message", "last_assistant_message"]) {
    const cleanValue = clean(value[key], 420);
    if (cleanValue) result[key] = cleanValue;
  }
  const updatedAt = clean(value.updated_at, 64);
  if (updatedAt && Number.isFinite(Date.parse(updatedAt))) result.updated_at = updatedAt;
  if (Array.isArray(value.recent_messages)) result.recent_messages = normalizeConversation(value.recent_messages);
  if (value.semantic_state) {
    const semantic = require("./bm-semantic-state").normalizeSemanticState(value.semantic_state);
    if (semantic) result.semantic_state = semantic;
  }
  if (value.bmb_state && JSON.stringify(value.bmb_state).length < 8000) result.bmb_state = value.bmb_state;
  return Object.keys(result).length ? result : null;
}

function freshConversationState(value, now = Date.now()) {
  const state = normalizeConversationState(value);
  if (!state || !state.updated_at) return null;
  const updatedAt = Date.parse(state.updated_at);
  if (!Number.isFinite(updatedAt) || updatedAt > now + 5 * 60 * 1000) return null;
  if (now - updatedAt > SHORT_TERM_CONVERSATION_TTL_MS) return null;
  return state;
}

function normalizeObject(value, maxKeys = 24, depth = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  if (depth > 3) return {};
  return Object.keys(value).slice(0, maxKeys).reduce((result, key) => {
    const item = value[key];
    if (typeof item === "number" && Number.isFinite(item)) result[key] = item;
    else if (typeof item === "boolean") result[key] = item;
    else if (typeof item === "string") result[key] = clean(item, 240);
    else if (Array.isArray(item)) {
      result[key] = item.slice(0, 20).map((entry) => {
        if (typeof entry === "string") return clean(entry, 240);
        if (typeof entry === "number" && Number.isFinite(entry)) return entry;
        if (typeof entry === "boolean") return entry;
        return normalizeObject(entry, 20, depth + 1);
      }).filter((entry) => entry !== "" && (typeof entry !== "object" || Object.keys(entry).length));
    } else if (item && typeof item === "object") {
      const nested = normalizeObject(item, 20, depth + 1);
      if (Object.keys(nested).length) result[key] = nested;
    }
    return result;
  }, {});
}

function normalizeObjectArray(value, maxItems = 20) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map((item) => normalizeObject(item, 16)).filter((item) => Object.keys(item).length);
}

function buildAgentContext(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const shared = normalizeUserContext(source.user_context);
  const merged = { ...shared, ...source };
  const result = {};
  if (source.channel === "app" && source.brain_request) {
    const request = source.brain_request;
    if (["control", "conversation", "statistics", "configuration", "memory", "history", "account"].includes(request.route)) {
      result.brain_request = { route: request.route, execute: request.route === "control" && request.execute === true,
        language: ["en", "es"].includes(request.language) ? request.language : "en" };
    }
  }
  const brainSnapshot = normalizeBrainSnapshot(merged.brain_snapshot);
  if (brainSnapshot) result.brain_snapshot = brainSnapshot;
  if (source.channel === "app" && Array.isArray(source.brain_memories)) result.brain_memories = source.brain_memories.slice(0, 7);
  for (const key of SCALAR_KEYS) {
    if (merged[key] !== undefined) result[key] = merged[key];
  }
  for (const key of ARRAY_KEYS) {
    if (merged[key] !== undefined) result[key] = normalizeStringArray(merged[key]);
  }
  for (const key of OBJECT_ARRAY_KEYS) {
    if (merged[key] !== undefined) result[key] = normalizeObjectArray(merged[key]);
  }
  for (const key of OBJECT_KEYS) {
    if (merged[key] !== undefined) {
      result[key] = key === "app_presence" ? normalizeAppPresence(merged[key]) : normalizeSchedule(merged[key]);
    }
  }
  for (const key of GENERIC_OBJECT_KEYS) {
    if (merged[key] !== undefined) result[key] = normalizeObject(merged[key], 32);
  }
  const pendingBlocking = normalizePendingBlocking(merged.pending_blocking);
  if (pendingBlocking) result.pending_blocking = pendingBlocking;
  if (merged.autonomy_grant !== undefined) {
    const grant = normalizeAutonomyGrant(merged.autonomy_grant);
    if (grant) result.autonomy_grant = grant;
  }
  result.memory = normalizeMemory({ ...(shared.memory || {}), ...(source.memory || {}) });
  const conversationState = freshConversationState(source.conversation_state || result.memory.conversation_state);
  if (result.memory.conversation_state && !conversationState) delete result.memory.conversation_state;
  if (conversationState) result.memory.conversation_state = conversationState;
  if (source.semantic_state || conversationState?.semantic_state) {
    const semantic = require("./bm-semantic-state").normalizeSemanticState(source.semantic_state || conversationState.semantic_state);
    if (semantic) result.semantic_state = semantic;
  }
  result.recent_messages = normalizeConversation(
    source.recent_messages || shared.recent_messages || source.conversation || conversationState?.recent_messages,
  );
  result.metrics = normalizeObject(source.metrics || shared.metrics);
  result.signals = normalizeObject(source.signals || shared.signals);
  const presence = deriveAppPresence(result.app_presence || shared.app_presence);
  result.app_presence_state = presence.state;
  result.app_presence_recent = presence.recent;
  result.app_ready = presence.ready;
  result.single_distraction_block = true;
  result.protection_target = "selected_distractions";
  if (Object.keys(shared).length) result.user_context = shared;
  result.context_fingerprint = fingerprint({
    ...result,
    recent_messages: result.recent_messages.map((message) => ({ role: message.role, length: message.content.length })),
  });
  return result;
}

module.exports = {
  MEMORY_KEYS,
  buildAgentContext,
  normalizeAppPresence,
  deriveAppPresence,
  normalizeConversation,
  normalizeConversationState,
  freshConversationState,
  normalizeMemory,
  normalizeUserContext,
};
