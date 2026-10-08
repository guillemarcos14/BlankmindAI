"use strict";
// Matched AB/BA order; exact local handlers, real OpenAI/Decisions + private QA DB.
// Does not measure deployed Netlify transport, iPhone or native execution.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),{performance}=require("node:perf_hooks");
const {configuration,memoryIdentity}=require("./assistant_app_cloud_test"),{percentile}=require("./bm_latency_benchmark");
const CASES=require('./datasets/bm_retrieval_step_cases_2026-10-08.json').cases;
// Explicit rates required: no guessed price for the selected generative model.
function cost(usage,rates) {
  if(!rates)return null;
  const {input_tokens:i=0,output_tokens:o=0,cached_input_tokens:c=0}=usage||{};
  return (Math.max(0,i-c)*rates.input+c*rates.cached+o*rates.output)/1000000;
}
function summarize(records,rates) {
 return Object.fromEntries(['optimized','decisions'].map(variant=>{
 const rows=records.filter(r=>r.variant===variant),good=rows.filter(r=>r.passed),requests=rows.flatMap(r=>r.provider_requests),costs=requests.map(r=>require('./bm_decisions_meter').estimate(r,rates));
 return [variant,{samples:rows.length,passed:good.length,errors:rows.length-good.length,
 first_text_ms:{p50:percentile(good.map(r=>r.first_text_ms),.5),p95:percentile(good.map(r=>r.first_text_ms),.95)},
 final_ms:{p50:percentile(good.map(r=>r.elapsed_ms),.5),p95:percentile(good.map(r=>r.elapsed_ms),.95)},
 database_calls_p50:percentile(rows.map(r=>r.database_calls),.5),model_calls:rows.reduce((s,r)=>s+r.model_calls,0),decisions_calls:rows.reduce((s,r)=>s+r.decisions_calls,0),
 known_estimated_cost_usd:costs.reduce((s,c)=>s+(c||0),0),unknown_billed_requests:costs.filter(c=>c===null).length,total_estimated_cost_usd:costs.every(c=>c!==null)?costs.reduce((s,c)=>s+c,0):null,
 classifier_completed:rows.filter(r=>r.retrieval_trace.some(t=>t.status==='completed')).length,
 final_only_accepted:rows.filter(r=>r.retrieval_trace.some(t=>t.accepted===true)).length,
 by_language:Object.fromEntries(['es','en'].map(l=>[l,{samples:rows.filter(r=>r.language===l).length,errors:rows.filter(r=>r.language===l&&!r.passed).length,first_text_p50_ms:percentile(good.filter(r=>r.language===l).map(r=>r.first_text_ms),.5)}])),
 by_group:Object.fromEntries([...new Set(rows.map(r=>r.group))].map(g=>[g,{samples:rows.filter(r=>r.group===g).length,errors:rows.filter(r=>r.group===g&&!r.passed).length,first_text_p50_ms:percentile(good.filter(r=>r.group===g).map(r=>r.first_text_ms),.5),model_calls:rows.filter(r=>r.group===g).reduce((s,r)=>s+r.model_calls,0)}]))}];
 }));
}
const {seed}=require('./bm_retrieval_wide_fixtures');
async function main(){
 const args=process.argv.slice(2),get=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d;
 if(!args.includes("--run"))throw Error("retrieval_explicit_benchmark_required");
 const CASES=JSON.parse(fs.readFileSync(get("--cases","tools/datasets/bm_retrieval_step_cases_2026-10-08.json"))).cases;
 const pairs=Number(get("--pairs",20)),fromPair=Number(get("--from-pair",0));if(!Number.isInteger(pairs)||pairs<1||pairs>300||!Number.isInteger(fromPair)||fromPair<0||fromPair+pairs>300)throw Error("decisions_pairs_invalid");
 const c=configuration();if(process.env.SUPABASE_URL!==c.supabase||!process.env.OPENAI_API_KEY)throw Error("decisions_private_providers_required");
 const rateFile=get("--rates",null),rates=rateFile?JSON.parse(fs.readFileSync(rateFile)):null;
 if(rates&&(!["input","cached","output"].every(k=>Number.isFinite(rates[k])&&rates[k]>=0)||rates.model!==(process.env.OPENAI_MODEL||"gpt-5.6-luna")||!rates.source))throw Error("decisions_rates_invalid");
 const roots={optimized:path.resolve(get("--baseline","../Codigo-decisions")),decisions:path.resolve(get("--candidate","."))};
 const meter=require('./bm_decisions_meter');
 const budgetFile=get('--budget-file','tmp/retrieval-wide/budget.json');const budget=fs.existsSync(budgetFile)?JSON.parse(fs.readFileSync(budgetFile)):{limit_usd:4,reserved_upper_usd:0,known_usd:0,requests:0};
 const saveBudget=()=>fs.writeFileSync(budgetFile,JSON.stringify(budget,null,2));
 const reserve=(body,endpoint)=>{const p=JSON.parse(body),upper=(Buffer.byteLength(String(body),'utf8')*(endpoint==='decisions'?rates.decisions_input:rates.input*1.25)+(endpoint==='decisions'?0:(p.max_output_tokens||10000))*rates.output)/1e6;if(budget.reserved_upper_usd+upper>budget.limit_usd)throw Error('decisions_spend_limit');budget.reserved_upper_usd+=upper;budget.requests++;saveBudget();return upper;};
 const originalFetch=global.fetch;let active=null;
 global.fetch=async(url,options)=>{
   const endpoint=String(url)==='https://api.openai.com/v1/decisions'?'decisions':String(url)==='https://api.openai.com/v1/responses'?'responses':null;
   if(!endpoint)return originalFetch(url,options); const reserved=reserve(options.body,endpoint); if(!active)return originalFetch(url,options);
   const local=active,row={endpoint,reserved_upper_usd:reserved,request_sha256:crypto.createHash('sha256').update(String(options?.body||'')).digest('hex')};local.provider_requests.push(row);
   if(endpoint==='responses')local.model_calls++;else local.decisions_calls++;
   try{const result=await meter.meterResponse(await originalFetch(url,options),row);return result;}catch(e){row.error=e.name;throw e;}
 };
 const handlers={};for(const [key,root]of Object.entries(roots)){
   const m=require(path.join(root,"netlify/functions/_membership")),db=m.supabaseFetch;
   m.supabaseFetch=async(...a)=>{if(active)active.database_calls++;return db(...a);};
   handlers[key]=require(path.join(root,"netlify/functions/assistant-app")).handler;
 }
 const service={apikey:c.serviceKey,authorization:"Bearer "+c.serviceKey},records=[],cleanup=[],runId=crypto.randomUUID(),install="decisions-"+runId;
 const file=path.resolve(get("--output","tmp/retrieval-step/benchmark.json"));fs.mkdirSync(path.dirname(file),{recursive:true});
 const request=async(route,body,headers=service,method="POST")=>{
   const r=await originalFetch(c.supabase+route,{method,headers:{"content-type":"application/json",...headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000)});
   const data=await r.json().catch(()=>null);if(!r.ok)throw Error("decisions_qa_http_"+r.status);return data;
 };
 const sourceHashes=Object.fromEntries(Object.entries(roots).map(([key,root])=>[key,Object.fromEntries(["assistant-app.js","bmb-brain.js","bm-decisions.js","bm-retrieval-step.js","bmb-sources.js","bm-brain-data.js","bm-response-stream.js"].flatMap(n=>{const f=path.join(root,"netlify/functions",n);return fs.existsSync(f)?[[n,crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex")]]:[]}))]));
 const report={schema_version:1,run_id:runId,provider_real:true,decisions_real:true,database_real:true,netlify_transport_tested:false,physical_device_tested:false,native_actions_executed:0,source_commits:{optimized:require("node:child_process").execFileSync("git",["-C",roots.optimized,"rev-parse","HEAD"],{encoding:"utf8"}).trim(),decisions:require("node:child_process").execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim()},
   order:"paired AB/BA alternation by case; identical independent fixtures; same conversation context within each variant",from_pair:fromPair,pair_count:pairs,sourceHashes,generative_model:process.env.OPENAI_MODEL||"gpt-5.6-luna",rates,records,cleanup,complete:false,gates_passed:false};
 const save=()=>fs.writeFileSync(file,JSON.stringify({...report,summary:summarize(records,rates)},null,2));
 let user,connect,token;const fixtureNow=Date.now();report.fixture_clock=new Date(fixtureNow).toISOString();report.case_manifest=JSON.parse(fs.readFileSync(get("--cases","tools/datasets/bm_retrieval_step_cases_2026-10-08.json")));
 const context=()=>({context_revision:Date.now()*1000,language:"en",locale:"en",timezone:"Europe/Madrid",has_selected_apps:true,selection_count:2,
   screen_time_authorized:true,is_blank_active:false,protection_target:"selected_distractions",device_execution_ready:true,schedule:{windows:[]},
   brain_snapshot:{schema_version:1,generated_at:new Date().toISOString(),timezone:"Europe/Madrid",sessions:[],history_complete:true,account:{signed_in:true,premium_access:true}}});
 const invoke=(variant,body)=>handlers[variant]({httpMethod:"POST",headers:{authorization:"Bearer "+token},body:JSON.stringify({app_install_id:install,...body})},null,
   {onDraft:text=>{if(active&&text==="")active.first_text_ms=null;if(active&&text.trim()){active.drafts.push(text);if(active.first_text_ms===null)active.first_text_ms=performance.now()-active.start;}}});
 const streams={};for(const [key,root]of Object.entries(roots))streams[key]=(await import(require('url').pathToFileURL(path.join(root,'netlify/functions/assistant-app-stream.mjs')))).default;
 const invokeStream=async(variant,body)=>{const r=await streams[variant](new Request('http://localhost/assistant-app-stream',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({app_install_id:install,...body})}),{});let buffer='',result;const reader=r.body.getReader(),decoder=new TextDecoder();const frames=[];while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let i;while((i=buffer.indexOf('\n'))>=0){const frame=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);frames.push(frame.type);if(frame.type==='draft'&&frame.text.trim()){active.drafts.push(frame.text);if(active.first_text_ms===null)active.first_text_ms=performance.now()-active.start;}if(frame.type==='result')result=frame;}}active.transport_frames=frames;return {statusCode:result?.status||503,body:JSON.stringify(result?.body||{})};};
 const envBefore=Object.fromEntries(["BM_RETRIEVAL_STEP_QA_ENABLED","BM_DECISIONS_QA_ENABLED","BM_DECISIONS_DATA_POLICY","BM_DECISIONS_QA_USERS","BM_JEV_SHADOW_ENABLED","BM_JEV_PREFETCH_EXPERIMENT"].map(k=>[k,process.env[k]]));
 const originalInfo=console.info;
 try{
   const password=crypto.randomBytes(28).toString("base64url"),email="decisions-"+runId+"@example.invalid";
   user=(await request("/auth/v1/admin/users",{email,password,email_confirm:true,app_metadata:{provider:"apple",providers:["apple"],synthetic_staging_run:runId}})).id;
   token=(await request("/auth/v1/token?grant_type=password",{email,password},{apikey:c.anonKey})).access_token;
   const activated=await invoke("optimized",{action:"activate"});if(activated.statusCode!==200)throw Error("decisions_activation_failed");connect=JSON.parse(activated.body).assistant_connect_code;
   Object.assign(process.env,{BM_DECISIONS_DATA_POLICY:"synthetic-private-qa",BM_DECISIONS_QA_USERS:user,BM_JEV_SHADOW_ENABLED:"false",BM_JEV_PREFETCH_EXPERIMENT:"false"});
   for(let pair=fromPair;pair<fromPair+pairs;pair++){
    // Long paired runs can exceed the one-hour access-token lifetime. Renew
    // before each pair; keep authentication failures as explicit failures.
    token=(await request("/auth/v1/token?grant_type=password",{email,password},{apikey:c.anonKey})).access_token;
    for(const variant of (Math.floor(pair/2)+Math.floor(pair/CASES.length))%2?["decisions","optimized"]:["optimized","decisions"]){
     await Promise.all([...["assistant_app_turns","bmb_events","bmb_followups","bmb_observations","bm_brain_memories","bmb_sessions"].map(table=>request(`/rest/v1/${table}?auth_user_id=eq.${user}`,undefined,service,"DELETE")),...["assistant_semantic_conversations","digital_wellness_feature_payloads"].map(table=>request(`/rest/v1/${table}?anonymous_user_id=eq.${memoryIdentity("app",user)}`,undefined,service,"DELETE"))]);
     const spec=CASES[pair%CASES.length],{language}=spec,group=spec.route;
     const expected=await seed(spec,{request,user,service,now:fixtureNow});
     process.env.BM_DECISIONS_QA_ENABLED="false";process.env.BM_RETRIEVAL_STEP_QA_ENABLED=variant==="decisions"?"true":"false";
     const history=[];for(const [step,text]of (spec.turns||[spec.text]).entries()){const turn=crypto.randomUUID();active={pair,step,variant,group,turn_id:turn,start:performance.now(),first_text_ms:null,drafts:[],database_calls:0,model_calls:0,usage_records:0,metered_usage:{},decisions_calls:0,decisions_known_cost_usd:0,decisions_unknown_cost_upper_usd:0,provider_requests:[],decisions_trace:[],retrieval_trace:[]};
     console.info=line=>{try{const m=JSON.parse(line);if(["bm_stream_timing","bm_token_usage"].includes(m.event)&&Number.isSafeInteger(m.usage?.input_tokens)&&Number.isSafeInteger(m.usage?.output_tokens)){
       active.usage_records++;for(const [k,v]of Object.entries(m.usage))active.metered_usage[k]=(active.metered_usage[k]||0)+v;
     }if(m.event==="bm_decisions_timing")active.decisions_trace.push(m);if(m.event.startsWith("bm_retrieval_step_"))active.retrieval_trace.push(m);if(m.event==="bm_turn_timing"){active.usage=m.usage;active.stages=m.stages;active.decisions=m.decisions||[];}}catch(_){};};
     let response;try{response=await (pair%8===0?invokeStream:invoke)(variant,{action:"send",turn_id:turn,text,context:{...context(),language,locale:language}});}catch(_){response={statusCode:503,body:"{}"};}
     const value=JSON.parse(response.body),t=value.turn||{},noAction=!t.action_id&&!t.auto_apply;
     const row={...active,case_id:spec.id,eligible:spec.eligible,expected:{...expected,criterion:spec.expectation,history:[...history]},transport:pair%8===0?"local-ndjson-handler":"local-json-handler",profile:spec.profile,language,start:undefined,status:response.statusCode,elapsed_ms:performance.now()-active.start,
       passed:response.statusCode===200&&t.status==="completed"&&typeof t.assistant_text==="string"&&Boolean(t.assistant_text.trim())&&(["action","actions_combined"].includes(group)?Boolean(t.action_id&&t.auto_apply):noAction),
       // Synthetic text is kept for semantic review, never live-user transcripts.
       synthetic_input:text,synthetic_response:t.assistant_text||null,action_id_present:Boolean(t.action_id),auto_apply:Boolean(t.auto_apply)};
     if(group==="habits")row.passed=row.passed&&/sleep|dorm/i.test(t.assistant_text||"");
     if(group==="bedtime")row.passed=row.passed&&/23:00|11\s*p\.?m/i.test(t.assistant_text||"");
     if(group==="incomplete")row.passed=row.passed&&/\?/.test(t.assistant_text||"");
     if(["action","actions_combined"].includes(group)&&t.action_id){
       const payloads=await request(`/rest/v1/digital_wellness_feature_payloads?anonymous_user_id=eq.${memoryIdentity("app",user)}&select=payload`,undefined,service,"GET");
       const p=payloads.map(r=>r.payload?.properties?.memory?.pending_assistant_action).find(p=>p?.id===t.action_id);
       row.pending_action=p?{type:p.type,minutes:p.minutes,recurrence:p.recurrence}:null;
       row.passed=row.passed&&p?.type==="start_protection"&&p.minutes===30&&!['verified','applied'].includes(t.action_status);
     }
     if(group==="forget"&&response.statusCode===200){
       const memories=await request(`/rest/v1/bm_brain_memories?auth_user_id=eq.${user}&select=value`,undefined,service,"GET");
       row.forgetting_committed=memories.some(m=>m.value===null);row.passed=row.passed&&row.forgetting_committed;
     }
     history.push({role:"user",content:text},{role:"assistant",content:t.assistant_text||""}); records.push(row);for(const req of row.provider_requests){const measured=meter.estimate(req,rates);if(measured!==null){budget.known_usd+=measured;budget.reserved_upper_usd-=req.reserved_upper_usd-measured;}}saveBudget();active=null;console.info=originalInfo;save();
     if(records.length%20===0)console.log(JSON.stringify({turns:records.length,pairs:pair+1,errors:records.filter(r=>!r.passed).length}));
   }
   }
   }
   report.complete=records.length===CASES.slice(fromPair,fromPair+pairs).reduce((n,s)=>n+2*(s.turns||[s.text]).length,0);
 }finally{
   active=null;global.fetch=originalFetch;console.info=originalInfo;
   for(const [k,v]of Object.entries(envBefore))if(v===undefined)delete process.env[k];else process.env[k]=v;
   if(user)for(const [table,filter]of [["digital_wellness_feature_payloads","anonymous_user_id=eq."+memoryIdentity("app",user)],
     ["digital_wellness_feature_payloads","anonymous_user_id=eq."+encodeURIComponent("connect:"+connect)],["assistant_semantic_conversations","anonymous_user_id=eq."+memoryIdentity("app",user)],
     ["blankmind_identity_links","auth_user_id=eq."+user]])try{await request(`/rest/v1/${table}?${filter}`,undefined,service,"DELETE");cleanup.push({table,passed:true});}catch(_){cleanup.push({table,passed:false});}
   if(user)try{await request("/auth/v1/admin/users/"+user,undefined,service,"DELETE");cleanup.push({table:"auth.users",passed:true});}catch(_){cleanup.push({table:"auth.users",passed:false});}
   report.summary=summarize(records,rates);report.gates_passed=false;report.limitations=["Authored factual retrieval questions; independent human review absent; repeats are labelled by case ID","Physical iPhone and deployed Netlify not measured","Unknown billed retries/timeouts prevent an exact total cost when present"];
   save();
 }
 console.log(JSON.stringify({report:file,complete:report.complete,summary:report.summary,cleanup,gates_passed:false}));
}
if(require.main===module)main().catch(e=>{console.error(/^decisions_[a-z0-9_]+$/.test(e.message)?e.message:"decisions_benchmark_failed");process.exitCode=1;});
module.exports={cost,summarize,CASES};
