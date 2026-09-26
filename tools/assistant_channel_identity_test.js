"use strict";

const assert = require("node:assert/strict");
const channel = require("../netlify/functions/_assistant_channel");
const identity = require("../netlify/functions/_identity");
const counters = { install: 0, phone: 0, connection: 0, memory: 0, write: 0 };
const record = { app_install_id: "install-1", assistant_connect_code: "ABCDEFGH23", phone_e164: "+15555550101" };
let installed = record;
let channelPhone = record.phone_e164;
identity.identityForAppInstall = async () => { counters.install += 1; return installed; };
identity.identityForPhone = async () => { counters.phone += 1; throw new Error("A phone must not resolve an inbox credential"); };
channel.findAssistantConnection = async (code) => {
  counters.connection += 1;
  assert.equal(code, record.assistant_connect_code);
  return { channel: "whatsapp", channelUser: channelPhone };
};
channel.getAssistantMemory = async () => { counters.memory += 1; return {}; };
channel.recordAssistantMemory = async () => { counters.write += 1; };
const { handler } = require("../netlify/functions/assistant-channel");
const request = (body) => handler({ httpMethod: "POST", body: JSON.stringify({ channel: "whatsapp", ...body }) });
const snapshot = () => ({ ...counters });

(async () => {
  for (const action of ["poll_pending_action", "ack_pending_action", "register_device_push", "connection_status", "complete_onboarding"]) {
    const before = snapshot();
    const response = await request({ action, user_phone: record.phone_e164, action_id: "wa_private", status: "failed" });
    assert.equal(response.statusCode, 400, action);
    assert.deepEqual(counters, before, `${action}: phone-only request must not look up identity, read inbox or mutate anything`);
  }

  assert.equal((await request({ action: "poll_pending_action", connect_code: record.assistant_connect_code })).statusCode, 200, "legacy CONNECT clients stay supported");
  assert.equal((await request({ action: "poll_pending_action", app_install_id: record.app_install_id })).statusCode, 200, "linked install can recover its own connection");
  assert.equal((await request({ action: "poll_pending_action", connect_code: record.assistant_connect_code, app_install_id: record.app_install_id, user_phone: "whatsapp:+1 (555) 555-0101" })).statusCode, 200);
  channelPhone = record.phone_e164.slice(1);
  assert.equal((await request({ action: "poll_pending_action", app_install_id: record.app_install_id, user_phone: record.phone_e164 })).statusCode, 200, "Meta's digit-only sender matches the account's E.164 phone");
  channelPhone = record.phone_e164;

  const beforeWrongCode = counters.memory;
  const conflict = await request({ action: "poll_pending_action", connect_code: "ZZZZZZZZ99", app_install_id: record.app_install_id });
  assert.equal(conflict.statusCode, 400);
  assert.equal(JSON.parse(conflict.body).error, "assistant_identity_conflict");
  assert.equal(counters.memory, beforeWrongCode);
  const wrongPhone = await request({ action: "poll_pending_action", connect_code: record.assistant_connect_code, user_phone: "+15555550202" });
  assert.equal(wrongPhone.statusCode, 400);
  assert.equal(counters.memory, beforeWrongCode);

  installed = { ...record, phone_e164: "+15555550202" };
  assert.equal((await request({ action: "poll_pending_action", app_install_id: record.app_install_id })).statusCode, 400);
  assert.equal(counters.memory, beforeWrongCode);
  installed = null;
  const unknown = await request({ action: "poll_pending_action", app_install_id: "unknown", user_phone: record.phone_e164 });
  assert.equal(unknown.statusCode, 400, "unknown install cannot fall back to a phone");
  assert.equal(counters.memory, beforeWrongCode);
  assert.equal((await request({ action: "poll_pending_action", connect_code: record.assistant_connect_code, app_install_id: "old-unclaimed-install" })).statusCode, 200, "an existing CONNECT credential remains valid before account migration");
  assert.equal(counters.phone, 0);
  assert.equal(counters.write, 0);
  console.log("Assistant inbox identity: phone-only requests rejected before lookup; linked identity consistency and legacy CONNECT compatibility passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
