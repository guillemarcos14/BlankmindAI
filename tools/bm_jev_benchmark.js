"use strict";
// Matched AB/BA order; exact local handlers, real OpenAI/Jev + private QA DB.
// Does not measure deployed Netlify transport, iPhone or native execution.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),{performance}=require("node:perf_hooks");
const {configuration,memoryIdentity}=require("./assistant_app_cloud_test"),{percentile}=require("./bm_latency_benchmark");
const CASES=[
 ["social","Hello! How are you?"],
 ["advice","Give me one short tip to put my phone away before bed. Don't activate anything."],
 ["rest","Hoy estoy cansado. Dame un consejo breve, no actives nada."],
 ["focus","I'm finding it hard to focus today. Give one practical suggestion without activating a block."],
 ["habits","¿Qué objetivo te dije antes?"],
 ["bedtime","What bedtime did I tell you before?"],
 ["sleep","Have I recorded any sleep measurements this week? Check available data; don't activate anything."],
 ["protection","How many protection minutes have I recorded this week? Don't activate anything."],
 ["action","Block my distractions now for 30 minutes, only once."],
 ["incomplete","Block my distractions now."],
 ["quoted","My friend said 'block distractions for thirty minutes'. I'm only quoting, don't activate anything."],
 ["forget","Forget everything you remember about me."],
 ];
