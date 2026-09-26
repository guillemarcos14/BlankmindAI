"use strict";

const assert = require("node:assert/strict");
const membership = require("../netlify/functions/_membership");
const channel = require("../netlify/functions/_assistant_channel");
const identity = require("../netlify/functions/_identity");
const turnId = "11111111-1111-4111-8111-111111111111";
const actionId = `app_${turnId}`;
const owner = { auth_user_id: "owner-1", app_install_id: "install-1", assistant_connect_code: "ABCDEFGH23", phone_e164: "+15555550101" };
let memory;
let linked = owner;
let failWrite = false;
let foreignRow = false;
let receipt = null;
const operations = [];
channel.findAssistantConnection = async () => ({ channel: "whatsapp", channelUser: "+15555550101" });
channel.getAssistantMemory = async () => structuredClone(memory);
channel.recordAssistantMemory = async ({ memory: patch }) => {
  operations.push("memory");
  Object.assign(memory, structuredClone(patch));
};
channel.transitionPendingAssistantAction = async ({ pending: next, outcome }) => {
  await channel.recordAssistantMemory({ memory: { pending_assistant_action: next, ...(outcome ? { last_assistant_action_outcome: outcome } : {}) } });
  return { updated: true, status: "updated" };
};
channel.sendAssistantMessage = async () => { throw new Error("App receipt must not send a WhatsApp message"); };
identity.identityForPhone = async (phone) => {
  assert.equal(phone, "+15555550101", "receipt owner comes from resolved connection, not supplied user phone");
  return linked;
};
identity.identityForAppInstall = async () => linked;
membership.supabaseFetch = async (path, options) => {
  operations.push("receipt");
  const params = new URLSearchParams(path.split("?")[1]);
  assert.ok(path.startsWith("assistant_app_turns?"));
  assert.equal(options.method, "PATCH");
  assert.equal(params.get("id"), `eq.${turnId}`);
  assert.equal(params.get("auth_user_id"), `eq.${owner.auth_user_id}`);
  assert.equal(params.get("action_id"), `eq.${actionId}`);
  if (failWrite) throw new Error("storage unavailable");
  if (foreignRow) return [];
  receipt = JSON.parse(options.body).action_status;
  return [{ id: turnId, action_status: receipt }];
};
const { handler } = require("../netlify/functions/assistant-channel");
const pending = () => ({ id: actionId, type: "delete_schedule", window_id: "window-1", status: "execution_started",
  expires_at: new Date(Date.now() + 60_000).toISOString() });
const request = (fields = {}) => handler({ httpMethod: "POST", body: JSON.stringify({
  action: "ack_pending_action", action_id: actionId, status: "verified", channel: "whatsapp",
  connect_code: owner.assistant_connect_code, app_install_id: owner.app_install_id, ...fields,
}) });

(async () => {
  memory = { pending_assistant_action: pending() };
  let response = await request();
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(receipt, "verified", "native acknowledgement persists even if app never polls its turn");
  assert.deepEqual(operations, ["receipt", "memory"], "durable receipt precedes clearing the pending action");
  memory.last_assistant_action_outcome = { id: "new-whatsapp-action", status: "failed" };
  assert.equal(receipt, "verified", "a later channel outcome cannot erase app history");

  for (const status of ["failed", "dismissed", "delayed"]) {
    memory = { pending_assistant_action: { ...pending(), status: status === "dismissed" ? "delivered" : "execution_started" } };
    receipt = null;
    const terminalResponse = await request({ status, ...(status === "delayed" ? { start_delay_seconds: 61 } : {}) });
    assert.equal(terminalResponse.statusCode, 200, terminalResponse.body);
    assert.equal(JSON.parse(terminalResponse.body).acknowledged, true);
    assert.equal(receipt, status);
  }

  memory = { pending_assistant_action: pending() };
  failWrite = true;
  response = await request();
  assert.equal(response.statusCode, 500);
  assert.equal(memory.pending_assistant_action.id, actionId, "write failure leaves the device receipt retryable");
  failWrite = false;
  assert.equal((await request()).statusCode, 200);

  for (const [mismatched, expectedStatus] of [[{ ...owner, auth_user_id: "" }, 500], [{ ...owner, assistant_connect_code: "ZZZZZZZZ99" }, 400], [{ ...owner, app_install_id: "someone-else" }, 500]]) {
    linked = mismatched;
    memory = { pending_assistant_action: pending() };
    const count = operations.length;
    assert.equal((await request()).statusCode, expectedStatus);
    assert.equal(operations.length, count, "identity mismatch performs neither receipt nor memory writes");
  }
  linked = owner;
  foreignRow = true;
  assert.equal((await request()).statusCode, 500);
  assert.equal(memory.pending_assistant_action.id, actionId, "owner-scoped zero rows cannot claim acknowledgement");
  foreignRow = false;

  memory = { pending_assistant_action: { ...pending(), expires_at: "2020-01-01T00:00:00Z" } };
  assert.equal((await request({ action: "poll_pending_action" })).statusCode, 200);
  assert.equal(receipt, "expired");

  memory = { pending_assistant_action: { ...pending(), id: "wa_legacy" } };
  channel.sendAssistantMessage = async () => ({ delivered: true });
  const receiptWrites = operations.filter((operation) => operation === "receipt").length;
  assert.equal((await request({ action_id: "wa_legacy", status: "failed" })).statusCode, 200);
  assert.equal(operations.filter((operation) => operation === "receipt").length, receiptWrites, "legacy channel IDs never touch app turns");
  console.log("App native receipts: durable before channel advancement, account/action scoped, retryable on write failure and legacy compatible");
})().catch((error) => { console.error(error); process.exitCode = 1; });
