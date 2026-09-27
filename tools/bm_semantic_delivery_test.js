"use strict";

const assert = require("node:assert/strict");
const { advanceSemanticState, normalizeSemanticState, TTL_MS } = require("../netlify/functions/bm-semantic-state");
const { normalizeSemanticDelivery, applySemanticDelivery, deliveryStage, renderSuppressedDelivery } = require("../netlify/functions/bm-semantic-delivery");
const NOW = Date.parse("2026-09-26T12:00:00Z");
const READY = { channel:"whatsapp", app_presence_state:"recently_seen", screen_time_authorized:true, has_selected_apps:true };
const ABSENT = { ...READY, app_presence_state:"stale" };
const PICKER = { ...READY, has_selected_apps:false };
const PERMISSION = { ...READY, screen_time_authorized:false };
const REQUESTS = [
  ["Block selected apps now for 30 minutes once.", "start_protection"],
  ["Set a 50-minute daily limit for selected apps now.", "set_daily_limit"],
  ["Block selected apps from 10am to 11am every day for 7 days.", "apply_schedule"],
];
let checks = 0;
function test(name, fn) { try { fn(); checks++; } catch (error) { error.message = `${name}: ${error.message}`; throw error; } }
const turn = (prompt, previous, context = READY, extra = {}) => advanceSemanticState({ prompt, previousState:previous?.state || previous, context, now:NOW, ...extra });
function suppressed(result) { assert.deepEqual(result.actions, []); assert.equal(result.actionReplaySuppressed, true); assert.doesNotMatch(result.responseText, /already sent|ya se envió|already waiting|is pending|ya está pendiente|successfully|ya (?:está|están) bloquead|has been applied/i); }

for (const [request, type] of REQUESTS) {
  test(`${type}: review-only transport and refreshed presence share one delivery`, () => {
    const first = turn(request, null, ABSENT);
    assert.equal(first.actions[0].type, type); assert.equal(first.reviewOnlyAppPresence, true);
    const repeat = turn("Yes", first, ABSENT); suppressed(repeat); assert.equal(repeat.reviewOnlyAppPresence, false);
    suppressed(turn("Ready", repeat));
  });
  test(`${type}: attached picker applies the same plan without a second command`, () => {
    const first = turn(request, null, PICKER); assert.equal(first.actions[0].type, "open_app_picker");
    assert.equal(deliveryStage(first.actions[0]), "execution");
    const repeat = turn("Yes", first, PICKER); suppressed(repeat);
    suppressed(turn("Done", repeat));
  });
  test(`${type}: permission request cannot repeat, but permission to execution is legitimate`, () => {
    const permission = turn(request, null, PERMISSION); assert.deepEqual(permission.actions, [{type:"request_screen_time_permission"}]);
    const repeat = turn("I said yes", permission, PERMISSION); suppressed(repeat);
    assert.match(repeat.responseText,/permission request was already prepared/);
    assert.match(repeat.responseText,/Open Blankmind, grant blocking permission/);
    assert.doesNotMatch(repeat.responseText,/Check its result|This request was already prepared/);
    const ready = turn("Ready", repeat); assert.equal(ready.actions[0].type, type);
    assert.deepEqual(ready.state.delivery.sent, ["permission", "execution"]); suppressed(turn("Yes", ready));
  });
  test(`${type}: executable owns later permission and selection preflight`, () => {
    const first = turn(request, null, ABSENT);
    const permission = turn("Ready", first, PERMISSION); suppressed(permission);
    const picker = turn("Ready", permission, PICKER); suppressed(picker);
    suppressed(turn("Ready", picker));
  });
}

test("Spanish repeated permission directs the user to grant access without claiming an executable result", () => {
  const first=turn("Bloquea mis distracciones ahora durante 30 minutos una vez.",null,PERMISSION,{language:"es"});
  assert.deepEqual(first.actions,[{type:"request_screen_time_permission"}]);
  const repeat=turn("Sí.",first,PERMISSION,{language:"es"}); suppressed(repeat);
  assert.match(repeat.responseText,/solicitud de permiso ya se preparó/);
  assert.match(repeat.responseText,/Abre Blankmind, concede el permiso de bloqueo/);
  assert.doesNotMatch(repeat.responseText,/Consulta su resultado|permiso concedido|ya se envió|ya se aplicó/);
  assert.deepEqual(repeat.state.delivery,first.state.delivery);
  const ready=turn("Listo.",repeat,READY,{language:"es"});
  assert.deepEqual(ready.actions,[{type:"start_protection",minutes:30,hard_mode:false}]);
});

