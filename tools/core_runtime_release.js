"use strict";
// Authorized repair of the current CORE route. Optimization approvals remain
// off; no environment, database, native client or unrelated endpoint changes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const preservation=require('./core_production_cleanup');
const ROOT=path.resolve(__dirname,'..'),SITE='59955668-9a9b-4979-a283-63fbf3115fe5',DIR=path.join(ROOT,'tmp/runtime-fix-20261015');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
const load=n=>read(path.join(DIR,n)),save=(n,v)=>{fs.mkdirSync(DIR,{recursive:true});fs.writeFileSync(path.join(DIR,n),JSON.stringify(v,null,2)+'\n');};
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const git=(...a)=>execFileSync('git',a,{cwd:ROOT,encoding:'utf8',windowsHide:true}).trim();
function manifest(snapshot,packaged){
 assert.equal(snapshot.context,'production');assert.equal(snapshot.functions.length,27);
 const base=preservation.plan(snapshot);assert.equal(base.removed.length,0);
 assert.equal(packaged.source_tree_clean,true);assert.equal(packaged.functions.length,preservation.CORE.length);
 assert.deepEqual(packaged.functions.map(f=>f.name).sort(),[...preservation.CORE].sort());
 const body=structuredClone(base.body),artifacts={};
 for(const f of packaged.functions){
  assert.equal(f.compilation_target,'nodejs22.x');
  if(/stream|voice/.test(f.name)){assert.equal(f.runtime_api_version,2);assert.equal(f.invocation_mode,'stream');}
  body.functions[f.name]=f.sha256;artifacts[f.name]=f.path;
  body.functions_config[f.name].build_data={...body.functions_config[f.name].build_data,
   ...(f.runtime_api_version!==undefined?{runtimeAPIVersion:f.runtime_api_version}:{}),
   ...(f.bootstrap_version!==undefined?{bootstrapVersion:f.bootstrap_version}:{})};
 }
 body.title='Authorized current-route pause and memory-scope repair; optimizations OFF';
 return {body,artifacts,retained:base.retained,removed:[]};
}
async function main(){
 const mode=process.argv[2];assert(['plan','prepare','resume','smoke-draft','smoke-live','publish','verify','rollback'].includes(mode));
 if(!['plan','verify'].includes(mode))assert(process.argv.includes('--confirm'));
 const cfg=read(path.join(process.env.APPDATA,'netlify/Config/config.json')),token=(cfg.users[cfg.userId]||Object.values(cfg.users)[0]).auth.token;
 async function api(route,method='GET',body,binary=false){
  const r=await fetch('https://api.netlify.com/api/v1'+route,{method,headers:{authorization:'Bearer '+token,'content-type':binary?'application/octet-stream':'application/json'},...(body===undefined?{}:{body:binary?body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
  assert(r.ok,method+' '+route+' HTTP '+r.status);return r.status===204?null:r.json();
 }
 const site=await api('/sites/'+SITE);assert.equal(site.ssl_url,'https://getblank.netlify.app');
 const vars=await api('/accounts/'+site.account_id+'/env?site_id='+SITE),envHash=preservation.environmentDigest(vars);
 const value=k=>{const e=vars.find(v=>v.key===k);return e?.values.find(v=>v.context==='production')?.value??e?.values.find(v=>v.context==='all')?.value;};
 for(const feature of ['tools','retrieval','labels'])assert.equal(require('../netlify/functions/bm-agent-activation').enabled(feature,{...Object.fromEntries(vars.map(v=>[v.key,value(v.key)])),BM_AGENT_QA_ENABLED:'false'}),false);
 async function snapshot(id){const d=await api('/deploys/'+id);return {context:d.context,functions:preservation.inventory(await api('/deploys/'+id+'/functions')),files:await api('/deploys/'+id+'/files'),schedules:d.function_schedules};}
 if(mode==='plan'){
  assert(!fs.existsSync(path.join(DIR,'publication.json')),'Existing deployment receipt; never overwrite');
  const packagePath=path.resolve(process.argv[3]),packaged=read(packagePath),before=await snapshot(site.published_deploy.id);
  assert.equal(git('status','--porcelain'),'');assert.equal(git('diff',packaged.source_commit,'HEAD','--','netlify/functions','supabase/migrations'),'');
  const prepared=manifest(before,packaged);
  // Every unchanged ZIP is required locally even if Netlify has it cached.
  const old=read(path.join(ROOT,'tmp/release-today/manifest.json'));
  const original=read(path.join(ROOT,'../Codigo-appstore-final/tmp/appstore-final/production-bundle/manifest.json'));
  for(const [name,digest]of Object.entries(prepared.body.functions)){
   const file=prepared.artifacts[name]||old.artifacts[digest]||original.artifacts[digest];assert(file&&hash(file)===digest,'Missing exact artifact '+name);prepared.artifacts[name]=file;
  }
  save('plan.json',{...prepared,previous:site.published_deploy.id,previous_locked:!!(await api('/deploys/'+site.published_deploy.id)).locked,previous_snapshot:before,environment_digest:envHash,source_commit:packaged.source_commit,package_sha256:hash(packagePath)});
  console.log(JSON.stringify({previous:site.published_deploy.id,functions:27,statics:before.files.length,optimizations:false}));return;
 }
 const p=load('plan.json');assert.equal(p.environment_digest,envHash,'Environment changed');
 if(mode==='rollback'){
  const r=load('publication.json');assert([p.previous,r.deploy_id].includes(site.published_deploy.id));
  await api('/sites/'+SITE+'/deploys/'+p.previous+'/restore','POST',{});if(!p.previous_locked)await api('/deploys/'+p.previous+'/unlock','POST',{});
  save('rollback.json',{at:new Date().toISOString(),restored:p.previous});return;
 }
 if(['prepare','resume'].includes(mode)){
  assert.equal(site.published_deploy.id,p.previous);assert.deepEqual(await snapshot(p.previous),p.previous_snapshot);
  assert.equal(git('status','--porcelain'),'');assert(/^codex\/backend-release-/.test(git('branch','--show-current')));
  assert.equal(git('diff',p.source_commit,'HEAD','--','netlify/functions','supabase/migrations'),'');
  assert.equal(load('release-harness.json').status,'passed');
  const pilot=load('runtime-pilot.json'),quality=load('runtime-pilot-quality.json');assert(pilot.complete&&quality.complete);
  assert(pilot.records.filter(r=>r.variant==='optimized').every(r=>r.passed));
  assert(quality.reviews.filter(r=>r.variant==='optimized').every(r=>r.review&&['response_ok','memory_ok','action_ok'].every(k=>r.review[k])));
  let d;
  if(mode==='prepare'){
   assert(!fs.existsSync(path.join(DIR,'publication.json')));await api('/deploys/'+p.previous+'/lock','POST',{});
   d=await api('/sites/'+SITE+'/deploys','POST',p.body);assert.equal(d.context,'production');
   save('publication.json',{status:'preparing',deploy_id:d.id,url:d.deploy_ssl_url,previous:p.previous,source_commit:p.source_commit});
  }else d=await api('/deploys/'+load('publication.json').deploy_id);
  for(const [name,digest]of Object.entries(p.body.functions))if((d.required_functions||[]).includes(digest)){
   assert.equal(hash(p.artifacts[name]),digest);const meta=p.body.functions_config[name].build_data;
   await api('/deploys/'+d.id+'/functions/'+name+'?runtime=nodejs22.x&invocation_mode='+(meta.runtimeAPIVersion===2?'stream':name.endsWith('-background')?'background':'buffer'),'PUT',fs.readFileSync(p.artifacts[name]),true);
  }
  for(let i=0;i<40;i++){const state=await api('/deploys/'+d.id);assert.notEqual(state.state,'error');if(state.state==='ready'){
   preservation.verify(await snapshot(d.id),p);assert.equal((await api('/sites/'+SITE)).published_deploy.id,p.previous);
   save('publication.json',{...load('publication.json'),status:'prepared'});console.log(JSON.stringify({status:'prepared',deploy:d.id,url:d.deploy_ssl_url}));return;
  }await new Promise(r=>setTimeout(r,1000));}throw Error('Readiness timeout; resume same deployment');
 }
 const r=load('publication.json');
 if(mode.startsWith('smoke-')){
  const cloud=require('./assistant_app_cloud_test'),config=cloud.configuration({BM_CLOUD_TEST_SUPABASE_URL:value('SUPABASE_URL'),BM_CLOUD_TEST_SERVICE_ROLE_KEY:value('SUPABASE_SERVICE_ROLE_KEY'),BM_CLOUD_TEST_ANON_KEY:value('SUPABASE_ANON_KEY'),BM_CLOUD_TEST_NETLIFY_URL:mode==='smoke-draft'?r.url:site.ssl_url},true,{physicalQa:true});
  const result=await cloud.run(config,path.join(DIR,mode+'.json'),{infrastructureOnly:true});assert(result.passed);return;
 }
 if(mode==='publish'){
  assert.equal(site.published_deploy.id,p.previous);assert.equal(r.status,'prepared');assert(load('smoke-draft.json').passed);
  preservation.verify(await snapshot(r.deploy_id),p);await api('/sites/'+SITE+'/deploys/'+r.deploy_id+'/restore','POST',{});
 }
 assert.equal((await api('/sites/'+SITE)).published_deploy.id,r.deploy_id);preservation.verify(await snapshot(r.deploy_id),p);
 if(mode==='publish'&&!p.previous_locked)await api('/deploys/'+r.deploy_id+'/unlock','POST',{});
 save('publication.json',{...r,status:'published_verified',verified_at:new Date().toISOString(),environment_unchanged:true,statics_unchanged:true,schedules_unchanged:true,optimizations_enabled:false,physical_verified:false});
 console.log(JSON.stringify({status:'published_verified',deploy:r.deploy_id,functions:27}));
}
if(require.main===module)main().catch(e=>{console.error('core_runtime_release: '+e.message);process.exitCode=1;});
module.exports={manifest};