// Explicit rates required: no guessed price for the selected generative model.
function cost(usage,rates) {
  if(!rates)return null;
  const {input_tokens:i=0,output_tokens:o=0,cached_input_tokens:c=0}=usage||{};
  return (Math.max(0,i-c)*rates.input+c*rates.cached+o*rates.output)/1000000;
}
function summarize(records,rates) {
  return Object.fromEntries(["optimized","jev"].map(variant=>{
    const all=records.filter(r=>r.variant===variant),good=all.filter(r=>r.passed),known=all.map(r=>cost(r.metered_usage||r.usage,rates));
    const verified=all.length>0&&all.every(r=>r.usage_records===r.model_calls&&r.model_calls>0);
    const subtotal=known.some(x=>x===null)?null:known.reduce((s,x)=>s+x,0)+all.reduce((s,r)=>s+r.jev_known_cost_usd,0);
    return [variant,{samples:all.length,passed:good.length,errors:all.length-good.length,
      first_text_ms:{p50:percentile(good.map(r=>r.first_text_ms),.5),p95:percentile(good.map(r=>r.first_text_ms),.95)},
      final_ms:{p50:percentile(good.map(r=>r.elapsed_ms),.5),p95:percentile(good.map(r=>r.elapsed_ms),.95)},
      database_calls_p50:percentile(all.map(r=>r.database_calls),.5),model_calls:all.reduce((s,r)=>s+r.model_calls,0),jev_calls:all.reduce((s,r)=>s+r.jev_calls,0),
      tokens:all.reduce((s,r)=>s+(r.usage?.total_tokens||0),0),jev_known_cost_usd:all.reduce((s,r)=>s+r.jev_known_cost_usd,0),
      jev_unknown_cost_upper_usd:all.reduce((s,r)=>s+r.jev_unknown_cost_upper_usd,0),
      generative_usage_fully_metered:verified,
      total_cost_usd:verified&&!all.some(r=>r.jev_unknown_cost_upper_usd>0)?subtotal:null,
      cost_interval_usd:{lower:subtotal,upper:verified&&subtotal!==null?subtotal+all.reduce((s,r)=>s+r.jev_unknown_cost_upper_usd,0):null},
      generative_estimated_cost_usd:known.some(x=>x===null)?null:known.reduce((s,x)=>s+x,0)}];
  }));
}
async function main(){
 const args=process.argv.slice(2),get=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
 if(!args.includes("--run"))throw Error("jev_explicit_benchmark_required");
 const pairs=Number(get("--pairs",300));if(!Number.isInteger(pairs)||pairs<1||pairs>300)throw Error("jev_pairs_invalid");
 const c=configuration();if(process.env.SUPABASE_URL!==c.supabase||!process.env.OPENAI_API_KEY||!process.env.TYPESAFE_API_KEY)throw Error("jev_private_providers_required");
 const rateFile=get("--rates",null),rates=rateFile?JSON.parse(fs.readFileSync(rateFile)):null;
 if(rates&&(!["input","cached","output"].every(k=>Number.isFinite(rates[k])&&rates[k]>=0)||rates.model!==(process.env.OPENAI_MODEL||"gpt-5.6-luna")||!rates.source))throw Error("jev_rates_invalid");
 const roots={optimized:path.resolve(get("--baseline","../Codigo-latency")),jev:path.resolve(get("--candidate","."))};
 const originalFetch=global.fetch;let active=null;
 global.fetch=async(url,options)=>{
   const isJev=String(url)==="https://api.typesafe.ai/v1/systemone";
   if(active&&String(url)==="https://api.openai.com/v1/responses")active.model_calls++;
   if(active&&isJev)active.jev_calls++;
   if(active&&isJev){
     const local=active;try{
       const result=await originalFetch(url,options);
       const v=await result.clone().json().catch(()=>null);
       if(Number.isSafeInteger(v?.usage?.input_tokens))local.jev_known_cost_usd+=v.usage.input_tokens*.042/1000000;
       else local.jev_unknown_cost_upper_usd+=.001;
       return result;
     }catch(e){local.jev_unknown_cost_upper_usd+=.001;throw e;}
   }
   return originalFetch(url,options);
 };
 const handlers={};for(const [key,root]of Object.entries(roots)){
   const m=require(path.join(root,"netlify/functions/_membership")),db=m.supabaseFetch;
   m.supabaseFetch=async(...a)=>{if(active)active.database_calls++;return db(...a);};
   handlers[key]=require(path.join(root,"netlify/functions/assistant-app")).handler;
 }
 const service={apikey:c.serviceKey,authorization:"Bearer "+c.serviceKey},records=[],cleanup=[],runId=crypto.randomUUID(),install="jev-"+runId;
 const file=path.resolve(get("--output","tmp/jev/benchmark.json"));fs.mkdirSync(path.dirname(file),{recursive:true});
 const request=async(route,body,headers=service,method="POST")=>{
   const r=await originalFetch(c.supabase+route,{method,headers:{"content-type":"application/json",...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000)});
   const data=await r.json().catch(()=>null);if(!r.ok)throw Error("jev_qa_http_"+r.status);return data;
 };
 const sourceHashes=Object.fromEntries(Object.entries(roots).map(([key,root])=>[key,Object.fromEntries(["assistant-app.js","bmb-brain.js","bm-jev.js","bm-jev-taxonomy.json"].flatMap(n=>{const f=path.join(root,"netlify/functions",n);return fs.existsSync(f)?[[n,crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex")]]:[]}))]));
 const report={schema_version:1,run_id:runId,provider_real:true,jev_real:true,database_real:true,netlify_transport_tested:false,physical_device_tested:false,native_actions_executed:0,
   order:"paired AB/BA alternation; independent identical fixtures",sourceHashes,generative_model:process.env.OPENAI_MODEL||"gpt-5.6-luna",rates,records,cleanup,complete:false,gates_passed:false};
 const save=()=>fs.writeFileSync(file,JSON.stringify({...report,summary:summarize(records,rates)},null,2));
 let user,connect,token;
 const context=()=>({context_revision:Date.now()*1000,language:"en",locale:"en",timezone:"Europe/Madrid",has_selected_apps:true,selection_count:2,
   screen_time_authorized:true,is_blank_active:false,protection_target:"selected_distractions",device_execution_ready:true,schedule:{windows:[]},
   brain_snapshot:{schema_version:1,generated_at:new Date().toISOString(),timezone:"Europe/Madrid",sessions:[],history_complete:true,account:{signed_in:true,premium_access:true}}});
 const invoke=(variant,body)=>handlers[variant]({httpMethod:"POST",headers:{authorization:"Bearer "+token},body:JSON.stringify({app_install_id:install,...body})},null,
   {onDraft:text=>{if(active&&text.trim()&&active.first_text_ms===null)active.first_text_ms=performance.now()-active.start;}});
 const envBefore=Object.fromEntries(["BM_JEV_SHADOW_ENABLED","BM_JEV_DATA_POLICY","BM_JEV_QA_USERS","BM_JEV_QA_SINCE","BM_JEV_QA_PERCENT","BM_JEV_PREFETCH_EXPERIMENT"].map(k=>[k,process.env[k]]));
 const originalInfo=console.info;
 try{
   const password=crypto.randomBytes(28).toString("base64url"),email="jev-"+runId+"@example.invalid";
   user=(await request("/auth/v1/admin/users",{email,password,email_confirm:true,app_metadata:{provider:"apple",providers:["apple"],synthetic_staging_run:runId}})).id;
   token=(await request("/auth/v1/token?grant_type=password",{email,password},{apikey:c.anonKey})).access_token;
   const activated=await invoke("optimized",{action:"activate"});if(activated.statusCode!==200)throw Error("jev_activation_failed");connect=JSON.parse(activated.body).assistant_connect_code;
   Object.assign(process.env,{BM_JEV_SHADOW_ENABLED:"true",BM_JEV_DATA_POLICY:"synthetic-private-qa",BM_JEV_QA_USERS:user,BM_JEV_QA_SINCE:new Date(Date.now()-60000).toISOString(),BM_JEV_QA_PERCENT:"100"});
   // Migration is a prerequisite; fail before paid turns if it is absent.
   await request("/rest/v1/rpc/bm_jev_pending",{p_users:[user],p_since:process.env.BM_JEV_QA_SINCE});
   for(let pair=0;pair<pairs;pair++)for(const variant of pair%2?["jev","optimized"]:["optimized","jev"]){
     for(const table of ["assistant_app_turns","bmb_events","bmb_followups","bmb_observations","bm_brain_memories","bmb_sessions"])
       await request(`/rest/v1/${table}?auth_user_id=eq.${user}`,undefined,service,"DELETE");
     for(const table of ["assistant_semantic_conversations","digital_wellness_feature_payloads"])
       await request(`/rest/v1/${table}?anonymous_user_id=eq.${memoryIdentity("app",user)}`,undefined,service,"DELETE");
     await request("/rest/v1/bm_brain_memories",[{auth_user_id:user,key:"goal",value:"sleep better",source_text:"I want to sleep better",source_at:new Date(Date.now()-3600000).toISOString()},
       {auth_user_id:user,key:"bedtime",value:"23:00",source_text:"I go to bed at 23:00",source_at:new Date(Date.now()-3600000).toISOString()}]);
     const [group,text]=CASES[pair%CASES.length],turn=crypto.randomUUID();process.env.BM_JEV_PREFETCH_EXPERIMENT=variant==="jev"?"true":"false";
     active={pair,variant,group,turn_id:turn,start:performance.now(),first_text_ms:null,database_calls:0,model_calls:0,usage_records:0,metered_usage:{},jev_calls:0,jev_known_cost_usd:0,jev_unknown_cost_upper_usd:0};
     console.info=line=>{try{const m=JSON.parse(line);if(["bm_stream_timing","bm_token_usage"].includes(m.event)&&Number.isSafeInteger(m.usage?.input_tokens)&&Number.isSafeInteger(m.usage?.output_tokens)){
       active.usage_records++;for(const [k,v]of Object.entries(m.usage))active.metered_usage[k]=(active.metered_usage[k]||0)+v;
     }if(m.event==="bm_turn_timing"){active.usage=m.usage;active.stages=m.stages;active.jev=m.jev||[];}}catch(_){};};
     let response;try{response=await invoke(variant,{action:"send",turn_id:turn,text,context:context()});}catch(_){response={statusCode:503,body:"{}"};}
     const value=JSON.parse(response.body),t=value.turn||{},noAction=!t.action_id&&!t.auto_apply;
     const row={...active,start:undefined,status:response.statusCode,elapsed_ms:performance.now()-active.start,
       passed:response.statusCode===200&&t.status==="completed"&&typeof t.assistant_text==="string"&&Boolean(t.assistant_text.trim())&&(group==="action"?Boolean(t.action_id&&t.auto_apply):noAction),
       // Synthetic text is kept for semantic review, never live-user transcripts.
       synthetic_input:text,synthetic_response:t.assistant_text||null,action_id_present:Boolean(t.action_id),auto_apply:Boolean(t.auto_apply)};
     if(group==="habits")row.passed=row.passed&&/sleep|dorm/i.test(t.assistant_text||"");
     if(group==="bedtime")row.passed=row.passed&&/23:00|11\s*p\.?m/i.test(t.assistant_text||"");
     if(group==="incomplete")row.passed=row.passed&&/\?/.test(t.assistant_text||"");
     records.push(row);active=null;console.info=originalInfo;save();
     if(records.length%20===0)console.log(JSON.stringify({turns:records.length,pairs:pair+1,errors:records.filter(r=>!r.passed).length}));
   }
   report.complete=records.length===pairs*2;
 }finally{
   active=null;global.fetch=originalFetch;console.info=originalInfo;
   for(const [k,v]of Object.entries(envBefore))if(v===undefined)delete process.env[k];else process.env[k]=v;
   if(user)for(const [table,filter]of [["digital_wellness_feature_payloads","anonymous_user_id=eq."+memoryIdentity("app",user)],
     ["digital_wellness_feature_payloads","anonymous_user_id=eq."+encodeURIComponent("connect:"+connect)],["assistant_semantic_conversations","anonymous_user_id=eq."+memoryIdentity("app",user)],
     ["blankmind_identity_links","auth_user_id=eq."+user]])try{await request(`/rest/v1/${table}?${filter}`,undefined,service,"DELETE");cleanup.push({table,passed:true});}catch(_){cleanup.push({table,passed:false});}
   if(user)try{await request("/auth/v1/admin/users/"+user,undefined,service,"DELETE");cleanup.push({table:"auth.users",passed:true});}catch(_){cleanup.push({table:"auth.users",passed:false});}
   report.summary=summarize(records,rates);report.gates_passed=false;report.limitations=["Synthetic fixtures; independent semantic review pending","Physical iPhone and deployed Netlify not measured","Unknown billed retries/timeouts prevent an exact total cost when present"];
   save();
 }
 console.log(JSON.stringify({report:file,complete:report.complete,summary:report.summary,cleanup,gates_passed:false}));
}
if(require.main===module)main().catch(e=>{console.error(/^jev_[a-z0-9_]+$/.test(e.message)?e.message:"jev_benchmark_failed");process.exitCode=1;});
module.exports={cost,summarize,CASES};
