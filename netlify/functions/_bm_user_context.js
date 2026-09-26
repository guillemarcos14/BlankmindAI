"use strict";

const { supabaseFetch } = require("./_membership");

function clean(value, max = 160) {
  return String(value == null ? "" : value).trim().replace(/\s+/g, " ").slice(0, max);
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function safeRows(path) {
  try {
    const rows = await supabaseFetch(path, { method: "GET" });
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

async function canonicalIdentity(connectCode) {
  const code = clean(connectCode, 32).toUpperCase();
  if (!code) return null;
  // Local contract tests intentionally run without a Supabase environment.
  // A partially configured or failing production environment still throws.
  if (!process.env.SUPABASE_URL && !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const rows = await supabaseFetch(`blankmind_identity_links?assistant_connect_code=eq.${encodeURIComponent(code)}&select=auth_user_id,anonymous_user_id,assistant_connect_code&limit=1`, { method: "GET" });
  return rows[0] || null;
}

async function persistCanonicalSnapshot(connectCode, context, source = "assistant_context_sync") {
  const code = clean(connectCode, 32).toUpperCase();
  if (!code || !safeObject(context).anonymous_user_id) return null;
  const identity = await canonicalIdentity(code);
  if (!identity?.auth_user_id) {
    const legacyRows = await supabaseFetch("rpc/upsert_bm_legacy_user_context", {
      method: "POST",
      body: JSON.stringify({
        p_connect_code: code,
        p_context: context,
        p_source: clean(source, 80) || "app",
      }),
    });
    return Array.isArray(legacyRows) ? legacyRows[0] || null : legacyRows;
  }
  const rows = await supabaseFetch("rpc/upsert_bm_user_context", {
    method: "POST",
    body: JSON.stringify({
      p_connect_code: code,
      p_anonymous_user_id: clean(context.anonymous_user_id, 120),
      p_context: context,
      p_source: clean(source, 80) || "app",
    }),
  });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

async function enrichAssistantContext(input = {}, connectCode = "") {
  const base = safeObject(input);
  const identity = await canonicalIdentity(connectCode);
  const snapshotRows = identity?.auth_user_id
    ? await supabaseFetch(`bm_user_context_snapshots?user_id=eq.${encodeURIComponent(identity.auth_user_id)}&select=anonymous_user_id,context,context_version,updated_at&limit=1`, { method: "GET" })
    : await safeRows(`bm_legacy_context_snapshots?connect_code=eq.${encodeURIComponent(clean(connectCode, 32).toUpperCase())}&select=context,context_version,updated_at&limit=1`);
  const snapshot = snapshotRows[0] || {};
  const durableContext = safeObject(snapshot.context);
  // The canonical app snapshot is authoritative. Channel memory may lag when
  // several iOS syncs complete out of order and must never overwrite it.
  const mergedBase = { ...base, ...durableContext };
  const anonymousUserId = clean(mergedBase.anonymous_user_id || identity?.anonymous_user_id || snapshot.anonymous_user_id, 120);
  if (!anonymousUserId) return mergedBase;

  const [onboarding, insights, outcomes, memories, signals] = await Promise.all([
    safeRows(`onboarding_responses?anonymous_user_id=eq.${encodeURIComponent(anonymousUserId)}&select=name,age_range,goal,profile,daily_hours,ai_goal,weak_moment,selected_plan,submitted_at&limit=1`),
    safeRows(`digital_wellness_feature_payloads?anonymous_user_id=eq.${encodeURIComponent(anonymousUserId)}&select=insight,period_start,period_end,submitted_at&order=submitted_at.desc&limit=1`),
    safeRows(`bai_user_plan_outcomes?anonymous_user_id=eq.${encodeURIComponent(anonymousUserId)}&select=pattern_key,recommendation_kind,proposed_value,outcome,outcome_score,created_at&order=created_at.desc&limit=20`),
    safeRows(`bai_user_memory_signals?anonymous_user_id=eq.${encodeURIComponent(anonymousUserId)}&select=signal_type,signal_value,confidence,source,updated_at&order=updated_at.desc&limit=20`),
    safeRows(`wellness_signal_events?anonymous_user_id=eq.${encodeURIComponent(anonymousUserId)}&select=signal_type,value_number,value_text,source,measured_at&order=measured_at.desc&limit=20`),
  ]);
  const profile = onboarding[0] || {};
  return {
    ...mergedBase,
    anonymous_user_id: anonymousUserId,
    canonical_user_id: clean(identity?.auth_user_id, 80),
    profile_name: clean(mergedBase.profile_name || profile.name, 80),
    age_range: clean(mergedBase.age_range || profile.age_range, 40),
    personal_profile: {
      goal: clean(profile.goal, 120),
      profile: clean(profile.profile, 120),
      daily_hours: Number.isFinite(Number(profile.daily_hours)) ? Number(profile.daily_hours) : null,
      ai_goal: clean(profile.ai_goal, 180),
      weak_moment: clean(profile.weak_moment, 180),
      selected_plan: clean(profile.selected_plan, 120),
    },
    latest_insight: safeObject(insights[0]?.insight),
    recent_plan_outcomes: outcomes,
    learned_memory_signals: memories,
    recent_wellness_signals: signals,
  };
}

module.exports = { canonicalIdentity, enrichAssistantContext, persistCanonicalSnapshot };
