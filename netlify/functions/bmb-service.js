"use strict";
const {supabaseFetch,json}=require("./_membership");
const {settings,actionGate,fingerprint,notificationGate}=require("./bmb-policy");
const {normalizeBrainSnapshot}=require("./bm-brain-data");
async function account(userId) {
  const rows=await supabaseFetch(`bmb_accounts?auth_user_id=eq.${encodeURIComponent(userId)}&select=*`,{method:"GET"});
  return rows[0]||{auth_user_id:userId,version:0,settings:settings()};
}
async function api(auth,body) {
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
    if(snapshot.sessions.length)await supabaseFetch("bmb_sessions?on_conflict=auth_user_id,id",{method:"POST",headers:{prefer:"resolution=merge-duplicates"},body:JSON.stringify(snapshot.sessions.map(s=>({...s,auth_user_id:auth.user.id,observed_at:snapshot.generated_at})))});
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
  const rows=await supabaseFetch(`bmb_events?id=eq.${encodeURIComponent(actionId.slice(4))}&auth_user_id=eq.${encodeURIComponent(userId)}&kind=eq.action&select=*`,{method:"GET"});
  if(!rows[0])throw Error("bmb_receipt_not_found");
  if(rows[0].outcome.status&&rows[0].outcome.status!==status)throw Error("bmb_receipt_conflict");
  await supabaseFetch(`bmb_events?id=eq.${encodeURIComponent(rows[0].id)}&auth_user_id=eq.${encodeURIComponent(userId)}`,{method:"PATCH",body:JSON.stringify({outcome:{...rows[0].outcome,status,device_evidence:evidence,received_at:new Date().toISOString()}})});
}
function opportunities(sessions,events,now=Date.now()) {
  const candidates=[];
  const recent=sessions.filter(s=>Date.parse(s.ended_at)>now-7*86400000&&["manual","emergency"].includes(s.ended_reason));
  if(recent.length>=2)candidates.push({kind:"opportunity",priority:40,
    event_key:fingerprint(recent.map(s=>s.id).sort()),meaning_key:`early_exits:${recent.map(s=>s.id).sort().join(",")}`,
    expires_at:new Date(now+6*3600000).toISOString(),facts:{source:"recorded_protection_sessions",ids:recent.map(s=>s.id),early_exits:recent.length,inference:"Repeated early protection exits may be a useful moment to offer help; this is not measured phone use."}});
  for(const e of events.filter(e=>e.kind==="action"&&["verified","delayed","failed"].includes(e.outcome?.status)))candidates.push({
    kind:e.outcome.status==="failed"?"failure":"intervention",priority:e.outcome.status==="failed"?90:70,
    event_key:`receipt:${e.id}`,meaning_key:`receipt:${e.id}`,expires_at:e.expires_at,
    facts:{source:"native_receipt",event_id:e.id,action:e.action,outcome:e.outcome}});
  return candidates.filter(c=>Date.parse(c.expires_at)>now).sort((a,b)=>b.priority-a.priority);
}
async function tickAccount(a,{brain=require("./bmb-brain").plan,push=require("./_assistant_push").sendAssistantActionPush,notify=require("./_assistant_push").sendBMBNotification}={}) {
  const identity=await require("./_identity").identityForAuthUser(a.auth_user_id);
  if(!identity||identity.app_install_id!==a.app_install_id)return {skipped:"installation_changed"};
  const channel=require("./_assistant_channel");
  const memory=await channel.getAssistantMemory("app",a.auth_user_id,{requireSemantic:true});
  const context=await require("./_bm_user_context").enrichAssistantContext({},identity.assistant_connect_code);
  context.memory=memory;context.language=memory.language||"en";
  const sessions=await supabaseFetch(`bmb_sessions?auth_user_id=eq.${encodeURIComponent(a.auth_user_id)}&ended_at=gte.${encodeURIComponent(new Date(Date.now()-7*86400000).toISOString())}&select=*&limit=2000`,{method:"GET"});
  const events=await supabaseFetch(`bmb_events?auth_user_id=eq.${encodeURIComponent(a.auth_user_id)}&kind=eq.action&created_at=gte.${encodeURIComponent(new Date(Date.now()-86400000).toISOString())}&select=*`,{method:"GET"});
  const candidates=opportunities(sessions,events);
  const signals=await supabaseFetch(`bmb_device_signals?auth_user_id=eq.${encodeURIComponent(a.auth_user_id)}&occurred_at=gte.${encodeURIComponent(new Date(Date.now()-6*3600000).toISOString())}&select=*&order=occurred_at.desc&limit=100`,{method:"GET"});
  for(const s of signals)candidates.push({kind:"opportunity",priority:60,event_key:`threshold:${s.id}`,meaning_key:`threshold:${s.occurred_at.slice(0,10)}:${s.threshold_minutes}`,
    expires_at:new Date(Date.parse(s.occurred_at)+6*3600000).toISOString(),facts:{source:"native_threshold",source_id:s.id,threshold_minutes:s.threshold_minutes,occurred_at:s.occurred_at,measurement:"Selected distractions reached the configured aggregate usage threshold; no per-app usage is available."}});
  candidates.sort((a,b)=>b.priority-a.priority);
  if(!candidates.length)return {skipped:"no_verified_opportunity"};
  // Choose the highest-value verified event once; do not fill the budget for its own sake.
  const selected=candidates[0];
  const canNotify=notificationGate(selected,a.settings,context).allowed;
  const canAct=a.settings.grant?.active&&selected.kind==="opportunity";
  if(!canNotify&&!canAct)return {skipped:"policy"};
  const prior=await supabaseFetch(`bmb_events?auth_user_id=eq.${encodeURIComponent(a.auth_user_id)}&event_key=eq.${encodeURIComponent(selected.event_key)}&select=id,kind`,{method:"GET"});
  if(prior.some(e=>e.kind==="notification")&&(!canAct||prior.some(e=>e.kind==="action")))return {skipped:"duplicate"};
  const {plan}=await brain({prompt:"",context,userId:a.auth_user_id,identity,proactive:{selected,other_opportunities:candidates.slice(1,4)}});
  if(plan.proactive_decision==="silent")return {skipped:"model_silent"};
  const action=plan.proactive_action;
  const claim=async(kind,payload)=>{
    const result=await supabaseFetch("rpc/bmb_claim_event",{method:"POST",body:JSON.stringify({p_user:a.auth_user_id,p_version:a.version,p_event:{...selected,kind,...payload}})});
    return Array.isArray(result)?result[0]:result;
  };
  if(action&&actionGate(action,a.settings,context).allowed&&!prior.some(e=>e.kind==="action")) {
    const reserved=await claim("action",{action});
    if(reserved.claimed) {
      const pending=require("./bm-pending-action").pendingActionFromPlan({actions:[action],message_text:plan.message_text});
      pending.id=`bmb_${reserved.id}`;pending.expires_at=new Date(Math.min(Date.parse(selected.expires_at),Date.now()+30*60000)).toISOString();
      // Expiry is immutable and shared by ledger and inbox.
      await supabaseFetch(`bmb_events?id=eq.${reserved.id}&auth_user_id=eq.${a.auth_user_id}`,{method:"PATCH",body:JSON.stringify({expires_at:pending.expires_at})});
      pending.autonomous=true;pending.grant_version=a.version;
      const queued=await supabaseFetch("rpc/bmb_enqueue_event",{method:"POST",body:JSON.stringify({p_user:a.auth_user_id,p_id:reserved.id,p_action:pending})});
      if((Array.isArray(queued)?queued[0]:queued)?.enqueued) {
        const result=await push(memory.assistant_device_push,pending,{silent:true});
        await supabaseFetch(`bmb_events?id=eq.${reserved.id}&auth_user_id=eq.${a.auth_user_id}`,{method:"PATCH",body:JSON.stringify({outcome:{enqueued_at:new Date().toISOString(),transport:result}})});
      }
      return {action_reserved:reserved.id}; // Notify only after device confirmation, separately.
    }
  }
  if(canNotify) {
    const reserved=await claim("notification",{});
    if(reserved.claimed) {
      const result=await notify(memory.assistant_device_push,{id:reserved.id,text:plan.message_text,expires_at:selected.expires_at});
      await supabaseFetch(`bmb_events?id=eq.${reserved.id}&auth_user_id=eq.${a.auth_user_id}`,{method:"PATCH",body:JSON.stringify({outcome:{transport:result,message_text:plan.message_text}})});
      return {notification_reserved:reserved.id};
    }
  }
  return {skipped:"budget_or_duplicate"};
}
module.exports={account,api,autonomousPendingAllowed,receipt,opportunities,tickAccount};
