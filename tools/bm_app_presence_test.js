"use strict";

const assert = require("assert");

process.env.OPENAI_API_KEY = "";
process.env.BLANKMIND_APP_DOWNLOAD_URL = "https://apps.apple.com/es/app/blanked/id6789519152";

const { buildAgentContext, deriveAppPresence } = require("../netlify/functions/bm-context");
const { recordAssistantUserContext } = require("../netlify/functions/_assistant_channel");
const { handler } = require("../netlify/functions/blanked-agent");

function request(prompt, context) {
  return handler({
    httpMethod: "POST",
    body: JSON.stringify({ prompt, context }),
  }).then((response) => {
    assert.strictEqual(response.statusCode, 200, response.body);
    return JSON.parse(response.body).plan;
  });
}

async function run() {
  const now = Date.now();
  assert.strictEqual(deriveAppPresence({}).state, "never_seen");
  assert.strictEqual(
    deriveAppPresence({ app_present: true, last_seen_at: new Date(now - 48 * 60 * 60 * 1000).toISOString() }, now).state,
    "stale",
  );
  assert.strictEqual(
    deriveAppPresence({ app_present: true, app_ready: true, last_seen_at: new Date(now - 60 * 60 * 1000).toISOString() }, now).ready,
    true,
  );

  const neverSeen = buildAgentContext({ channel: "whatsapp" });
  assert.strictEqual(neverSeen.app_presence_state, "never_seen");
  assert.strictEqual(neverSeen.app_presence_recent, false);
  assert.strictEqual(neverSeen.app_ready, false);

  const recent = buildAgentContext({
    channel: "whatsapp",
    has_selected_apps: true,
    screen_time_authorized: true,
    app_presence: {
      app_present: true,
      app_ready: true,
      last_seen_at: new Date(now - 60 * 60 * 1000).toISOString(),
    },
  });
  assert.strictEqual(recent.app_presence_state, "recently_seen");
  assert.strictEqual(recent.app_presence_recent, true);
  assert.strictEqual(recent.app_ready, true);

  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  const originalFetch = global.fetch;
  let syncedRow = null;
  global.fetch = async (target, options = {}) => {
    if (String(target).startsWith("https://supabase.test/rest/v1/digital_wellness_feature_payloads")) {
      syncedRow = JSON.parse(options.body || "{}");
      return { ok: true, status: 201, text: async () => "", json: async () => ({}) };
    }
    return originalFetch(target, options);
  };
  try {
    await recordAssistantUserContext({
      connectCode: "ABC123",
      channel: "whatsapp",
      context: {
        app_presence: {
          app_present: true,
          app_ready: true,
          last_seen_at: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
        },
      },
    });
  } finally {
    global.fetch = originalFetch;
  }
  const serverSeenAt = syncedRow?.payload?.properties?.context?.app_presence?.last_seen_at;
  assert.ok(serverSeenAt && Date.now() - Date.parse(serverSeenAt) < 5000);
  assert.strictEqual(syncedRow.payload.properties.context.app_presence.source, "assistant_context_sync");

  async function authorizedActivation(context) {
    return request("Block Instagram from 22:00 to 23:00 every day for 7 days", context);
  }

  const installGuidance = await authorizedActivation({ channel: "whatsapp" });
  assert.deepStrictEqual(installGuidance.actions.map((item) => item.type), ["apply_schedule"]);
  assert.strictEqual(installGuidance.semantic_state.status, "needs_setup");
  assert.strictEqual(installGuidance.semantic_state.next_question, "app_presence");
  assert.match(installGuidance.message_text, /Blankmind/);
  assert.match(installGuidance.message_text, /review|apply/i);
  assert.doesNotMatch(installGuidance.message_text, /apps\.apple\.com|download|descarga/i);
  assert.strictEqual(installGuidance.review_only_actions, true);

  const incompleteRequest = await request("Block Instagram", { channel: "whatsapp" });
  assert.deepStrictEqual(incompleteRequest.actions, []);
  assert.strictEqual(incompleteRequest.semantic_state.next_question, "start");
  assert.doesNotMatch(incompleteRequest.message_text, /apps\.apple\.com|download|descarga/i);

  const staleGuidance = await authorizedActivation({
    channel: "sms",
    app_presence: { app_present: true, app_ready: true, last_seen_at: new Date(now - 48 * 60 * 60 * 1000).toISOString() },
  });
  assert.deepStrictEqual(staleGuidance.actions.map((item) => item.type), ["apply_schedule"]);
  assert.strictEqual(staleGuidance.semantic_state.next_question, "app_presence");
  assert.doesNotMatch(staleGuidance.message_text, /apps\.apple\.com|download|descarga/i);

  const recentContext = {
    channel: "whatsapp", has_selected_apps: true, selected_app_names: ["Instagram"], screen_time_authorized: true,
    app_presence: { app_present: true, app_ready: true, last_seen_at: new Date(now - 60 * 60 * 1000).toISOString() },
  };
  const recentPlan = await authorizedActivation(recentContext);
  assert.deepStrictEqual(recentPlan.actions.map((item) => item.type), ["apply_schedule"]);
  assert.strictEqual(recentPlan.actions[0].start_minute, 1320);
  assert.strictEqual(recentPlan.actions[0].end_minute, 1380);
  assert.doesNotMatch(recentPlan.message_text, /apps\.apple\.com|download it here|descárgala aquí/);

  // A spoken installation claim is not a heartbeat or a new executable order.
  // Keep the original review envelope: replacing it could replay a plan that
  // the native device applied before its presence/receipt reached the server.
  const installedContinuation = await request("Done", {
    channel: "whatsapp", semantic_state: installGuidance.semantic_state,
  });
  assert.deepStrictEqual(installedContinuation.actions, []);
  assert.deepStrictEqual(installedContinuation.semantic_state.delivery, installGuidance.semantic_state.delivery);
  assert.strictEqual(installedContinuation.semantic_state.next_question, "app_presence");
  assert.match(installedContinuation.message_text, /already prepared/i);
  assert.match(installedContinuation.message_text, /22:00.*23:00.*7 days/i);
  assert.doesNotMatch(installedContinuation.message_text, /has been applied|is active|notification/i);

  const repeatedInstallClaim = await request("It’s already opened", {
    channel: "whatsapp", semantic_state: installedContinuation.semantic_state,
  });
  assert.deepStrictEqual(repeatedInstallClaim.actions, []);
  assert.strictEqual(repeatedInstallClaim.semantic_state.next_question, "app_presence");
  assert.deepStrictEqual(repeatedInstallClaim.semantic_state.delivery, installGuidance.semantic_state.delivery);
  assert.match(repeatedInstallClaim.message_text, /already prepared/i);

  const heartbeatContinuation = await request("Ready", {
    ...recentContext, semantic_state: repeatedInstallClaim.semantic_state,
  });
  assert.deepStrictEqual(heartbeatContinuation.actions, []);
  assert.strictEqual(heartbeatContinuation.semantic_state.status, "ready");
  assert.deepStrictEqual(heartbeatContinuation.semantic_state.delivery, installGuidance.semantic_state.delivery);

  // Legacy conversation prose can restore requested facts, never authorization
  // or a native receipt. Confirm only after presenting the migrated proposal.
  const migratedHistory = await request("Done", {
    ...recentContext,
    recent_messages: [
      { role: "user", content: "Block Instagram from 22:00 to 23:00 every day for 7 days" },
      { role: "assistant", content: "Applied successfully; protection is active." },
    ],
  });
  assert.deepStrictEqual(migratedHistory.actions, []);
  assert.strictEqual(migratedHistory.semantic_state.next_question, "confirmation");
  assert.strictEqual(migratedHistory.semantic_state.slots.confirmation, null);
  assert.strictEqual(migratedHistory.semantic_state.delivery, null);
  assert.match(migratedHistory.message_text, /22:00.*23:00.*7 days/i);
  assert.doesNotMatch(migratedHistory.message_text, /applied successfully|is active/i);
  const newlyAuthorized = await request("Yes", {
    ...recentContext, semantic_state: migratedHistory.semantic_state,
  });
  assert.deepStrictEqual(newlyAuthorized.actions.map((item) => item.type), ["apply_schedule"]);
  assert.strictEqual(newlyAuthorized.actions[0].start_minute, 1320);
  assert.strictEqual(newlyAuthorized.actions[0].end_minute, 1380);

  const permissionGuidance = await authorizedActivation({ ...recentContext, screen_time_authorized: false });
  assert.deepStrictEqual(permissionGuidance.actions.map((item) => item.type), ["request_screen_time_permission"]);
  assert.strictEqual(permissionGuidance.semantic_state.next_question, "permissions");

  const smallTalk = await request("Hey", { channel: "whatsapp" });
  assert.doesNotMatch(smallTalk.message_text, /apps\.apple\.com|download|descarga/i);

  console.log("BM app presence tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
