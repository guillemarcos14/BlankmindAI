"use strict";
// Production service + planner, synthetic provider/DB/native receipt/transport.
// PostgreSQL runs the actual atomic functions separately in CI. No device claim.
const assert=require("node:assert/strict");
const {tickAccount,opportunities}=require("../netlify/functions/bmb-service");
const brain=require("../netlify/functions/bmb-brain");
const {settings}=require("../netlify/functions/bmb-policy");
const crypto=require("node:crypto");
const now=()=>new Date().toISOString();
async function main(){
  const a={auth_user_id:"account-A",app_install_id:"install-A",version:1,settings:settings({timezone:"UTC",grant:{active:true,action_types:["start_protection"],expires_at:new Date(Date.now()+86400000).toISOString()},notifications:{enabled:true,start_minute:0,end_minute:0}})};
  const sessions=[1,2].map(i=>({id:`session-${i}`,ended_at:now(),ended_reason:"manual"}));
  let ledger=[],queued=[],pushes=[],notices=[],modelCalls=0,assessed=new Set(),failQueue=false;
  const context={has_selected_apps:true,screen_time_authorized:true,notification_authorized:true,
    brain_snapshot:{generated_at:now(),timezone:"UTC",sessions:[]}};
  const db=async(path,options={})=>{
    const p=options.body?JSON.parse(options.body):{};
    if(path.startsWith("bmb_sessions?"))return sessions;
    if(path.startsWith("bmb_followups?"))return [];
    if(path==="rpc/bmb_claim_daily_review")return {claimed:false};
    if(path.startsWith("assistant_app_turns?"))return [];
    if(path.startsWith("bmb_device_signals?"))return [{id:"signal-A",occurred_at:now(),threshold_minutes:30}];
    if(path.startsWith("bmb_accounts?"))return [a];
    if(path.startsWith("bmb_events?")) {
      const q=new URL("https://db/"+path).searchParams;
      assert.equal(q.get("auth_user_id"),"eq.account-A","Cross-account data read");
      return ledger.filter(e=>(!q.has("id")||q.get("id")==="eq."+e.id)&&(!q.has("event_key")||q.get("event_key")==="eq."+e.event_key));
    }
    if(path==="rpc/bmb_claim_assessment") {
      const key=p.p_version+":"+p.p_event_key;if(assessed.has(key))return false;assessed.add(key);return true;
    }
    if(path==="rpc/bmb_claim_event") {
      if(p.p_version!==a.version)return {claimed:false};
      const e=p.p_event,id=crypto.randomUUID();
      const root=e.facts.source==="native_receipt"?ledger.find(r=>r.id===e.facts.event_id).initiative_key:e.meaning_key;
      ledger.push({...e,id,initiative_key:root,grant_version:a.version,created_at:now(),outcome:{message_text:e.message_text}});
      return {claimed:true,id};
    }
    if(path==="rpc/bmb_enqueue_event") {
      if(failQueue){failQueue=false;throw Error("synthetic_worker_interruption");}
      const e=ledger.find(r=>r.id===p.p_id);
      assert.equal(p.p_action.expires_at,e.expires_at);
      assert.equal(p.p_action.grant_version,a.version);
      assert.equal(p.p_action.autonomous,true);
      queued.push(p.p_action);e.outcome.enqueued_at=now();return {enqueued:true};
    }
    if(path==="rpc/bmb_merge_outcome") {const e=ledger.find(r=>r.id===p.p_id);e.outcome={...e.outcome,...p.p_patch};return null;}
    throw Error("Unexpected database call "+path);
  };
  const deps={db,identityLookup:async()=>({app_install_id:"install-A",assistant_connect_code:"verified"}),getMemory:async()=>({language:"en",assistant_device_push:{}}),getContext:async()=>structuredClone(context),
    brain:args=>brain.plan(args,{db,memories:[],run:async input=>{
      modelCalls++;
      const execute=input.proactive.selected.kind==="opportunity";
      assert.equal(execute?input.proactive.can_execute:input.proactive.can_notify,true);
      return {phase:"final",response_text:execute?"I'll try a short protection block.":"Your protection started on your iPhone.",response_language:"en",message_kind:"statement",decision:execute?"execute":"respond",evidence:"",accepted_proposal:null,pending_request:null,queries:[],memory:null,cited_sources:[],
        action:execute?{type:"start_protection",minutes:30,hard_mode:false}:null};
    }}),push:async(device,pending,options)=>{pushes.push(pending);assert.equal(options.silent,true);return {sent:true};},notify:async(device,event)=>{notices.push(event);return {sent:true};}};
  // Reservation survives interruption; retry reuses ID/expiry and no model call.
  failQueue=true;await assert.rejects(()=>tickAccount(a,deps),/interruption/);
  assert.equal(ledger.length,1);assert.equal(queued.length,0);
  await tickAccount(a,deps);assert.equal(queued.length,1);assert.equal(modelCalls,1);assert.equal(notices.length,0);
  assert.equal(queued[0].id,"bmb_"+ledger[0].id);
  // Synthetic native receipt, explicitly not a real Screen Time observation.
  ledger[0].outcome={...ledger[0].outcome,status:"verified",received_at:now(),device_evidence:{result:"native_verified",requested_duration_minutes:30}};
  await tickAccount(a,deps);assert.equal(notices.length,1);assert.equal(modelCalls,2);assert.equal(ledger[0].outcome.status,"verified");
  await tickAccount(a,deps);assert.equal(notices.length,1);assert.equal(modelCalls,2,"Duplicate spent provider budget");
  assert.equal(ledger[1].initiative_key,ledger[0].initiative_key,"Receipt split the account initiative budget");
  // Current pause/revocation is checked again before a reserved effect is queued.
  ledger=[{...ledger[0],outcome:{},expires_at:new Date(Date.now()+600000).toISOString()}];a.settings.grant.active=false;
  await tickAccount(a,deps);assert.equal(queued.length,1);assert.equal(modelCalls,2);
  const expiredAction={...ledger[0],expires_at:"2020-01-01",outcome:{status:"verified",received_at:now()}};
  assert(opportunities([], [expiredAction]).length===1,"Receipt inherited expired action delivery window");
  a.app_install_id="different-install";
  assert.equal((await tickAccount(a,deps)).skipped,"installation_changed");
  console.log("BMB loop: contextual decision → current grant → durable reservation/retry → canonical inbox → synthetic native receipt → free-text notice → shared budget/replay/revocation passed");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
