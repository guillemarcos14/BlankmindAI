"use strict";

// Real staging integration smoke. No mocks, email/SMS sends, APNs token, or
// fabricated device verification. Network targets are closed before credentials
// are read. Every seeded row belongs to this run; cleanup is identity scoped.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const SUPABASE_ORIGIN = "https://njqbovsmoowkhhsqmitn.supabase.co";
const STAGING_SITE = "blank-product-staging-20260926";

function target(raw, kind) {
  let url;
  try { url = new URL(raw); } catch (_) { throw new Error(`invalid_${kind}_target`); }
  if (url.protocol !== "https:" || url.username || url.password || url.port
    || !["", "/"].includes(url.pathname) || url.search || url.hash) throw new Error(`invalid_${kind}_target`);
  if (kind === "supabase" && url.origin !== SUPABASE_ORIGIN) throw new Error("supabase_target_not_allowlisted");
  const host = new RegExp(`^(?:[a-z0-9-]+--)?${STAGING_SITE}\\.netlify\\.app$`);
  if (kind === "netlify" && !host.test(url.hostname)) throw new Error("netlify_target_not_allowlisted");
  return url.origin;
}

function protectionHeaders(raw = "{}") {
  let input;
  try { input = JSON.parse(raw); } catch (_) { throw new Error("invalid_extra_headers_json"); }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_extra_headers_object");
  const headers = {};
  for (const [key, value] of Object.entries(input)) {
    // Do not let Netlify protection override the JWT under test or Supabase keys.
    if (!/^(?:cookie|x-nf-[a-z0-9-]+)$/i.test(key) || typeof value !== "string" || /[\r\n]/.test(value)) {
      throw new Error("extra_header_not_allowlisted");
    }
    headers[key.toLowerCase()] = value;
  }
  return headers;
}

function configuration(env = process.env, requireCredentials = true) {
  const supabase = target(env.BM_CLOUD_TEST_SUPABASE_URL || SUPABASE_ORIGIN, "supabase");
  const netlify = target(env.BM_CLOUD_TEST_NETLIFY_URL || `https://${STAGING_SITE}.netlify.app`, "netlify");
  const extraHeaders = protectionHeaders(env.BM_CLOUD_TEST_EXTRA_HEADERS_JSON);
  const serviceKey = env.BM_CLOUD_TEST_SERVICE_ROLE_KEY || "";
  const anonKey = env.BM_CLOUD_TEST_ANON_KEY || "";
  if (requireCredentials && (!serviceKey || !anonKey)) throw new Error("staging_credentials_missing");
  return { supabase, netlify, extraHeaders, serviceKey, anonKey };
}

function memoryIdentity(phone) {
  return `assistant:${crypto.createHash("sha256").update(`whatsapp:${phone}`).digest("hex").slice(0,32)}`;
}

