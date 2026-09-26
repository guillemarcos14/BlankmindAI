const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { emptyState } = require("../netlify/functions/bm-semantic-state");

const membership = require("../netlify/functions/_membership");
const channel = require("../netlify/functions/_assistant_channel");
const identity = require("../netlify/functions/_identity");
const semantic = require("../netlify/functions/_bm_semantic_store");
const push = require("../netlify/functions/_assistant_push");
const userId = "11111111-1111-4111-8111-111111111111";
const otherId = "99999999-9999-4999-8999-999999999999";
const rows = new Map();
const effects = { planner: 0, semantic: 0, queue: 0, push: 0 };
let memory = { semantic_store_version: 0 };
let fault = "";
let replyText = "Vamos a proteger tus distracciones.";
let actions = [{ type: "start_protection", minutes: 45, app_names: ["Instagram"] }];
let modelUnavailable = false;
let semanticState = { intent: "block", status: "ready" };
let semanticDecision = { type: "execute" };
let plannerBarrier = null;
let memoryUnavailable = false;
let semanticConflict = false;
let queueRace = false;
let receiptRace = false;
const identityRecord = { app_install_id: "verified-install", assistant_connect_code: "ABCDEFGHIJ", phone_e164: "+34123456789" };
const copy = (value) => structuredClone(value);
const faultOnce = (name) => { if (fault === name) { fault = ""; throw new Error("private storage detail must not leak"); } };

membership.getSupabaseUser = async (event) => {
  const token = event.headers?.authorization;
  return token === "Bearer valid" ? { id: userId } : token === "Bearer other" ? { id: otherId } : null;
};
identity.identityForAuthUser = async () => identityRecord;
semantic.semanticPersistenceRequired = () => true;
channel.getAssistantMemory = async () => {
  if (memoryUnavailable) throw new Error("private memory unavailable");
  return copy(memory);
};
channel.recordAssistantMemory = async ({ memory: next }) => {
  if (next.pending_assistant_action) { faultOnce("queue_before"); effects.queue += 1; }
  Object.assign(memory, copy(next));
  if (next.pending_assistant_action) faultOnce("queue_after");
};
push.sendAssistantActionPush = async () => { effects.push += 1; return { sent: true }; };
// No test may call a real push or background URL.
delete process.env.URL;

