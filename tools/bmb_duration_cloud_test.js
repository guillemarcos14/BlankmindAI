"use strict";
// Private staging only. Synthetic Apple account, no device or transport calls.
const fs=require("node:fs"),crypto=require("node:crypto"),path=require("node:path");
const {configuration,memoryIdentity}=require("./assistant_app_cloud_test");
async function run() {
  const c=configuration(),id=crypto.randomUUID(),checks=[],cleanup=[];
  const service={apikey:c.serviceKey,authorization:`Bearer ${c.serviceKey}`};
  let user,token,connect,failure;
  const request=async(origin,route,body,headers={},method="POST")=>{
    if(![c.supabase,c.netlify].includes(origin)||!route.startsWith("/"))throw Error("target_rejected");
    const r=await fetch(origin+route,{method,headers:{"content-type":"application/json",...headers},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000)});
    return {status:r.status,body:await r.json().catch(()=>null)};
  };
  const expect=(condition,code)=>{if(!condition)throw Error(code);};
  const app=body=>request(c.netlify,"/.netlify/functions/assistant-app",{app_install_id:"duration-qa-"+id,...body},
    {...c.extraHeaders,authorization:"Bearer "+token});
  const context=()=>({context_revision:Date.now()*1000,language:"es",locale:"es",timezone:"Europe/Madrid",
    has_selected_apps:true,selection_count:2,screen_time_authorized:true,is_blank_active:false,
    protection_target:"selected_distractions",device_execution_ready:true,schedule:{windows:[]},
    brain_snapshot:{schema_version:1,generated_at:new Date().toISOString(),timezone:"Europe/Madrid",sessions:[],
      history_complete:true,account:{signed_in:true,premium_access:true}}});
  const check=async(name,fn)=>{await fn();checks.push({name,passed:true});console.log("PASS "+name);};
  try {
    const password=crypto.randomBytes(28).toString("base64url"),email=`duration-${id}@example.invalid`;
    const created=await request(c.supabase,"/auth/v1/admin/users",{email,password,email_confirm:true,
      app_metadata:{provider:"apple",providers:["apple"],synthetic_staging_run:id}},service);
    expect(created.status===200||created.status===201,"create_account_failed");user=created.body.id;
    const login=await request(c.supabase,"/auth/v1/token?grant_type=password",{email,password},{apikey:c.anonKey});
    expect(login.status===200,"login_failed");token=login.body.access_token;
    const activated=await app({action:"activate"});expect(activated.status===200,"activate_failed");connect=activated.body.assistant_connect_code;
    let body,reply;
    await check("three_minutes_returns_completed_reply_without_action",async()=>{
      body={action:"send",turn_id:crypto.randomUUID(),text:"Está yendo muy bien. ¿Me podrías bloquear las distracciones durante tres minutos ahora mismo? Solo una vez, no hace falta que lo repitas en otros días.",context:context()};
      reply=await app(body);expect(reply.status===200,`three_minutes_http_${reply.status}`);
      expect(reply.body.turn?.status==="completed"&&!reply.body.turn.action_id&&!reply.body.turn.auto_apply,"unsupported_action_created");
      expect(/5|cinco/i.test(reply.body.turn.assistant_text),"minimum_not_explained");
    });
    await check("same_uuid_replays_identical_completed_reply",async()=>{
      const replay=await app(body);expect(replay.status===200,"replay_failed");
      expect(JSON.stringify(replay.body.turn)===JSON.stringify(reply.body.turn),"replay_changed");
      const status=await app({action:"status",turn_id:body.turn_id});expect(status.body.turn?.status==="completed","not_durable");
    });
    await check("same_uuid_changed_text_rejected",async()=>{
      expect((await app({...body,text:"Bloquea cinco minutos ahora, una sola vez."})).status===409,"payload_conflict_allowed");
    });
    await check("supported_five_minutes_retains_action",async()=>{
      const valid=await app({action:"send",turn_id:crypto.randomUUID(),text:"Bloquea mis distracciones durante cinco minutos ahora mismo, solo una vez.",context:context()});
      expect(valid.status===200&&valid.body.turn?.status==="completed",`supported_http_${valid.status}`);
      expect(valid.body.turn.action_id&&valid.body.turn.auto_apply,"supported_action_missing");
    });
    await check("excessive_duration_returns_reply_without_action",async()=>{
      const excessive=await app({action:"send",turn_id:crypto.randomUUID(),text:"Bloquea mis distracciones durante 300 minutos ahora, una sola vez.",context:context()});
      expect(excessive.status===200&&!excessive.body.turn?.action_id&&!excessive.body.turn?.auto_apply,"excessive_action_or_failure");
    });
  } catch(error) { failure=/^[\w_]+$/.test(error.message)?error.message:"unexpected_error";console.log("FAIL "+failure); }
  finally {
    if(user) {
      const memory=memoryIdentity("app",user);
      for(const [name,origin,route]of [
        ["synthetic_account",c.supabase,`/auth/v1/admin/users/${user}`],
        ["synthetic_identity",c.supabase,`/rest/v1/blankmind_identity_links?auth_user_id=eq.${user}`],
        ["synthetic_semantic_state",c.supabase,`/rest/v1/assistant_semantic_conversations?anonymous_user_id=eq.${memory}`],
        ...[memory,`connect:${connect}`,`app:${user}`].map(key=>["synthetic_features",c.supabase,`/rest/v1/digital_wellness_feature_payloads?anonymous_user_id=eq.${encodeURIComponent(key)}`])]) {
        try {const r=await request(origin,route,undefined,service,"DELETE");cleanup.push({name,passed:r.status>=200&&r.status<300});}
        catch(_){cleanup.push({name,passed:false});}
      }
    }
  }
  const report={generated_at:new Date().toISOString(),checks,cleanup,failure,passed:!failure&&checks.length===5&&cleanup.every(x=>x.passed),native_execution_tested:false};
  const output=process.argv[2]||"tmp/duration/cloud.json";fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.passed,checks:checks.length,cleanup:cleanup.every(x=>x.passed),report:output}));process.exitCode=report.passed?0:1;
}
run().catch(()=>{console.error("duration_smoke_configuration_failed");process.exitCode=1;});
