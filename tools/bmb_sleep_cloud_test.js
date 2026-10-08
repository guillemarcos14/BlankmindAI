"use strict";
// Isolated private QA account, real deployed handler/model; no device actions.
const fs=require("node:fs"),crypto=require("node:crypto"),path=require("node:path");
const {configuration,memoryIdentity}=require("./assistant_app_cloud_test");
async function run() {
  const c=configuration(),id=crypto.randomUUID(),checks=[],cleanup=[];
  const service={apikey:c.serviceKey,authorization:`Bearer ${c.serviceKey}`};
  let user,token,connect,failure;
  const request=async(origin,route,body,headers={},method="POST")=>{
    if(![c.supabase,c.netlify].includes(origin))throw Error("target_rejected");
    const r=await fetch(origin+route,{method,headers:{"content-type":"application/json",...headers},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000)});
    return {status:r.status,body:await r.json().catch(()=>null)};
  };
  const expect=(ok,code)=>{if(!ok)throw Error(code);};
  const app=body=>request(c.netlify,"/.netlify/functions/assistant-app",{app_install_id:"sleep-qa-"+id,...body},
    {...c.extraHeaders,authorization:"Bearer "+token});
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Madrid",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const date=i=>new Date(Date.parse(today+"T12:00:00Z")-i*86400000).toISOString().slice(0,10);
  const nights=Array.from({length:14},(_,i)=>({date:date(13-i),source:"synthetic_qa",sleep_minutes:i<7?420:480,
    deep_minutes:75,rem_minutes:90,core_minutes:(i<7?420:480)-165,bedtime_minute:1380,wake_minute:450}));
  const context=(source="synthetic_qa",enabled=true)=>({context_revision:Date.now()*1000,language:"es",locale:"es",
    has_selected_apps:true,selection_count:2,screen_time_authorized:true,is_blank_active:false,
    sleep_data_available:enabled,sleep_minutes:enabled?480:0,
    personal_profile:{sleep_source:source,sleep_is_synthetic:source==="synthetic_qa",sleep_nights:enabled?nights.map(n=>({...n,source})):[]},
    brain_snapshot:{schema_version:1,generated_at:new Date().toISOString(),timezone:"Europe/Madrid",local_date:today,
      sessions:[],history_complete:true,account:{signed_in:true,premium_access:true}}});
  const turn=async(name,text,ctx,validate)=>{
    const r=await app({action:"send",turn_id:crypto.randomUUID(),text,context:ctx});
    expect(r.status===200&&r.body.turn?.status==="completed",name+"_http_"+r.status);
    expect(!r.body.turn.action_id&&!r.body.turn.auto_apply,name+"_unexpected_action");
    validate(r.body.turn.assistant_text);checks.push({name,passed:true,response:r.body.turn.assistant_text});
    console.log("PASS "+name);
  };
  try {
    const password=crypto.randomBytes(28).toString("base64url"),email=`sleep-${id}@example.invalid`;
    const created=await request(c.supabase,"/auth/v1/admin/users",{email,password,email_confirm:true,
      app_metadata:{provider:"apple",providers:["apple"],synthetic_staging_run:id}},service);
    expect([200,201].includes(created.status),"create_failed");user=created.body.id;
    const login=await request(c.supabase,"/auth/v1/token?grant_type=password",{email,password},{apikey:c.anonKey});
    expect(login.status===200,"login_failed");token=login.body.access_token;
    const activated=await app({action:"activate"});expect(activated.status===200,"activate_failed");connect=activated.body.assistant_connect_code;
    await turn("existing_history","Anteriormente dormí mejor tras aplicar el bloqueo.",context("apple_health",false),()=>{});
    await turn("synthetic_dated_sleep",`¿Cuánto dormí el ${today}? Usa los registros de sueño de la app, no mis mensajes anteriores. No propongas bloqueos.`,context(),text=>{
      expect(/8\s*(?:h|horas)|ocho horas|480/.test(text),"latest_night_missing");
      expect(/sint[eé]tic|simulad|prueba/i.test(text),"synthetic_provenance_missing");
    });
    await turn("synthetic_period_comparison",`Compara mi media de sueño entre ${date(13)} y ${date(7)} con ${date(6)} a ${today}. ¿Cuántas horas en cada periodo y qué diferencia hay? No propongas bloqueos.`,context(),text=>{
      expect(/7\s*(?:h|horas)|siete horas|420/.test(text)&&/8\s*(?:h|horas)|ocho horas|480/.test(text),"period_comparison_missing");
    });
    await turn("measured_same_path",`¿Cuánto sueño registra Apple Health el ${today}? Consulta el estado actual de la app. No propongas bloqueos.`,context("apple_health"),text=>{
      expect(/8\s*(?:h|horas)|ocho horas|480/.test(text),"measured_night_missing");
      expect(!/datos (?:sint[eé]ticos|simulados)/i.test(text),"measured_source_replaced_by_old_fixture");
    });
    await turn("disabled_source",`He desactivado la fuente de prueba. ¿Hay ahora registros actuales de sueño en la app? No uses el historial como registro ni propongas bloqueos.`,context("apple_health",false),text=>{
      expect(/no (?:hay|tengo|constan|aparecen)|sin registros|no muestra/i.test(text),"disabled_source_not_cleared");
    });
  }catch(e){failure=/^[\w_]+$/.test(e.message)?e.message:"unexpected_error";console.log("FAIL "+failure);}
  finally {
    if(user)for(const [name,route]of [
      ["account",`/auth/v1/admin/users/${user}`],
      ["identity",`/rest/v1/blankmind_identity_links?auth_user_id=eq.${user}`],
      ["semantic",`/rest/v1/assistant_semantic_conversations?anonymous_user_id=eq.${memoryIdentity("app",user)}`],
      ...[memoryIdentity("app",user),`connect:${connect}`,`app:${user}`].map(key=>["features",`/rest/v1/digital_wellness_feature_payloads?anonymous_user_id=eq.${encodeURIComponent(key)}`])]) {
      try{const r=await request(c.supabase,route,undefined,service,"DELETE");cleanup.push({name,passed:r.status>=200&&r.status<300});}
      catch(_){cleanup.push({name,passed:false});}
    }
  }
  const report={generated_at:new Date().toISOString(),checks,cleanup,failure,passed:!failure&&checks.length===5&&cleanup.every(x=>x.passed)};
  const directory=path.resolve("tmp/sleep-bmb-fix");fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,"cloud.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.passed,checks:checks.length,cleanup:cleanup.every(x=>x.passed)}));
  if(!report.passed)process.exitCode=1;
  return report;
}
if(require.main===module)run().catch(()=>{console.error("sleep_cloud_unavailable");process.exitCode=1;});
module.exports={run};
