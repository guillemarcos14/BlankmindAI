"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const corpus=require('./bm_agent_corpus_v2'),preflight=require('./bm_agent_plan_preflight'),brain=require('../netlify/functions/bmb-brain'),tracking=require('../netlify/functions/bmb-longitudinal'),labels=require('../netlify/functions/bm-agent-labels'),routing=require('../netlify/functions/bm-agent-decisions'),activation=require('../netlify/functions/bm-agent-activation');
const directory=path.join(__dirname,'datasets/bm_agent_prepared_2026-10-15'),now=Date.parse('2026-10-15T10:00:00Z');
const user='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',env={BM_AGENT_QA_ENABLED:'true',BM_AGENT_QA_FEATURES:'retrieval,labels',SUPABASE_URL:activation.QA,OPENAI_API_KEY:'fixture'};
async function main(){
 let cases=0,actionChecks=0,labelChecks=0,retrievalChecks=0;const types=new Set();
 for(const feature of corpus.FEATURES){
  const plan=corpus.build(feature);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,feature+'.json'))),plan,'Frozen authored corpus drifted');
  const c=corpus.coverage(plan);assert(c.coverage_prepared);assert.equal(c.approved,false);assert.equal(c.executed_pairs,0);assert.equal(c.counts.all.planned_audio,64);cases+=plan.cases.length;
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,feature+'-coverage.json'))),c);
  const currentHashes=require('./bm_agent_runtime').verify();
  const historical=JSON.parse(fs.readFileSync(path.join(directory,'source-lock.json')));
  assert.throws(()=>preflight.verify(plan,historical,{feature,hashes:currentHashes}),/stale_source/,'The pre-funnel preparation must remain stale, never relabelled as executed evidence');
  preflight.verify(plan,JSON.parse(fs.readFileSync(path.join(directory,'source-lock-funnel-pricing.json'))),{feature,hashes:currentHashes});
  for(const mutate of [p=>{p.cases.pop();},p=>{p.cases[1]=p.cases[0];},p=>{p.cases.forEach(c=>c.audio_requested=false);},p=>{p.cases[0].text='changed';},p=>{p.executed=true;}]){const changed=structuredClone(plan);mutate(changed);assert.equal(corpus.coverage(changed).coverage_prepared,false);}
  const hashes={fixture:'f'.repeat(64)},lock={kind:'agent-unexecuted-source-lock-v1',source_hashes:hashes,corpora:{[feature]:corpus.sha(plan)}};
  assert.equal(preflight.verify(plan,lock,{feature,hashes}).activation_ready,false);
  assert.throws(()=>preflight.verify(plan,lock,{feature,hashes:{fixture:'a'.repeat(64)}}),/stale_source/);
  assert.throws(()=>preflight.verify(plan,lock,{feature,hashes,pairs:201}),/repeated_or_missing/);
  assert.throws(()=>preflight.verify(plan,{...lock,corpora:{}},{feature,hashes}),/corpus_changed/);
  for(const spec of plan.cases.filter(c=>c.group==='action')){
   const full={minutes:null,hours:null,start_minute:null,end_minute:null,start_mode:null,weekdays:[],recurrence:'weekly',duration_days:null,local_date:null,timezone:'Europe/Madrid',window_id:null,hard_mode:false,...spec.expected_action};
   const result=brain.normalizeAction(full,now,spec.text);for(const [k,v] of Object.entries(spec.expected_action))assert.deepEqual(result[k],v,spec.id+':'+k);types.add(result.type);actionChecks++;
  }
 }
 assert.equal(types.size,15,'Some supported commands have no authored expectation');
 const plan=corpus.build('labels');
 for(const spec of plan.cases.filter(c=>c.expected_observations)){
  const observations=spec.expected_observations.map(o=>({...o,evidence:spec.text,timezone:'Europe/Madrid',measured_at:o.measurement==='declared'?'2026-10-14T10:00:00Z':null}));
  const validated=tracking.validateEffects({message_kind:'statement',observations},spec.text,false,[],now);assert.deepEqual(validated.observations,observations,spec.id);
  const extracted=observations.map(({measurement,...o})=>o),values=observations.map(o=>o.measurement);
  let calls=0;const completed=await labels.complete({observations:extracted},{current_message:spec.text},{env,fetcher:async(_,options)=>{
   calls++;const p=JSON.parse(options.body);assert.equal(p.questions.length,1,'One exact fragment must be classified once even for simultaneous observations');
   return new Response(JSON.stringify({model:'gpt-6-luna',usage:{input_tokens:1},answers:p.questions.map(q=>({name:q.name,type:'choice',choice:values[0],probabilities:q.choices.map(c=>({value:c.value,probability:c.value===values[0]?1:0}))}))}));
  }});assert.equal(calls,1);assert.deepEqual(completed.observations,observations);labelChecks++;
 }
 for(const spec of corpus.build('retrieval').cases.filter(c=>c.expected_retrieval)){
  const r=spec.expected_retrieval;let calls=0;
  assert.deepEqual(await routing.start(user,spec.text,{env,fetcher:async(_,options)=>{calls++;const p=JSON.parse(options.body);return new Response(JSON.stringify({model:'gpt-6-luna',usage:{input_tokens:1},answers:p.questions.map(q=>q.type==='predicate'?{name:q.name,type:q.type,probability:q.name==='eligible'||q.name==='metric_'+r.metric?1:0}:{name:q.name,type:'choice',choice:r.period,probabilities:q.choices.map(c=>({value:c.value,probability:c.value===r.period?1:0}))})}));}}),r,spec.id);assert.equal(calls,1);retrievalChecks++;
 }
 console.log(`PASS ${cases} authored plans audited (NOT executed pairs), ${actionChecks} native parameter checks/all15 commands, ${labelChecks} routine/episode extraction+classification mocks, ${retrievalChecks} ES/EN selection mocks; coverage tamper/source drift/repeated pairs rejected`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
