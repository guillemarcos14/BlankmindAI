"use strict";

const assert = require("node:assert/strict");
process.env.OPENAI_API_KEY = "";
process.env.BM_SEMANTIC_PERSISTENCE = "legacy";
process.env.BLANKED_PUBLIC_APP_LINK_BASE = "https://getblank.netlify.app";

const channel = require("../netlify/functions/_assistant_channel");
let memory;
let pushSent = false;
require("../netlify/functions/_assistant_push").sendAssistantActionPush = async () => ({sent:pushSent,reason:pushSent ? undefined : "missing_device_token"});

const directConnection = channel.connectionForChannelUser([
  {
    payload: {
      properties: {
        channel: "whatsapp",
        channel_user: "whatsapp:+34000000000",
        connect_code: "ABC123",
      },
    },
  },
], "whatsapp", "whatsapp:+34000000000");
assert.deepStrictEqual(directConnection, {
  channel: "whatsapp",
  channelUser: "whatsapp:+34000000000",
  connectCode: "ABC123",
}, "An existing channel connection must remain usable even when phone identity lookup has no row");
assert.match(
  channel.assistantConnectionPath("ABC123"),
  /payload->properties->>channel_user=not\.is\.null/,
  "Connection lookup must exclude context-only events before applying its row limit"
);

function reset() {
  memory = {
    user_context: {
      has_selected_apps: true,
      selected_app_names: ["Instagram"],
      screen_time_authorized: true,
      device_execution_ready: true,
      app_presence: { app_present: true, app_ready: true, last_seen_at: new Date().toISOString() },
    },
  };
}

channel.getAssistantMemory = async () => structuredClone(memory);
channel.ensureAssistantConnectionForPhone = async ({ channel: name, channelUser }) => ({
  channel: name,
  channelUser,
  connectCode: "ABC123",
  appInstallId: "install-sms",
});
channel.recordAssistantMemory = async ({ memory: patch }) => { memory = { ...memory, ...patch }; };
channel.recordPendingAssistantAction = async ({ pending }) => {
  memory.pending_assistant_action = pending;
  return { enqueued: true, status: pending ? "queued" : "invalidated" };
};
channel.recordAssistantConversationTurn = async ({ semanticState, userMessage, assistantMessage }) => {
  memory.conversation_state = {
    semantic_state: semanticState,
    updated_at: new Date().toISOString(),
    recent_messages: [{ role: "user", content: userMessage }, { role: "assistant", content: assistantMessage }],
  };
};

const { handler } = require("../netlify/functions/sms-agent");

async function send(input) {
  return handler({ httpMethod: "POST", body: new URLSearchParams({ From: "+34000000000", Body: input }).toString() });
}

async function prepare() {
  reset();
  const response = await send("Block Instagram now for 18 minutes, once.");
  assert.match(response.body, /Block your selected distractions.*18 minutes/i);
  assert.match(response.body, /couldn(?:'|&apos;)t send a notification/i);
  assert.match(response.body, /Open Blankmind/i);
  assert.doesNotMatch(response.body, /Reply BLOCK|Tap.*notification|review-action/i);
  const acknowledgment = await send("Yes");
  assert.match(acknowledgment.body, /18 minutes/);
  assert.match(acknowledgment.body, /already prepared.*Check its result in Blankmind/);
  assert.doesNotMatch(acknowledgment.body, /Tap.*notification|review-action/i);
  assert.equal(memory.pending_assistant_action.type, "start_protection");
  assert.equal(memory.pending_assistant_action.minutes, 18);
  assert.deepStrictEqual(memory.pending_assistant_action.app_names, []);
}

async function run() {
  await prepare();
  const firstId = memory.pending_assistant_action.id;
  const open = await send("OPEN");
  assert.doesNotMatch(open.body, /review-action|minutes=18|Reply BLOCK/i, "OPEN must not expose a stale executable link");
  assert.equal(memory.pending_assistant_action.id, firstId, "A non-blocking follow-up must not replace the queued command");

  await prepare();
  await send("Actually make it 22 minutes.");
  assert.equal(memory.pending_assistant_action.type, "start_protection", "An explicit correction becomes the new authorized command");
  assert.equal(memory.pending_assistant_action.minutes, 22);

  await prepare();
  await send("Cancel that block.");
  assert.equal(memory.pending_assistant_action, null, "Cancellation must invalidate the queued command");

  reset();
  memory.user_context.screen_time_authorized=false;
  const permission=await send("Set a 35-minute daily limit for selected apps now.");
  assert.match(permission.body,/35 minutes per day/);
  assert.match(permission.body,/grant blocking permission.*tell me/);
  assert.doesNotMatch(permission.body,/choose|Tap.*notification/i);
  assert.equal(memory.pending_assistant_action.type,"request_screen_time_permission");

  reset(); pushSent=true;
  const delivered=await send("Block selected apps now for 18 minutes, once.");
  assert.match(delivered.body,/Tap the Blankmind notification/);
  assert.match(delivered.body,/Block your selected distractions.*18 minutes/);
  assert.doesNotMatch(delivered.body,/couldn(?:'|&apos;)t send/);
  assert.equal(Object.hasOwn(memory.pending_assistant_action,"push"),false,"delivery receipts stay out of durable action payloads");
  pushSent=false;

  await prepare();
  memory.pending_assistant_action.expires_at = new Date(Date.now() - 1).toISOString();
  const { normalizePendingAction } = require("../netlify/functions/assistant-channel");
  assert.equal(normalizePendingAction(memory.pending_assistant_action), null, "Expired commands must never execute");

  console.log("SMS pending action tests passed: autonomous queue, no review link, correction/cancellation and expiry");
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
