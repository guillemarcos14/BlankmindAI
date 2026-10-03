"use strict";
const assert = require("node:assert/strict");
const data = require("../netlify/functions/bm-brain-data");
const membership = require("../netlify/functions/_membership");
let calls = [], stored = [];
membership.supabaseFetch = async (path, options) => {
  calls.push({ path,options });
  if (path.startsWith("bm_brain_memories?")) return stored;
  if (path.startsWith("assistant_app_turns?")) return [{ id:"turn-A", user_text:"Mi objetivo es concentrarme", created_at:"2026-08-01T12:00:00Z" }];
  if (path === "rpc/commit_assistant_brain_memory") return { committed:true };
  throw new Error(path);
};
const brain = require("../netlify/functions/bm-brain");
const now = Date.parse("2026-10-02T12:00:00Z");
const row = (id,a,b,extra={}) => ({ id:`00000000-0000-4000-8000-${String(id).padStart(12,"0")}`, started_at:`2026-10-02T${a}:00Z`, ended_at:`2026-10-02T${b}:00Z`, ...extra });
const snapshot = data.normalizeBrainSnapshot({ schema_version:1, generated_at:new Date(now).toISOString(), timezone:"Europe/Madrid", local_date:"wrong",
  history_started_at:"2026-01-01T00:00:00Z", history_complete:true, account:{ premium_access:true },
  sessions:[row(1,"08:00","09:00",{ pause_started_at:"2026-10-02T08:10:00Z", pause_ended_at:"2026-10-02T08:20:00Z" }),
    row(2,"08:30","09:30",{ ended_reason:"emergency" })] });
assert.equal(snapshot.local_date,"2026-10-02");
const bounds = data.periodBounds({period:"today"},snapshot,now);
const stats = data.statistics(snapshot,bounds,now);
assert.equal(stats.protected_seconds,80*60);
assert.equal(stats.session_count,2); assert.equal(stats.break_count,1); assert.equal(stats.partial,false);
assert.equal(data.statistics(snapshot,{from:Date.parse("2026-10-02T08:35:00Z"),to:Date.parse("2026-10-02T08:55:00Z")},now).protected_seconds,20*60);
assert.equal(data.statistics({...snapshot,history_complete:false},bounds,now).partial,true);
assert.equal(data.statistics({...snapshot,history_started_at:null},bounds,now).available,false);
assert.equal(data.statistics(snapshot,bounds,now+121000).partial,true);
assert.equal(data.midnight("2026-03-30","Europe/Madrid")-data.midnight("2026-03-29","Europe/Madrid"),23*3600000);
assert.equal(data.midnight("2026-10-26","Europe/Madrid")-data.midnight("2026-10-25","Europe/Madrid"),25*3600000);
assert.equal(data.periodBounds({period:"last_week"},snapshot,now).start_date,"2026-09-21");
assert.equal(data.periodBounds({period:"this_week"},{...snapshot,week_starts_on:1},now).start_date,"2026-09-27");
assert.equal(data.periodBounds({period:"last_month"},snapshot,now).start_date,"2026-09-01");
assert.throws(() => data.periodBounds({period:"custom",start_date:"2026-02-30",end_date:"2026-03-02"},snapshot,now),/invalid_date/);
assert.throws(() => data.periodBounds({period:"custom",start_date:"2026-10-01",end_date:"invalid"},snapshot,now),/invalid_date/);
assert.throws(() => data.periodBounds({period:"custom",start_date:"2026-10-01",end_date:"2026-09-20"},snapshot,now),/invalid_period/);
assert.equal(data.normalizeBrainSnapshot({...snapshot,timezone:"invalid"}),null);
assert.equal(data.normalizeBrainSnapshot({...snapshot,timezone:undefined}),null);
assert.equal(data.normalizeBrainSnapshot({...snapshot,sessions:Array(2001).fill(snapshot.sessions[0])}),null);
const duplicated = data.normalizeBrainSnapshot({...snapshot,sessions:[snapshot.sessions[0],snapshot.sessions[0]]});
assert.equal(duplicated.sessions.length,1); assert.equal(duplicated.history_complete,false);
assert(!JSON.stringify(data.normalizeBrainSnapshot({...snapshot,password:"secret",sessions:[{...snapshot.sessions[0],app_tokens:["secret"]}]})).includes("secret"));