test("an earlier executable keeps its original result guidance after permission preflight", () => {
  const fingerprint="a".repeat(24);
  for (const language of ["en","es"]) {
    const original=renderSuppressedDelivery(language);
    assert.equal(renderSuppressedDelivery(language,{version:1,proposal_fingerprint:fingerprint,sent:["permission","execution"]}),original);
    const permission=renderSuppressedDelivery(language,{version:1,proposal_fingerprint:fingerprint,sent:["permission"]});
    assert.notEqual(permission,original);
    assert.doesNotMatch(permission,/already sent|ya se envió|permission granted|permiso concedido/i);
  }
});

test("permission then picker transports execution once", () => {
  const permission = turn(REQUESTS[0][0], null, {...PERMISSION, has_selected_apps:false});
  const picker = turn("Ready", permission, PICKER); assert.equal(picker.actions[0].type, "open_app_picker");
  suppressed(turn("Done", picker));
});
test("explicit complete repetition starts a new authorization", () => {
  const first = turn(REQUESTS[0][0]);
  const second = turn(REQUESTS[0][0], first); assert.equal(second.actions.length, 1); assert.equal(second.actionReplaySuppressed, false);
  suppressed(turn("Yes", second));
});
test("an incomplete new request cannot inherit old authorization or duration", () => {
  const first = turn(REQUESTS[0][0]);
  const next = turn("Block selected apps now", first); assert.deepEqual(next.actions, []); assert.equal(next.state.slots.duration_minutes, null); assert.equal(next.state.delivery, null);
  assert.deepEqual(turn("Yes", next).actions, []);
});
test("operational correction and correcting back each require a new delivery", () => {
  const first = turn(REQUESTS[0][0], null, PICKER);
  const corrected = turn("Actually 45 minutes", first, PICKER); assert.equal(corrected.actions[0].minutes, 45);
  const restored = turn("Actually 30 minutes", corrected); assert.equal(restored.actions[0].minutes, 30);
  suppressed(turn("Yes", restored));
});
test("withdrawal closes all delivery stages and cannot be revived by yes", () => {
  const first = turn(REQUESTS[0][0], null, PICKER);
  const cancelled = turn("Cancel this request.", first); assert.equal(cancelled.state.delivery, null); assert.equal(cancelled.state.last_action_fingerprint, null);
  assert.deepEqual(turn("Yes", cancelled).actions, []);
  assert.equal(turn(REQUESTS[0][0], cancelled).actions[0].type, "start_protection");
});
test("TTL does not resurrect authorization from recent messages", () => {
  const first = turn(REQUESTS[0][0]);
  const result = turn("Yes", first, {...READY, recent_messages:[{role:"user",content:REQUESTS[0][0]}]}, {now:NOW + TTL_MS + 1});
  assert.deepEqual(result.actions, []); assert.equal(result.state.slots.confirmation, null); assert.equal(result.state.delivery, null);
  assert.equal(result.state.slots.duration_minutes, null);
});
test("history-only migration cannot treat a bare acknowledgement as an old authorization", () => {
  const result = turn("Yes", null, {...READY, recent_messages:[{role:"user",content:REQUESTS[0][0]}, {role:"assistant",content:"It was applied successfully."}]});
  assert.deepEqual(result.actions, []); assert.equal(result.state.slots.confirmation, null); assert.equal(result.state.delivery, null);
  assert.equal(result.state.slots.duration_minutes.value, 30);
});
test("unknown and real terminal receipts never imply pending or authorize replay", () => {
  const first = turn(REQUESTS[0][0]);
  for (const status of [null, "verified", "failed", "expired", "dismissed", "delayed"]) {
    const context = {...READY, memory:{last_assistant_action_outcome:status ? {id:"app_other_action",status} : null}};
    suppressed(turn("Yes", first, context));
  }
});
test("delivery survives normalization and channel changes", () => {
  const first = turn(REQUESTS[1][0], null, PICKER);
  const restored = normalizeSemanticState(JSON.parse(JSON.stringify(first.state)), NOW);
  assert.deepEqual(restored.delivery, first.state.delivery);
  for (const channel of ["ios", "android", "sms", "whatsapp"]) suppressed(turn("Ready", restored, {...READY, channel}));
});
test("rolling upgrade respects the old ready fingerprint", () => {
  const first = turn(REQUESTS[0][0]); delete first.state.delivery;
  suppressed(turn("Ready", first)); suppressed(turn("Ready", first, PICKER));
});
test("marker is proposal-bound and ignores invalid stages", () => {
  const fp = "a".repeat(24), marker = {version:1,proposal_fingerprint:fp,sent:["execution"]};
  assert.equal(normalizeSemanticDelivery(marker, "b".repeat(24)), null);
  assert.equal(normalizeSemanticDelivery({...marker,sent:["verified"]}, fp), null);
  assert.equal(normalizeSemanticDelivery({...marker,version:2}, fp), null);
  const result = applySemanticDelivery({delivery:marker,fingerprint:"b".repeat(24),actions:[{type:"start_protection",minutes:45}]});
  assert.equal(result.actions.length, 1); assert.equal(result.suppressed, false);
});
test("bare picker is not a transported executable plan", () => {
  const fp = "c".repeat(24);
  const picker = applySemanticDelivery({fingerprint:fp,actions:[{type:"open_app_picker",name:"Distractions"}]});
  assert.deepEqual(picker.delivery.sent, ["selection"]);
  const executable = applySemanticDelivery({delivery:picker.delivery,fingerprint:fp,actions:[{type:"start_protection",minutes:30}]});
  assert.equal(executable.actions.length, 1);
});
// Use the production provider queue and payload builder. Storage and push are
// adapters only; this proves bare replies never replace the original id/expiry.
async function transportRegression() {
  const channel = require("../netlify/functions/_assistant_channel");
  const push = require("../netlify/functions/_assistant_push");
  const names = ["BM_SEMANTIC_PERSISTENCE", "URL", "WHATSAPP_APP_SECRET"];
  const env = Object.fromEntries(names.map(name => [name,process.env[name]]));
  const originals = {getAssistantMemory:channel.getAssistantMemory,recordAssistantMemory:channel.recordAssistantMemory,recordPendingAssistantAction:channel.recordPendingAssistantAction,push:push.sendAssistantActionPush,fetch:global.fetch};
  let memory = {semantic_store_version:0};
  let enqueued = 0, pushes = 0;
  try {
    process.env.BM_SEMANTIC_PERSISTENCE = "required";
    delete process.env.URL; delete process.env.WHATSAPP_APP_SECRET;
    global.fetch = async () => { throw new Error("network_forbidden_in_delivery_regression"); };
    channel.getAssistantMemory = async () => structuredClone(memory);
    channel.recordAssistantMemory = async ({memory:patch}) => { memory = {...memory,...structuredClone(patch)}; };
    channel.recordPendingAssistantAction = async ({pending,expectedVersion}) => {
      assert.equal(expectedVersion,memory.semantic_store_version);
      enqueued++; memory.pending_assistant_action = structuredClone(pending);
      return {enqueued:true,status:"queued"};
    };
    push.sendAssistantActionPush = async () => { pushes++; return {sent:false,reason:"test_missing_device_token"}; };
    const {queuePendingAssistantAction} = require("../netlify/functions/whatsapp-agent");
    for (const provider of ["whatsapp", "sms"]) {
      const connection = {channel:provider,channelUser:"+34000000000",connectCode:"ABC123"};
      let previous;
      async function send(prompt, context) {
        const result = turn(prompt, previous, {...context,channel:provider}); previous = result;
        memory.semantic_store_version++;
        memory.conversation_state = {semantic_state:structuredClone(result.state)};
        const queued = await queuePendingAssistantAction(connection,{actions:result.actions,message_text:result.responseText},prompt,provider === "sms" ? "sms" : "wa",null,memory.semantic_store_version);
        return {result,queued};
      }
      const before = enqueued;
      const first = await send(REQUESTS[0][0], ABSENT);
      assert.equal(first.queued.action.type,"start_protection");
      const original = structuredClone(memory.pending_assistant_action);
      for (const context of [PERMISSION, PICKER, READY]) {
        const next = await send("Ready", context); suppressed(next.result); assert.equal(next.queued,null);
        assert.deepEqual(memory.pending_assistant_action,original,"preflight follow-up replaced the durable action or reset its expiry");
      }
      for (const status of ["verified","failed","dismissed","expired","delayed"]) {
        memory.pending_assistant_action = null;
        memory.last_assistant_action_outcome = {id:original.id,type:original.type,status};
        const afterReceipt = await send("Yes",READY); suppressed(afterReceipt.result); assert.equal(afterReceipt.queued,null);
        assert.equal(memory.pending_assistant_action,null,"a terminal action was resurrected");
      }
      assert.equal(enqueued-before,1);
      const fresh = await send(REQUESTS[0][0],READY); assert.ok(fresh.queued.action.id !== original.id);
      assert.equal(enqueued-before,2,"only a new complete instruction may enqueue another action");
      checks++;
    }
    assert.equal(pushes,enqueued);
  } finally {
    channel.getAssistantMemory=originals.getAssistantMemory; channel.recordAssistantMemory=originals.recordAssistantMemory; channel.recordPendingAssistantAction=originals.recordPendingAssistantAction; push.sendAssistantActionPush=originals.push; global.fetch=originals.fetch;
    for (const name of names) { if (env[name] === undefined) delete process.env[name]; else process.env[name]=env[name]; }
  }
}
transportRegression().then(() => console.log(`Semantic delivery: ${checks}/${checks} passed (real reducer and provider queue; no model or network)`)).catch(error => { console.error(error); process.exitCode=1; });
