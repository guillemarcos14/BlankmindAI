"use strict";
// Current native-app contract, real deployed QA handler. No APNs or device ack.
const fs=require("node:fs"),crypto=require("node:crypto"),{configuration,memoryIdentity}=require("./assistant_app_cloud_test");
async function main(){
 if(!process.argv.includes("--run"))throw Error("jev_explicit_cloud_qa_required");
 const c=configuration(),service={apikey:c.serviceKey,authorization:"Bearer "+c.serviceKey},id=crypto.randomUUID(),users=[],checks=[],cleanup=[];let failure;
 const request=async(origin,route,body,headers,method="POST")=>{
  if(![c.netlify,c.supabase].includes(origin))throw Error("jev_target_rejected");
  const r=await fetch(origin+route,{method,headers:{"content-type":"application/json",...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000)});
  return {status:r.status,body:await r.json().catch(()=>null)};
 };
 const db=(route,body,method="POST")=>request(c.supabase,"/rest/v1/"+route,body,service,method);
 const requireOk=(r)=>{if(r.status<200||r.status>=300)throw Error("jev_qa_http_"+r.status);return r.body;};
 const expect=(condition,code)=>{if(!condition)throw Error(code);};
 const context=()=>({context_revision:Date.now()*1000,language:"en",locale:"en",timezone:"Europe/Madrid",has_selected_apps:true,selection_count:2,screen_time_authorized:true,is_blank_active:false,
  protection_target:"selected_distractions",device_execution_ready:true,schedule:{windows:[]},brain_snapshot:{schema_version:1,generated_at:new Date().toISOString(),timezone:"Europe/Madrid",sessions:[],history_complete:true,account:{signed_in:true,premium_access:true}}});
 const app=(u,body)=>request(c.netlify,"/.netlify/functions/assistant-app",{app_install_id:u.install,...body},{...c.extraHeaders,authorization:"Bearer "+u.token});
 const events=async u=>requireOk(await db(`digital_wellness_feature_payloads?anonymous_user_id=eq.${memoryIdentity("app",u.id)}&select=payload,submitted_at&order=submitted_at.desc`,undefined,"GET"));
 const check=async(name,fn)=>{await fn();checks.push({name,passed:true});console.log("PASS "+name);};
 try{
  for(let n=0;n<2;n++){
   const password=crypto.randomBytes(28).toString("base64url"),email=`jev-cloud-${id}-${n}@example.invalid`;
   const u={id:requireOk(await request(c.supabase,"/auth/v1/admin/users",{email,password,email_confirm:true,app_metadata:{provider:"apple",providers:["apple"],synthetic_staging_run:id}},service)).id,install:`jev-cloud-${id}-${n}`};users.push(u);
   u.token=requireOk(await request(c.supabase,"/auth/v1/token?grant_type=password",{email,password},{apikey:c.anonKey})).access_token;
   u.connect=requireOk(await app(u,{action:"activate"})).assistant_connect_code;
  }
  const [a,b]=users,turnId=crypto.randomUUID(),body={action:"send",turn_id:turnId,text:"Block my distractions now for 30 minutes, only once.",context:context()};let first;
  await check("fresh_snapshot_prepares_exact_30_minute_action",async()=>{
   first=requireOk(await app(a,body));expect(first.turn?.status==="completed"&&first.turn.action_id===`app_${turnId}`&&first.turn.auto_apply,"jev_native_action_missing");
   const rows=await events(a),pending=rows.map(r=>r.payload?.properties?.memory?.pending_assistant_action).find(p=>p?.id===first.turn.action_id);
   expect(pending?.type==="start_protection"&&pending.minutes===30,"jev_native_parameters_changed");expect(!["verified","applied"].includes(first.turn.action_status),"jev_fake_native_receipt");
  });
  await check("immutable_replay_preserves_reply_and_one_outbox_event",async()=>{
   const before=await events(a),r=requireOk(await app(a,body)),after=await events(a);
   expect(r.idempotent&&JSON.stringify(r.turn)===JSON.stringify(first.turn),"jev_replay_changed");expect(before.length===after.length,"jev_replay_recommitted");
  });
  await check("same_uuid_changed_message_rejected",async()=>expect((await app(a,{...body,text:"Block for 40 minutes instead."})).status===409,"jev_conflict_allowed"));
  await check("other_account_cannot_read_turn_or_history",async()=>{
   expect((await app(b,{action:"status",turn_id:turnId})).status===404,"jev_foreign_turn_visible");expect(requireOk(await app(b,{action:"history"})).turns.length===0,"jev_foreign_history_visible");
  });
  await check("authenticated_client_cannot_read_advisory_metadata",async()=>{
   const r=await request(c.supabase,"/rest/v1/bm_jev_turn_labels?select=turn_id",undefined,{apikey:c.anonKey,authorization:"Bearer "+a.token},"GET");expect([401,403].includes(r.status),"jev_advisory_rls_bypassed");
  });
  await check("incomplete_request_asks_without_new_action",async()=>{
   const r=requireOk(await app(b,{action:"send",turn_id:crypto.randomUUID(),text:"Block my distractions now.",context:context()}));
   expect(r.turn?.status==="completed"&&!r.turn.action_id&&!r.turn.auto_apply&&r.turn.assistant_text.includes("?"),"jev_incomplete_request_executed");
  });
  await check("forget_commits_without_native_action",async()=>{
   const r=requireOk(await app(b,{action:"send",turn_id:crypto.randomUUID(),text:"Forget everything you remember about me.",context:context()}));
   expect(r.turn?.status==="completed"&&!r.turn.action_id&&!r.turn.auto_apply,"jev_forget_native_action");
   const memories=requireOk(await db(`bm_brain_memories?auth_user_id=eq.${b.id}&select=value`,undefined,"GET"));expect(memories.some(m=>m.value===null),"jev_forget_not_durable");
  });
 }catch(e){failure=/^jev_[a-z0-9_]+$/.test(e.message)?e.message:"jev_cloud_check_failed";}
 finally{for(const u of users){
  for(const [table,filter]of [["assistant_semantic_conversations","anonymous_user_id=eq."+memoryIdentity("app",u.id)],
   ["digital_wellness_feature_payloads","anonymous_user_id=eq."+memoryIdentity("app",u.id)],["digital_wellness_feature_payloads","anonymous_user_id=eq."+encodeURIComponent("connect:"+u.connect)],
   ["digital_wellness_feature_payloads","anonymous_user_id=eq."+encodeURIComponent("app:"+u.id)],["blankmind_identity_links","auth_user_id=eq."+u.id]])try{requireOk(await db(table+"?"+filter,undefined,"DELETE"));cleanup.push({table,passed:true});}catch(_){cleanup.push({table,passed:false});}
  try{requireOk(await request(c.supabase,"/auth/v1/admin/users/"+u.id,undefined,service,"DELETE"));cleanup.push({table:"auth.users",passed:true});}catch(_){cleanup.push({table:"auth.users",passed:false});}
 }}
 const report={generated_at:new Date().toISOString(),provider_real:true,netlify_transport_tested:true,checks,cleanup,failure:failure||null,passed:!failure&&checks.length===7&&cleanup.every(x=>x.passed),native_execution_tested:false};
 fs.mkdirSync("tmp/jev",{recursive:true});fs.writeFileSync("tmp/jev/native-cloud-qa.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
}
if(require.main===module)main().catch(()=>{console.error("jev_cloud_configuration_failed");process.exitCode=1;});