const request = (route,evidence,extra={}) => ({ route,evidence,execute:false,period:"this_week",start_date:null,end_date:null,
  compare_previous:false,search_terms:[],section:null,setting_change:null,memory:null,...extra });
assert.equal(brain.validateRequest(request("memory", "Why do I scroll?", { message_kind: "question",
  memory: { operation: "set", key: "weak_moments", value: "Why do I scroll?", evidence: "Why do I scroll?" } }), "Why do I scroll?").memory, null);
assert.throws(() => brain.validateRequest(request("memory","not stated"),"remember bedtime"),/invalid_request/);
assert.throws(() => brain.validateRequest(request("memory","Remember",{memory:{operation:"set",key:"bedtime",value:"23:00",evidence:"Remember"}}),"Remember bedtime"),/ungrounded_memory/);
assert.throws(() => brain.validateRequest(request("memory","Remember",{memory:{operation:"set",key:"password",value:"Remember",evidence:"Remember"}}),"Remember"),/ungrounded_memory/);
assert.throws(() => brain.validateRequest(request("history","Find",{search_terms:["other user"]}),"Find"),/invalid_request/);

async function main() {
  process.env.OPENAI_API_KEY="test-only-never-used";
  const context = () => ({language:"es",memory:{},brain_snapshot:{...snapshot,generated_at:new Date().toISOString()},profile_name:"old", personal_profile:{goal:"old"}});
  const plan = async (text, query, ctx=context()) => brain.planBrainTurn({prompt:text,context:ctx,userId:"user-A",extract:async()=>query});
  const remembered = await plan("Recuerda que trabajo de noche",request("memory","Recuerda",{ memory:{operation:"set",key:"work_routine",value:"trabajo de noche",evidence:"trabajo de noche"}}));
  assert.deepEqual(remembered.context.brain_memory_effect,{operation:"set",key:"work_routine",value:"trabajo de noche",evidence:"trabajo de noche"});
  assert.equal(remembered.plan.actions.length,0);
  assert.equal(remembered.plan.semantic_state.status,"idle","A read needs a durable semantic checkpoint");
  assert.equal(calls.some(call=>call.options?.method==="POST"),false,"Planning cannot commit a fact before the turn commits");
  const forgot = await plan("Olvida mi objetivo",request("memory","Olvida",{memory:{operation:"forget",key:"goal",value:null,evidence:"Olvida mi objetivo"}}));
  assert.equal(forgot.context.brain_memory_effect.operation,"forget");
  stored=[{key:"goal",value:null,source_at:"2026-10-01T00:00:00Z"}];
  const ctx=context(); await plan("Hola",request("conversation","Hola"),ctx);
  assert.equal(ctx.personal_profile.goal,""); assert.equal(ctx.brain_memories.length,0);
  assert.equal(ctx.recent_messages.length,0,"A forgotten statement resurfaced in short-term personalization");
  const stale=await plan("Bloquea ahora",request("control","Bloquea",{execute:true}),{...context(),brain_snapshot:snapshot});
  assert.equal(stale.plan.actions.length,0); assert(stale.plan.message_text.includes("reciente"));
  calls=[]; await plan("Busca objetivo",request("history","Busca",{period:"all_time",search_terms:["objetivo"]}));
  const history=calls.find(call=>call.path.includes("user_text.ilike"));
  assert(history.path.includes("auth_user_id=eq.user-A")); assert(history.path.includes("status=eq.completed"));
  assert(decodeURIComponent(history.path).includes("user_text.ilike.*objetivo*"));
  calls=[]; await brain.commitMemory("user-A","turn-A");
  assert.deepEqual(JSON.parse(calls[0].options.body),{p_auth_user_id:"user-A",p_turn_id:"turn-A"});
  const controls=context(); assert.equal(await plan("Bloquea ahora",request("control","Bloquea",{execute:true}),controls),null);
  assert.equal(controls.brain_request.execute,true);
  const suggestion=context(); await plan("¿Puedes bloquear?",request("control","bloquear",{execute:false}),suggestion);
  assert.equal(suggestion.brain_request.execute,false);
  delete process.env.OPENAI_API_KEY;
  console.log("Brain: interval union, pauses, DST, coverage, dates, schema/evidence, stale controls, account-scoped retrieval and commit boundaries passed");
}
main().catch(error=>{ console.error(error); process.exitCode=1; });
