"use strict";
// Real provider + private QA database, running the exact source handler locally.
// Does not measure Netlify cold starts, mobile network or physical device time.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { configuration, memoryIdentity } = require("./assistant_app_cloud_test");
const CASES = [
  ["simple", "Hello! How are you?"],
  ["simple", "Give me one short tip to put my phone away before bed. Don't activate anything."],
  ["simple", "Thanks, that helps."],
  ["simple", "I'm finding it hard to focus today. Give me one practical suggestion, without activating a block."],
  ["simple", "¿Me das un consejo breve para desconectar del móvil? No actives nada."],
  ["personal", "What do you remember about my goal?"],
  ["personal", "What bedtime did I tell you before?"],
  ["personal", "Have I recorded any sleep measurements this week? Check the available data; don't activate anything."],
  ["action", "Block my distractions now for 30 minutes, only once."],
  ["action", "Block my distractions now."],
];
function percentile(values, p) { const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b); return sorted.length?sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]:null; }
function summary(records) {
  return Object.fromEntries(["all","simple","personal","action"].map(group=>{
    const rows=records.filter(r=>group==="all"||r.group===group),good=rows.filter(r=>r.passed);
    return [group,{samples:rows.length,passed:good.length,errors:rows.length-good.length,
      first_text_ms:{p50:percentile(good.map(r=>r.first_text_ms),.5),p90:percentile(good.map(r=>r.first_text_ms),.9),p95:percentile(good.map(r=>r.first_text_ms),.95)},
      final_ms:{p50:percentile(good.map(r=>r.elapsed_ms),.5),p95:percentile(good.map(r=>r.elapsed_ms),.95)},
      database_calls:percentile(good.map(r=>r.database_calls),.5),model_calls:percentile(good.map(r=>r.model_calls),.5),
      mean_tokens:good.length?Math.round(good.reduce((s,r)=>s+(r.total_tokens||0),0)/good.length):null}];
  }));
}
async function main() {
  const args=process.argv.slice(2),get=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
  if(!args.includes("--run"))throw Error("explicit_run_required");
  const c=configuration();
  if(process.env.SUPABASE_URL!==c.supabase||!process.env.OPENAI_API_KEY)throw Error("private_qa_provider_configuration_required");
  const source=path.resolve(get("--source",path.join(__dirname,".."))),label=get("--label","candidate"),count=Number(get("--count",100));
  if(!Number.isInteger(count)||count<1||count>100)throw Error("benchmark_count_out_of_bounds");
  const membership=require(path.join(source,"netlify/functions/_membership.js"));
  const originalDb=membership.supabaseFetch, originalFetch=global.fetch;
  let active=null;
  membership.supabaseFetch=async(...args)=>{if(active)active.database_calls++;return originalDb(...args);};
  global.fetch=async(url,options)=>{
    if(String(url)==="https://api.openai.com/v1/responses"&&active)active.model_calls++;
    return originalFetch(url,options);
  };
  const app=require(path.join(source,"netlify/functions/assistant-app.js"));
  const records=[],cleanup=[],runId=crypto.randomUUID(),install="latency-"+runId;
  let user,connect,token;
  const service={apikey:c.serviceKey,authorization:"Bearer "+c.serviceKey};
  const request=async(route,body,headers=service,method="POST")=>{
    const r=await originalFetch(c.supabase+route,{method,headers:{"content-type":"application/json",...headers},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000)});
    const value=await r.json().catch(()=>null);if(!r.ok)throw Error("qa_http_"+r.status);return value;
  };
  const context=()=>({context_revision:Date.now()*1000,language:"en",locale:"en",timezone:"Europe/Madrid",
    has_selected_apps:true,selection_count:2,screen_time_authorized:true,is_blank_active:false,
    protection_target:"selected_distractions",device_execution_ready:true,schedule:{windows:[]},
    brain_snapshot:{schema_version:1,generated_at:new Date().toISOString(),timezone:"Europe/Madrid",sessions:[],
      history_complete:true,account:{signed_in:true,premium_access:true}}});
  const invoke=async body=>app.handler({httpMethod:"POST",headers:{authorization:"Bearer "+token},body:JSON.stringify({app_install_id:install,...body})},null,
    {onDraft:text=>{if(active&&text.trim()&&active.first_text_ms==null)active.first_text_ms=performance.now()-active.start;}});
  try {
    const password=crypto.randomBytes(28).toString("base64url"),email="latency-"+runId+"@example.invalid";
    user=(await request("/auth/v1/admin/users",{email,password,email_confirm:true,app_metadata:{provider:"apple",providers:["apple"],synthetic_staging_run:runId}})).id;
    token=(await request("/auth/v1/token?grant_type=password",{email,password},{apikey:c.anonKey})).access_token;
    const activated=await invoke({action:"activate"});if(activated.statusCode!==200)throw Error("qa_activation_failed");
    connect=JSON.parse(activated.body).assistant_connect_code;
    for(let index=0;index<count;index++) {
      // Matched independent turn fixtures: never carry a generated proposal or
      // a different baseline transcript into the next comparison.
      for(const table of ["assistant_app_turns","bmb_events","bmb_followups","bmb_observations","bm_brain_memories"])
        await request(`/rest/v1/${table}?auth_user_id=eq.${user}`,undefined,service,"DELETE");
      await request(`/rest/v1/assistant_semantic_conversations?anonymous_user_id=eq.${memoryIdentity("app",user)}`,undefined,service,"DELETE");
      await request(`/rest/v1/digital_wellness_feature_payloads?anonymous_user_id=eq.${memoryIdentity("app",user)}`,undefined,service,"DELETE");
      await request("/rest/v1/bm_brain_memories",[
        {auth_user_id:user,key:"goal",value:"sleep better",source_text:"I want to sleep better",source_at:"2026-10-01T10:00:00Z"},
        {auth_user_id:user,key:"bedtime",value:"23:00",source_text:"I go to bed at 23:00",source_at:"2026-10-01T10:00:00Z"},
      ]);
      const [group,text]=CASES[index%CASES.length],turn=crypto.randomUUID();
      active={index,group,turn_id:turn,start:performance.now(),first_text_ms:null,database_calls:0,model_calls:0};
      const originalInfo=console.info;
      console.info=line=>{try{const m=JSON.parse(line);if(m.event==="bm_stream_timing")active.total_tokens=(active.total_tokens||0)+(m.usage?.total_tokens||0);}catch(_){};};
      let response;
      try {response=await invoke({action:"send",turn_id:turn,text,context:context()});}
      catch(_) {response={statusCode:503,body:"{}"};}
      finally {console.info=originalInfo;}
      const value=JSON.parse(response.body),actionExpected=index%10===8;
      const noAction=!value.turn?.action_id&&!value.turn?.auto_apply;
      const record={...active,start:undefined,elapsed_ms:performance.now()-active.start,status:response.statusCode,
        passed:response.statusCode===200&&value.turn?.status==="completed"&&typeof value.turn.assistant_text==="string"&&value.turn.assistant_text.trim().length>0
          &&(actionExpected?Boolean(value.turn?.action_id&&value.turn?.auto_apply):noAction)};
      if(index%10===5)record.passed=record.passed&&/sleep|dorm/i.test(value.turn?.assistant_text||"");
      if(index%10===6)record.passed=record.passed&&/23:00|11\s*p\.?m/i.test(value.turn?.assistant_text||"");
      if(index%10===9)record.passed=record.passed&&/\?/.test(value.turn?.assistant_text||"");
      records.push(record);active=null;
      console.log(JSON.stringify({label,index:index+1,group,passed:record.passed,first_text_ms:Math.round(record.first_text_ms||0),elapsed_ms:Math.round(record.elapsed_ms)}));
      fs.mkdirSync("tmp/latency",{recursive:true});fs.writeFileSync(`tmp/latency/${label}.json`,JSON.stringify({label,source,records,summary:summary(records),complete:false},null,2));
    }
  } finally {
    active=null;global.fetch=originalFetch;
    if(user)for(const [table,filter]of [
      ["digital_wellness_feature_payloads","anonymous_user_id=eq."+memoryIdentity("app",user)],
      ["digital_wellness_feature_payloads","anonymous_user_id=eq."+encodeURIComponent("connect:"+connect)],
      ["assistant_semantic_conversations","anonymous_user_id=eq."+memoryIdentity("app",user)],
      ["blankmind_identity_links","auth_user_id=eq."+user],
    ])try{await request(`/rest/v1/${table}?${filter}`,undefined,service,"DELETE");cleanup.push({table,passed:true});}catch(_){cleanup.push({table,passed:false});}
    if(user)try{await request("/auth/v1/admin/users/"+user,undefined,service,"DELETE");cleanup.push({table:"auth.users",passed:true});}catch(_){cleanup.push({table:"auth.users",passed:false});}
    fs.mkdirSync("tmp/latency",{recursive:true});fs.writeFileSync(`tmp/latency/${label}.json`,JSON.stringify({label,source,provider_real:true,database_real:true,
      physical_device_tested:false,netlify_transport_tested:false,native_actions_executed:0,complete:records.length===count,cleanup,records,summary:summary(records)},null,2));
  }
  console.log(JSON.stringify({label,summary:summary(records),cleanup}));
  if(records.some(r=>!r.passed)||cleanup.some(r=>!r.passed))process.exitCode=1;
}
if(require.main===module)main().catch(error=>{console.error(/^[\w_]+$/.test(error.message)?error.message:"benchmark_failed");process.exitCode=1;});
module.exports={percentile,summary};