async function run(config, output, { infrastructureOnly = false } = {}) {
  // Recheck even when called programmatically.
  target(config.supabase, "supabase"); target(config.netlify, "netlify");
  const runId = crypto.randomUUID();
  const users = [];
  const checks = [];
  const cleanup = [];
  let activeCheck = "preflight";
  let failure = null;
  async function request(origin, route, { method = "GET", body, headers = {} } = {}) {
    if (![config.supabase, config.netlify].includes(origin) || !route.startsWith("/") || route.startsWith("//")) throw new Error("request_target_rejected");
    const url = new URL(route, origin);
    if (url.origin !== origin) throw new Error("request_target_rejected");
    let response;
    try {
      response = await fetch(url, { method, redirect: "error", headers: { "content-type": "application/json", ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(90_000) });
    } catch (_) { throw new Error("request_failed_or_timed_out"); }
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { /* Protection HTML is not an app response. */ }
    return { status: response.status, body: data };
  }
  const serviceHeaders = { apikey: config.serviceKey, authorization: `Bearer ${config.serviceKey}` };
  const db = (route, options = {}) => request(config.supabase, `/rest/v1/${route}`, {
    ...options, headers: { ...serviceHeaders, prefer: "return=representation", ...options.headers },
  });
  const admin = (route, options = {}) => request(config.supabase, `/auth/v1/admin/${route}`, { ...options, headers: serviceHeaders });
  function expect(value, code) { if (!value) throw new Error(code); }
  function ok(response, code) { expect(response.status >= 200 && response.status < 300, `${code}_http_${response.status}`); return response.body; }
  async function check(name, fn) {
    activeCheck = name;
    await fn(); checks.push({ name, passed: true }); console.log(`PASS ${name}`);
  }
  const app = (user, body, token = user?.token) => request(config.netlify, "/.netlify/functions/assistant-app", {
    method: "POST", headers: { ...config.extraHeaders, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: { app_install_id: user?.install, ...body },
  });
  const inbox = (user, body) => request(config.netlify, "/.netlify/functions/assistant-channel", {
    method: "POST", headers: config.extraHeaders,
    body: { connect_code: user.connect, app_install_id: user.install, preferred_channel: "whatsapp", ...body },
  });
  async function semantic(user) {
    const rows = ok(await db(`assistant_semantic_conversations?anonymous_user_id=eq.${user.memory}&select=storage_version,state`), "semantic_read");
    expect(rows.length === 1, "semantic_row_missing"); return rows[0];
  }
  async function memoryEvents(user) {
    return ok(await db(`digital_wellness_feature_payloads?anonymous_user_id=eq.${user.memory}&select=payload,submitted_at&order=submitted_at.desc`), "event_read");
  }
  async function pending(user) {
    const rows = await memoryEvents(user);
    const event = rows.find(row => Object.hasOwn(row.payload?.properties?.memory || {}, "pending_assistant_action"));
    return event?.payload?.properties?.memory?.pending_assistant_action ?? null;
  }
  async function send(user, text) {
    const id = crypto.randomUUID();
    const response = await app(user, { action: "send", turn_id: id, text });
    expect(response.status === 200 && response.body?.turn?.status === "completed", `send_not_completed_http_${response.status}`);
    return response.body.turn;
  }
  async function seed(index) {
    const user = { install: `qa-cloud-${runId}-${index}`, anonymous: `qa-cloud:${runId}:${index}`,
      phone: `+1999${crypto.randomInt(100000000,999999999)}${index}`,
      connect: crypto.randomBytes(5).toString("hex").toUpperCase() };
    user.memory = memoryIdentity(user.phone);
    // .invalid is a reserved non-deliverable domain. Admin confirmation bypasses
    // email delivery, and phone is only a fabricated identity-table fixture.
    const email = `blank-qa-${runId}-${index}@example.invalid`;
    const password = `Qa!${crypto.randomBytes(24).toString("base64url")}`;
    const created = ok(await admin("users", { method: "POST", body: { email, password, email_confirm: true,
      app_metadata: { blank_qa_cloud_run: runId }, user_metadata: { synthetic_qa: true } } }), "auth_seed");
    expect(typeof created?.id === "string", "auth_seed_missing_id");
    user.id = created.id; users.push(user); // Register immediately for cleanup.
    ok(await db("blankmind_identity_links", { method: "POST", body: { auth_user_id: user.id,
      phone_e164: user.phone, app_install_id: user.install, assistant_connect_code: user.connect, anonymous_user_id: user.anonymous } }), "identity_seed");
    // A collision or orphan from an older QA run must not make cleanup delete
    // somebody else's channel data, even if the new identity insert succeeded.
    const oldSemantic = ok(await db(`assistant_semantic_conversations?anonymous_user_id=eq.${user.memory}&select=anonymous_user_id`), "namespace_preflight");
    expect(oldSemantic.length === 0, "synthetic_namespace_already_exists");
    for (const id of [user.memory, `connect:${user.connect}`, user.anonymous]) {
      const rows = ok(await db(`digital_wellness_feature_payloads?anonymous_user_id=eq.${encodeURIComponent(id)}&select=id&limit=1`), "namespace_preflight");
      expect(rows.length === 0, "synthetic_namespace_already_exists");
    }
    user.ownsMemoryNamespace = true;
    const now = new Date().toISOString();
    ok(await db("rpc/upsert_bm_user_context", { method: "POST", body: { p_connect_code: user.connect,
      p_anonymous_user_id: user.anonymous, p_source: "synthetic_staging_cloud_test", p_context: {
        anonymous_user_id: user.anonymous, context_revision: 1, has_selected_apps: true, selection_count: 3,
        screen_time_authorized: true, protection_target: "selected_distractions", language: "en", locale: "en",
        app_presence: { app_present: true, app_ready: true, last_seen_at: now },
        app_presence_state: "recently_seen", app_presence_recent: true,
      } } }), "context_seed");
    ok(await db("digital_wellness_feature_payloads", { method: "POST", body: {
      anonymous_user_id: `connect:${user.connect}`, schema_version: 1, platform: "whatsapp", data_consent: true,
      consent_text: "Synthetic staging QA only", submitted_at: now,
      payload: { event: "assistant_channel_connected", properties: { channel: "whatsapp", preferred_channel: "whatsapp",
        connect_code: user.connect, channel_user: user.phone } }, insight: { event: "assistant_channel_connected" },
    } }), "connection_seed");
    const signedIn = ok(await request(config.supabase, "/auth/v1/token?grant_type=password", {
      method: "POST", headers: { apikey: config.anonKey }, body: { email, password },
    }), "password_sign_in");
    expect(typeof signedIn?.access_token === "string", "sign_in_missing_token"); user.token = signedIn.access_token;
    return user;
  }
  try {
    await check("unauthenticated_request_rejected", async () => {
      const response = await app(null, { action: "history", app_install_id: "qa-not-installed" }, "");
      expect(response.status === 401 && response.body?.error === "authentication_required", "expected_app_401_not_protection_html");
    });
    let a, b;
    await check("two_synthetic_accounts_seeded_without_delivery", async () => { a = await seed(1); b = await seed(2); });
    await check("installation_and_account_isolation", async () => {
      for (const install of [b.install, "qa-unlinked-install"]) {
        const response = await app(a, { action: "history", app_install_id: install });
        expect(response.status === 403 && response.body?.error === "installation_not_verified", "foreign_install_not_rejected");
      }
      const response = await app(a, { action: "history" }, b.token);
      expect(response.status === 403, "foreign_jwt_not_rejected");
    });
    await check("clients_cannot_read_or_execute_service_tables", async () => {
      const headers = { apikey: config.anonKey, authorization: `Bearer ${a.token}` };
      const table = await request(config.supabase, "/rest/v1/assistant_app_turns?select=id", { headers });
      expect([401,403].includes(table.status), "client_table_access_allowed");
      const rpc = await request(config.supabase, "/rest/v1/rpc/claim_assistant_app_turn", { method: "POST", headers,
        body: { p_auth_user_id: a.id, p_turn_id: crypto.randomUUID(), p_user_text: "forbidden", p_lease_owner: crypto.randomUUID() } });
      expect([401,403].includes(rpc.status), "client_claim_rpc_allowed");
    });
    if (!infrastructureOnly) {
    let first;
    await check("send_commits_exact_reply_action_and_shared_state", async () => {
      first = await send(a, "Block my selected apps now for 25 minutes, just once.");
      expect(first.action_id === `app_${first.id}` && !["verified","delayed"].includes(first.action_status), "action_identity_or_unverified_status_invalid");
      expect(first.assistant_text.length > 0, "reply_missing");
      const state = await semantic(a);
      expect(state.state?.semantic_state?.slots?.duration_minutes?.value === 25, "shared_whatsapp_state_missing_app_turn");
      const queued = await pending(a);
      expect(queued?.id === first.action_id && queued.minutes === 25, "canonical_pending_action_missing");
      const events = await memoryEvents(a);
      expect(events.every(row => !row.payload?.properties?.memory?.assistant_device_push?.token), "unexpected_push_device_fixture");
      expect(events.every(row => row.payload?.properties?.memory?.last_assistant_push_attempt?.sent !== true), "unexpected_push_sent");
    });
    await check("immutable_replay_has_one_row_and_no_new_semantic_commit", async () => {
      const before = await semantic(a);
      const beforeEvents = (await memoryEvents(a)).filter(row => row.payload?.properties?.memory?.pending_assistant_action?.id === first.action_id).length;
      const replay = await app(a, { action: "send", turn_id: first.id, text: first.user_text });
      expect(replay.status === 200 && replay.body?.idempotent === true, "replay_not_idempotent");
      expect(replay.body.turn.assistant_text === first.assistant_text && replay.body.turn.created_at === first.created_at
        && replay.body.turn.action_id === first.action_id, "replay_changed_saved_output");
      expect((await semantic(a)).storage_version === before.storage_version, "replay_recommitted_shared_state");
      const rows = ok(await db(`assistant_app_turns?id=eq.${first.id}&auth_user_id=eq.${a.id}&select=id`), "turn_count");
      expect(rows.length === 1, "duplicate_turn_row");
      const afterEvents = (await memoryEvents(a)).filter(row => row.payload?.properties?.memory?.pending_assistant_action?.id === first.action_id).length;
      expect(beforeEvents === afterEvents, "replay_duplicated_outbox_event");
      const conflict = await app(a, { action: "send", turn_id: first.id, text: "Block for 40 minutes instead." });
      expect(conflict.status === 409 && conflict.body?.error === "turn_payload_conflict", "immutable_text_conflict_not_rejected");
    });
    await check("history_and_status_never_cross_accounts", async () => {
      const history = await app(b, { action: "history" });
      expect(history.status === 200 && history.body?.turns?.length === 0, "foreign_history_visible");
      const status = await app(b, { action: "status", turn_id: first.id });
      expect(status.status === 404 && status.body?.error === "turn_not_found", "foreign_turn_visible");
      const own = await app(a, { action: "history" });
      expect(own.status === 200 && own.body?.turns?.length === 1 && own.body.turns[0].id === first.id, "own_history_missing");
    });
    await check("cancellation_updates_shared_whatsapp_state_and_clears_inbox", async () => {
      const cancelled = await send(a, "Please cancel this request.");
      expect(!cancelled.action_id, "cancellation_created_action");
      expect((await semantic(a)).state?.semantic_state?.intent === "cancelled", "shared_state_not_cancelled");
      expect(await pending(a) === null, "cancelled_action_still_pending");
      const original = await app(a, { action: "status", turn_id: first.id });
      expect(original.body?.turn?.action_status === "superseded", "cancelled_original_not_superseded");
    });
    await check("simulated_failed_receipt_is_durable_and_never_verified", async () => {
      const turn = await send(a, "Block my selected apps now for 20 minutes, just once.");
      expect(turn.action_id === `app_${turn.id}`, "second_action_missing");
      const denied = await inbox(b, { action: "ack_pending_action", connect_code: a.connect, action_id: turn.action_id, status: "failed" });
      expect(denied.status === 400 && denied.body?.error === "assistant_identity_conflict", "foreign_receipt_not_rejected");
      // Simulate the native protocol's delivered -> failed transition. Polling
      // this synthetic inbox is not evidence of a real iPhone receiving it.
      const delivered = await inbox(a, { action: "poll_pending_action" });
      expect(delivered.status === 200 && delivered.body?.pending_action?.id === turn.action_id
        && delivered.body.pending_action.status === "delivered", "synthetic_inbox_not_delivered");
      const failed = await inbox(a, { action: "ack_pending_action", action_id: turn.action_id, status: "failed",
        detail: "Synthetic cloud smoke failure; no iPhone execution occurred." });
      expect(failed.status === 200 && failed.body?.acknowledged === true && failed.body?.status === "failed", "failed_receipt_not_acknowledged");
      const replay = await inbox(a, { action: "ack_pending_action", action_id: turn.action_id, status: "failed" });
      expect(replay.body?.acknowledged === true && replay.body?.idempotent === true && replay.body?.status === "failed", "failed_receipt_replay_not_idempotent");
      await send(a, "Block my selected apps now for 15 minutes, just once.");
      const historical = await app(a, { action: "status", turn_id: turn.id });
      expect(historical.body?.turn?.action_status === "failed", "terminal_receipt_lost_after_next_turn");
      const dbRow = ok(await db(`assistant_app_turns?id=eq.${turn.id}&auth_user_id=eq.${a.id}&select=action_status`), "receipt_read");
      expect(dbRow[0]?.action_status === "failed", "terminal_receipt_not_persisted");
      await send(a, "Cancel this request.");
    });
    }
  } catch (error) {
    // All exceptions generated here have static labels; never log upstream body,
    // password, token, request headers or native IDs from fetched data.
    failure = { check: activeCheck, code: /^[a-z0-9_]+$/i.test(error.message) ? error.message : "unexpected_test_error" };
    checks.push({ name: activeCheck, passed: false, code: failure.code });
    console.log(`FAIL ${activeCheck} ${failure.code}`);
  } finally {
    for (const user of users.reverse()) {
      const tasks = [
        ["auth_user_and_turns", () => admin(`users/${encodeURIComponent(user.id)}`, { method: "DELETE" })],
        ["identity_and_snapshot", () => db(`blankmind_identity_links?auth_user_id=eq.${encodeURIComponent(user.id)}`, { method: "DELETE" })],
        ...(user.ownsMemoryNamespace ? [
          ["semantic_state", () => db(`assistant_semantic_conversations?anonymous_user_id=eq.${user.memory}`, { method: "DELETE" })],
          ...[user.memory, `connect:${user.connect}`, user.anonymous].map(id => ["synthetic_events", () => db(`digital_wellness_feature_payloads?anonymous_user_id=eq.${encodeURIComponent(id)}`, { method: "DELETE" })]),
        ] : []),
      ];
      for (const [name, action] of tasks) {
        try { const response = await action(); cleanup.push({ name, passed: response.status >= 200 && response.status < 300 }); }
        catch (_) { cleanup.push({ name, passed: false }); }
      }
    }
    console.log(`${cleanup.every(item => item.passed) ? "PASS" : "FAIL"} synthetic_data_cleanup`);
  }
  const result = { evaluator: "assistant-app-real-staging-v1", generated_at: new Date().toISOString(), run_id: runId,
    script_sha256: crypto.createHash("sha256").update(fs.readFileSync(__filename)).digest("hex"),
    targets: { supabase: config.supabase, netlify: config.netlify }, checks, cleanup,
    scope: infrastructureOnly ? "infrastructure_only_no_model_calls" : "full_conversation_recovery",
    full_conversation_tested: !infrastructureOnly,
    synthetic_auth_user_ids: users.map(user => user.id),
    passed: !failure && checks.length === (infrastructureOnly ? 4 : 9) && cleanup.every(item => item.passed),
    limitations: [...(infrastructureOnly ? ["Only authentication, installation isolation and database access controls tested. Conversation generation, replay, shared memory and receipts are NOT tested in this run."] : []), "Seeded QA identities bypass phone OTP onboarding; no email or SMS is sent.",
      infrastructureOnly ? "No native receipt or iPhone enforcement is tested." : "Native receipt is a simulated failed result, never verified; no iPhone enforcement tested.",
      infrastructureOnly ? "Shared WhatsApp memory, provider webhooks and delivery are not tested." : "Shared WhatsApp semantic storage is checked directly; no external provider webhook or delivery is exercised."] };
  if (output) { fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result,null,2)+"\n"); }
  return result;
}

