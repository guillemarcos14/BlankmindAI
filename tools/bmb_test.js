"use strict";
const assert=require("node:assert/strict");
const policy=require("../netlify/functions/bmb-policy");
const membership=require("../netlify/functions/_membership");
let history=[],calls=[],saved=[];
membership.supabaseFetch=async(path,options)=>{
  calls.push({path,options});
  if(path.startsWith("bm_brain_memories"))return saved;
  if(path.startsWith("bmb_accounts"))return [];
  if(path.startsWith("assistant_app_turns"))return history;
  if(path.startsWith("bmb_sessions"))return [];
  throw Error(path);
};
const brain=require("../netlify/functions/bmb-brain");
const base=()=>({phase:"final",response_text:"I can help you protect your evening.",response_language:"en",message_kind:"statement",decision:"respond",evidence:"help",accepted_proposal:null,pending_request:null,action:null,queries:[],memory:null,cited_sources:[]});
const action=(extra={})=>({type:"start_protection",minutes:30,start_minute:null,end_minute:null,weekdays:[],duration_days:null,local_date:null,timezone:null,recurrence:"once",window_id:null,hours:null,hard_mode:false,...extra});
const context=()=>({language:"en",memory:{semantic_store_version:0},has_selected_apps:true,screen_time_authorized:true,brain_snapshot:{schema_version:1,generated_at:new Date().toISOString(),timezone:"Europe/Madrid",sessions:[],local_date:"2026-10-03"}});
async function turn(response,ctx=context(),prompt="help") {return brain.plan({prompt,context:ctx,userId:"A",identity:{anonymous_user_id:"verified-A"}},{run:async()=>response});}
async function main() {
  let response=base(), result=await turn(response);
  assert.equal(result.plan.bmb_generated,true);assert.deepEqual(result.plan.actions,[]);
  for (const active of [false, true]) {
    const prompt = "¿Cómo puedo dormir mejor esta noche? ¿Qué debería hacer?";
    let observed;
    const advice = "Podrías bajar el ritmo un rato antes de acostarte. ¿Qué suele mantenerte despierto?";
    const chatted = await brain.plan({ prompt, context: { ...context(), is_blank_active: active }, userId: "A", identity: {} }, {
      memories: [], run: async input => { observed = input; return { ...base(), evidence: prompt, response_text: advice, response_language: "es", message_kind: "question" }; }
    });
    assert.equal(observed.current_message, prompt);
    assert.equal(observed.context.is_blank_active, active);
    assert.equal(chatted.plan.response_text, advice, "Protection state altered model wording");
    assert.deepEqual(chatted.plan.actions, [], "Advice should not create a block");
  }
  response={...base(),message_kind:"question",decision:"propose",action:action()};result=await turn(response);
  assert.equal(result.plan.actions.length,0);assert.equal(result.context.brain_request.execute,false);
  const proposed=result.plan.bmb_state.proposal;
  const ctx=context();ctx.memory.conversation_state={bmb_state:{proposal:proposed}};
  result=await turn({...base(),message_kind:"statement",decision:"respond"},ctx);
  assert.equal(result.plan.bmb_state.proposal.fingerprint,proposed.fingerprint,"Detour erased proposal");
  await assert.rejects(()=>turn({...base(),message_kind:"statement",decision:"execute",action:action()},ctx),/not_authorized/);
  const mismatch=await turn({...base(),message_kind:"acceptance",decision:"execute",accepted_proposal:proposed.fingerprint,action:action({minutes:45})},ctx);assert.deepEqual(mismatch.plan.actions,[]);assert.equal(mismatch.context.brain_request.execute,false);
  result=await turn({...base(),message_kind:"acceptance",decision:"execute",accepted_proposal:proposed.fingerprint,action:action()},ctx);
  assert.equal(result.plan.actions[0].minutes,30);assert.equal(result.context.brain_request.execute,true);
  const reorderedAction=Object.fromEntries(Object.entries(action()).reverse());
  result=await turn({...base(),message_kind:"acceptance",decision:"execute",accepted_proposal:proposed.fingerprint,action:reorderedAction},ctx);
  assert.equal(result.context.brain_request.execute,true,"JSON field order changed proposal authority");
  const recover=require("../netlify/functions/bmb-proposal").recover;
  const offered={id:"saved-offer",created_at:new Date(Date.now()-60000).toISOString(),action_id:null,
    user_text:"I want to focus",assistant_text:"Want a 30-minute block of your distractions?"};
  const extraction={turn_id:offered.id,offer:offered.assistant_text,action:action()};
  const recoverOptions={normalize:brain.normalizeAction,run:async()=>extraction};
  const restored=await recover({history:[offered]},recoverOptions);
  assert.equal(restored.action.minutes,30);
  assert.equal(await recover({history:[{...offered,action_id:"already-applied"}]},recoverOptions),null);
  assert.equal(await recover({history:[offered],after:new Date().toISOString()},recoverOptions),null);
  assert.equal(await recover({history:[{...offered,created_at:"2020-01-01"}]},recoverOptions),null);
  assert.equal(await recover({history:[offered]}, {...recoverOptions,run:async()=>({...extraction,turn_id:"foreign"})}),null);
  assert.equal(await recover({history:[offered]}, {...recoverOptions,run:async()=>({...extraction,offer:"invented offer"})}),null);
  assert.equal(await recover({history:[offered,{...offered,id:"later",created_at:new Date().toISOString(),action_id:"other-action"}]},recoverOptions),null);
  let reruns=0;
  const recoveredTurn=await brain.plan({prompt:"Yes",context:context(),userId:"A",identity:{}},{
    memories:[],recover:async()=>restored,
    run:async input=>{reruns++;return {...base(),evidence:"Yes",message_kind:"acceptance",
      decision:reruns===1?"ask":"execute",action:reruns===1?null:action(),accepted_proposal:input.pending?.proposal?.fingerprint||null};},
  });
  assert.equal(reruns,2);assert.equal(recoveredTurn.context.brain_request.execute,true);
  assert.equal(recoveredTurn.plan.actions[0].minutes,30);
  const expired=context();expired.memory.conversation_state={bmb_state:{proposal:{...proposed,expires_at:"2020-01-01"}}};
  const expiredReply=await turn({...base(),message_kind:"acceptance",decision:"execute",accepted_proposal:proposed.fingerprint,action:action()},expired);assert.deepEqual(expiredReply.plan.actions,[]); const missing=await turn({...base(),message_kind:"acceptance",decision:"execute",accepted_proposal:null,action:action()});assert.deepEqual(missing.plan.actions,[]);assert.match(missing.plan.response_text,/haven.t applied/);assert.equal(missing.plan.bmb_state.proposal,null);
  result=await turn({...base(),message_kind:"action_request",decision:"execute",action:action()});assert.equal(result.plan.actions.length,1);
  // Regression for the real 3-minute request: no service error, clamping or
  // old proposal surviving to authorize a different block on the next turn.
  for(const minutes of [0,3,241,2.5])for(const type of ["start_protection","set_daily_limit"]) {
    const ctx=context();ctx.memory.conversation_state={bmb_state:{proposal:proposed}};
    const limited=await turn({...base(),message_kind:"action_request",decision:"execute",action:action({minutes,type})},ctx);
    assert.deepEqual(limited.plan.actions,[]);assert.equal(limited.context.brain_request.execute,false);
    assert.equal(limited.plan.bmb_state.proposal,null);assert(limited.plan.bmb_state.recovery_after);
    assert.equal(limited.plan.bmb_state.pending_request,"help");assert.match(limited.plan.response_text,/5 to 240/);
    assert.equal(limited.context.brain_memory_effect,undefined);
  }
  for(const minutes of [5,240]) {
    const supported=await turn({...base(),message_kind:"action_request",decision:"execute",action:action({minutes})});
    assert.equal(supported.plan.actions[0].minutes,minutes);assert.equal(supported.context.brain_request.execute,true);
  }
  const incident="Está yendo muy bien. ¿Me podrías bloquear las distracciones durante tres minutos ahora mismo? Solo una vez.";
  for(const repairFails of [false,true]) {
    let attempts=0;
    const reply="El mínimo son 5 minutos. No he cambiado nada. ¿Quieres que lo prepare con esa duración?";
    const limited=await brain.plan({prompt:incident,context:context(),userId:"A",identity:{}},{memories:[],run:async input=>{
      attempts++;
      if(attempts===1)return {...base(),evidence:incident,response_language:"es",message_kind:"action_request",decision:"execute",action:action({minutes:3})};
      assert.equal(input.tool_budget_remaining,0);assert.match(input.action_constraint,/5 through 240/);
      if(repairFails)throw Error("bmb_timeout");
      return {...base(),evidence:incident,response_language:"es",message_kind:"action_request",decision:"ask",response_text:reply};
    }});
    assert.equal(attempts,2);assert.deepEqual(limited.plan.actions,[]);assert.equal(limited.context.brain_request.execute,false);
    assert.equal(limited.plan.response_text,repairFails
      ? "Los bloqueos y límites admiten entre 5 y 240 minutos. No he aplicado ningún cambio. ¿Qué duración quieres dentro de ese rango?":reply);
  }
  const stale=context();stale.brain_snapshot.generated_at="2020-01-01";
  await assert.rejects(()=>turn({...base(),message_kind:"action_request",decision:"execute",action:action()},stale),/stale_device/);
  result=await turn({...base(),message_kind:"cancellation",decision:"cancel"},ctx);assert.equal(result.plan.bmb_state.proposal,null);assert.equal(result.plan.bmb_invalidates,true);
  await assert.rejects(()=>turn({...base(),response_text:"Your evening: protected"}),/invalid_prose/);
  assert.equal((await turn({...base(),response_text:"Let's start at 22:30."})).plan.response_text,"Let's start at 22:30.");
  await assert.rejects(()=>turn({...base(),cited_sources:["other-user"]}),/unknown_citation/);
  await assert.rejects(()=>turn({...base(),memory:{operation:"set",key:"goal",value:"help",evidence:"help"},message_kind:"question"}),/ungrounded_memory/);
  result=await turn({...base(),memory:{operation:"set",key:"goal",value:"help",evidence:"help"}});assert.equal(result.context.brain_memory_effect.value,"help");
  saved=[{key:"goal",value:null,source_at:"2026-10-01T00:00:00Z"}];calls=[];
  await turn(base());assert(calls.some(c=>c.path.includes("created_at=gt.2026-10-01")),"Forgotten history resurfaced");saved=[];
  history=Array.from({length:41},(_,i)=>({id:String(i),user_text:"old fact",created_at:"2020-01-01"}));
  const page=await brain.readSource("A",{anonymous_user_id:"verified-A"},{source:"history",term:"old",offset:0},null);
  assert.equal(page.next_offset,40);assert.equal(page.rows.length,40);
  assert(calls.at(-1).path.includes("auth_user_id=eq.A"));assert(!calls.at(-1).path.includes("eq.B"));
  assert.equal((await brain.readSource("A",null,{source:"features",offset:0},null)).reason,"no_verified_account_link");history=[];
  const once=action({type:"apply_schedule",minutes:null,start_minute:1350,end_minute:420,local_date:"2027-01-05",timezone:"Europe/Madrid"});
  const dated=brain.normalizeAction(once,Date.parse("2027-01-05T12:00:00Z"));
  assert.equal(dated.starts_at,"2027-01-05T21:30:00.000Z");assert.equal(dated.ends_at,"2027-01-06T06:00:00.000Z");assert.deepEqual(dated.weekdays,[]);
  assert.throws(()=>brain.normalizeAction({...once,local_date:"2027-03-28",start_minute:150,end_minute:240},Date.parse("2027-03-27")),/missing_local_time/);
  assert.throws(()=>brain.normalizeAction({...once,local_date:"2026-10-25",start_minute:150,end_minute:240},Date.parse("2026-10-24")),/ambiguous/);
  assert.throws(()=>brain.normalizeAction({...once,local_date:"2020-01-01"}),/invalid_once/);
  assert.equal(brain.normalizeAction({...once,recurrence:"continuous",local_date:null,weekdays:[1,2],duration_days:null}).duration_days,null);
  const p=policy.settings({timezone:"Europe/Madrid",grant:{active:true,action_types:["start_protection"],expires_at:"2027-01-01",start_minute:1320,end_minute:480},notifications:{enabled:true}});
  assert.equal(policy.actionGate(action(),p,context(),Date.parse("2026-10-03T21:00:00Z")).allowed,true);
  assert.equal(policy.actionGate(action(),p,context(),Date.parse("2026-10-03T12:00:00Z")).allowed,false);
  assert.equal(policy.actionGate(action({minutes:45}),p,context(),Date.parse("2026-10-03T21:00:00Z")).allowed,false);
  assert.equal(policy.actionGate(action(),{...p,grant:{...p.grant,active:false}},context()).allowed,false);
  assert.equal(policy.actionGate(action(),p,{...context(),vacation_mode_active:true},Date.parse("2026-10-03T21:00:00Z")).allowed,false);
  const event={kind:"opportunity",expires_at:"2027-01-01"},nc={notification_authorized:true};
  assert.equal(policy.notificationGate(event,p,nc,Date.parse("2026-10-03T12:00:00Z")).allowed,true);
  assert.equal(policy.notificationGate(event,p,{...nc,chat_active_until:"2027-01-01"},Date.parse("2026-10-03T12:00:00Z")).allowed,false);
  assert.equal(policy.notificationGate(event,p,nc,Date.parse("2026-10-03T21:00:00Z")).allowed,false);
  assert.equal(policy.notificationExpiry({expires_at:"2026-10-04T01:00:00Z"},p,Date.parse("2026-10-03T19:59:00Z")),"2026-10-03T20:00:00.000Z","Stored APNs notification crossed local quiet boundary");
  assert.equal(policy.notificationGate({...event,expires_at:"2020-01-01"},p,nc).allowed,false);
  assert.equal(policy.settings().notifications.max_per_day,1);assert.equal(policy.settings().notifications.max_per_week,3);
  const sources=require("../netlify/functions/bmb-sources");
  const accountSnapshot=require("../netlify/functions/bm-brain-data").normalizeBrainSnapshot({schema_version:1,generated_at:new Date().toISOString(),timezone:"UTC",sessions:[],
    account:{signed_in:true,premium_access:true,active_product_ids:["blank_monthly","private&token"],referral_trial_ends_at:"2026-11-01T00:00:00Z",referral_count:2,token:"secret"}});
  assert.deepEqual(accountSnapshot.account.active_product_ids,["blank_monthly"]);assert.equal(accountSnapshot.account.referral_count,2);
  assert.equal(accountSnapshot.account.billing_details_available,false);assert.equal(accountSnapshot.account.token,undefined);
  const scrubbed=sources.sanitize({token:"secret",nested:{encrypted_access_token:"secret",goal:"sleep",applicationTokens:["private"]}});
  assert.deepEqual(scrubbed,{nested:{goal:"sleep"}});
  assert(sources.SOURCE_NAMES.includes("onboarding")&&sources.SOURCE_NAMES.includes("learned_signals")&&sources.SOURCE_NAMES.includes("protection_statistics"));
  let sourcePath;
  await sources.readSource("A",{anonymous_user_id:"verified-A"},{source:"wearable_connections",offset:0},null,async p=>{sourcePath=p;return [];});
  assert(!sourcePath.includes("encrypted")&&sourcePath.includes("anonymous_user_id=eq.verified-A"));
  await sources.readSource("A",{anonymous_user_id:"verified-A"},{source:"onboarding",offset:0},"2026-10-01",async p=>{sourcePath=p;return [];});
  assert(sourcePath.includes("data_consent=eq.true")&&sourcePath.includes("created_at=gt.2026-10-01"));
  const all=sources.readSource("A",null,{source:"protection_statistics",offset:0,from:"2026-10-01T10:00:00Z",to:"2026-10-01T12:00:00Z",timezone:"UTC"},null,async()=>[
    {id:"one",started_at:"2026-10-01T10:00:00Z",ended_at:"2026-10-01T11:00:00Z",observed_at:new Date().toISOString()},
    {id:"two",started_at:"2026-10-01T10:30:00Z",ended_at:"2026-10-01T11:30:00Z",pause_started_at:"2026-10-01T11:00:00Z",pause_ended_at:"2026-10-01T11:15:00Z",observed_at:new Date().toISOString()}]);
  assert.equal((await all).rows[0].protected_seconds,4500,"Overlaps or pause double-counted");
  const common=policy.settings({timezone:"UTC",grant:{active:true,action_types:["start_protection"],expires_at:"2027-01-01"},notifications:{enabled:true}});
  const ledger=[{id:"act",kind:"action",event_key:"A",meaning_key:"A",initiative_key:"A",created_at:new Date().toISOString()}];
  assert.equal(policy.budgetGate("notification",{event_key:"B",meaning_key:"B"},common,ledger).allowed,false,"Two unrelated initiatives consumed default daily budget");
  assert.equal(policy.budgetGate("notification",{event_key:"receipt:act",meaning_key:"receipt:act",facts:{source:"native_receipt",event_id:"act"}},common,ledger).allowed,true,"Receipt counted as an unrelated initiative");
  const push=require("../netlify/functions/_assistant_push").pushPayload({id:"x"},{silent:true});assert.equal(push.aps.alert,undefined);assert.equal(push.bm_autonomous,true);
  const prose=require("../netlify/functions/assistant-app").visibleReply({bmb_generated:true,message_text:"I'll give this a try.",actions:[action()]},context(),action());assert.equal(prose,"I'll give this a try.");
  console.log("BMB: generative output, exact acceptance, detours/cancellation, account history/pagination, memory tombstones, date/DST/overnight/continuous schedules, current grants/pauses/revocation and separate notifications passed");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
