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
