"use strict";
// Closed staging targets, synthetic accounts only, no notifications or native
// success receipts. The production endpoint and real user data are unreachable.
const fs = require("node:fs"), crypto = require("node:crypto"), path = require("node:path");
const { configuration, target, memoryIdentity } = require("./assistant_app_cloud_test");
const SCRIPT_SHA256 = crypto.createHash("sha256").update(fs.readFileSync(__filename)).digest("hex");
async function run(config, output) {
  target(config.supabase,"supabase"); target(config.netlify,"netlify");
  const runId = crypto.randomUUID(), users = [], checks = [], cleanup = [];
  let active = "preflight", failure = null, revision = Date.now()*1000;
  const service = { apikey: config.serviceKey, authorization: `Bearer ${config.serviceKey}` };
  const expect = (test, code) => { if (!test) throw Error(code); };
  async function request(origin, route, { method="GET", body, headers={} }={}) {
    expect([config.supabase,config.netlify].includes(origin) && route.startsWith("/") && !route.startsWith("//"),"target_rejected");
    let response;
    try { response = await fetch(origin+route,{method,redirect:"error",headers:{"content-type":"application/json",...headers},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000)}); }
    catch (_) { throw Error("network_failed"); }
    let data; try { data = await response.json(); } catch (_) { data=null; }
    return { status:response.status,body:data };
  }
  function ok(response,code) { expect(response.status>=200 && response.status<300,`${code}_http_${response.status}`); return response.body; }
  const db = (route,options={})=>request(config.supabase,"/rest/v1/"+route,{...options,headers:{...service,prefer:"return=representation",...options.headers}});
  const admin = (route,options={})=>request(config.supabase,"/auth/v1/admin/"+route,{...options,headers:service});
  const app = (user,body)=>request(config.netlify,"/.netlify/functions/assistant-app",{method:"POST",
    headers:{...config.extraHeaders,...(user?.token?{authorization:`Bearer ${user.token}`}:{})},body:{app_install_id:user?.install||"brain-qa",...body}});
  async function check(name,fn) { active=name; await fn();checks.push({name,passed:true});console.log("PASS "+name); }
  async function seed(index) {
    const user={install:`brain-qa-${runId}-${index}`,anonymous:`brain-qa:${runId}:${index}`};
    const password=crypto.randomBytes(28).toString("base64url");
    const created=ok(await admin("users",{method:"POST",body:{email:`brain-${runId}-${index}@example.invalid`,password,email_confirm:true,
      app_metadata:{provider:"apple",providers:["apple"],synthetic_staging_run:runId}}}),"create_user");
    user.id=created.id;users.push(user);
    user.token=ok(await request(config.supabase,"/auth/v1/token?grant_type=password",{method:"POST",headers:{apikey:config.anonKey},
      body:{email:created.email,password}}),"sign_in").access_token;
    user.connect=ok(await app(user,{action:"activate"}),"activate").assistant_connect_code;
    user.memory=memoryIdentity("app",user.id);
    for(const id of [user.memory,user.anonymous,`app:${user.id}`]) {
      expect(ok(await db(`digital_wellness_feature_payloads?anonymous_user_id=eq.${encodeURIComponent(id)}&select=id&limit=1`),"namespace").length===0,"existing_namespace");
    }
    user.ownsNamespace=true;
    return user;
  }
  function context(overrides={}) {
    const now=Date.now(),iso=t=>new Date(t).toISOString();
    const midnight=Date.parse(new Date(now).toISOString().slice(0,10)+"T00:00:00Z"), yesterday=midnight-86400000;
    return { anonymous_user_id:"client-cannot-choose-account",context_revision:++revision,language:"en",locale:"en",timezone:"UTC",
      is_blank_active:false,has_selected_apps:true,selection_count:3,screen_time_authorized:true,
      device_execution_ready:true,protection_target:"selected_distractions",schedule:{windows:[]},
      brain_snapshot:{schema_version:1,generated_at:iso(now),timezone:"UTC",week_starts_on:2,
        history_started_at:iso(yesterday-86400000),history_complete:true,
        sessions:[{id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",started_at:iso(yesterday+3600000),ended_at:iso(yesterday+5400000),
          pause_started_at:iso(yesterday+3900000),pause_ended_at:iso(yesterday+4200000),ended_reason:"timer"}],
        account:{signed_in:true,premium_access:true}},...overrides };
  }
  const send=async(user,text,{id=crypto.randomUUID(),snapshot=context()}={})=>{
    const response=await app(user,{action:"send",turn_id:id,text,context:snapshot});
    expect(response.status===200 && response.body?.turn?.status==="completed",`send_http_${response.status}`);
    return response.body.turn;
  };
  const memories=async user=>ok(await db(`bm_brain_memories?auth_user_id=eq.${user.id}&select=key,value,source_turn_id,source_text`),"read_memory");
  try {
    await check("unauthenticated_request_rejected",async()=>expect((await app(null,{action:"history"})).status===401,"auth_rejected"));
    let a,b,remembered;
    await check("two_isolated_synthetic_apple_accounts",async()=>{a=await seed(1);b=await seed(2);});
    await check("personal_memory_clients_and_foreign_install_denied",async()=>{
      const denied=await request(config.supabase,"/rest/v1/bm_brain_memories?select=key",{headers:{apikey:config.anonKey,authorization:`Bearer ${a.token}`}});
      expect([401,403].includes(denied.status),"memory_client_read_allowed");
      expect((await app(b,{action:"history",app_install_id:a.install})).status===403,"foreign_install_allowed");
    });
    await check("memory_committed_with_literal_source_and_immutable_replay",async()=>{
      const prompt="Remember my goal: study in the morning.";
      remembered=await send(a,prompt);
      const rows=await memories(a),goal=rows.find(r=>r.key==="goal");
      expect(goal && prompt.includes(goal.value) && goal.source_text===prompt && goal.source_turn_id===remembered.id,"memory_source_mismatch");
      const replay=await send(a,prompt,{id:remembered.id});
      expect(replay.assistant_text===remembered.assistant_text && (await memories(a)).length===rows.length,"memory_replay_changed");
    });
    await check("personal_memory_does_not_cross_accounts",async()=>{
      const reply=await send(b,"What do you remember about me?");
      expect((await memories(b)).length===0 && !reply.assistant_text.includes("study in the morning"),"account_memory_leaked");
    });
    await check("memory_correction_replaces_prior_fact",async()=>{
      const prompt="Correct my goal: read every evening.";
      const turn=await send(a,prompt),goal=(await memories(a)).find(r=>r.key==="goal");
      expect(goal && prompt.includes(goal.value) && goal.value.includes("evening") && goal.source_turn_id===turn.id,"correction_not_saved");
    });
    await check("statistics_subtract_recorded_pauses_without_actions",async()=>{
      const turn=await send(a,"How many minutes was I protected yesterday?");
      expect(/25 min/.test(turn.assistant_text) && !turn.action_id && !turn.auto_apply,"statistics_incorrect_or_mutating");
    });
    await check("configuration_reads_current_device_snapshot",async()=>{
      const turn=await send(a,"What blocking schedules are configured?");
      expect(/No saved schedules/.test(turn.assistant_text) && !turn.action_id,"configuration_not_current");
    });
    await check("history_search_returns_own_literal_user_statement",async()=>{
      const turn=await send(a,"Search my previous messages for 'morning'.");
      expect(turn.assistant_text.includes("study in the morning") && !turn.action_id,"history_search_missing_or_mutating");
    });
    await check("account_query_uses_observed_storekit_access",async()=>{
      const turn=await send(a,"Do I have premium access?");
      expect(/premium access active/.test(turn.assistant_text) && turn.control_section==="settings" && !turn.action_id,"account_query_not_observed");
    });
    await check("explicit_protection_queues_exact_native_action_once",async()=>{
      const prompt="Block my selected distractions now for 25 minutes, just once.";
      const turn=await send(a,prompt),replay=await send(a,prompt,{id:turn.id});
      expect(turn.auto_apply===true && turn.action_id===`app_${turn.id}` && replay.action_id===turn.action_id,"explicit_action_not_unique");
      const inbox=ok(await request(config.netlify,"/.netlify/functions/assistant-channel",{method:"POST",
        headers:{...config.extraHeaders,authorization:`Bearer ${a.token}`},body:{action:"poll_pending_action",connect_code:a.connect,app_install_id:a.install,preferred_channel:"app"}}),"inbox");
      expect(inbox.pending_action?.id===turn.action_id && inbox.pending_action.minutes===25,"inbox_action_mismatch");
      expect(!["verified","delayed"].includes(turn.action_status),"fabricated_native_success");
    });
    await check("stale_device_snapshot_cannot_authorize_action",async()=>{
      const snapshot=context();snapshot.brain_snapshot.generated_at=new Date(Date.now()-600000).toISOString();
      const turn=await send(a,"Block my distractions now for 30 minutes.",{snapshot});
      expect(!turn.action_id && !turn.auto_apply && /recent iPhone state/.test(turn.assistant_text),"stale_context_executed");
    });
    await check("weakening_protection_requires_explicit_native_confirmation",async()=>{
      const turn=await send(a,"Disable the adult content filter.");
      expect(turn.action_id && !turn.auto_apply && turn.action_status==="queued","weakening_bypassed_confirmation");
    });
    await check("forget_and_old_response_replay_do_not_restore_fact",async()=>{
      await send(a,"Forget my goal.");
      expect((await memories(a)).find(r=>r.key==="goal")?.value===null,"forget_not_saved");
      await send(a,"Remember my goal: study in the morning.",{id:remembered.id});
      expect((await memories(a)).find(r=>r.key==="goal")?.value===null,"old_reply_resurrected_memory");
    });
    await check("forget_all_persists_reset_and_empty_memory_read",async()=>{
      await send(a,"Forget all your personal memories about me.");
      const rows=await memories(a);expect(rows.some(r=>r.key==="_reset") && rows.every(r=>r.value===null),"forget_all_incomplete");
      const turn=await send(a,"What do you remember about me?");expect(/no saved personal memories/.test(turn.assistant_text),"forgotten_fact_reported");
    });
  } catch(error) { failure={check:active,code:/^[a-z0-9_]+$/i.test(error.message)?error.message:"unexpected_test_error"};checks.push({name:active,passed:false,code:failure.code});console.log(`FAIL ${active} ${failure.code}`); }
  finally {
    for(const user of users.reverse()) {
      const tasks=[["auth_user_turns_and_memories",()=>admin(`users/${user.id}`,{method:"DELETE"})],
        ["identity_and_snapshot",()=>db(`blankmind_identity_links?auth_user_id=eq.${user.id}`,{method:"DELETE"})],
        ...(user.ownsNamespace?[["semantic_state",()=>db(`assistant_semantic_conversations?anonymous_user_id=eq.${user.memory}`,{method:"DELETE"})],
          ...[user.memory,`connect:${user.connect}`,user.anonymous,`app:${user.id}`].map(id=>["synthetic_events",()=>db(`digital_wellness_feature_payloads?anonymous_user_id=eq.${encodeURIComponent(id)}`,{method:"DELETE"})])]:[])];
      for(const [name,action] of tasks) {try {const r=await action();cleanup.push({name,passed:r.status>=200&&r.status<300});} catch(_){cleanup.push({name,passed:false});}}
    }
    console.log(`${cleanup.every(c=>c.passed)?"PASS":"FAIL"} synthetic_cleanup`);
  }
  const report={generated_at:new Date().toISOString(),run_id:runId,script_sha256:SCRIPT_SHA256,
    targets:{supabase:config.supabase,netlify:config.netlify},checks,cleanup,synthetic_auth_user_ids:users.map(u=>u.id),
    scope:"real_staging_brain_with_synthetic_device_observations_no_native_execution",passed:!failure&&checks.length===15&&cleanup.every(c=>c.passed),failure};
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));return report;
}
if(require.main===module) {
  const args=process.argv.slice(2),at=args.indexOf("--out");
  if(!args.includes("--run"))throw Error("explicit_staging_run_required");
  run(configuration(),at<0?"tmp/brain/cloud.json":args[at+1]).then(r=>{process.exitCode=r.passed?0:1;}).catch(()=>{console.error("staging_configuration_failed");process.exitCode=1;});
}
module.exports={run};
