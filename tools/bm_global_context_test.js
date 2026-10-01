"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildAgentContext, normalizeUserContext } = require("../netlify/functions/bm-context");
const { personalizedRecommendationPlan, scheduleManagementPlan } = require("../netlify/functions/bm-schedule-management");
const { pendingActionFromPlan } = require("../netlify/functions/bm-pending-action");
const { enforceSemanticBoundary } = require("../netlify/functions/blanked-agent");
const { personalContextView } = require("../netlify/functions/bm-personal-context-view");
const { memoryFactsFromText } = require("../netlify/functions/sms-agent");
const { isGrounded } = require("../netlify/functions/bm-contextual-response");

const root = path.join(__dirname, "..");
const upsertFix = fs.readFileSync(path.join(root, "supabase/migrations/017_fix_bm_context_upsert.sql"), "utf8");
const revisionGuard = fs.readFileSync(path.join(root, "supabase/migrations/018_guard_bm_context_revision.sql"), "utf8");
const persistenceSource = fs.readFileSync(path.join(root, "netlify/functions/_bm_user_context.js"), "utf8");
const assistantChannelSource = fs.readFileSync(path.join(root, "netlify/functions/assistant-channel.js"), "utf8");
const iosContextSource = fs.readFileSync(path.join(root, "ios/Blank/Blank/ContentView.swift"), "utf8");
const iosHomeSource = fs.readFileSync(path.join(root, "ios/Blank/Blank/HomeView.swift"), "utf8");
assert.match(upsertFix, /on conflict on constraint bm_user_context_snapshots_pkey/i);
assert.match(revisionGuard, /client_revision/i);
assert.match(revisionGuard, /excluded\.client_revision > bm_user_context_snapshots\.client_revision/i);
assert.doesNotMatch(persistenceSource, /catch\s*\(_\)\s*\{\s*return null;\s*\}/);
assert.match(persistenceSource, /const mergedBase = \{ \.\.\.base, \.\.\.durableContext \}/);
assert.match(persistenceSource, /profile_name: clean\(mergedBase\.profile_name/);
assert.match(assistantChannelSource, /return await syncContext\(body,\s*appAuth\)/);
assert.match(assistantChannelSource, /assistant_identity_conflict/);
assert.match(assistantChannelSource, /enrichAssistantContext\(\{\}, connectCode\)/);
assert.match(iosContextSource, /for attempt in 0\.\.<3/);
assert.match(iosContextSource, /200\.\.<300/);
assert.match(iosHomeSource, /"context_revision"/);
assert.match(iosHomeSource, /max\(currentRevision, nextRevision\)/);
assert.deepEqual(
  (({ profile_name, age, age_range, declared_goal }) => ({ profile_name, age, age_range, declared_goal }))(
    memoryFactsFromText("Call me Guillem. I'm 32 years old. I want to sleep better."),
  ),
  { profile_name: "Guillem", age: 32, age_range: "25-34", declared_goal: "sleep better" },
);
assert.equal(memoryFactsFromText("Block Instagram for 30 minutes").age, undefined);

const windowId = "2D7B82F5-3F07-48F2-8D20-D4E7EA02967E";
const source = {
  anonymous_user_id: "anon-juan",
  canonical_user_id: "auth-juan",
  profile_name: "Juan",
  age_range: "25-34",
  personal_profile: { goal: "Focus after lunch", daily_hours: 5 },
  latest_insight: { pattern: "post_lunch_scroll" },
  recent_plan_outcomes: [{ outcome: "held", outcome_score: 0.9 }],
  schedule: {
    enabled: true,
    windows: [{
      id: windowId,
      name: "Lunch focus",
      enabled: true,
      start_minute: 13 * 60,
      end_minute: 14 * 60,
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    }],
  },
};

const normalized = normalizeUserContext(source);
assert.equal(normalized.profile_name, "Juan");
assert.equal(normalized.personal_profile.goal, "Focus after lunch");
assert.equal(normalized.latest_insight.pattern, "post_lunch_scroll");
assert.equal(normalized.recent_plan_outcomes[0].outcome, "held");

const context = buildAgentContext({ user_context: source });
assert.equal(context.canonical_user_id, "auth-juan");
assert.equal(context.schedule.windows[0].id, windowId);

const listed = scheduleManagementPlan("What recurring blocking windows do I have?", context);
assert.match(listed.response_text, /1:00 PM to 2:00 PM/);
assert.deepEqual(listed.actions, []);
const listedAgain = scheduleManagementPlan("What recurring blocking windows do I have?", {
  ...context,
  recent_messages: [{ role: "user", content: "same question" }, { role: "assistant", content: listed.response_text }],
});
assert.notEqual(listedAgain.response_text, listed.response_text);

const moved = scheduleManagementPlan("Move my 1 PM to 2 PM blocking window one hour later", context);
assert.equal(moved.actions[0].type, "update_schedule");
assert.equal(moved.actions[0].window_id, windowId);
assert.equal(moved.actions[0].start_minute, 14 * 60);
assert.equal(moved.actions[0].end_minute, 15 * 60);
const pendingMove = pendingActionFromPlan(moved, { now: 1_700_000_000_000 });
assert.equal(pendingMove.window_id, windowId);

const deleted = scheduleManagementPlan("Quiero eliminar todos los bloques de bloqueo", context);
assert.equal(deleted.actions[0].type, "delete_all_schedules");
const deletedPlural = scheduleManagementPlan("I want to delete the existing blocking windows", context);
assert.equal(deletedPlural.actions[0].type, "delete_all_schedules");

const removeOne = scheduleManagementPlan("Delete the 1 PM to 2 PM blocking window", context);
assert.equal(removeOne.actions[0].type, "delete_schedule");
assert.equal(removeOne.actions[0].window_id, windowId);

const movedFromContext = scheduleManagementPlan("Move it one hour later", {
  ...context,
  recent_messages: [
    { role: "user", content: "What recurring blocking windows do I have?" },
    { role: "assistant", content: listed.response_text },
  ],
});
assert.equal(movedFromContext.actions[0].window_id, windowId);
assert.equal(movedFromContext.actions[0].start_minute, 14 * 60);

const weekdaysOnly = scheduleManagementPlan("Change my blocking window to weekdays", context);
assert.deepEqual(weekdaysOnly.actions[0].weekdays, [2, 3, 4, 5, 6]);
assert.equal(weekdaysOnly.actions[0].start_minute, 13 * 60);

const extended = scheduleManagementPlan("Extend the 1 PM to 2 PM blocking window by 30 minutes", context);
assert.equal(extended.actions[0].end_minute, 14 * 60 + 30);

const movedToTime = scheduleManagementPlan("Move my blocking window to 2:30 PM", context);
assert.equal(movedToTime.actions[0].start_minute, 14 * 60 + 30);
assert.equal(movedToTime.actions[0].end_minute, 15 * 60 + 30);

const changedEnd = scheduleManagementPlan("Make my blocking window end at 2:30 PM", context);
assert.equal(changedEnd.actions[0].start_minute, 13 * 60);
assert.equal(changedEnd.actions[0].end_minute, 14 * 60 + 30);

const recommendation = enforceSemanticBoundary({
  response_text: "Based on your stronger adherence, keep the lunch window and move it 15 minutes earlier on difficult days.",
  actions: [{ type: "apply_schedule", start_minute: 765, end_minute: 840 }],
}, { state: { status: "idle", intent: "advice" }, decision: { type: "none", slot: null } }, "en");
assert.deepEqual(recommendation.actions, []);
assert.match(recommendation.response_text, /keep the lunch window/i);
assert.doesNotMatch(recommendation.response_text, /couldn't validate/i);

const weekly = personalizedRecommendationPlan("What would suit me better this week for my phone habits?", {
  ...context,
  weekly_break_count: 2,
  latest_insight: { summary: "Social use rises after lunch" },
  recent_plan_outcomes: [{ outcome: "held", outcome_score: 0.9 }],
});
assert.match(weekly.response_text, /keep your 1:00 PM–2:00 PM blocking window/i);
assert.match(weekly.response_text, /clearest recent signal is that social use rises after lunch/i);
assert.match(weekly.response_text, /1 or fewer breaks/i);
assert.deepEqual(weekly.actions, []);

const latestFailureWins = personalizedRecommendationPlan("What would suit me better this week?", {
  ...context,
  recent_plan_outcomes: [{ outcome: "failed" }, { outcome: "held" }],
});
assert.match(latestFailureWins.response_text, /12:45 PM–2:00 PM|15 minutes earlier/i);
assert.ok(personalizedRecommendationPlan("¿Qué me vendría mejor para esta semana?", context));

const safeView = personalContextView({
  ...context,
  canonical_user_id: "auth-secret",
  anonymous_user_id: "anon-secret",
  assistant_connect_code: "PRIVATE",
  memory: {
    main_apps: ["Instagram"],
    last_topic: "lunch routine",
    user_context: { canonical_user_id: "nested-auth-secret", assistant_connect_code: "NESTED-PRIVATE" },
  },
  latest_insight: { summary: "Lunch scroll", recommendations: ["Protect lunch"], nested: { confidence: 0.82 } },
});
const serializedView = JSON.stringify(safeView);
assert.doesNotMatch(serializedView, /auth-secret|anon-secret|PRIVATE|nested-auth-secret|NESTED-PRIVATE/);
assert.match(serializedView, /Protect lunch/);
assert.match(serializedView, /lunch routine/);
assert.equal(safeView.latest_digital_wellness_insight.nested.confidence, 0.82);

assert.equal(isGrounded("I found it. Move it to 2 PM–3 PM, then tap the Blankmind notification.", {
  actions: [{ type: "update_schedule" }],
  response_contract: { required_phrases: ["2:00 PM–3:00 PM", "Blankmind notification"] },
}, { recent_messages: [] }), true);
assert.equal(isGrounded("I've moved it to 2 PM–3 PM.", {
  actions: [{ type: "update_schedule" }],
  response_contract: { required_phrases: ["2:00 PM–3:00 PM"] },
}, { recent_messages: [] }), false);
assert.equal(isGrounded("A one-time 45-minute block is ready. Tap the Blankmind notification.", {
  actions: [{ type: "start_protection", minutes: 45 }],
  response_contract: { required_phrases: ["Blankmind notification"], required_duration_minutes: 45, required_any_groups: [["one-time", "just once"]] },
}, { recent_messages: [] }), true);
assert.equal(isGrounded("A one-time 30-minute block is ready. Tap the Blankmind notification.", {
  actions: [{ type: "start_protection", minutes: 45 }],
  response_contract: { required_phrases: ["Blankmind notification"], required_duration_minutes: 45, required_any_groups: [["one-time", "just once"]] },
}, { recent_messages: [] }), false);
assert.equal(isGrounded("Instagram is set for a 30-minute block. Is this just once or recurring?", {
  actions: [],
  response_contract: { operation: "semantic_ask_recurrence", required_any_groups: [["once"], ["recurring"]] },
}, { recent_messages: [] }), false);

console.log("BM global context: isolated identity, personal context and schedule CRUD passed");