membership.supabaseFetch = async (path, options = {}) => {
  const body = options.body ? JSON.parse(options.body) : null;
  if (path === "rpc/claim_assistant_app_turn") {
    const { p_turn_id: id, p_auth_user_id: owner, p_user_text: text, p_lease_owner: lease } = body;
    const row = rows.get(id);
    if (row && (row.auth_user_id !== owner || row.user_text !== text)) return [{ claimed: false, status: "payload_conflict" }];
    if (row?.status === "completed") return [{ claimed: false, status: "completed", turn: copy(row) }];
    if (row?.status === "processing" && Date.parse(row.lease_expires_at) > Date.now()) {
      return [{ claimed: false, status: "processing", turn: copy(row) }];
    }
    if ([...rows.values()].some((r) => r.id !== id && r.auth_user_id === owner
        && r.status === "processing" && Date.parse(r.lease_expires_at) > Date.now())) {
      return [{ claimed: false, status: "conversation_in_progress" }];
    }
    const claimed = { ...(row || { id, auth_user_id: owner, user_text: text, created_at: new Date().toISOString() }),
      status: "processing", lease_owner: lease, lease_expires_at: new Date(Date.now() + 90000).toISOString() };
    rows.set(id, claimed);
    return [{ claimed: true, status: "claimed", turn: copy(claimed) }];
  }
  if (path === "rpc/prepare_assistant_app_turn") {
    faultOnce("prepare_before");
    const row = rows.get(body.p_turn_id);
    if (!row || row.auth_user_id !== body.p_auth_user_id || row.lease_owner !== body.p_lease_owner
        || Date.parse(row.lease_expires_at) <= Date.now()) return [{ prepared: false, status: "lease_lost" }];
    if (semanticConflict) { semanticConflict = false; memory.semantic_store_version += 1; }
    if (memory.semantic_store_version !== body.p_expected_version) return [{ prepared: false, status: "conflict" }];
    memory.semantic_store_version += 1;
    memory.conversation_state = copy(body.p_state);
    effects.semantic += 1;
    row.prepared_payload = { ...copy(body.p_payload), semantic_identity: body.p_anonymous_user_id };
    faultOnce("prepare_after");
    return [{ prepared: true, status: "prepared", turn: copy(row) }];
  }
  if (path === "rpc/enqueue_assistant_app_action") {
    faultOnce("queue_before");
    const row = rows.get(body.p_turn_id);
    if (!row || row.auth_user_id !== body.p_auth_user_id || row.lease_owner !== body.p_lease_owner) {
      return [{ enqueued: false, status: "lease_lost", action: null }];
    }
    const pending = row.prepared_payload.action;
    if (queueRace) { queueRace = false; memory.semantic_store_version += 1; }
    if (memory.semantic_store_version !== row.prepared_payload.semantic_version) {
      return [{ enqueued: false, status: "superseded", action: pending ? { ...pending, status: "superseded" } : null }];
    }
    if (!row.action_enqueued_at) {
      memory.pending_assistant_action = copy(pending);
      row.action_id = pending?.id;
      row.action_enqueued_at = new Date().toISOString();
      if (pending) effects.queue += 1;
    }
    faultOnce("queue_after");
    return [{ enqueued: true, status: pending ? "queued" : "invalidated", action: copy(pending) }];
  }
  assert.ok(path.startsWith("assistant_app_turns?"), path);
  const params = new URLSearchParams(path.split("?")[1]);
  if (receiptRace && options.method === "PATCH" && body.action_status) {
    receiptRace = false;
    rows.get(params.get("id").slice(3)).action_status = "verified";
  }
  let matches = [...rows.values()].filter((row) => ["id", "auth_user_id", "lease_owner", "status"]
    .every((key) => !params.has(key) || row[key] === params.get(key).slice(3)));
  if (params.get("action_status") === "is.null") matches = matches.filter((row) => row.action_status == null);
  // Every read/update stays scoped to the JWT identity, including failure paths.
  assert.ok(params.has("auth_user_id"), "unscoped app turn access");
  if (options.method === "PATCH") {
    if (body.status === "completed") faultOnce("complete_before");
    matches.forEach((row) => Object.assign(row, copy(body)));
    if (body.status === "completed") faultOnce("complete_after");
    return options.headers?.prefer === "return=representation" ? copy(matches) : [];
  }
  if (params.has("or")) {
    const [, at, id] = params.get("or").match(/^\(created_at\.lt\.(.+),and\(created_at\.eq\..+,id\.lt\.([a-f0-9-]+)\)\)$/);
    matches = matches.filter((r) => r.created_at < at || (r.created_at === at && r.id < id));
  } else if (params.has("created_at")) matches = matches.filter((r) => r.created_at < params.get("created_at").slice(3));
  matches.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  return copy(matches.slice(0, Number(params.get("limit") || matches.length)));
};

