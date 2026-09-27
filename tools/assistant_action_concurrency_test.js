"use strict";
const assert = require("node:assert/strict");
process.env.BM_SEMANTIC_PERSISTENCE = "required";
delete process.env.URL;
const membership = require("../netlify/functions/_membership");
const push = require("../netlify/functions/_assistant_push");
let version = 3;
let writes = 0;
let pushes = 0;
let legacyWrites = 0;
let pending = { id: "app_latest", type: "start_protection", minutes: 45 };
let advanceBeforeEnqueue = false;
const calls = [];
membership.supabaseFetch = async (path, options) => {
  const body = JSON.parse(options.body);
  calls.push({ path, body });
  if (path === "rpc/enqueue_assistant_channel_action") {
    if (advanceBeforeEnqueue) { version += 1; advanceBeforeEnqueue = false; }
    if (body.p_expected_version !== version) return [{ enqueued: false, status: "superseded" }];
    pending = body.p_action;
    writes += 1;
    return [{ enqueued: true, status: pending ? "queued" : "invalidated" }];
  }
  if (path === "digital_wellness_feature_payloads") { legacyWrites += 1; return []; }
  throw new Error(`Unexpected RPC ${path}`);
};
// Reload to bind the RPC stub without replacing the implementation under test.
const guarded = require("../netlify/functions/_assistant_channel");
guarded.getAssistantMemory = async () => ({ semantic_store_version: version, pending_assistant_action: pending });
guarded.recordAssistantMemory = async () => {};
push.sendAssistantActionPush = async () => { pushes += 1; return { sent: true }; };
const wa = require("../netlify/functions/whatsapp-agent");
const sms = require("../netlify/functions/sms-agent");
const connection = { channel: "whatsapp", channelUser: "+15555550101", connectCode: "ABCDEFGH23" };
const plan = { message_text: "Ready", response_language: "en", actions: [{ type: "start_protection", minutes: 5 }] };

(async () => {
  for (const queue of [
    () => wa.queuePendingAssistantAction(connection, plan, "Focus", "wa", null, 2),
    () => sms.queuePendingAssistantAction(connection, plan, [], 2),
    () => sms.queuePendingAssistantAction({ ...connection, channel: "sms" }, plan, [], 2),
  ]) {
    const result = await queue();
    assert.equal((result.action || result).status, "superseded");
    assert.equal(pending.id, "app_latest", "a late provider turn overwrote the latest app action");
  }
  const clear = () => guarded.recordPendingAssistantAction({ ...connection, pending: null, expectedVersion: 2 });
  assert.equal((await clear()).status, "superseded");
  assert.equal(pending.id, "app_latest", "a late cancellation cleared the app action");
  pending = null; // The latest app turn cancelled its action.
  await wa.queuePendingAssistantAction(connection, plan, "Focus", "wa", null, 2);
  assert.equal(pending, null, "a late provider turn revived an app cancellation");
  assert.equal(writes, 0);
  assert.equal(pushes, 0);
  assert.equal(legacyWrites, 0);
  assert.doesNotMatch(wa.whatsappReplyText(plan, { action: { status: "superseded" } }), /tap|notification|saved/i);

  // Memory may advance after the JS read: only the SQL guard may authorize a write.
  advanceBeforeEnqueue = true;
  const raced = await wa.queuePendingAssistantAction(connection, plan, "Focus", "wa", null, 3);
  assert.equal(raced.action.status, "superseded");
  assert.equal(pending, null);
  assert.equal(writes, 0);
  const accepted = await wa.queuePendingAssistantAction(connection, plan, "Focus", "wa", null, 4);
  assert.equal(accepted.action.minutes, 5);
  assert.equal(writes, 1);
  assert.equal(pushes, 1);
  assert.equal((await guarded.recordPendingAssistantAction({ ...connection, pending: null, expectedVersion: 4 })).status, "invalidated");
  assert.equal(pending, null);
  await assert.rejects(() => guarded.recordPendingAssistantAction({ ...connection, pending: null }), /missing_semantic_version/);

  process.env.BM_SEMANTIC_PERSISTENCE = "legacy";
  assert.equal((await guarded.recordPendingAssistantAction({ ...connection, pending: null })).status, "invalidated");
  assert.equal(legacyWrites, 1, "explicit legacy compatibility was removed");
  assert(calls.filter((call) => call.path.includes("rpc/")).every((call) => Number.isInteger(call.body.p_expected_version)));
  console.log("Action concurrency: late WA/SMS enqueue and cancellation cannot overwrite newer app state; SQL guard, no stale pushes and explicit legacy compatibility passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