function selfTest() {
  const assert = require("node:assert/strict");
  assert.equal(target(SUPABASE_ORIGIN,"supabase"),SUPABASE_ORIGIN);
  for (const host of [`https://${STAGING_SITE}.netlify.app`, `https://preview--${STAGING_SITE}.netlify.app`]) assert.equal(target(host,"netlify"),host);
  for (const host of ["https://blankmind.netlify.app", "https://production.supabase.co", `${SUPABASE_ORIGIN}.evil.example`, `${SUPABASE_ORIGIN}/rest/v1`, `http://${STAGING_SITE}.netlify.app`, `https://${STAGING_SITE}.netlify.app.evil.example`, `https://x@${STAGING_SITE}.netlify.app`]) {
    assert.throws(()=>target(host,host.includes("supabase")?"supabase":"netlify"));
  }
  assert.throws(()=>protectionHeaders('{"authorization":"not-allowed"}'));
  assert.throws(()=>protectionHeaders('{"Cookie":"bad\\r\\nheader"}'));
  assert.deepEqual(protectionHeaders('{"Cookie":"opaque","X-NF-Protection-Bypass":"opaque"}'),{cookie:"opaque","x-nf-protection-bypass":"opaque"});
  assert.notEqual(memoryIdentity("+199900000001"),memoryIdentity("+199900000002"));
  console.log("PASS local_target_allowlist_header_safety_and_identity_tests (no network)");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) return selfTest();
  if (!args.includes("--run")) {
    configuration(process.env,false);
    console.log("PASS staging_configuration_validated (no network; use --run only when staging is deployed)");
    return;
  }
  const at = args.indexOf("--out");
  const result = await run(configuration(), at >= 0 ? args[at+1] : "tmp/assistant-app-cloud/report.json", { infrastructureOnly: args.includes("--infrastructure-only") });
  process.exitCode = result.passed ? 0 : 1;
}
module.exports = { configuration, target, protectionHeaders, memoryIdentity, run };
if (require.main === module) main().catch(() => { console.error("FAIL staging_smoke_configuration_or_runner_error"); process.exitCode = 2; });
