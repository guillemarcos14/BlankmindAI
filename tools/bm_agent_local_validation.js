"use strict";
// Free validation only. No benchmark, reviewer, voice, deployment or ledger writes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const budgetFile=path.resolve(root,'../Codigo-retrieval/tmp/retrieval-wide/budget.json');
const gateFile=path.join(root,'netlify/functions/bm-agent-activation.json');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function main(){
 const args=process.argv.slice(2),arg=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
 const relativeDirectory=arg('--directory','tmp/local-regressions-20261015'),directory=path.resolve(root,relativeDirectory),baseline=arg('--baseline','tmp/local-regressions-20261015/baseline.json');
 if(!directory.startsWith(root+path.sep)||!fs.existsSync(path.resolve(root,baseline)))throw Error('Existing local baseline and workspace output directory required');
 fs.mkdirSync(directory,{recursive:true});
 const before={budget:hash(budgetFile),gates:hash(gateFile)};
 const guard=path.join(__dirname,'local_offline_guard.cjs').replace(/\\/g,'/');
 const env={...process.env,NODE_OPTIONS:`--require="${guard}"`,OPENAI_API_KEY:'offline-fixture'};
 for(const key of Object.keys(env))if(/(?:API_KEY|SERVICE_ROLE_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET_KEY)$/.test(key)&&key!=='OPENAI_API_KEY')delete env[key];
 const probe=cp.spawnSync(process.execPath,['-e',"const a=require('assert/strict');(async()=>{await a.rejects(()=>fetch('https://api.openai.com/v1/responses'),/network_forbidden/);a.throws(()=>require('https').get('https://api.openai.com'),/network_forbidden/);a.throws(()=>require('net').connect(443,'api.openai.com'),/network_forbidden/);a.throws(()=>new(require('net').Socket)().connect(443,'api.openai.com'),/network_forbidden/);console.log('PASS inherited network guard')})().catch(e=>{console.error(e);process.exitCode=1})"],{cwd:root,env,encoding:'utf8',windowsHide:true});
 assert.equal(probe.status,0,probe.stderr);
 const run=cp.spawnSync(process.execPath,['tools/product_harness.js','--contract','tools/product_harness_contract.json','--baseline',baseline,'--mode','validate','--enforce-scope','--report',path.join(relativeDirectory,'harness.json')],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:300000,maxBuffer:4*1024*1024});
 const after={budget:hash(budgetFile),gates:hash(gateFile)};
 const result={provider_real:false,provider_cost_usd:0,network_guard:{status:probe.status,stdout:probe.stdout},before,after,unchanged:JSON.stringify(before)===JSON.stringify(after),status:run.status,stdout:run.stdout,stderr:run.stderr};
 fs.writeFileSync(path.join(directory,'validation.json'),JSON.stringify(result,null,2)+'\n');
 process.stdout.write(run.stdout||'');process.stderr.write(run.stderr||'');assert.deepEqual(after,before,'Budget or activation gates changed during local validation');
 if(run.status!==0)process.exitCode=1;
}
if(require.main===module)main();
