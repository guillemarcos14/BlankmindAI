"use strict";
const fs=require('node:fs'),crypto=require('node:crypto');
const {configuration,memoryIdentity}=require('./assistant_app_cloud_test');
async function main() {
  const c=configuration(),run=crypto.randomUUID(),report={run_id:run,turns:[],checks:[],cleanup:[],passed:false,native_execution_tested:false};
  const service={apikey:c.serviceKey,authorization:'Bearer '+c.serviceKey};
  const request=async(origin,route,body,headers={},method='POST')=>{
    if(![c.supabase,c.netlify].includes(origin))throw Error('closed_target_required');
    const r=await fetch(origin+route,{method,headers:{'content-type':'application/json',...headers},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});
    return {status:r.status,body:await r.json().catch(()=>null)};
  };
  const assert=(ok,name)=>{if(!ok)throw Error(name);report.checks.push({name,passed:true});};
  const cases=[['today_es','Bloquea mis distracciones durante todo el día de hoy','es'],
    ['today_en','Block my selected distractions for the rest of today, only today.','en'],
    ['midnight_es','Bloquea mis distracciones desde ahora hasta medianoche de hoy, solo una vez.','es']];
  for(const [name,text,language] of cases) {
    let user,connect,token;const install=name+'-'+run;
    const app=body=>request(c.netlify,'/.netlify/functions/assistant-app',{app_install_id:install,...body},
      {...c.extraHeaders,authorization:'Bearer '+token});
    const context=()=>({context_revision:Date.now()*1000,language,locale:language,timezone:'Europe/Madrid',
      has_selected_apps:true,selection_count:2,screen_time_authorized:true,is_blank_active:false,
      protection_target:'selected_distractions',device_execution_ready:true,schedule:{windows:[]},
      brain_snapshot:{schema_version:1,generated_at:new Date().toISOString(),timezone:'Europe/Madrid',sessions:[],
        history_complete:true,account:{signed_in:true,premium_access:true}}});
    try {
      const email=name+'-'+run+'@example.invalid',password=crypto.randomBytes(28).toString('base64url');
      const created=await request(c.supabase,'/auth/v1/admin/users',{email,password,email_confirm:true,
        app_metadata:{provider:'apple',providers:['apple'],synthetic_staging_run:run}},service);
      assert([200,201].includes(created.status),name+'_account');user=created.body.id;
      const login=await request(c.supabase,'/auth/v1/token?grant_type=password',{email,password},{apikey:c.anonKey});
      assert(login.status===200,name+'_login');token=login.body.access_token;
      const active=await app({action:'activate'});assert(active.status===200,name+'_activate');connect=active.body.assistant_connect_code;
      const body={action:'send',turn_id:crypto.randomUUID(),app_install_id:install,text,context:context()},start=Date.now();
      const r=await fetch(c.netlify+'/.netlify/functions/assistant-app-stream',{method:'POST',
        headers:{'content-type':'application/json',...c.extraHeaders,authorization:'Bearer '+token},
        body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
      assert(r.status===200&&r.headers.get('content-type')?.includes('application/x-ndjson'),name+'_transport');
      const frames=(await r.text()).trim().split('\n').map(x=>JSON.parse(x)),final=frames.find(x=>x.type==='result');
      assert(final?.status===200&&final.body.turn?.status==='completed',name+'_completed');
      const turn=final.body.turn;assert(!!turn.action_id&&turn.auto_apply===true,name+'_action');
      const stored=await request(c.supabase,'/rest/v1/digital_wellness_feature_payloads?anonymous_user_id=eq.'+memoryIdentity('app',user)+'&select=payload',undefined,service,'GET');
      assert(stored.status===200,name+'_stored');
      const action=stored.body.map(row=>row.payload?.properties?.memory?.pending_assistant_action).find(x=>x?.id===turn.action_id);
      assert(action?.type==='apply_schedule'&&action.recurrence==='once'&&action.end_minute===0,name+'_once_midnight');
      assert(action.timezone==='Europe/Madrid'&&action.weekdays.length===0&&action.duration_days===null,name+'_no_recurrence');
      const expected=require('../netlify/functions/bm-brain-data').midnight(require('../netlify/functions/bm-brain-data').dayOffset(action.local_date,1),action.timezone);
      assert(Date.parse(action.ends_at)===expected,name+'_exact_local_midnight');
      const remaining=Date.parse(action.starts_at)-Date.now();assert(remaining>15000&&remaining<90000,name+'_native_future_start');
      assert(!/no he podido|couldn't prepare/i.test(turn.assistant_text),name+'_no_generic_clarification');
      const status=await app({action:'status',turn_id:body.turn_id});assert(status.status===200&&status.body.turn?.status==='completed',name+'_status');
      const replay=await app(body);assert(replay.status===200&&JSON.stringify(replay.body.turn)===JSON.stringify(turn),name+'_exact_replay');
      report.turns.push({name,text,reply:turn.assistant_text,elapsed_ms:Date.now()-start,action:{type:action.type,recurrence:action.recurrence,
        start_minute:action.start_minute,end_minute:action.end_minute,local_date:action.local_date,timezone:action.timezone,starts_at:action.starts_at,ends_at:action.ends_at}});
      console.log('PASS '+name);
    } catch(e) {report.failure=/^[\w_]+$/.test(e.message)?e.message:'unexpected_failure';console.log('FAIL '+report.failure);}
    finally {
      if(user)for(const [label,route] of [['account','/auth/v1/admin/users/'+user],['identity','/rest/v1/blankmind_identity_links?auth_user_id=eq.'+user],
        ['semantic','/rest/v1/assistant_semantic_conversations?anonymous_user_id=eq.'+memoryIdentity('app',user)],
        ...[memoryIdentity('app',user),'connect:'+connect,'app:'+user].map(x=>['features','/rest/v1/digital_wellness_feature_payloads?anonymous_user_id=eq.'+encodeURIComponent(x)])]) {
        try {const cleaned=await request(c.supabase,route,undefined,service,'DELETE');report.cleanup.push({name:name+'_'+label,passed:cleaned.status>=200&&cleaned.status<300});}
        catch(_){report.cleanup.push({name:name+'_'+label,passed:false});}
      }
    }
    if(report.failure)break;
  }
  report.passed=!report.failure&&report.turns.length===cases.length&&report.cleanup.every(x=>x.passed);report.finished_at=new Date().toISOString();
  fs.mkdirSync('tmp/schedule-followup',{recursive:true});fs.writeFileSync('tmp/schedule-followup/cloud-test.json',JSON.stringify(report,null,2));
  if(!report.passed)process.exitCode=1;
}
main().catch(()=>{console.log('today_cloud_test_failed');process.exitCode=1;});
