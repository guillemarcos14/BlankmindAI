"use strict";
const {supabaseFetch,json}=require("./_membership");
const {settings,actionGate,fingerprint,notificationGate,budgetGate,notificationExpiry}=require("./bmb-policy");
const longitudinal=require("./bmb-longitudinal");
const {normalizeBrainSnapshot}=require("./bm-brain-data");
async function account(userId) {
  const rows=await supabaseFetch(`bmb_accounts?auth_user_id=eq.${encodeURIComponent(userId)}&select=*`,{method:"GET"});
  return rows[0]||{auth_user_id:userId,version:0,settings:settings()};
}
async function api(auth,body) {
  if(body.action==="bmb_followup") {
    if(typeof body.event_id!=="string"||!/^[-\da-f]{36}$/i.test(body.event_id))return json(400,{error:"invalid_event_id"});
    const followup=await longitudinal.greetingContext(auth.user.id,supabaseFetch,body.event_id);
    return json(200,{ok:true,text:followup?.question||null});
  }
  if(body.action==="bmb_settings")return json(200,{ok:true,account:await account(auth.user.id)});
  if(body.action==="bmb_activity")return json(200,{ok:true,events:await supabaseFetch(`bmb_events?auth_user_id=eq.${encodeURIComponent(auth.user.id)}&select=id,kind,outcome,feedback,created_at&order=created_at.desc&limit=10`,{method:"GET"})});
  if(body.action==="bmb_sync_signals") {
    if(!Array.isArray(body.signals)||body.signals.length>100||body.signals.some(s=>!/^[-\da-f]{36}$/i.test(s.id)||s.kind!=="daily_limit_reached"||!Number.isFinite(Date.parse(s.occurred_at))||Date.parse(s.occurred_at)>Date.now()+30000||!Number.isInteger(s.threshold_minutes)||s.threshold_minutes<5||s.threshold_minutes>1440))return json(400,{error:"invalid_device_signals"});
    if(body.signals.length)await supabaseFetch("bmb_device_signals?on_conflict=auth_user_id,id",{method:"POST",headers:{prefer:"resolution=ignore-duplicates"},body:JSON.stringify(body.signals.map(s=>({auth_user_id:auth.user.id,id:s.id,kind:s.kind,occurred_at:s.occurred_at,threshold_minutes:s.threshold_minutes})))});
    return json(200,{ok:true});
  }
  if(body.action==="bmb_save_settings") {
    const normalized=settings(body.settings);
    if(!Number.isSafeInteger(body.version)||body.version<0)return json(400,{error:"bmb_invalid_version"});
    const rows=await supabaseFetch("rpc/bmb_save_settings",{method:"POST",body:JSON.stringify({p_user:auth.user.id,p_install:auth.identity.app_install_id,p_settings:normalized,p_version:body.version})});
    const result=Array.isArray(rows)?rows[0]:rows;
    return json(result.saved?200:409,{ok:result.saved,...result});
  }
  if(body.action==="bmb_sync_sessions") {
    const snapshot=normalizeBrainSnapshot(body.snapshot);
    if(!snapshot||snapshot.sessions.length!==body.snapshot.sessions.length)return json(400,{error:"invalid_session_page"});
    if(snapshot.sessions.length)await supabaseFetch("rpc/bmb_sync_sessions",{method:"POST",body:JSON.stringify({p_user:auth.user.id,p_observed:snapshot.generated_at,p_rows:snapshot.sessions})});
    return json(200,{ok:true,count:snapshot.sessions.length});
  }
  if(body.action==="bmb_feedback") {
    if(!/^[\da-f-]{36}$/i.test(body.event_id)||!["helpful","unhelpful","wrong_time","too_frequent"].includes(body.feedback))return json(400,{error:"invalid_feedback"});
    const rows=await supabaseFetch(`bmb_events?id=eq.${encodeURIComponent(body.event_id)}&auth_user_id=eq.${encodeURIComponent(auth.user.id)}`,{method:"PATCH",headers:{prefer:"return=representation"},body:JSON.stringify({feedback:{value:body.feedback,at:new Date().toISOString()}})});
    return json(rows.length?200:404,{ok:rows.length>0});
  }
  return null;
}
async function autonomousPendingAllowed(userId,pending,context) {
  if(!pending?.id?.startsWith("bmb_"))return true;
  const current=await account(userId);
  const ev=await supabaseFetch(`bmb_events?id=eq.${encodeURIComponent(pending.id.slice(4))}&auth_user_id=eq.${encodeURIComponent(userId)}&kind=eq.action&select=*`,{method:"GET"});
  return Boolean(ev[0]&&ev[0].grant_version===current.version&&ev[0].expires_at===pending.expires_at
    &&actionGate(ev[0].action,current.settings,context).allowed);
}
async function receipt(userId,actionId,status,evidence) {
  if(!actionId.startsWith("bmb_"))return;
  await mergeOutcome(userId,actionId.slice(4),{status,device_evidence:evidence,received_at:new Date().toISOString()});
}
const mergeOutcome=(userId,id,patch,db=supabaseFetch)=>db("rpc/bmb_merge_outcome",{method:"POST",body:JSON.stringify({p_user:userId,p_id:id,p_patch:patch})});
function opportunities(events,now=Date.now()) {
  const candidates=[];
  for(const e of events.filter(e=>e.kind==="action"&&["verified","delayed","failed"].includes(e.outcome?.status)))candidates.push({
    kind:e.outcome.status==="failed"?"failure":"intervention",priority:e.outcome.status==="failed"?90:70,
    event_key:`receipt:${e.id}`,meaning_key:`receipt:${e.id}`,expires_at:new Date(Date.parse(e.outcome.received_at||e.created_at)+6*3600000).toISOString(),
    facts:{source:"native_receipt",event_id:e.id,action:e.action,outcome:e.outcome}});
  return candidates.filter(c=>Date.parse(c.expires_at)>now).sort((a,b)=>b.priority-a.priority);
}
async function tickAccount(a,{brain=require("./bmb-brain").plan,push=require("./_assistant_push").sendAssistantActionPush,notify=require("./_assistant_push").sendBMBNotification,
  db=supabaseFetch,identityLookup=require("./_identity").identityForAuthUser,getMemory=require("./_assistant_channel").getAssistantMemory,getContext=require("./_bm_user_context").enrichAssistantContext}={}) {
  const identity=await identityLookup(a.auth_user_id);
  if(!identity||identity.app_install_id!==a.app_install_id)return {skipped:"installation_changed"};
  const memory=await getMemory("app",a.auth_user_id,{requireSemantic:true});
  const context=await getContext({},identity.assistant_connect_code);
  context.memory=memory;context.language=memory.language||"en";
  await longitudinal.dailyReview(a,identity,context,brain,db);
  const events=await db(`bmb_events?auth_user_id=eq.${encodeURIComponent(a.auth_user_id)}&created_at=gte.${encodeURIComponent(new Date(Date.now()-7*86400000).toISOString())}&select=*&order=created_at.desc`,{method:"GET"});
  // Resume a reservation after worker interruption using the same action ID and
  // expiry. APNs acceptance is transport evidence only, never device execution.
  const deliver=async ev=>{
    if(!actionGate(ev.action,a.settings,context).allowed)return {skipped:"current_policy"};
    const pending=require("./bm-pending-action").pendingActionFromPlan({actions:[ev.action],message_text:ev.outcome.message_text},{now:Date.parse(ev.created_at)});
    pending.id=`bmb_${ev.id}`;pending.expires_at=ev.expires_at;pending.autonomous=true;pending.grant_version=ev.grant_version;
    const queued=await db("rpc/bmb_enqueue_event",{method:"POST",body:JSON.stringify({p_user:a.auth_user_id,p_id:ev.id,p_action:pending})});
    if((Array.isArray(queued)?queued[0]:queued)?.enqueued&&!ev.outcome.transport?.sent) {
      const transport=await push(memory.assistant_device_push,pending,{silent:true});
      await mergeOutcome(a.auth_user_id,ev.id,{transport},db);
    }
    return {action_reserved:ev.id};
  };
  const waiting=events.find(e=>e.kind==="action"&&!e.outcome.status&&e.grant_version===a.version&&Date.parse(e.expires_at)>Date.now());
  if(waiting)return deliver(waiting);
  const deliverNotice=async ev=>{
    const current=await db(`bmb_accounts?auth_user_id=eq.${encodeURIComponent(a.auth_user_id)}&select=settings,version`,{method:"GET"});
    if(current[0]?.version!==ev.grant_version)return {skipped:"grant_changed"};
    const event={...ev,kind:ev.facts.notice_kind||"opportunity"};
    if(!notificationGate(event,current[0].settings,context).allowed)return {skipped:"notification_policy"};
    if(ev.facts.followup_id&&!(await longitudinal.followups(a.auth_user_id,db)).some(f=>f.id===ev.facts.followup_id))return {skipped:"followup_closed"};
    const attempts=(ev.outcome.notification_attempts||0)+1;
    await mergeOutcome(a.auth_user_id,ev.id,{notification_attempts:attempts,next_retry_at:new Date(Date.now()+30*60000).toISOString()},db);
    const transport=await notify(memory.assistant_device_push,{id:ev.id,text:ev.outcome.message_text,expires_at:ev.expires_at});
    await mergeOutcome(a.auth_user_id,ev.id,{transport},db);
    return {notification_reserved:ev.id};
  };
  const retry=events.find(e=>e.kind==="notification"&&!e.outcome.transport?.sent&&e.grant_version===a.version
    &&Date.parse(e.expires_at)>Date.now()&&(e.outcome.notification_attempts||0)<3
    &&(!e.outcome.next_retry_at||Date.parse(e.outcome.next_retry_at)<=Date.now()));
  if(retry)return deliverNotice(retry);
  const candidates=opportunities(events);
  candidates.push(...await longitudinal.reviewOpportunities(a.auth_user_id,a.settings.timezone,db));
  for(const f of await longitudinal.followups(a.auth_user_id,db))candidates.push({kind:"opportunity",priority:45,
    event_key:`followup:${f.id}`,meaning_key:`followup:${f.id}`,expires_at:new Date(Date.parse(f.created_at)+7*86400000).toISOString(),
    facts:{source:"longitudinal_followup",followup_id:f.id,question:f.question,metric:f.metric,evidence_ids:f.evidence_ids}});
  const signals=await db(`bmb_device_signals?auth_user_id=eq.${encodeURIComponent(a.auth_user_id)}&occurred_at=gte.${encodeURIComponent(new Date(Date.now()-6*3600000).toISOString())}&select=*&order=occurred_at.desc&limit=100`,{method:"GET"});
  for(const s of signals)candidates.push({kind:"opportunity",priority:60,event_key:`threshold:${s.id}`,meaning_key:`threshold:${s.occurred_at.slice(0,10)}:${s.threshold_minutes}`,
    expires_at:new Date(Date.parse(s.occurred_at)+6*3600000).toISOString(),facts:{source:"native_threshold",source_id:s.id,threshold_minutes:s.threshold_minutes,occurred_at:s.occurred_at,measurement:"Selected distractions reached the configured aggregate usage threshold; no per-app usage is available."}});
  candidates.sort((a,b)=>b.priority-a.priority);
  if(!candidates.length)return {skipped:"no_verified_opportunity"};
  // Choose the highest-value verified event once; do not fill the budget for its own sake.
  const selected=candidates.find(c=>notificationGate(c,a.settings,context).allowed&&budgetGate("notification",c,a.settings,events).allowed
    ||c.kind==="opportunity"&&a.settings.grant?.active&&budgetGate("action",c,a.settings,events).allowed);
  if(!selected)return {skipped:"policy_or_budget"};
  const canNotify=notificationGate(selected,a.settings,context).allowed&&budgetGate("notification",selected,a.settings,events).allowed;
  const canAct=selected.facts.source!=="longitudinal_followup"&&selected.kind==="opportunity"&&a.settings.grant?.active&&actionGate({type:a.settings.grant.action_types[0],minutes:Math.min(30,a.settings.grant.max_minutes)},a.settings,context).allowed&&budgetGate("action",selected,a.settings,events).allowed;
  if(!canNotify&&!canAct)return {skipped:"policy"};
  const prior=await db(`bmb_events?auth_user_id=eq.${encodeURIComponent(a.auth_user_id)}&event_key=eq.${encodeURIComponent(selected.event_key)}&select=id,kind`,{method:"GET"});
  if(prior.some(e=>e.kind==="notification")&&(!canAct||prior.some(e=>e.kind==="action")))return {skipped:"duplicate"};
  const assessment=await db("rpc/bmb_claim_assessment",{method:"POST",body:JSON.stringify({p_user:a.auth_user_id,p_version:a.version,p_event_key:selected.event_key})});
  if(!(Array.isArray(assessment)?assessment[0]:assessment))return {skipped:"already_assessed"};
  const {plan}=await brain({prompt:"",context,userId:a.auth_user_id,identity,proactive:{selected,can_execute:canAct,can_notify:canNotify,recent_feedback:events.filter(e=>e.feedback).map(e=>({id:e.id,feedback:e.feedback,created_at:e.created_at})).slice(0,10),other_opportunities:candidates.slice(1,4)}});
  if(plan.proactive_decision==="silent")return {skipped:"model_silent"};
  // Re-read canonical policy after the provider call, before an external alert.
  const latest=await db(`bmb_accounts?auth_user_id=eq.${encodeURIComponent(a.auth_user_id)}&select=version`,{method:"GET"});
  if(latest[0]?.version!==a.version)return {skipped:"grant_changed"};
  const action=plan.proactive_action;
  const claim=async(kind,payload)=>{
    const result=await db("rpc/bmb_claim_event",{method:"POST",body:JSON.stringify({p_user:a.auth_user_id,p_version:a.version,p_event:{...selected,kind,message_text:plan.message_text,...payload}})});
    return Array.isArray(result)?result[0]:result;
  };
  if(action) {
    if(!canAct||!actionGate(action,a.settings,context).allowed)return {skipped:"model_action_outside_grant"};
    const reserved=await claim("action",{action,expires_at:new Date(Math.min(Date.parse(selected.expires_at),Date.now()+30*60000)).toISOString()});
    if(reserved.claimed) {
      const stored=await db(`bmb_events?id=eq.${reserved.id}&auth_user_id=eq.${encodeURIComponent(a.auth_user_id)}&select=*`,{method:"GET"});
      return deliver(stored[0]);
    }
    return {skipped:"budget_or_duplicate"};
  }
  if(canNotify) {
    const expiry=notificationExpiry(selected,a.settings);
    const reserved=await claim("notification",{expires_at:expiry,facts:{...selected.facts,notice_kind:selected.kind}});
    if(reserved.claimed) {
      const stored=await db(`bmb_events?id=eq.${reserved.id}&auth_user_id=eq.${encodeURIComponent(a.auth_user_id)}&select=*`,{method:"GET"});
      return deliverNotice(stored[0]);
    }
  }
  return {skipped:"budget_or_duplicate"};
}
module.exports={account,api,autonomousPendingAllowed,receipt,opportunities,tickAccount};
