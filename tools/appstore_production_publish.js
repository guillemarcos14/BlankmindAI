"use strict";
// Explicit human-authorized operational rollout. Does not manufacture a
// physical/model readiness certificate or submit an app to Apple.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const {execFileSync}=require("node:child_process");
const ROOT=path.resolve(__dirname,".."),SITE="59955668-9a9b-4979-a283-63fbf3115fe5",PREVIOUS="6abe94a92bf201769389c075";
const DIRECTORY=path.join(ROOT,"tmp/appstore-final/production-bundle"),RECEIPT=path.join(ROOT,"tmp/appstore-final/production-publication.json");
const APP=["account-data","app-auth","assistant-app","assistant-app-stream","assistant-app-voice","assistant-channel","bmb-tick","bmb-worker-background"];
const FLAGS={BM_VOICE_ENABLED:"true",BM_VOICE_PROVIDER:"elevenlabs",ELEVENLABS_VOICE_ID_ES:"dNjJKg63Fr5AXwIdkATa",ELEVENLABS_VOICE_ID_EN:"WtA85syCrJwasGeHGH2p",BM_RETRIEVAL_STEP_ENABLED:"true",BM_DECISIONS_DATA_POLICY:"authenticated-account-records",BM_RETRIEVAL_STEP_QA_ENABLED:"false",BM_DECISIONS_QA_ENABLED:"false",BM_JEV_SHADOW_ENABLED:"false",BM_JEV_PREFETCH_EXPERIMENT:"false"};
const DORMANT=new Set(["BM_RETRIEVAL_STEP_QA_ENABLED","BM_DECISIONS_QA_ENABLED","BM_JEV_SHADOW_ENABLED","BM_JEV_PREFETCH_EXPERIMENT"]);
const DEFAULT_VOICE_IDS=new Set(["ELEVENLABS_VOICE_ID_ES","ELEVENLABS_VOICE_ID_EN"]);
const json=file=>JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));
const hash=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const git=args=>execFileSync("git",args,{cwd:ROOT,encoding:"utf8",windowsHide:true}).trim();
const value=v=>v?.values?.find(x=>x.context==="production")?.value??v?.values?.find(x=>x.context==="all")?.value;
function inventory(payload){const groups=Array.isArray(payload)?payload:[payload];const group=groups.filter(g=>g.branch===null);assert.equal(group.length,1);assert(Array.isArray(group[0].functions));return group[0].functions;}
function uploadMode(name,metadata,existing){
 if(metadata?.invocation_mode==="stream"||existing?.bd?.runtimeAPIVersion===2)return "stream";
 if(metadata?.invocation_mode==="background"||name.endsWith("-background"))return "background";
 return "buffer";
}
function validateManifest(manifest){
 assert.equal(manifest.expected_production_deploy,PREVIOUS);assert.equal(manifest.total_functions,77);
 assert.equal(manifest.statics,17);assert.equal(manifest.original_static_files_preserved,16);
 assert.equal(manifest.reconstructed_endpoints,5);assert.equal(manifest.body.function_schedules.length,0);
 assert.deepEqual([...manifest.force_upload_app_entries].sort(),[...APP].sort());
 assert.equal(git(["status","--porcelain"]),"");assert(/^codex\/backend-release-/.test(git(["branch","--show-current"])));
 // A documented closure may follow the frozen runtime; runtime edits may not.
 assert.equal(git(["diff",manifest.source_commit,"HEAD","--","netlify/functions","supabase/migrations"]),"");
 for(const sha of Object.values(manifest.body.functions))assert.equal(hash(manifest.artifacts[sha]),sha);
 for(const [name,sha] of Object.entries(manifest.body.files))assert.equal(crypto.createHash("sha1").update(fs.readFileSync(path.join(manifest.static_directory,name))).digest("hex"),sha);
 for(const name of APP){assert.equal(manifest.upload_metadata[name].runtime,"nodejs22.x");if(/stream|voice/.test(name))assert.equal(manifest.body.functions_config[name].build_data.runtimeAPIVersion,2);}
 const sql=json(path.join(ROOT,"tmp/appstore-final/production-schema-receipt.json"));
 assert.equal(sql.project,"vhiikgyyfisejjwqtxfc");assert(sql.after.protected&&sql.after.server_only&&sql.after.language);
 assert.deepEqual(sql.after.versions,["031","032","033","034"]);
}
async function main(args=process.argv.slice(2)){
 assert(args.includes("--authorized-production"),"Explicit production rollout authorization is required");
 const mode=args.find(x=>["--prepare","--publish","--rollback"].includes(x));assert(mode,"Choose prepare, publish or rollback");
 const cfg=json(path.join(process.env.APPDATA,"netlify/Config/config.json"));const token=(cfg.users[cfg.userId]||Object.values(cfg.users)[0]).auth.token;
 async function api(route,method="GET",body,type="application/json"){
  const response=await fetch("https://api.netlify.com/api/v1"+route,{method,headers:{authorization:"Bearer "+token,"content-type":type},
   ...(body===undefined?{}:{body:type==="application/json"?JSON.stringify(body):body}),signal:AbortSignal.timeout(60000)});
  assert(response.ok,"Netlify "+method+" "+route+" HTTP "+response.status);return response.status===204?null:response.json();
 }
 let site=await api("/sites/"+SITE);assert.equal(site.ssl_url,"https://getblank.netlify.app");
 const envRoute="/accounts/"+site.account_id+"/env",query="?site_id="+SITE;
 const save=r=>fs.writeFileSync(RECEIPT,JSON.stringify(r,null,2));
 async function setFlag(key,wanted){const all=await api(envRoute+query),current=all.find(v=>v.key===key);assert(!current?.is_secret);
  // These QA-only experiments default OFF when absent. Keep their explicit
  // false settings in Builds without consuming the legacy Lambda 4KB budget.
  // The selected IDs equal the tested server defaults. Preserve their values
  // in Builds; legacy channels use their separate singular VOICE_ID setting.
  const body={key,scopes:DORMANT.has(key)||DEFAULT_VOICE_IDS.has(key)?["builds"]:[...new Set([...(current?.scopes||[]),"functions"])],values:[...(current?.values||[]).filter(v=>v.context!=="production"),{context:"production",value:wanted}]};
  await api(current?envRoute+"/"+key+query:envRoute+query,current?"PUT":"POST",current?body:[body]);
 }
 if(mode==="--rollback"){
  const r=json(RECEIPT);assert.equal(r.previous,PREVIOUS);assert([PREVIOUS,r.deploy_id].includes(site.published_deploy.id));
  await api("/sites/"+SITE+"/deploys/"+PREVIOUS+"/restore","POST",{});
  await setFlag("BM_VOICE_ENABLED","false");await setFlag("BM_RETRIEVAL_STEP_ENABLED","false");
  if(!r.previous_locked)await api("/deploys/"+PREVIOUS+"/unlock","POST",{});
  r.status="rolled_back";save(r);console.log(JSON.stringify({status:r.status,deploy:PREVIOUS}));return;
 }
 const manifest=json(path.join(DIRECTORY,"manifest.json"));validateManifest(manifest);
 async function verifyRemote(id){const d=await api("/deploys/"+id);assert.equal(d.site_id,SITE);assert.equal(d.context,"production");assert.equal(d.state,"ready");
  const groups=await api("/sites/"+SITE+"/functions?deploy_id="+id);
  // Site catalogue follows the currently published deploy; inspect the
  // candidate catalogue only once published, then check every frozen digest.
  if(site.published_deploy.id===id){const functions=inventory(groups);assert.equal(functions.length,77);
   for(const f of functions){const name=f.n||f.name;assert.equal(f.d||f.sha,manifest.body.functions[name]);
    if(APP.includes(name)){assert.equal(f.r||f.runtime,"nodejs22.x");if(/stream|voice/.test(name))assert.equal(f.bd.runtimeAPIVersion,2);}}
  }
  return d;
 }
 async function probe(origin){const response=await fetch(origin+"/.netlify/functions/assistant-app-stream",{method:"POST",headers:{"content-type":"application/json"},body:'{"action":"send","turn_id":"runtime-preflight"}',signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200);assert(response.headers.get("content-type")?.startsWith("application/x-ndjson"));
  assert((await response.text()).split("\n").filter(Boolean).map(JSON.parse).some(f=>f.type==="result"&&f.status===401&&f.body.error==="authentication_required"));
  const voice=await fetch(origin+"/.netlify/functions/assistant-app-voice",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({turn_id:crypto.randomUUID(),request_id:crypto.randomUUID(),elevenlabs_consent:false}),signal:AbortSignal.timeout(15000)});
  assert.equal(voice.status,401);return {stream_status:200,auth_status:401,voice_auth_status:401,model_calls:0};
 }
 if(mode==="--publish"){
  const r=json(RECEIPT);assert.equal(r.source_commit,manifest.source_commit);assert.equal(r.manifest_sha256,hash(path.join(DIRECTORY,"manifest.json")));assert.equal(r.status,"prepared");
  assert.equal(site.published_deploy.id,PREVIOUS);await verifyRemote(r.deploy_id);await probe(r.deploy_url);
  const infra=json(path.join(ROOT,"tmp/appstore-final/production-draft-infrastructure.json"));assert(infra.passed&&infra.targets.netlify===r.deploy_url);
  await api("/sites/"+SITE+"/deploys/"+r.deploy_id+"/restore","POST",{});
  site=await api("/sites/"+SITE);assert.equal(site.published_deploy.id,r.deploy_id);await verifyRemote(r.deploy_id);r.live_probe=await probe(site.ssl_url);
  r.status="published_pending_voice_smoke";r.published_at=new Date().toISOString();save(r);
  console.log(JSON.stringify({status:r.status,deploy:r.deploy_id,functions:77,context:"production"}));return;
 }
 assert.equal(site.published_deploy.id,PREVIOUS);
 const published=await api("/deploys/"+PREVIOUS);const current=inventory(await api("/sites/"+SITE+"/functions"));assert.equal(current.length,73);
 assert.equal(Object.keys(manifest.expected_production_functions).length,73);
 for(const fn of current)assert.equal(fn.d||fn.sha,manifest.expected_production_functions[fn.n||fn.name],"Published baseline changed: "+(fn.n||fn.name));
 const vars=await api(envRoute+query);assert.equal(value(vars.find(v=>v.key==="SUPABASE_URL")),"https://vhiikgyyfisejjwqtxfc.supabase.co");
 const earlier=fs.existsSync(RECEIPT)?json(RECEIPT):null;
 const r={status:"preparing",source_commit:manifest.source_commit,operator_commit:git(["rev-parse","HEAD"]),manifest_sha256:hash(path.join(DIRECTORY,"manifest.json")),
  previous:PREVIOUS,previous_locked:earlier?.previous===PREVIOUS?earlier.previous_locked:!!published.locked,authorization:"Guillem: Pásalo a producción, 2026-10-13",physical_verified:false,model_quality_gate_passed:false,
  schedules_enabled:false,prior_flags:Object.fromEntries(Object.keys(FLAGS).map(k=>[k,value(vars.find(v=>v.key===k))??null]))};save(r);
 await api("/deploys/"+PREVIOUS+"/lock","POST",{});assert((await api("/deploys/"+PREVIOUS)).locked);
 const secret=vars.find(v=>v.key==="BM_VOICE_ELEVENLABS_API_KEY");
 if(!secret){assert(/^sk_[A-Za-z0-9_-]{20,}$/.test(process.env.BM_VOICE_ELEVENLABS_API_KEY||""));
  await api(envRoute+query,"POST",[{key:"BM_VOICE_ELEVENLABS_API_KEY",scopes:["functions"],is_secret:true,values:[{context:"production",value:process.env.BM_VOICE_ELEVENLABS_API_KEY}]}]);}
 else assert(secret.is_secret&&secret.scopes.includes("functions")&&value(secret));
 for(const [key,wanted] of Object.entries(FLAGS)){r.phase="configure:"+key;save(r);await setFlag(key,wanted);}
 const body={...manifest.body,draft:false,title:"Unified app production, authorized13Oct; preserve legacy services"};
 const deployment=await api("/sites/"+SITE+"/deploys","POST",body);assert.equal(deployment.context,"production");
 r.deploy_id=deployment.id;r.deploy_url=deployment.deploy_ssl_url;save(r);
 const required=new Set(deployment.required_functions||[]);
 for(const [name,sha] of Object.entries(body.functions)){
  if(!required.has(sha)&&!APP.includes(name))continue;
  const metadata=manifest.upload_metadata[name],old=current.find(f=>(f.n||f.name)===name);
  const runtime=metadata?.runtime||old?.r||"nodejs22.x";
  const invocation=uploadMode(name,metadata,old);
  await api("/deploys/"+deployment.id+"/functions/"+name+"?runtime="+runtime+"&invocation_mode="+invocation,"PUT",fs.readFileSync(manifest.artifacts[sha]),"application/octet-stream");
 }
 for(const [name,sha] of Object.entries(body.files))if((deployment.required||[]).includes(sha))await api("/deploys/"+deployment.id+"/files/"+name,"PUT",fs.readFileSync(path.join(manifest.static_directory,name)),"application/octet-stream");
 let ready=false;for(let attempt=0;attempt<40;attempt++){const d=await api("/deploys/"+deployment.id);if(d.state==="ready"){ready=true;break;}assert.notEqual(d.state,"error");await new Promise(resolve=>setTimeout(resolve,1000));}assert(ready,"Deploy not ready");
 site=await api("/sites/"+SITE);assert.equal(site.published_deploy.id,PREVIOUS,"Auto-publication must stay locked during preparation");
 r.draft_probe=await probe(r.deploy_url);r.status="prepared";save(r);
 console.log(JSON.stringify({status:r.status,deploy:r.deploy_id,url:r.deploy_url,functions:77,context:"production",previous_still_live:true}));
}
if(require.main===module)main().catch(error=>{console.error("production_rollout: "+error.message);process.exitCode=1;});
module.exports={inventory,uploadMode,validateManifest,FLAGS,APP,main};
