const assert=require('node:assert/strict');const staging=require('./bmb_staging');const {dispatch}=require('../netlify/functions/bmb-worker-background');
(async()=>{
 assert.throws(()=>staging.assertSite('59955668-9a9b-4979-a283-63fbf3115fe5'));staging.assertEntries([...staging.ENTRIES].reverse());assert.throws(()=>staging.assertEntries(staging.ENTRIES.slice(1)));
 const fs=require('fs'),os=require('os'),path=require('path');
 const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'blank-stream-package-test-'));
 const tracked=new Set();
 for(const name of staging.ENTRIES){const file=`netlify/functions/${name}${name==='assistant-app-stream'?'.mjs':'.js'}`;tracked.add(file);fs.mkdirSync(path.dirname(path.join(fixture,file)),{recursive:true});fs.writeFileSync(path.join(fixture,file),'synthetic');}
 let buffered=false;
 const bundler={zipFunctions:async(wrappers,target)=>{fs.mkdirSync(target);return staging.ENTRIES.map(name=>{
   const streaming=name==='assistant-app-stream',extension=streaming?'.mjs':'.js';
   const wrapper=path.join(wrappers,name+extension),entry=path.join(fixture,'netlify/functions',name+extension);
   if(streaming){assert.match(fs.readFileSync(wrapper,'utf8'),/export \{ default \} from/);assert(!fs.readFileSync(wrapper,'utf8').includes('exports.handler'));}
   const archive=path.join(target,name+'.zip');fs.writeFileSync(archive,'synthetic-'+name);
   return{name,path:archive,bundler:streaming?'nft':'esbuild',invocationMode:streaming?(buffered?'buffered':'stream'):undefined,runtimeAPIVersion:streaming?2:1,runtimeVersion:'nodejs22.x',buildData:{runtimeAPIVersion:streaming?2:1},inputs:[wrapper,entry]};
 }).map((bundle,index,list)=>{if(index===list.length-1)fs.writeFileSync(path.join(target,'manifest.json'),JSON.stringify({functions:list,timestamp:Date.now()}));return bundle;});}};
 const packaged=await staging.packageCandidate({source:fixture},{tracked},bundler);
 assert.equal(packaged.functions.find(x=>x.name==='assistant-app-stream').invocation_mode,'stream');
 assert(fs.existsSync(path.join(packaged.directory,'.netlify/functions/manifest.json')));
 assert(!staging.deployCommand({cli:'synthetic',site:staging.SITE_ID},packaged).includes('--skip-functions-cache'));
 const uploads=[];const deployId='b'.repeat(24);
 const result=await staging.publishPackage(packaged,'synthetic',id=>assert.equal(id,deployId),async(url,options)=>{
   assert(url.startsWith('https://api.netlify.com/api/v1/'));uploads.push({url,method:options.method});
   let body={};
   if(options.method==='POST'){assert(url.endsWith('/sites/'+staging.SITE_ID+'/deploys'));const request=JSON.parse(options.body);assert.equal(request.functions_config['assistant-app-stream'].build_data.runtimeAPIVersion,2);body={id:deployId,site_id:staging.SITE_ID,required:[],required_functions:packaged.functions.map(fn=>fn.sha256)};}
   if(options.method===undefined)body={id:deployId,state:'ready'};
   return{ok:true,status:200,json:async()=>body};
 });
 assert.equal(result.deploy_id,deployId);
 assert(uploads.some(x=>x.url.includes('/functions/assistant-app-stream?runtime=nodejs22.x&invocation_mode=stream')&&x.method==='PUT'));
 buffered=true;await assert.rejects(staging.packageCandidate({source:fixture},{tracked},bundler),/correct buffered\/streaming runtime/);
 const before={URL:process.env.URL,KEY:process.env.SUPABASE_SERVICE_ROLE_KEY,COOKIE:process.env.BMB_PRIVATE_STAGE_COOKIE,fetch:global.fetch};
 try{process.env.URL=staging.SITE_URL;process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';process.env.BMB_PRIVATE_STAGE_COOKIE='synthetic-cookie';let count=0;
 global.fetch=async(url,options)=>{count++;assert.equal(new URL(url).origin,staging.SITE_URL);assert.equal(options.headers.cookie,'synthetic-cookie');assert.ok(options.headers['x-bmb-signature']);return {status:202};};
 assert.deepEqual(await dispatch(),{accepted:true});assert.equal(count,1);process.env.URL='https://getblank.netlify.app';await assert.rejects(dispatch(),/bmb_private_stage_origin_invalid/);assert.equal(count,1);
 }finally{global.fetch=before.fetch;for(const [k,v]of [['URL',before.URL],['SUPABASE_SERVICE_ROLE_KEY',before.KEY],['BMB_PRIVATE_STAGE_COOKIE',before.COOKIE]])if(v===undefined)delete process.env[k];else process.env[k]=v;}
 console.log('BMB staging isolation and protected worker dispatch passed');
})();
