"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { normalizePendingAction, pendingActionTransition, normalizeExecutionEvidence } = require("../netlify/functions/assistant-channel");

const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

function action(overrides = {}) {
  return {
    id: "action-1",
    type: "start_protection",
    name: "Instagram",
    minutes: 18,
    hard_mode: true,
    app_names: ["Instagram"],
    status: "queued",
    created_at: new Date().toISOString(),
    expires_at: future,
    ...overrides,
  };
}

function assertTransition(current, requested, expected) {
  const result = pendingActionTransition(current, requested);
  assert.equal(result.allowed, expected, `${current} -> ${requested}`);
  return result;
}

assertTransition("queued", "delivered", true);
assertTransition("delivered", "confirmed", true);
assertTransition("confirmed", "execution_started", true);
assertTransition("execution_started", "verified", true);
assertTransition("execution_started", "delayed", true);
assertTransition("execution_started", "failed", true);
assertTransition("delivered", "dismissed", true);
assertTransition("delivered", "verified", false);
assertTransition("verified", "failed", false);
assert.equal(assertTransition("execution_started", "confirmed", true).idempotent, true, "retrying an earlier stage must be safe");
assert.equal(assertTransition("verified", "verified", true).idempotent, true, "terminal retries must be safe");

const immediate = normalizePendingAction(action());
assert.equal(immediate.minutes, 18);
assert.equal(immediate.hard_mode, true);
assert.deepEqual(immediate.app_names, ["Instagram"]);
assert.equal(immediate.requested_at, immediate.created_at);

const evidence = normalizeExecutionEvidence({
  action_id: immediate.id,
  origin: "assistant_remote",
  requested_at: immediate.requested_at,
  started_at: new Date().toISOString(),
  requested_duration_minutes: immediate.minutes,
  effective_until: future,
  result: "merged_without_shortening_existing_protection",
  start_delay_seconds: 74,
  merged_with_existing: true,
}, immediate);
assert.equal(evidence.valid, true, "exact action identity, request time and duration must verify");
assert.equal(evidence.merged_with_existing, true);
assert.equal(normalizeExecutionEvidence({ ...evidence, action_id: "another-action" }, immediate).valid, false, "another active block must not verify this action");

const schedule = normalizePendingAction(action({
  id: "schedule-1",
  type: "apply_schedule",
  name: "Instagram evenings",
  minutes: null,
  start_minute: 1230,
  end_minute: 1320,
  weekdays: [1, 3, 5],
  duration_days: 11,
}));
assert.equal(schedule.copy_mode, undefined);
assert.equal(schedule.source_mode_name, undefined);
assert.equal(schedule.start_minute, 1230);
assert.equal(schedule.end_minute, 1320);
assert.deepEqual(schedule.weekdays, [1, 3, 5]);
assert.equal(schedule.duration_days, 11);

const dailyLimit = normalizePendingAction(action({
  id: "daily-1",
  type: "set_daily_limit",
  name: "Daily Limit",
  minutes: 25,
}));
assert.equal(dailyLimit.minutes, 25);
assert.deepEqual(dailyLimit.app_names, ["Instagram"]);

assert.equal(normalizePendingAction(action({ expires_at: new Date(Date.now() - 1).toISOString() })), null);

const root = path.resolve(__dirname, "..");
const home = fs.readFileSync(path.join(root, "ios", "Blank", "Blank", "HomeView.swift"), "utf8");
const app = fs.readFileSync(path.join(root, "ios", "Blank", "Blank", "BlankApp.swift"), "utf8");
const channel = fs.readFileSync(path.join(root, "netlify", "functions", "assistant-channel.js"), "utf8");

assert.match(home, /AssistantActionReceiptStore\.save/, "foreground outcomes must survive relaunch until acknowledged");
assert.match(home, /AssistantActionReceiptStore\.load/, "foreground must retry an unacknowledged outcome before polling again");
assert.match(home, /acknowledgeLifecycle/, "foreground lifecycle delivery must be retryable");
assert.match(home, /screen_time_permission_denied/, "permission denial must end explicitly");
const pickerStart = home.indexOf(".onChange(of: showingContextualAppPicker)");
const pickerEnd = home.indexOf(".fullScreenCover", pickerStart);
assert.ok(pickerStart >= 0 && pickerEnd > pickerStart, "native picker outcome handler must exist");
const pickerOutcome = home.slice(pickerStart, pickerEnd);
assert.match(pickerOutcome, /refreshAuthorizationStatus\(\)[\s\S]*?let permissionApproved = screenTimeBlocker\.authorizationStatus == \.approved[\s\S]*?let selectionConfirmed = permissionApproved &&[\s\S]*?if selectionConfirmed \{\s*sessionStore\.selection =/, "permission must be refreshed and approved before selection can mutate native state");
assert.match(pickerOutcome, /assistantActionApplied \? "verified" : \(!permissionApproved \|\| selectionConfirmed \? "failed" : "dismissed"\)/, "denied permission and native registration failure are failed; ordinary picker cancellation is dismissed; only applied state is verified");
assert.match(pickerOutcome, /!permissionApproved \? "screen_time_permission_denied" : \(assistantActionApplied \? "native_state_applied_after_selection" : \(selectionConfirmed \? "device_activity_registration_failed" : "app_selection_cancelled"\)\)/, "each picker terminal status must preserve its distinct reason");
assert.match(pickerOutcome, /executionStarted: selectionConfirmed/, "permission denial and picker cancellation must not claim execution started");
assert.match(app, /completionHandler\(\.noData\)/, "silent pushes must never execute a pending action");
assert.doesNotMatch(app, /AssistantBackgroundActionRunner/, "background execution is removed from the tap-gated flow");
assert.match(channel, /action_expired_before_execution/, "expired actions must have an explicit terminal outcome");
assert.match(channel, /invalid_execution_evidence/, "generic active state must not verify an exact immediate action");
assert.match(channel, /Cancelled\. Nothing was changed on the iPhone\./, "dismissal must be reported accurately");

console.log("bm_thursday_reliability_test passed: lifecycle, retries, expiry, permission, selection and action variants");
