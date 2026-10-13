"use strict";
// Live private QA smoke. Synthetic account; never execute a device action.
const fs=require("node:fs"),crypto=require("node:crypto");
const {configuration,memoryIdentity}=require("./assistant_app_cloud_test");
async function main() {
  const c=configuration(),id=crypto.randomUUID(),install="schedule-qa-"+id;
  const report={run_id:id,checks:[],turns:[],cleanup:[],passed:false,native_execution_tested:false};
  const service={apikey:c.serviceKey,authorization:"Bearer "+c.serviceKey};
  let user,token,connect;
  const req=async(origin,route,body,headers={},method="POST")=>{
    if(![c.supabase,c.netlify].includes(origin))throw Error("target_rejected");
    const r=await fetch(origin+route,{method,headers:{"content-type":"application/json",...headers},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});
    return {status:r.status,body:await r.json().catch(()=>null)};
  };
  const expect=(ok,name)=>{if(!ok)throw Error(name);report.checks.push({name,passed:true});};
  const app=body=>req(c.netlify,"/.netlify/functions/assistant-app",{app_install_id:install,...body},
    {...c.extraHeaders,authorization:"Bearer "+token});
  const context=language=>({context_revision:Date.now()*1000,language,locale:language,timezone:"Europe/Madrid",
    has_selected_apps:true,selection_count:2,screen_time_authorized:true,is_blank_active:false,
    protection_target:"selected_distractions",device_execution_ready:true,schedule:{windows:[]},
    brain_snapshot:{schema_version:1,generated_at:new Date().toISOString(),timezone:"Europe/Madrid",sessions:[],
      history_complete:true,account:{signed_in:true,premium_access:true}}});
  async function send(name,text,language,allowAction=false) {
    const body={action:"send",turn_id:crypto.randomUUID(),app_install_id:install,text,context:context(language)};
    const start=Date.now();
    const r=await fetch(c.netlify+"/.netlify/functions/assistant-app-stream",{method:"POST",
      headers:{"content-type":"application/json",...c.extraHeaders,authorization:"Bearer "+token},
      body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
    expect(r.status===200&&r.headers.get("content-type")?.includes("application/x-ndjson"),name+"_stream");
    const reader=r.body.getReader(),decoder=new TextDecoder();let buffer="",final,first=null;
    while(true){const chunk=await reader.read();if(chunk.done)break;buffer+=decoder.decode(chunk.value,{stream:true});
      let n;while((n=buffer.indexOf("\n"))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);if(!line)continue;
        const frame=JSON.parse(line);if(frame.type==="draft"&&frame.text)first??=Date.now()-start;
        if(frame.type==="result")final=frame;}}
    expect(final?.status===200&&final.body.turn?.status==="completed"&&final.body.turn.assistant_text?.trim(),name+"_completed");
    const turn=final.body.turn;
    if(!allowAction)expect(!turn.action_id&&!turn.auto_apply,name+"_no_action");
    else expect(!!turn.action_id&&turn.auto_apply===true,name+"_action_retained");
    report.turns.push({name,text,reply:turn.assistant_text,status:final.status,first_text_ms:first,
      elapsed_ms:Date.now()-start,action_present:!!turn.action_id});
    const status=await app({action:"status",turn_id:body.turn_id});
    expect(status.status===200&&status.body.turn?.status==="completed",name+"_durable");
    const replay=await app(body);
    expect(replay.status===200&&JSON.stringify(replay.body.turn)===JSON.stringify(turn),name+"_identical_replay");
    console.log("PASS "+name+" "+(Date.now()-start)+"ms");
  }
  try {
    const password=crypto.randomBytes(28).toString("base64url"),email="schedule-"+id+"@example.invalid";
    const created=await req(c.supabase,"/auth/v1/admin/users",{email,password,email_confirm:true,
      app_metadata:{provider:"apple",providers:["apple"],synthetic_staging_run:id}},service);
    expect([200,201].includes(created.status),"synthetic_account_created");user=created.body.id;
    const login=await req(c.supabase,"/auth/v1/token?grant_type=password",{email,password},{apikey:c.anonKey});
    expect(login.status===200,"synthetic_login");token=login.body.access_token;
    const active=await app({action:"activate"});expect(active.status===200,"installation_activated");connect=active.body.assistant_connect_code;
    await send("equal_times_en","Block my selected distractions tonight from 22:00 until 22:00, once only.","en");
    await send("acceptance_after_invalid","Yes, do it.","en");
    await send("valid_schedule","Set a continuous weekly block on Mondays from 22:00 until 07:00, Europe/Madrid, for my selected distractions.","en",true);
    await send("equal_times_es","Bloquea mis distracciones mañana desde las 22:00 hasta las 22:00, solo una vez.","es");
    await send("conversation_continues","Gracias. Dame un consejo breve para descansar mejor. No actives ningún bloqueo.","es");
  } catch(e) {report.failure=/^[\w_]+$/.test(e.message)?e.message:"unexpected_failure";console.log("FAIL "+report.failure);}
  finally {
    if(user)for(const [name,route] of [
      ["account","/auth/v1/admin/users/"+user],
      ["identity","/rest/v1/blankmind_identity_links?auth_user_id=eq."+user],
      ["semantic","/rest/v1/assistant_semantic_conversations?anonymous_user_id=eq."+memoryIdentity("app",user)],
      ...[memoryIdentity("app",user),"connect:"+connect,"app:"+user].map(x=>["features","/rest/v1/digital_wellness_feature_payloads?anonymous_user_id=eq."+encodeURIComponent(x)])]) {
      try {const r=await req(c.supabase,route,undefined,service,"DELETE");report.cleanup.push({name,passed:r.status>=200&&r.status<300});}
      catch(_){report.cleanup.push({name,passed:false});}
    }
  }
  report.passed=!report.failure&&report.turns.length===5&&report.cleanup.every(x=>x.passed);
  report.finished_at=new Date().toISOString();
  fs.mkdirSync("tmp/schedule-fix",{recursive:true});fs.writeFileSync("tmp/schedule-fix/cloud-test.json",JSON.stringify(report,null,2));
  if(!report.passed)process.exitCode=1;
}
main().catch(()=>{console.error("schedule_cloud_test_failed");process.exitCode=1;});
