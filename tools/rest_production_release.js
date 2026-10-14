"use strict";
// Explicit operational release authorized by Guillem, 14 October 2026.
// Keeps the normal readiness gate intact and records unverified device/model gates.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),SITE='59955668-9a9b-4979-a283-63fbf3115fe5',PREVIOUS='6ace0be5d1774a17ce921165';
const DIR=path.join(ROOT,'tmp/rest-release'),RECEIPT=path.join(DIR,'publication.json');
const APP=require('./appstore_production_publish').APP;
const read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const git=(...a)=>execFileSync('git',a,{cwd:ROOT,encoding:'utf8',windowsHide:true}).trim();
function manifestBody(candidate,baseline){
 assert.equal(candidate.total_functions,77);assert.equal(candidate.statics,17);
 assert.deepEqual(Object.keys(candidate.body.functions).sort(),Object.keys(baseline.body.functions).sort());
 for(const [name,digest] of Object.entries(baseline.body.functions))if(!APP.includes(name))assert.equal(candidate.body.functions[name],digest,'Unrelated function changed: '+name);
 assert.deepEqual(candidate.body.files,baseline.body.files);
 return {...candidate.body,draft:false,function_schedules:[{name:'bmb-tick',cron:'*/5 * * * *'}],title:'Measured rest loop; explicit production authorization 14 Oct 2026'};
}
async function main(args=process.argv.slice(2)){
 assert(args.includes('--authorized-production'));const mode=args.find(x=>['--prepare','--publish','--rollback','--verify','--resume-prepare'].includes(x));assert(mode);
 const cfg=read(path.join(process.env.APPDATA,'netlify/Config/config.json')),token=(cfg.users[cfg.userId]||Object.values(cfg.users)[0]).auth.token;
 async function api(route,method='GET',body,binary=false){const r=await fetch('https://api.netlify.com/api/v1'+route,{method,headers:{authorization:'Bearer '+token,'content-type':binary?'application/octet-stream':'application/json'},...(body===undefined?{}:{body:binary?body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)});assert(r.ok,method+' '+route+' HTTP '+r.status);return r.status===204?null:r.json();}
 let site=await api('/sites/'+SITE);assert.equal(site.ssl_url,'https://getblank.netlify.app');
 const save=r=>fs.writeFileSync(RECEIPT,JSON.stringify(r,null,2)+'\n');
 if(mode==='--rollback'){
  const r=read(RECEIPT);assert([PREVIOUS,r.deploy_id].includes(site.published_deploy.id));
  await api('/sites/'+SITE+'/deploys/'+PREVIOUS+'/restore','POST',{});
  const d=await api('/deploys/'+PREVIOUS);assert(!(d.function_schedules||[]).length);
  if(!r.previous_locked)await api('/deploys/'+PREVIOUS+'/unlock','POST',{});
  r.status='rolled_back';r.rollback_at=new Date().toISOString();r.database='035 retained; private additive tables and compatible RPCs; no data deleted';save(r);return console.log(JSON.stringify({status:r.status,deploy:PREVIOUS,cron:false}));
 }
 const file=path.join(ROOT,'tmp/appstore-final/production-bundle/manifest.json'),candidate=read(file);
 const baseline=read(path.join(ROOT,'../Codigo-appstore-final/tmp/appstore-final/production-bundle/manifest.json'));
 const body=manifestBody(candidate,baseline);
 assert.equal(git('status','--porcelain'),'');assert(/^codex\/backend-release-/.test(git('branch','--show-current')));
 assert.equal(git('diff',candidate.source_commit,'HEAD','--','netlify/functions','supabase/migrations'),'');
 for(const [name,digest] of Object.entries(body.functions)){assert.equal(hash(candidate.artifacts[digest]),digest);if(APP.includes(name))assert.equal(candidate.upload_metadata[name].runtime,'nodejs22.x');}
 const sql=read(path.join(DIR,'schema-receipt.json'));assert.equal(sql.project,'vhiikgyyfisejjwqtxfc');assert(sql.after.version&&sql.after.protected&&sql.after.server_only&&sql.after.service_access);
 const vars=await api('/accounts/'+site.account_id+'/env?site_id='+SITE);
 const value=k=>{const v=vars.find(v=>v.key===k);return v?.values.find(x=>x.context==='production')?.value??v?.values.find(x=>x.context==='all')?.value;};
 assert.equal(value('SUPABASE_URL'),'https://vhiikgyyfisejjwqtxfc.supabase.co');assert.equal(value('BM_VOICE_ENABLED'),'true');assert.equal(value('BM_VOICE_PROVIDER'),'elevenlabs');assert.equal(value('BM_RETRIEVAL_STEP_ENABLED'),'true');
 assert(!value('BMB_PRIVATE_STAGE_COOKIE'));for(const k of ['BM_JEV_SHADOW_ENABLED','BM_JEV_PREFETCH_EXPERIMENT'])assert(!/^(true|1|on)$/i.test(value(k)||''));
 async function inventory(){const p=await api('/sites/'+SITE+'/functions');return require('./appstore_production_publish').inventory(p);}
 async function verify(id,published){const d=await api('/deploys/'+id);assert.equal(d.state,'ready');assert.equal(d.context,'production');assert.deepEqual(d.function_schedules,body.function_schedules);
  if(published){const fns=await inventory();assert.equal(fns.length,77);for(const f of fns){const name=f.n||f.name;assert.equal(f.d||f.sha,body.functions[name]);if(APP.includes(name)){assert.equal(f.r||f.runtime,'nodejs22.x');if(/stream|voice/.test(name))assert.equal(f.bd.runtimeAPIVersion,2);}}}
  return d;
 }
 async function probe(origin){const r=await fetch(origin+'/.netlify/functions/assistant-app-stream',{method:'POST',headers:{'content-type':'application/json'},body:'{"action":"send","turn_id":"rest-release-auth-probe"}',signal:AbortSignal.timeout(15000)});assert.equal(r.status,200);assert(r.headers.get('content-type')?.startsWith('application/x-ndjson'));assert((await r.text()).split('\n').filter(Boolean).map(JSON.parse).some(x=>x.type==='result'&&x.status===401));
  for(const endpoint of ['assistant-app','assistant-app-voice']){const v=await fetch(origin+'/.netlify/functions/'+endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...(endpoint==='assistant-app'?{action:'send'}:{}),turn_id:crypto.randomUUID(),request_id:crypto.randomUUID(),elevenlabs_consent:false}),signal:AbortSignal.timeout(15000)});assert.equal(v.status,401);}return {stream:200,authentication:401,voice_authentication:401,paid_calls:0};}
 if(mode==='--resume-prepare'){const r=read(RECEIPT);assert.equal(r.status,'preparing');assert.equal(site.published_deploy.id,PREVIOUS);assert.equal(r.manifest_sha256,hash(file));await verify(r.deploy_id,false);r.draft_probe=await probe(r.deploy_url);r.status='prepared';save(r);return console.log(JSON.stringify({status:r.status,deploy:r.deploy_id,url:r.deploy_url}));}
 if(mode==='--prepare'){
  assert.equal(site.published_deploy.id,PREVIOUS);const old=await api('/deploys/'+PREVIOUS);assert(!(old.function_schedules||[]).length);
  const fns=await inventory();assert.equal(fns.length,77);for(const f of fns)assert.equal(f.d||f.sha,baseline.body.functions[f.n||f.name],'Live baseline changed');
  const earlier=fs.existsSync(RECEIPT)?read(RECEIPT):null;const r={status:'preparing',authorization:'Guillem: Lleva a producción desde una nueva conversación, 14 October 2026',source_commit:candidate.source_commit,operator_commit:git('rev-parse','HEAD'),manifest_sha256:hash(file),previous:PREVIOUS,previous_locked:earlier?.previous===PREVIOUS?earlier.previous_locked:!!old.locked,physical_verified:false,semantic_quality_certified:false,normal_readiness_gate_unchanged:true,migration:'035',schedules_enabled:false,environment_mutations:0};save(r);
  await api('/deploys/'+PREVIOUS+'/lock','POST',{});
  const d=await api('/sites/'+SITE+'/deploys','POST',body);assert.equal(d.context,'production');r.deploy_id=d.id;r.deploy_url=d.deploy_ssl_url;save(r);
  for(const [name,digest] of Object.entries(body.functions)){if(!(d.required_functions||[]).includes(digest))continue;const m=candidate.upload_metadata[name],f=fns.find(f=>(f.n||f.name)===name);const invocation=require('./appstore_production_publish').uploadMode(name,m,f);await api('/deploys/'+d.id+'/functions/'+name+'?runtime='+(m?.runtime||f?.r||'nodejs22.x')+'&invocation_mode='+invocation,'PUT',fs.readFileSync(candidate.artifacts[digest]),true);}
  for(const [name,digest] of Object.entries(body.files))if((d.required||[]).includes(digest))await api('/deploys/'+d.id+'/files/'+name,'PUT',fs.readFileSync(path.join(candidate.static_directory,name)),true);
  let ready=false;for(let i=0;i<40;i++){const state=await api('/deploys/'+d.id);if(state.state==='ready'){ready=true;break;}assert.notEqual(state.state,'error');await new Promise(r=>setTimeout(r,1000));}assert(ready);
  site=await api('/sites/'+SITE);assert.equal(site.published_deploy.id,PREVIOUS);await verify(d.id,false);r.draft_probe=await probe(r.deploy_url);r.status='prepared';save(r);return console.log(JSON.stringify({status:r.status,deploy:d.id,url:r.deploy_url,previous_still_live:true}));
 }
 const r=read(RECEIPT);assert.equal(r.manifest_sha256,hash(file));
 if(mode==='--publish'){
  assert.equal(r.status,'prepared');assert.equal(site.published_deploy.id,PREVIOUS);const infra=read(path.join(DIR,'draft-infrastructure.json'));assert(infra.passed&&infra.targets.netlify===r.deploy_url);
  await verify(r.deploy_id,false);await probe(r.deploy_url);await api('/sites/'+SITE+'/deploys/'+r.deploy_id+'/restore','POST',{});
  site=await api('/sites/'+SITE);assert.equal(site.published_deploy.id,r.deploy_id);
 }
 assert.equal(site.published_deploy.id,r.deploy_id);await verify(r.deploy_id,true);r.live_probe=await probe(site.ssl_url);r.status='published_verified';r.schedules_enabled=true;r.verified_at=new Date().toISOString();save(r);
 if(!r.previous_locked)await api('/deploys/'+r.deploy_id+'/unlock','POST',{});
 console.log(JSON.stringify({status:r.status,deploy:r.deploy_id,functions:77,schedule:'*/5 * * * *',physical_verified:false,semantic_quality_certified:false}));
}
if(require.main===module)main().catch(e=>{console.error('rest_release: '+e.message);process.exitCode=1;});
module.exports={manifestBody,main};
