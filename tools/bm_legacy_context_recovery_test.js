"use strict";

const assert = require("node:assert/strict");
const originalFetch = global.fetch;
const originalEnvironment = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
process.env.SUPABASE_URL = "https://context-recovery.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";

const requests = [];
const identities = new Map();
const legacySnapshots = new Map();
const accountSnapshots = new Map();
let identityFailure = false;
let rpcFailure = false;
global.fetch = async (input, options = {}) => {
  const url = new URL(input);
  const resource = url.pathname.replace("/rest/v1/", "");
  const body = options.body ? JSON.parse(options.body) : null;
  requests.push({ resource, body, search: url.search });
  let rows = [];
  let status = 200;
  if (resource === "blankmind_identity_links") {
    const code = url.searchParams.get("assistant_connect_code").slice(3);
    if (identityFailure) { status = 503; rows = { message: "identity unavailable" }; }
    else rows = identities.has(code) ? [identities.get(code)] : [];
  } else if (resource.startsWith("rpc/upsert_bm_")) {
    if (rpcFailure) { status = 503; rows = { message: "snapshot unavailable" }; }
    else {
      const identity = identities.get(body.p_connect_code);
      const snapshots = resource.includes("legacy") ? legacySnapshots : accountSnapshots;
      const key = resource.includes("legacy") ? body.p_connect_code : identity.auth_user_id;
      snapshots.set(key, { context: body.p_context, context_version: 1 });
      rows = [{ context_version: 1 }];
    }
  } else if (resource === "bm_legacy_context_snapshots") {
    const code = url.searchParams.get("connect_code").slice(3);
    rows = legacySnapshots.has(code) ? [legacySnapshots.get(code)] : [];
  } else if (resource === "bm_user_context_snapshots") {
    const user = url.searchParams.get("user_id").slice(3);
    rows = accountSnapshots.has(user) ? [accountSnapshots.get(user)] : [];
  }
  return { ok: status === 200, status, text: async () => JSON.stringify(rows) };
};

const context = require("../netlify/functions/_bm_user_context");
const channelModulePath = require.resolve("../netlify/functions/_assistant_channel");
const channelExports = require(channelModulePath);
let channelMemory = {};
let previousContext = {};
const memoryWrites = [];
require.cache[channelModulePath].exports = {
  ...channelExports,
  getAssistantUserContext: async () => previousContext,
  recordAssistantUserContext: async ({ context: input }) => input,
  findAssistantConnection: async () => ({ channel: "whatsapp", channelUser: "+15555550101" }),
  getAssistantMemory: async () => channelMemory,
  transitionPendingAssistantAction: async ({ channel, channelUser, pending, outcome, source }) => {
    const memory = { pending_assistant_action: pending, ...(outcome ? { last_assistant_action_outcome: outcome } : {}) };
    memoryWrites.push({ channel, channelUser, memory, source });
    channelMemory = { ...channelMemory, ...memory };
    return { updated: true, status: "updated" };
  },
  recordAssistantMemory: async (write) => {
    memoryWrites.push(write);
    channelMemory = { ...channelMemory, ...write.memory };
  },
};
const endpoint = require("../netlify/functions/assistant-channel");

async function sync(input) {
  return endpoint.handler({ httpMethod: "POST", body: JSON.stringify({
    action: "sync_context", connect_code: "LEGACY01", channel: "whatsapp", context: input,
  }) });
}

async function main() {
  const legacy = { anonymous_user_id: "anon-legacy", context_revision: 4, schedule: { enabled: false, windows: [] } };
  await context.persistCanonicalSnapshot("legacy01", legacy);
  assert.equal(requests.at(-1).resource, "rpc/upsert_bm_legacy_user_context");
  assert.equal(requests.at(-1).body.p_connect_code, "LEGACY01");
  const enriched = await context.enrichAssistantContext({ schedule: { windows: [{ id: "stale" }] } }, "LEGACY01");
  assert.deepEqual(enriched.schedule.windows, [], "durable legacy snapshot wins over stale channel memory");

  identities.set("ACCOUNT1", { auth_user_id: "user-1", anonymous_user_id: "anon-1" });
  await context.persistCanonicalSnapshot("ACCOUNT1", { anonymous_user_id: "anon-1", profile_name: "One" });
  assert.equal(requests.at(-1).resource, "rpc/upsert_bm_user_context");
  assert.equal(requests.at(-1).body.p_anonymous_user_id, "anon-1");
  legacySnapshots.set("ACCOUNT1", { context: { profile_name: "wrong legacy profile" } });
  assert.equal((await context.enrichAssistantContext({}, "ACCOUNT1")).profile_name, "One");
  assert.equal((await context.enrichAssistantContext({}, "OTHER123")).profile_name, undefined);

  identityFailure = true;
  await assert.rejects(context.persistCanonicalSnapshot("ACCOUNT1", legacy), /identity unavailable/);
  identityFailure = false;

  previousContext = { profile_name: "Remembered", age_range: "25-34", personal_profile: { goal: "Sleep" } };
  channelMemory = { pending_assistant_action: {
    id: "wa_missing_window", type: "delete_schedule", status: "queued", window_id: "gone",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  } };
  const response = await sync(legacy);
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(JSON.parse(response.body).canonical_snapshot, true);
  assert.equal(legacySnapshots.get("LEGACY01").context.profile_name, "Remembered", "new onboarding profile merge survives legacy recovery");
  assert.equal(legacySnapshots.get("LEGACY01").context.personal_profile.goal, "Sleep");
  assert.equal(channelMemory.pending_assistant_action, null);
  assert.equal(channelMemory.last_assistant_action_outcome.detail, "schedule_target_missing_after_app_sync");

  for (const status of ["delivered", "confirmed", "execution_started"]) {
    const pending = { id: "wa_delete", type: "delete_schedule", status, window_id: "gone", expires_at: new Date(Date.now() + 60_000).toISOString() };
    channelMemory = { pending_assistant_action: pending };
    const result = await sync(legacy);
    assert.equal(result.statusCode, 200);
    assert.equal(channelMemory.pending_assistant_action, pending, `${status} delete must await its device acknowledgement`);
    assert.equal(channelMemory.last_assistant_action_outcome, undefined);
  }
  assert.equal(endpoint.pendingScheduleTargetIsMissing({ type: "update_schedule", status: "queued", window_id: "existing" }, { schedule: { windows: [{ id: "existing" }] } }), false);
  assert.equal(endpoint.pendingScheduleTargetIsMissing({ type: "start_protection", status: "queued" }, {}), false);

  rpcFailure = true;
  const before = memoryWrites.length;
  const failed = await sync(legacy);
  assert.equal(failed.statusCode, 500, "failed durable writes cannot announce successful sync");
  assert.equal(memoryWrites.length, before, "failed persistence cannot invalidate a queued action");
  console.log("BM legacy context recovery: durable routing, account isolation, profile preservation and queued-only invalidation passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  global.fetch = originalFetch;
  require.cache[channelModulePath].exports = channelExports;
  if (originalEnvironment.url === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalEnvironment.url;
  if (originalEnvironment.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnvironment.key;
});
