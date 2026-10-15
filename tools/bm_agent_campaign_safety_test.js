"use strict";
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'blank-campaign-preflight-')),budgetFile=path.join(dir,'budget.json');
fs.writeFileSync(budgetFile,JSON.stringify({limit_usd:55,reserved_upper_usd:39.68,known_usd:34.2,requests:0}));const before=fs.readFileSync(budgetFile,'utf8');
const dataset='tools/datasets/bm_agent_prepared_2026-10-15/',guard=path.join(__dirname,'local_offline_guard.cjs');
function run(feature,extra=[]){const flags=new Map([['--agent-feature',feature],['--cases',dataset+feature+'.json'],['--plan-lock',dataset+'source-lock.json'],['--pairs','200'],['--budget-file',budgetFile]]);for(let i=0;i<extra.length;i+=2)flags.set(extra[i],extra[i+1]);return cp.spawnSync(process.execPath,['--require',guard,'tools/bm_retrieval_wide_benchmark.js','--preflight-only',...[...flags].flat()],{cwd:root,env:{...process.env,OPENAI_API_KEY:'offline-fixture',BM_PROVIDER_SPEND_LIMIT_FILE:''},encoding:'utf8',windowsHide:true});}
for(const feature of ['tools','retrieval','labels']){const r=run(feature);assert.equal(r.status,0,r.stderr);const value=JSON.parse(r.stdout);assert(value.planned_only&&value.provider_real===false&&value.activation_ready===false);}
const baseline=path.join(dir,'other-source');fs.mkdirSync(path.join(baseline,'tools'),{recursive:true});fs.writeFileSync(path.join(baseline,'tools/bm_agent_runtime.js'),"module.exports={verify:()=>({different:'"+'f'.repeat(64)+"'})};");
let r=run('tools',['--baseline',baseline]);assert.equal(r.status,1);assert.match(r.stderr,/decisions_paired_source_mismatch/);
const lock=JSON.parse(fs.readFileSync(path.join(root,dataset+'source-lock.json')));lock.source_hashes['_membership.js']='f'.repeat(64);const stale=path.join(dir,'stale.json');fs.writeFileSync(stale,JSON.stringify(lock));
r=run('tools',['--plan-lock',stale]);assert.equal(r.status,1);assert.match(r.stderr,/decisions_plan_stale_source/);
const plan=JSON.parse(fs.readFileSync(path.join(root,dataset+'tools.json')));plan.provenance+=' modified';const changed=path.join(dir,'changed.json');fs.writeFileSync(changed,JSON.stringify(plan));
r=run('tools',['--cases',changed]);assert.equal(r.status,1);assert.match(r.stderr,/decisions_plan_corpus_changed/);
assert.equal(fs.readFileSync(budgetFile,'utf8'),before);
console.log('PASS 6 guarded CLI preflights: all three features, mismatched baseline, stale source and changed corpus; zero provider calls or ledger writes');
