"use strict";
// Real Jev + private QA RPC/RLS. Authored synthetic completed-turn fixtures;
// labeling starts after those rows exist, without any foreground request waiting.
const fs=require("node:fs"),crypto=require("node:crypto");
const {configuration}=require("./assistant_app_cloud_test"),jev=require("../netlify/functions/bm-jev");
async function main(){
 if(!process.argv.includes("--run")||!process.env.TYPESAFE_API_KEY)throw Error("jev_explicit_shadow_required");
 const c=configuration();if(process.env.SUPABASE_URL!==c.supabase)throw Error("jev_private_qa_required");
 const service={apikey:c.serviceKey,authorization:"Bearer "+c.serviceKey},runId=crypto.randomUUID(),since=new Date(Date.now()-60000).toISOString(),users=[],stages=[],cleanup=[],checks=[];
 const request=async(route,body,method="POST",headers=service)=>{
  const r=await fetch(c.supabase+route,{method,headers:{"content-type":"application/json",...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error("jev_qa_http_"+r.status);return r.json().catch(()=>null);
 };
 const assert=(value,code)=>{if(!value)throw Error(code);checks.push(code);};
 const db=(route,options)=>request("/rest/v1/"+route,JSON.parse(options.body));
 const before=Object.fromEntries(["BM_JEV_SHADOW_ENABLED","BM_JEV_DATA_POLICY","BM_JEV_QA_USERS","BM_JEV_QA_SINCE","BM_JEV_QA_PERCENT","BM_JEV_PREFETCH_EXPERIMENT"].map(k=>[k,process.env[k]]));
 let failure=null;
 try{
  for(let i=0;i<2;i++)users.push((await request("/auth/v1/admin/users",{email:`jev-shadow-${runId}-${i}@example.invalid`,password:crypto.randomBytes(28).toString("base64url"),email_confirm:true,
   app_metadata:i?{}:{provider:"apple",providers:["apple"],synthetic_staging_run:runId}})).id);
  const corpus=require("./datasets/bm_jev_v1.json").cases.slice(0,40),turns=corpus.map(x=>({id:crypto.randomUUID(),auth_user_id:users[0],user_text:x.current_message,assistant_text:"Authored synthetic completed reply for isolated advisory QA.",status:"completed",completed_at:new Date().toISOString()}));
  const denied=crypto.randomUUID();await request("/rest/v1/assistant_app_turns",[...turns,{id:denied,auth_user_id:users[1],user_text:"Synthetic negative control",assistant_text:"Reply",status:"completed",completed_at:new Date().toISOString()}]);
  assert(!(await request("/rest/v1/rpc/bm_jev_reserve",{p_user:users[1],p_turn:denied,p_since:since,p_mode:"shadow"})).claimed,"non_synthetic_server_metadata_rejected");
  assert(!(await request("/rest/v1/rpc/bm_jev_reserve",{p_user:users[1],p_turn:turns[0].id,p_since:since,p_mode:"shadow"})).claimed,"foreign_owner_rejected");
  Object.assign(process.env,{BM_JEV_SHADOW_ENABLED:"true",BM_JEV_DATA_POLICY:"synthetic-private-qa",BM_JEV_QA_USERS:users[0],BM_JEV_QA_SINCE:since,BM_JEV_PREFETCH_EXPERIMENT:"false"});
  for(const percent of [1,5,25,100]){
   process.env.BM_JEV_QA_PERCENT=String(percent);const config=jev.configuration();let processed=0;
   for(let batch=0;batch<3;batch++){const r=await jev.drain({config,db});processed+=r.processed;if(!r.processed)break;}
   const labels=await request(`/rest/v1/bm_jev_turn_labels?auth_user_id=eq.${users[0]}&select=turn_id,status,mode,result,attempts`,undefined,"GET");
   const snapshot={percent,eligible:turns.filter(t=>jev.eligible(users[0],t.id,config)).length,processed,completed:labels.filter(l=>l.status==="completed").length,failed:labels.filter(l=>l.status==="failed").length,
    known_cost_usd:labels.reduce((s,l)=>s+(l.result?.cost_usd||0),0),unknown_cost_upper_usd:labels.filter(l=>l.status==="failed").length*.001,labels};
   stages.push(snapshot);console.log(JSON.stringify({...snapshot,labels:undefined}));
  }
  const beforeReplay=stages.at(-1).completed;
  assert((await jev.drain({config:jev.configuration(),db})).processed===0,"no_immediate_replay_or_retry");
  const aggregated=await request("/rest/v1/rpc/bm_jev_conversation_labels",{p_user:users[0]});
  assert(aggregated.length===beforeReplay,"aggregate_matches_completed_durable_turns");
  assert(aggregated.every(l=>l.result.mode==="shadow"&&l.result.provenance==="typesafe_systemone"&&l.result.abstained&&l.result.thresholds===null),"raw_shadow_metadata_has_no_activation_authority");
  await request("/rest/v1/bm_brain_memories",[{auth_user_id:users[0],key:"_reset",value:null,source_at:new Date().toISOString()}]);
  assert((await request("/rest/v1/rpc/bm_jev_conversation_labels",{p_user:users[0]})).length===0,"forget_purges_aggregate");
  const purged=await request(`/rest/v1/bm_jev_turn_labels?auth_user_id=eq.${users[0]}&select=status,result`,undefined,"GET");
  assert(purged.every(l=>l.status==="forgotten"&&l.result===null),"forget_purges_all_stored_metadata");
 }catch(e){failure=/^jev_[a-z0-9_]+$/.test(e.message)?e.message:"jev_shadow_assertion_failed";}
 finally{
  for(const[k,v]of Object.entries(before))if(v===undefined)delete process.env[k];else process.env[k]=v;
  for(const user of users)try{await request("/auth/v1/admin/users/"+user,undefined,"DELETE");
   const rows=await request(`/rest/v1/bm_jev_turn_labels?auth_user_id=eq.${user}&select=turn_id`,undefined,"GET");cleanup.push({account_deleted:true,labels_remaining:rows.length});
  }catch(_){cleanup.push({account_deleted:false});}
  fs.writeFileSync("tmp/jev/shadow-qa.json",JSON.stringify({provider_real:true,database_real:true,cloud_scheduler_execution_tested:false,run_id:runId,fixture_origin:"authored synthetic completed turn rows",stages,checks,failure,cleanup,
   passed:!failure&&cleanup.every(x=>x.account_deleted&&x.labels_remaining===0),production_changed:false,activation_enabled:false},null,2));
 }
 if(failure)throw Error(failure);console.log(JSON.stringify({report:"tmp/jev/shadow-qa.json",passed:true,checks,cleanup}));
}
if(require.main===module)main().catch(e=>{console.error(/^jev_[a-z0-9_]+$/.test(e.message)?e.message:"jev_shadow_failed");process.exitCode=1;});
