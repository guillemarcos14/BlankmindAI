"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { buildAgentContext } = require("../netlify/functions/bm-context");
const { policyForPlan } = require("../netlify/functions/bm-policy");

const ROOT = path.join(__dirname, "..");
const ios = fs.readFileSync(path.join(ROOT, "ios/Blank/Blank/ContentView.swift"), "utf8");
const blankApp = fs.readFileSync(path.join(ROOT, "ios/Blank/Blank/BlankApp.swift"), "utf8");
const home = fs.readFileSync(path.join(ROOT, "ios/Blank/Blank/HomeView.swift"), "utf8");
const sessionStore = fs.readFileSync(path.join(ROOT, "ios/Blank/Blank/SessionStore.swift"), "utf8");
const assistantChannel = fs.readFileSync(path.join(ROOT, "netlify/functions/assistant-channel.js"), "utf8");
const assistantChannelShared = fs.readFileSync(path.join(ROOT, "netlify/functions/_assistant_channel.js"), "utf8");
const bmContext = fs.readFileSync(path.join(ROOT, "netlify/functions/bm-context.js"), "utf8");
const whatsapp = fs.readFileSync(path.join(ROOT, "netlify/functions/whatsapp-agent.js"), "utf8");
const smsAgent = fs.readFileSync(path.join(ROOT, "netlify/functions/sms-agent.js"), "utf8");
const agent = fs.readFileSync(path.join(ROOT, "netlify/functions/blanked-agent.js"), "utf8");
const whatsappModule = require("../netlify/functions/whatsapp-agent");
const { scheduleManagementPlan } = require("../netlify/functions/bm-schedule-management");
const openPage = fs.readFileSync(path.join(ROOT, "web/landing/open.html"), "utf8");
const android = fs.readFileSync(
  path.join(ROOT, "app/src/main/java/com/blanknfc/app/data/DigitalWellnessRemoteStore.kt"),
  "utf8",
);

const failures = [];

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push({ name, error: error.message || String(error) });
    console.error(`FAIL ${name}: ${error.message || error}`);
  }
}

function blockBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing:${startMarker}`);
  assert.ok(end > start, `missing:${endMarker}`);
  return source.slice(start, end);
}

check("ios_pending_action_lifecycle_is_durable", () => {
  const receiptBlock = blockBetween(home, "enum AssistantActionReceiptStore", "struct AssistantActionInboxClient");
  const finishBlock = blockBetween(home, "private func finishPendingAssistantAction", "private var contextualPickerHeaderText");
  assert.match(receiptBlock, /static func save/);
  assert.match(receiptBlock, /static func load/);
  assert.match(finishBlock, /AssistantActionReceiptStore\.save/);
  assert.match(finishBlock, /acknowledgeLifecycle/);
});

check("context_preserves_autonomy_and_native_control_fields", () => {
  const context = buildAgentContext({
    autonomy_consent: true,
    authorized_action_types: ["apply_schedule"],
    autonomy_grant: { active: true, action_types: ["apply_schedule"] },
    device_execution_ready: true,
    selection_count: 3,
  });

  assert.ok(Array.isArray(context.authorized_action_types));
  assert.ok(context.autonomy_grant && context.autonomy_grant.active === true);
  assert.strictEqual(context.selection_count, 3);
  assert.strictEqual(context.single_distraction_block, true);
  assert.strictEqual(context.protection_target, "selected_distractions");
  assert.strictEqual(
    policyForPlan({ actions: [{ type: "apply_schedule" }] }, context).decision,
    "autonomous_execution",
  );
});

check("ios_verification_uses_device_state_not_label_count", () => {
  const reportBlock = blockBetween(home, "private func finishPendingAssistantAction", "private var contextualPickerHeaderText");
  assert.doesNotMatch(
    ios,
    /verified:\s*appliedLabels\.count\s*>=\s*plan\.executableActionCount/,
    "verification cannot be inferred from UI labels");
  assert.match(
    reportBlock,
    /requestedAt:[\s\S]*startedAt:[\s\S]*effectiveUntil:[\s\S]*startDelaySeconds:/,
    "execution reporting must include measured native execution evidence");
});

check("native_clients_close_loop_with_outcome_recorded", () => {
  const reportBlock = blockBetween(home, "private func finishPendingAssistantAction", "private var contextualPickerHeaderText");
  const executionBlock = blockBetween(android, "fun recordExecution(", "private fun startLoop(");
  assert.match(reportBlock, /acknowledgeLifecycle/, "iOS must acknowledge the native lifecycle after execution");
  assert.match(executionBlock, /outcome_recorded/, "Android must send outcome_recorded after execution");
});

check("immediate_protection_does_not_invent_duration", () => {
  assert.match(agent, /const requestedDuration = explicitDurationMinutes\(prompt\);/);
  assert.match(agent, /normalized\.minutes = null/);
  assert.match(agent, /set_daily_limit.*explicitDurationMinutes/);
  const reviewLink = require("../netlify/functions/_bm_action_link").reviewActionLink({ type: "start_protection", minutes: 17 });
  assert.strictEqual(new URL(reviewLink).searchParams.get("action"), "review-action");
  assert.strictEqual(new URL(reviewLink).searchParams.get("minutes"), "17");
  assert.match(whatsapp, /queuePendingAssistantAction/);
  assert.doesNotMatch(whatsapp, /TWILIO_WHATSAPP_REVIEW_TEMPLATE_ENABLED/);
  assert.doesNotMatch(whatsapp, /Review and confirm in Blankmind:\\n/);
  assert.doesNotMatch(whatsapp, /start-focus.*minutes.*30/);
});

check("messaging_actions_wait_for_notification_tap", () => {
  const action={type:"start_protection",minutes:17};
  const plan={actions:[action],message_text:"I'm applying it now. Tap the Blankmind notification."};
  const delivered=whatsappModule.whatsappReplyText(plan,{action,push:{sent:true}});
  assert.match(delivered,/17-minute block.*Tap the Blankmind notification.*apply/);
  assert.match(delivered,/only confirm success after.*verifies/);
  assert.doesNotMatch(delivered,/I'm applying it now/);
  const pending=whatsappModule.whatsappReplyText(plan,{action,push:{sent:false}});
  assert.match(pending,/saved the request.*couldn't send a notification.*Open Blankmind/);
  assert.doesNotMatch(pending,/tap.*notification|I'm applying it now/i);
  assert.doesNotMatch(whatsapp, /I'm applying it now/);
  assert.doesNotMatch(whatsapp, /Open Blankmind to review and apply it/);
  assert.match(assistantChannel, /poll_pending_action/);
  assert.match(assistantChannel, /ack_pending_action/);
  assert.match(assistantChannel, /register_device_push/);
  assert.match(blankApp, /action == "review-action"/);
  assert.match(blankApp, /didReceiveRemoteNotification/);
  assert.match(blankApp, /completionHandler\(\.noData\)/);
  assert.match(sessionStore, /pendingAssistantAction/);
  assert.match(home, /AssistantActionInboxClient/);
  assert.match(home, /confirmPendingAssistantAction\(\)/);
  assert.match(assistantChannel, /execution_started/);
  assert.match(assistantChannel, /last_assistant_action_outcome/);
  assert.match(home, /status:\s*"verified"/);
  assert.match(home, /blankPendingAssistantActionId/);
  assert.match(sessionStore, /func restoreSavedSelectionForAssistant\(appNames: \[String\] = \[\]\)/);
  assert.match(sessionStore, /_ = appNames[\s\S]{0,80}return hasSelectedApps/);
  assert.match(smsAgent, /TWILIO_WHATSAPP_ACTION_CONTENT_SID/);
  assert.match(smsAgent, /whatsappSetupButton/);
  assert.doesNotMatch(whatsapp, /reviewActionLink\(action, apps\)/);
});

check("whatsapp_confirmation_redelivers_existing_action", () => {
  assert.strictEqual(whatsappModule.acceptsPendingActionConfirmation("Yes, apply it"), true);
  assert.strictEqual(whatsappModule.acceptsPendingActionConfirmation("yes"), true);
  assert.strictEqual(whatsappModule.acceptsPendingActionConfirmation("move it one hour later"), false);
  const plan = whatsappModule.pendingActionConfirmationPlan({
    type: "update_schedule",
    summary: "I'll move your 1:00 PM–2:00 PM window to 2:00 PM–3:00 PM every day.",
  });
  assert.strictEqual(plan.actions[0].type, "update_schedule");
  assert.match(plan.message_text, /move your 1:00 PM/);
  assert.match(whatsapp, /isActivePendingAction\(pendingAction\)/);
  assert.match(whatsapp, /deliverPendingAssistantAction\(linkedConnection, pendingAction, pendingMemory\)/);
});

check("schedule_review_preserves_native_permission_preflight", () => {
  const context = {
    schedule: { windows: [{ id: "w1", name: "Lunch", start_minute: 780, end_minute: 840, weekdays: [1, 2, 3, 4, 5, 6, 7] }] },
    recent_messages: [{ role: "user", content: "blocking window" }],
  };
  const plan = scheduleManagementPlan("move the 1:00 PM to 2:00 PM window one hour later", context);
  assert.strictEqual(plan.actions[0].type, "update_schedule");
  assert.strictEqual(plan.requires_screen_time_authorization, false, "preparing a review does not require device permission");
  const policy = blockBetween(home, "private func assistantActionRequiresScreenTime", "private func finishPendingAssistantAction");
  assert.match(policy, /case \.startProtection, \.setDailyLimit, \.allowOnly, \.adultFilter,[\s\S]*?\.applySchedule, \.updateSchedule,[\s\S]*?return true/, "native schedule activation must require permission");
  assert.match(policy, /case \.deleteSchedule, \.deleteAllSchedules, \.pauseRules, \.requestScreenTimePermission:\s*return false/, "removal and permission setup must remain available without authorization");
  const confirmation = blockBetween(home, "private func confirmPendingAssistantAction()", "switch pendingAction");
  assert.match(confirmation, /if assistantActionRequiresScreenTime\(pendingAction\), screenTimeBlocker\.authorizationStatus != \.approved[\s\S]*?await screenTimeBlocker\.requestAuthorization\(\)/, "permission preflight must precede native application");
  assert.match(confirmation, /status: "failed",\s*detail: "screen_time_permission_denied",\s*executionStarted: false/, "denied permission must fail without claiming execution");
});

check("assistant_context_sync_reaches_messaging_identity", () => {
  assert.match(assistantChannel, /action === "sync_context"/);
  assert.match(assistantChannel, /recordAssistantUserContext/);
  assert.match(assistantChannelShared, /assistant_user_context_synced/);
  assert.match(assistantChannelShared, /attachAssistantUserContext/);
  assert.match(assistantChannel, /const connection = await findAssistantConnection\(connectCode, preferredChannel\)/);
  assert.match(bmContext, /single_distraction_block/);
  assert.match(bmContext, /deriveAppPresence/);
  assert.match(bmContext, /app_presence_state/);
  assert.match(assistantChannelShared, /last_seen_at: now/);
  assert.match(ios, /AssistantContextSyncClient/);
  assert.match(home, /BlankmindAppPresence\.payload/);
  assert.match(home, /single_distraction_block/);
  assert.match(home, /assistantContextPayload/);
  assert.match(home, /syncAssistantContext/);
  assert.match(sessionStore, /func restoreSavedSelectionForAssistant/);
});

check("daily_limit_applies_screen_time_state", () => {
  const dailyLimitBlock = blockBetween(blankApp, 'if action == "daily-limit"', 'if action == "pause-rules"');
  assert.match(dailyLimitBlock, /refreshDailyLimitMonitoring\(\)/);
  assert.match(dailyLimitBlock, /applyScreenTimeState\(\)/);
  assert.match(agent, /title: "Daily Limit"/);
  assert.match(agent, /How many minutes per day do you want to allow/);
});

check("adaptive_schedule_appends_windows", () => {
  const scheduleBlock = blockBetween(sessionStore, "func applyAdaptivePlan(", "func applyAIPlan(");
  assert.match(scheduleBlock, /var windows = schedule\.windows/);
  assert.match(scheduleBlock, /windows\.append\(window\)/);
  assert.doesNotMatch(ios, /sessionStore\.schedule\.windows = \[window\]/);
});

check("why_now_layout_preserves_conversational_design", () => {
  const whyNowBlock = blockBetween(home, "private struct RelapseReviewSheet", "private struct RelapseReasonTile");
  assert.match(whyNowBlock, /ZStack\(alignment: \.bottomLeading\)/);
  assert.match(whyNowBlock, /frame\(maxWidth: \.infinity, maxHeight: \.infinity, alignment: \.leading\)/);
  assert.match(whyNowBlock, /VStack\(alignment: \.leading, spacing: -8\)/);
  assert.match(home, /sessionStore\.recordRelapseReview\(reason\)[\s\S]{0,160}sessionStore\.applyAIPlan\(\)/);
});

check("assistant_actions_reuse_canonical_selection_and_ignore_stale_timer", () => {
  assert.match(sessionStore, /func restoreSavedSelectionForAssistant\(appNames: \[String\] = \[\]\)/);
  assert.match(sessionStore, /usePendingWidgetTimer: Bool = true/);
  assert.match(home, /restoreSavedSelectionForAssistant\(appNames: appNames\)/);
  assert.match(home, /applyAssistantProtection/);
  assert.match(sessionStore, /usePendingWidgetTimer: false/);
});

check("review_action_survives_landing_redirect", () => {
  assert.match(openPage, /"review-action"/);
  assert.match(openPage, /Review and confirm in Blankmind/);
  assert.match(openPage, />Review and confirm</);
});

if (failures.length > 0) {
  console.error(`\nBM regression suite failed: ${failures.length}/14 checks`);
  process.exitCode = 1;
} else {
  console.log("\nBM regression suite passed: 14/14 checks");
}