// Use the real pending-action queue with only network/storage adapters stubbed.
delete require.cache[require.resolve("../netlify/functions/whatsapp-agent")];
const whatsapp = require("../netlify/functions/whatsapp-agent");
whatsapp.callBlankedAgent = async () => {
  effects.planner += 1;
  faultOnce("planner");
  const context = { language: "es", memory: copy(memory) };
  if (plannerBarrier) await plannerBarrier;
  return { plan: { message_text: replyText, response_language: "es", actions: copy(actions),
    semantic_state: { ...emptyState("es"), ...copy(semanticState) }, semantic_decision: copy(semanticDecision) }, context, modelUnavailable };
};
const { handler, actionStatus } = require("../netlify/functions/assistant-app");
const event = (body, token = "valid") => ({ httpMethod: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
const request = async (body, token) => {
  const response = await handler(event({ app_install_id: "verified-install", ...body }, token));
  return { status: response.statusCode, body: JSON.parse(response.body) };
};
const send = (id, text = "Bloquea ahora 45 min, una vez", token) => request({ action: "send", turn_id: id, text }, token);

(async () => {
  assert.equal((await request({ action: "history" }, "invalid")).status, 401);
  assert.equal((await request({ action: "history", app_install_id: "other-install" })).status, 403);
  assert.equal((await handler({ ...event({}), body: "null" })).statusCode, 400);
  assert.equal((await handler({ ...event({}), body: "{" })).statusCode, 400);
  assert.equal((await send(crypto.randomUUID(), { text: "not a string" })).status, 400);
  assert.equal((await send(crypto.randomUUID(), "x".repeat(4001))).status, 400);
  assert.equal((await request({ action: "history", before: "v1.bm90LWpzb24" })).status, 400);

  const firstId = crypto.randomUUID();
  let response = await send(firstId);
  assert.equal(response.status, 200, JSON.stringify(response));
  assert.equal(response.body.turn.action_label, "Bloquear 45 min");
  assert.equal(response.body.turn.action_status, "queued");
  assert.equal(response.body.turn.action_id, `app_${firstId}`);
  assert.deepEqual(memory.pending_assistant_action.app_names, []);
  assert.equal(effects.semantic, 1);
  const firstEffects = copy(effects);
  assert.equal((await send(firstId)).body.idempotent, true);
  assert.deepEqual(effects, firstEffects);
  assert.equal((await send(firstId, "different text")).body.error, "turn_payload_conflict");
  assert.equal((await send(firstId, undefined, "other")).body.error, "turn_payload_conflict");
  assert.equal((await request({ action: "status", turn_id: firstId }, "other")).status, 404);
  assert.equal((await request({ action: "history" }, "other")).body.turns.length, 0);

  replyText = "Ya están bloqueadas tus distracciones.";
  const guarded = await send(crypto.randomUUID());
  assert.match(guarded.body.turn.assistant_text, /Pulsa el botón/);
  assert.equal(memory.conversation_state.last_assistant_message, guarded.body.turn.assistant_text);
  const guardedId = guarded.body.turn.id;
  memory.last_assistant_action_outcome = { id: guarded.body.turn.action_id, status: "verified" };
  // assistant-channel persists the validated native receipt before advancing
  // memory; its isolation and write-failure cases live in bm_app_receipt_test.
  rows.get(guardedId).action_status = "verified";
  delete memory.pending_assistant_action;
  assert.equal((await request({ action: "status", turn_id: guardedId })).body.turn.action_status, "verified");
  memory.last_assistant_action_outcome = { id: "a newer action", status: "failed" };
  assert.equal((await request({ action: "status", turn_id: guardedId })).body.turn.action_status, "verified");
  assert.equal(actionStatus("receipt", { pending_assistant_action: { id: "receipt", status: "verified", expires_at: "2020-01-01" } }), "verified");

  // A 200 model fallback is not a completed app turn. Preserve the UUID for a
  // later healthy reply, with no semantic commit, action, push or private error.
  const degradedId = crypto.randomUUID();
  const beforeDegraded = copy(effects);
  const memoryBeforeDegraded = copy(memory);
  modelUnavailable = true;
  replyText = "private provider diagnostic must never become a saved reply";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    response = await send(degradedId);
    assert.deepEqual(response, { status: 503, body: { error: "assistant_app_unavailable", retry_after: 3 } });
    assert.equal(rows.get(degradedId).status, "failed");
    assert.equal(rows.get(degradedId).lease_expires_at, null);
    assert.equal(rows.get(degradedId).prepared_payload, undefined);
    assert.equal(rows.get(degradedId).assistant_text, undefined);
    assert.deepEqual(memory, memoryBeforeDegraded);
    for (const key of ["semantic", "queue", "push"]) assert.equal(effects[key], beforeDegraded[key]);
    assert.equal((await request({ action: "status", turn_id: degradedId })).body.turn.status, "failed");
  }
  assert.equal((await send(degradedId, "a replacement payload")).status, 409);
  assert.equal((await request({ action: "status", turn_id: degradedId }, "other")).status, 404);
  modelUnavailable = false;
  replyText = "Vamos a proteger tus distracciones.";
  response = await send(degradedId);
  assert.equal(response.status, 200);
  assert.equal(response.body.turn.action_id, `app_${degradedId}`);
  assert.equal(effects.semantic - beforeDegraded.semantic, 1);
  assert.equal(effects.queue - beforeDegraded.queue, 1);
  const recoveredEffects = copy(effects);
  assert.equal((await send(degradedId)).body.idempotent, true);
  assert.deepEqual(effects, recoveredEffects);

  // No-action advice/general fallbacks also remain retryable. The exception is
  // narrowly scoped to coherent canonical cancellation, never its label alone.
  modelUnavailable = true;
  const originalActions = copy(actions);
  for (const fixture of [
    { state: { intent: "general", status: "idle" }, decision: { type: "none" }, actions: [] },
    { state: { intent: "advice", status: "collecting" }, decision: { type: "ask" }, actions: [] },
    { state: { intent: "cancelled", status: "ready" }, decision: { type: "cancelled" }, actions: [] },
    { state: { intent: "cancelled", status: "cancelled" }, decision: { type: "ask" }, actions: [] },
    { state: { intent: "cancelled", status: "cancelled" }, decision: { type: "cancelled" }, actions: originalActions },
  ]) {
    semanticState = fixture.state; semanticDecision = fixture.decision; actions = fixture.actions;
    const before = copy(effects);
    const beforeMemory = copy(memory);
    assert.equal((await send(crypto.randomUUID())).status, 503);
    for (const key of ["semantic", "queue", "push"]) assert.equal(effects[key], before[key]);
    assert.deepEqual(memory, beforeMemory);
  }
  semanticState = { intent: "cancelled", status: "cancelled" };
  semanticDecision = { type: "cancelled", slot: null };
  actions = [];
  replyText = "He retirado esta instrucción. Si la protección ya empezó en el iPhone, detenla desde la app.";
  for (const text of ["Cancela esta petición.", "Stop."]) {
    const id = crypto.randomUUID();
    memory.pending_assistant_action = { id: "prior-pending", status: "queued" };
    const before = copy(effects);
    response = await send(id, text);
    assert.equal(response.status, 200);
    assert.equal(response.body.turn.status, "completed");
    assert.equal(response.body.turn.action_id, "");
    assert.equal(memory.pending_assistant_action, null);
    assert.equal(memory.conversation_state.semantic_state.intent, "cancelled");
    assert.equal(effects.semantic - before.semantic, 1);
    for (const key of ["queue", "push"]) assert.equal(effects[key], before[key]);
    const after = copy(effects);
    assert.equal((await send(id, text)).body.idempotent, true);
    assert.deepEqual(effects, after);
  }
  modelUnavailable = false;
  semanticState = { intent: "block", status: "ready" };
  semanticDecision = { type: "execute" };
  actions = originalActions;
  replyText = "Vamos a proteger tus distracciones.";

  // A durable prepared checkpoint already owns its semantic revision. Recovery
  // must reuse it without another model call, even during a later model outage.
  const checkpointId = crypto.randomUUID();
  fault = "queue_before";
  assert.equal((await send(checkpointId)).status, 503);
  const checkpointPayload = copy(rows.get(checkpointId).prepared_payload);
  const checkpointEffects = copy(effects);
  modelUnavailable = true;
  response = await send(checkpointId);
  assert.equal(response.status, 200);
  assert.equal(effects.planner, checkpointEffects.planner);
  assert.equal(effects.semantic, checkpointEffects.semantic);
  assert.equal(effects.queue - checkpointEffects.queue, 1);
  assert.equal(response.body.turn.action_id, checkpointPayload.action.id);
  assert.equal(memory.pending_assistant_action.requested_at, checkpointPayload.action.requested_at);
  assert.equal(memory.pending_assistant_action.expires_at, checkpointPayload.action.expires_at);
  modelUnavailable = false;

  // Failures at each persistence boundary resume one canonical semantic turn.
  for (const failure of ["planner", "prepare_before", "prepare_after", "queue_before", "queue_after", "complete_before", "complete_after"]) {
    const id = crypto.randomUUID();
    const before = copy(effects);
    fault = failure;
    response = await send(id);
    assert.equal(response.status, failure === "complete_after" ? 200 : 503, failure);
    assert.ok(!JSON.stringify(response).includes("private"), failure);
    const checkpoint = rows.get(id).prepared_payload && copy(rows.get(id).prepared_payload);
    response = await send(id);
    assert.equal(response.status, 200, failure);
    assert.equal(effects.semantic - before.semantic, 1, `semantic duplicated at ${failure}`);
    assert.equal(effects.queue - before.queue, 1, `action duplicated at ${failure}`);
    if (checkpoint) {
      assert.equal(memory.pending_assistant_action.id, checkpoint.action.id);
      assert.equal(memory.pending_assistant_action.requested_at, checkpoint.action.requested_at);
      assert.equal(memory.pending_assistant_action.expires_at, checkpoint.action.expires_at);
    }
  }

  // An active lease prevents duplicate work and serializes different app turns.
  let release;
  plannerBarrier = new Promise((resolve) => { release = resolve; });
  const concurrentId = crypto.randomUUID();
  const running = send(concurrentId);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await send(concurrentId)).status, 202);
  assert.equal((await send(crypto.randomUUID())).body.error, "conversation_in_progress");
  plannerBarrier = null;
  release();
  assert.equal((await running).status, 200);

  // A crashed worker's row becomes reclaimable without a new UUID.
  const staleId = crypto.randomUUID();
  rows.set(staleId, { id: staleId, auth_user_id: userId, user_text: "recover me", status: "processing",
    created_at: new Date().toISOString(), lease_expires_at: "2020-01-01T00:00:00Z" });
  assert.equal((await send(staleId, "recover me")).status, 200);
  semanticConflict = true;
  const conflictId = crypto.randomUUID();
  const beforeConflict = effects.queue;
  assert.equal((await send(conflictId)).status, 503);
  assert.equal(effects.queue, beforeConflict, "CAS conflict must not enqueue stale plan");
  assert.equal((await send(conflictId)).status, 200);

  // A newer WhatsApp conversation invalidates an unqueued prepared app action.
  const supersededId = crypto.randomUUID();
  fault = "queue_before";
  assert.equal((await send(supersededId)).status, 503);
  memory.semantic_store_version += 1;
  const beforeSuperseded = copy(effects);
  response = await send(supersededId);
  assert.equal(response.body.turn.action_status, "superseded");
  assert.deepEqual(effects, beforeSuperseded);

  // WhatsApp advances AFTER the queue reads memory but BEFORE its event write.
  queueRace = true;
  const beforeRace = effects.queue;
  const newerBeforeQueue = await send(crypto.randomUUID());
  assert.equal(newerBeforeQueue.body.turn.action_status, "superseded");
  assert.equal(effects.queue, beforeRace, "atomic enqueue must reject the stale read→write race");
  queueRace = true;
  receiptRace = true;
  assert.equal((await send(crypto.randomUUID())).body.turn.action_status, "verified", "late response must not overwrite an authoritative native receipt");

  const expiredId = crypto.randomUUID();
  fault = "queue_before";
  assert.equal((await send(expiredId)).status, 503);
  rows.get(expiredId).prepared_payload.action.expires_at = "2020-01-01T00:00:00Z";
  const beforeExpired = effects.queue;
  assert.equal((await send(expiredId)).body.turn.action_status, "expired");
  assert.equal(effects.queue, beforeExpired);

  // A transient memory outage still returns the durable reply, with no Apply CTA.
  memoryUnavailable = true;
  response = await send(firstId);
  assert.equal(response.status, 200);
  assert.equal(response.body.turn.action_status, "unavailable");
  memoryUnavailable = false;

  // The in-app surface preserves exact action facts and uses its own controls,
  // even when the planner supplies misleading remote or success prose.
  replyText = "Ya están bloqueadas. Pulsa la notificación de Blankmind.";
  const copies = [
    { action: { type: "set_daily_limit", minutes: 35 }, label: "Aplicar límite", required: /35 minutos de uso al día/ },
    { action: { type: "apply_schedule", start_minute: 510, end_minute: 565, weekdays: [1, 7], duration_days: 14 }, label: "Aplicar horario", required: /08:30 a 09:25, domingo, sábado durante 14 días/ },
    { action: { type: "apply_schedule", start_minute: 540, end_minute: 600 }, label: "Aplicar horario", required: /09:00 a 10:00, cada día durante 7 días/ },
    { action: { type: "update_schedule", window_id: "existing", start_minute: 540, end_minute: 600, duration_days: 3 }, label: "Aplicar horario", required: /09:00 a 10:00, cada día\./, forbidden: /durante 3 días/ },
    { action: { type: "request_screen_time_permission" }, label: "Conceder permiso", required: /Tiempo de uso.*Después dime/ },
    { action: { type: "open_app_picker", name: "Daily Limit", minutes: 25 }, label: "Elegir distracciones", required: /25 minutos de uso al día.*Al aceptar la selección/ },
    { action: { type: "open_app_picker", name: "Daily Limit", minutes: 35, start_minute: 540, end_minute: 600 }, label: "Elegir distracciones", required: /35 minutos de uso al día/, forbidden: /09:00/ },
    { action: { type: "open_app_picker", name: "Distractions" }, label: "Elegir distracciones", required: /Todavía no hay una propuesta/ },
  ];
  for (const fixture of copies) {
    actions = [fixture.action];
    const rendered = await send(crypto.randomUUID());
    assert.equal(rendered.status, 200);
    assert.equal(rendered.body.turn.action_label, fixture.label);
    assert.match(rendered.body.turn.assistant_text, fixture.required);
    if (fixture.forbidden) assert.doesNotMatch(rendered.body.turn.assistant_text, fixture.forbidden);
    assert.doesNotMatch(rendered.body.turn.assistant_text, /notificación|Ya están bloqueadas/i);
    assert.equal(rendered.body.turn.action_status, "queued");
  }

  // More than one page sharing exactly the same timestamp cannot lose turns.
  rows.clear();
  for (let i = 1; i <= 125; i += 1) {
    const id = `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`;
    rows.set(id, { id, auth_user_id: userId, user_text: String(i), assistant_text: String(i), status: "completed", created_at: "2026-09-26T12:00:00.123456Z" });
  }
  let before = null;
  const seen = [];
  do {
    response = await request({ action: "history", before });
    assert.equal(response.status, 200);
    seen.push(...response.body.turns.map((turn) => turn.id));
    before = response.body.next_before;
  } while (before);
  assert.equal(seen.length, 125);
  assert.equal(new Set(seen).size, 125);
  console.log("assistant app: auth isolation, immutable retries, leases, atomic checkpoints, CAS conflicts, canonical actions, durable receipts, failure recovery and 125 tied history timestamps passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
