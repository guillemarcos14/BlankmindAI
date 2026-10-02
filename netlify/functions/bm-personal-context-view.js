"use strict";

function clean(value, max = 240) {
  return String(value == null ? "" : value).trim().replace(/\s+/g, " ").slice(0, max);
}

function copy(value, depth = 0) {
  if (depth > 4 || value == null) return null;
  if (typeof value === "string") return clean(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => copy(item, depth + 1)).filter((item) => item != null);
  if (typeof value !== "object") return null;
  return Object.fromEntries(Object.entries(value).slice(0, 32).map(([key, item]) => [key, copy(item, depth + 1)]).filter(([, item]) => item != null));
}

function compact(value) {
  if (!value || typeof value !== "object") return undefined;
  return Object.keys(value).length ? value : undefined;
}

function rememberedContext(memory = {}) {
  if (!memory || typeof memory !== "object") return undefined;
  const safeKeys = [
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
  ];
  return compact(Object.fromEntries(safeKeys
    .filter((key) => memory[key] != null)
    .map((key) => [key, copy(memory[key])])));
}

function personalContextView(context = {}) {
  const source = context && typeof context === "object" ? context : {};
  const profile = source.personal_profile || source.user_context?.personal_profile || {};
  const schedule = source.schedule || source.user_context?.schedule || {};
  const recentMessages = Array.isArray(source.recent_messages) ? source.recent_messages : [];
  const view = {
    person: compact({
      name: clean(source.profile_name || source.user_context?.profile_name, 80) || undefined,
      age: Number.isInteger(profile.age) ? profile.age : undefined,
      age_range: clean(source.age_range || source.user_context?.age_range, 40) || undefined,
      goals_and_preferences: compact(copy(profile)),
    }),
    current_app_state: compact({
      protection_active: source.is_blank_active === true,
      distraction_list_ready: source.has_selected_apps === true,
      selected_app_names: copy(source.selected_app_names || source.user_context?.selected_app_names || []),
      blocking_permission_ready: source.screen_time_authorized === true,
      device_execution_ready: source.device_execution_ready === true,
      vacation_mode_active: source.vacation_mode_active === true,
      emergency_unlocks_remaining: source.emergency_unlocks_remaining,
      recurring_schedule: compact(copy(schedule)),
      daily_limit_enabled: source.daily_limit_enabled === true,
      daily_limit_minutes: source.daily_limit_minutes,
      allow_only_mode_enabled: source.allow_only_mode_enabled === true,
      adult_content_blocking_enabled: source.adult_content_blocking_enabled === true,
    }),
    progress: compact({
      adherence_score: source.adherence_score,
      weekly_protected_minutes: source.weekly_protected_minutes,
      weekly_break_count: source.weekly_break_count,
      weekly_goal: source.weekly_goal,
      strongest_hour: source.strongest_hour,
      risk_window: source.risk_window,
      recommended_duration_minutes: source.recommended_duration_minutes,
    }),
    latest_digital_wellness_insight: compact(copy(source.latest_insight || source.user_context?.latest_insight)),
    recent_plan_outcomes: copy(source.recent_plan_outcomes || source.user_context?.recent_plan_outcomes || []),
    learned_personal_signals: copy(source.learned_memory_signals || source.user_context?.learned_memory_signals || []),
    recent_wellness_signals: copy(source.recent_wellness_signals || source.user_context?.recent_wellness_signals || []),
    remembered_context: rememberedContext(source.memory || source.user_context?.memory || {}),
    durable_personal_memory: copy(source.brain_memories || []),
    data_limits: source.brain_snapshot ? {
      observed_at: source.brain_snapshot.generated_at,
      authority: "iPhone observations for device state; user statements for personal memory",
      phone_usage_available: false, saved_time_measured: false, billing_details_available: false,
      history_complete: source.brain_snapshot.history_complete,
    } : undefined,
    recent_conversation: recentMessages.slice(-8).map((message) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: clean(message?.content || message?.text, 420),
    })).filter((message) => message.content),
  };
  return Object.fromEntries(Object.entries(view).filter(([, value]) => value !== undefined && (!Array.isArray(value) || value.length)));
}

module.exports = { personalContextView };
