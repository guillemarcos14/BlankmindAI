"use strict";
const assert = require("node:assert/strict");
const { onboardingReady } = require("../netlify/functions/_onboarding_access");
const { normalizeUserContext } = require("../netlify/functions/bm-context");
const now = Date.parse("2026-10-07T12:00:00Z");
const context = normalizeUserContext({ onboarding_version: 6, screen_time_authorized: true,
  sleep_data_available: true, sleep_data_checked_at: new Date(now).toISOString(),
  has_selected_apps: false, selection_count: 0, notification_authorized: false, device_execution_ready: false });
assert.equal(onboardingReady(context, {}, "app", now), true, "App entry does not require selected apps, push or notifications");
for (const patch of [{ screen_time_authorized: false }, { sleep_data_available: false },
  { sleep_data_available: "true" }, { sleep_data_checked_at: "invalid" },
  { sleep_data_checked_at: new Date(now - 11 * 60_000).toISOString() },
  { sleep_data_checked_at: new Date(now + 60_000).toISOString() }]) {
  assert.equal(onboardingReady({ ...context, ...patch }, {}, "app", now), false);
}
assert.equal(onboardingReady(context, {}, "sms", now), false, "New app gate cannot change external channels");
const legacy = { has_selected_apps: true, selection_count: 2, screen_time_authorized: true, notification_authorized: true };
assert.equal(onboardingReady(legacy, {}, "app", now), false, "Legacy still requires registered push");
assert.equal(onboardingReady(legacy, { assistant_device_push: { token: "fixture" } }, "app", now), true);
assert.equal(onboardingReady(legacy, { assistant_device_push: { token: "fixture" } }, "sms", now), true);
console.log("Onboarding access: versioned app gate, freshness, denial and legacy channel contract passed");

// Exercise the real authenticated endpoint, with only database/identity edges mocked.
const membership = require("../netlify/functions/_membership");
const channel = require("../netlify/functions/_assistant_channel");
const identity = require("../netlify/functions/_identity");
const record = { auth_user_id: "owner", app_install_id: "fixture-install", assistant_connect_code: "ABCDEFGH23" };
let currentContext = { ...context, sleep_data_checked_at: new Date().toISOString() };
membership.getSupabaseUser = async () => ({ id: "owner", app_metadata: { provider: "apple", providers: ["apple"] } });
identity.identityForAuthUser = async () => record;
identity.identityForAppInstall = async id => id === record.app_install_id ? record : null;
channel.findAssistantConnection = async () => ({ channel: "app", channelUser: "owner" });
channel.getAssistantUserContext = async () => currentContext;
channel.getAssistantMemory = async () => ({});
channel.recordAssistantMemory = async () => { throw new Error("App onboarding must not fabricate a message or push token"); };
const { handler } = require("../netlify/functions/assistant-channel");
const request = install => handler({ httpMethod: "POST", headers: { authorization: "Bearer fixture" },
  body: JSON.stringify({ action: "complete_onboarding", channel: "app", preferred_channel: "app",
    connect_code: record.assistant_connect_code, app_install_id: install }) });
(async () => {
  const ready = await request(record.app_install_id);
  assert.equal(ready.statusCode, 200);
  assert.equal(JSON.parse(ready.body).ready, true);
  currentContext.sleep_data_available = false;
  assert.equal(JSON.parse((await request(record.app_install_id)).body).ready, false);
  assert.equal((await request("another-install")).statusCode, 403);
  console.log("Authenticated onboarding endpoint: verified install, usable sleep and absent push passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
