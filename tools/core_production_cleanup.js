"use strict";
// Explicitly authorized CORE retirement. No schema, environment, provider or
// user-data mutations. A replacement deploy preserves every retained digest.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const {execFileSync}=require("node:child_process");
const ROOT=path.resolve(__dirname,".."),SITE="59955668-9a9b-4979-a283-63fbf3115fe5",DIR=path.join(ROOT,"tmp/core-completion-20261015");
const CORE=["account-data","app-auth","assistant-app","assistant-app-stream","assistant-app-voice","assistant-device","bmb-tick","bmb-worker-background"];
const RETIRED=Object.freeze(["app-handoff","assistant-action-retry-background","assistant-audio","assistant-channel","bai-call-twiml","bai-call","bai-feedback","bai-intelligence","bai-learning-dashboard","bai-learning-notifications","bai-outcome","blanked-agent","bm-blocking-contract","bm-contextual-response","bm-harness","bm-learning","bm-loop","bm-onboarding","bm-personal-context-view","bm-policy","bm-schedule-management","bm-semantic-extraction","bm-verification","digital-wellness-features","elevenlabs-bai-tool","sms-agent","twilio-voice-configure","waitlist-agent-background","waitlist-agent","waitlist-data","waitlist-start","wearable-connections","wearable-oauth-callback","wearable-oauth-start","wearable-outcome","wearable-scheduled-sync","wearable-sync","weather-context","wellness-signal","whatsapp-agent","_assistant_channel","_bm_action_link","_bm_final_qa_access","_bm_final_qa_dispatch","_bm_tone","_twilio_voice","_waitlist_ai","_waitlist_store","_waitlist_whatsapp","_wearable_intelligence","_wearable_oauth"]);
const load=n=>JSON.parse(fs.readFileSync(path.join(DIR,n),"utf8"));
function save(n,v){fs.mkdirSync(DIR,{recursive:true});fs.writeFileSync(path.join(DIR,n),JSON.stringify(v,null,2)+"\n");}
function inventory(payload){const groups=Array.isArray(payload)?payload:[payload],main=groups.filter(x=>x.branch===null);assert.equal(main.length,1);assert(Array.isArray(main[0].functions));return main[0].functions;}
const name=f=>f.n||f.name,digest=f=>f.d||f.sha;
function plan({functions,files,schedules,sourceExists=n=>[".js",".mjs",".ts"].some(ext=>fs.existsSync(path.join(ROOT,"netlify/functions",n+ext)))}){
 assert(new Set(functions.map(name)).size===functions.length,"Duplicate function name");
 const remove=functions.filter(f=>RETIRED.includes(name(f))),keep=functions.filter(f=>!RETIRED.includes(name(f)));
 for(const f of remove)assert(!sourceExists(name(f)),"Retirement would remove a live source: "+name(f));
 for(const n of CORE)assert(keep.some(f=>name(f)===n),"Required CORE function missing: "+n);
 for(const f of functions)assert(/^[a-f0-9]{64}$/.test(digest(f)),"Invalid existing function digest");
 for(const s of schedules)assert(keep.some(f=>name(f)===s.name),"Retirement would orphan a schedule");
 assert(files.length>0);assert.equal(new Set(files.map(f=>f.path)).size,files.length);
 const body={draft:true,files:Object.fromEntries(files.map(f=>[f.path.replace(/^\//,""),f.sha])),functions:Object.fromEntries(keep.map(f=>[name(f),digest(f)])),functions_config:Object.fromEntries(keep.map(f=>[name(f),{priority:f.p??f.priority??10,build_data:f.bd??f.build_data??{}}])),function_schedules:schedules,title:"Authorized CORE retirement, 15 Oct 2026; preserve current iOS119 runtime"};
 return {removed:remove.map(name).sort(),retained:keep.map(name).sort(),body};
}
function verify({functions,files,schedules},prepared){
 assert.deepEqual(Object.fromEntries(functions.map(f=>[name(f),digest(f)])),prepared.body.functions,"Remote inventory/digests differ from the retirement manifest");
 assert(!functions.some(f=>RETIRED.includes(name(f))),"Retired function still published");
 assert.deepEqual(schedules,prepared.body.function_schedules,"Schedule changed");
 assert.deepEqual(Object.fromEntries(files.map(f=>[f.path.replace(/^\//,""),f.sha])),prepared.body.files,"Static content changed");
 return true;
}
function environmentDigest(vars){return crypto.createHash("sha256").update(JSON.stringify(vars.map(v=>({key:v.key,scopes:[...v.scopes].sort(),is_secret:!!v.is_secret,values:v.values.map(x=>({context:x.context,branch:x.branch||null,value:x.value})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))})).sort((a,b)=>a.key.localeCompare(b.key)))).digest("hex");}
function artifacts(prepared){
 const old=JSON.parse(fs.readFileSync(path.resolve(ROOT,"../Codigo-appstore-final/tmp/appstore-final/production-bundle/manifest.json"),"utf8"));
 const current=JSON.parse(fs.readFileSync(path.join(ROOT,"tmp/release-today/manifest.json"),"utf8"));
 const paths={...old.artifacts,...Object.fromEntries(current.package.functions.map(f=>[f.sha256,f.path]))};
 return Object.fromEntries(Object.entries(prepared.body.functions).map(([n,h])=>{const file=paths[h];assert(file&&fs.existsSync(file),"Exact retained ZIP unavailable: "+n);assert.equal(crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),h,"Retained ZIP mismatch: "+n);return [n,file];}));
}
async function main(){
 const mode=process.argv[2];assert(["plan","prepare","resume","publish","verify","rollback","smoke-draft","smoke-live"].includes(mode));
 if(!["plan","verify"].includes(mode))assert(process.argv.includes("--confirm"),"Explicit --confirm required for remote mutations");
 const cfg=JSON.parse(fs.readFileSync(path.join(process.env.APPDATA,"netlify/Config/config.json"),"utf8")),token=(cfg.users[cfg.userId]||Object.values(cfg.users)[0]).auth.token;
 async function api(route,method="GET",body,binary=false){const r=await fetch("https://api.netlify.com/api/v1"+route,{method,headers:{authorization:"Bearer "+token,"content-type":binary?"application/octet-stream":"application/json"},...(body===undefined?{}:{body:binary?body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});assert(r.ok,method+" "+route+" HTTP "+r.status);return r.status===204?null:r.json();}
 const site=await api("/sites/"+SITE);assert.equal(site.ssl_url,"https://getblank.netlify.app");
 const env=await api("/accounts/"+site.account_id+"/env?site_id="+SITE),envHash=environmentDigest(env);
 async function snapshot(id){return {functions:inventory(await api("/sites/"+SITE+"/functions?deploy_id="+id)),files:await api("/deploys/"+id+"/files"),schedules:(await api("/deploys/"+id)).function_schedules};}
 if(mode==="plan"){
  const previous=site.published_deploy.id,snap=await snapshot(previous),prepared=plan(snap);assert(prepared.removed.length,"No retired functions to remove");
  save("cleanup-plan.json",{created_at:new Date().toISOString(),authorization:"Guillem 15 Oct 2026: corrige limpieza servidor y completa validación/activación respetando40USD",previous,previous_locked:!!(await api("/deploys/"+previous)).locked,environment_digest:envHash,source:execFileSync("git",["rev-parse","HEAD"],{cwd:ROOT,encoding:"utf8"}).trim(),...prepared});
  console.log(JSON.stringify({previous,remove:prepared.removed.length,preserve:prepared.retained.length,statics:snap.files.length,environment_mutations:0}));return;
 }
 const prepared=load("cleanup-plan.json");assert.equal(envHash,prepared.environment_digest,"Production environment changed");
 if(mode==="rollback"){
  const receipt=load("cleanup-publication.json");assert.equal(site.published_deploy.id,receipt.deploy_id);await api("/sites/"+SITE+"/deploys/"+prepared.previous+"/restore","POST",{});if(!prepared.previous_locked)await api("/deploys/"+prepared.previous+"/unlock","POST",{});save("cleanup-rollback.json",{at:new Date().toISOString(),restored:prepared.previous});return;
 }
 if(mode==="prepare"||mode==="resume"){
  assert.equal(site.published_deploy.id,prepared.previous);const original=await snapshot(prepared.previous);assert.deepEqual(plan(original),{removed:prepared.removed,retained:prepared.retained,body:prepared.body});
  assert(/^codex\/backend-release-/.test(execFileSync("git",["branch","--show-current"],{cwd:ROOT,encoding:"utf8"}).trim()));
  assert.equal(execFileSync("git",["status","--porcelain"],{cwd:ROOT,encoding:"utf8"}).trim(),"","Commit release source first");
  assert.equal(load("cleanup-validation.json").status,"passed","Scope-enforced validation required");
  const exact=artifacts(prepared);let d;
  if(mode==="prepare"){
   assert(!fs.existsSync(path.join(DIR,"cleanup-publication.json")),"Existing draft receipt: use resume, never create a duplicate");
   await api("/deploys/"+prepared.previous+"/lock","POST",{});
   d=await api("/sites/"+SITE+"/deploys","POST",prepared.body);save("cleanup-publication.json",{status:"preparing",previous:prepared.previous,deploy_id:d.id,url:d.deploy_ssl_url,source:prepared.source});
  }else{d=await api("/deploys/"+load("cleanup-publication.json").deploy_id);assert.equal(load("cleanup-publication.json").status,"preparing");}
  const needed=new Set(d.required_functions||[]),metadata=new Map(original.functions.map(f=>[name(f),f]));
  for(const [n,h] of Object.entries(prepared.body.functions))if(needed.has(h)){
   const f=metadata.get(n),mode=f.bd?.runtimeAPIVersion===2?"stream":n.endsWith("-background")?"background":"buffer";
   await api("/deploys/"+d.id+"/functions/"+n+"?runtime="+(f.r||"nodejs22.x")+"&invocation_mode="+mode,"PUT",fs.readFileSync(exact[n]),true);
  }
  for(let i=0;i<30;i++){const state=await api("/deploys/"+d.id);assert.notEqual(state.state,"error");if(state.state==="ready"){verify(await snapshot(d.id),prepared);assert.equal((await api("/sites/"+SITE)).published_deploy.id,prepared.previous);save("cleanup-publication.json",{...load("cleanup-publication.json"),status:"prepared"});console.log(JSON.stringify({status:"prepared",deploy_id:d.id,removed:prepared.removed.length}));return;}await new Promise(r=>setTimeout(r,1000));}throw Error("Draft readiness timeout; retain receipt and inspect same deploy");
 }
 const receipt=load("cleanup-publication.json");
 if(mode.startsWith("smoke-")){
  const value=k=>{const e=env.find(v=>v.key===k);return e?.values.find(v=>v.context==="production")?.value??e?.values.find(v=>v.context==="all")?.value;};
  const cloud=require("./assistant_app_cloud_test"),config=cloud.configuration({BM_CLOUD_TEST_SUPABASE_URL:value("SUPABASE_URL"),BM_CLOUD_TEST_SERVICE_ROLE_KEY:value("SUPABASE_SERVICE_ROLE_KEY"),BM_CLOUD_TEST_ANON_KEY:value("SUPABASE_ANON_KEY"),BM_CLOUD_TEST_NETLIFY_URL:mode==="smoke-draft"?receipt.url:site.ssl_url},true,{physicalQa:true});
  const result=await cloud.run(config,path.join(DIR,mode+".json"),{infrastructureOnly:true});assert(result.passed);return;
 }
 if(mode==="publish"){
  assert.equal(site.published_deploy.id,prepared.previous);assert.equal(receipt.status,"prepared");assert(load("smoke-draft.json").passed);verify(await snapshot(receipt.deploy_id),prepared);await api("/sites/"+SITE+"/deploys/"+receipt.deploy_id+"/restore","POST",{});
 }
 assert.equal((await api("/sites/"+SITE)).published_deploy.id,receipt.deploy_id);verify(await snapshot(receipt.deploy_id),prepared);
 if(mode==="publish"&&!prepared.previous_locked)await api("/deploys/"+receipt.deploy_id+"/unlock","POST",{});
 save("cleanup-publication.json",{...receipt,status:"published_verified",verified_at:new Date().toISOString(),removed:prepared.removed,retained:prepared.retained,statics_unchanged:true,environment_unchanged:true,schedules_unchanged:true});
 console.log(JSON.stringify({status:"published_verified",deploy:receipt.deploy_id,removed:prepared.removed.length,retained:prepared.retained.length}));
}
if(require.main===module)main().catch(e=>{console.error("core_cleanup: "+e.message);process.exitCode=1;});
module.exports={CORE,RETIRED,inventory,plan,verify,environmentDigest};
