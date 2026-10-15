"use strict";
const assert=require('node:assert/strict'),audit=require('./bm_agent_state_audit'),{input}=require('./bm_agent_quality');
const clock='2026-10-15T10:00:00Z',message='Ayer tomé 2 cafés.',observation={metric:'caffeine',value_number:2,value_text:null,unit:'servings',measurement:'declared',evidence:'tomé 2 cafés',measured_at:'2026-10-14T10:00:00Z',timezone:'Europe/Madrid'};
const spec={id:'state',expected_observations:[{metric:'caffeine',value_number:2,unit:'servings',measurement:'declared'}],observation_date_policy:'previous_local_day'};
const row={synthetic_input:message,canonical_observations:[{...observation,source:'user_statement',status:'active'}],canonical_memories:[],committed_effect:[{brain_memory_effect:{observations:[observation]},brain_memory_applied_at:clock}]};
assert(audit.check(row,spec,{clock}));
for(const mutate of [r=>{r.committed_effect=[];},r=>{r.committed_effect[0].brain_memory_applied_at=null;},r=>{r.canonical_observations[0].source='apple_watch';},r=>{r.canonical_observations[0].status='superseded';},r=>{r.canonical_observations[0].measurement='routine_statement';},r=>{r.canonical_observations[0].value_number=3;},r=>{r.canonical_observations[0].evidence='invented';},r=>{r.canonical_observations[0].measured_at=clock;},r=>{r.committed_effect[0].brain_memory_effect.observations[0].evidence='invented';}]){
 const changed=structuredClone(row);mutate(changed);assert.equal(audit.check(changed,spec,{clock}),false,'A forged boolean, pre-existing row or altered extraction passed');
}
const kept={action_id_present:false,initial_state:{memories:[{key:'preferences',value:'paper'}],observations:row.canonical_observations},canonical_memories:[{key:'preferences',value:'paper'}],canonical_observations:row.canonical_observations,committed_effect:[{brain_memory_effect:null}]};
assert(audit.check(kept,{forbid_effects:true}));
for(const mutate of [r=>{r.canonical_memories=[];},r=>{r.canonical_observations=[];},r=>{r.action_id_present=true;},r=>{r.committed_effect[0].brain_memory_effect={operation:'forget_all'};}]){const changed=structuredClone(kept);mutate(changed);assert.equal(audit.check(changed,{forbid_effects:true}),false);}
const forgotten={canonical_memories:[{key:'goal',value:null}],committed_effect:[{brain_memory_effect:{operation:'forget_all',key:null},brain_memory_applied_at:clock}]};
assert(audit.check(forgotten,{expected_forgetting:{operation:'forget_all',key:null}}));
assert.equal(audit.check({...forgotten,committed_effect:[]},{expected_forgetting:{operation:'forget_all',key:null}}),false);
const report={case_manifest:{kind:'agent-certification-plan-v2',cases:[{...spec,expectation:'Exact declaration only'}]},fixture_clock:clock};
const reviewerRow={...row,case_id:'state',expected:{},synthetic_response:'Recorded.',language:'en',status:200};
assert.equal(input(reviewerRow,report,5).actual.initial_state,undefined,'Old judge inputs changed');
assert.equal(input(reviewerRow,report,6).observation_date_policy,'previous_local_day');
assert(!Object.hasOwn(input(reviewerRow,report,6),'variant'));
// Even an approving judge and a stale persisted=true bit cannot override the
// actual committed/canonical observation or its authored local date.
const crypto=require('node:crypto'),{adapt}=require('./bm_agent_report'),sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const measured={...report,complete:true,provider_real:false,generative_model:'gpt-5.6-luna',rates:{input:0,cached:0,output:0},records:[{...reviewerRow,variant:'decisions',pair:0,step:0,group:'memory',observations_persisted:true,provider_requests:[{endpoint:'responses',usage:{input_tokens:1,output_tokens:1}}],model_contexts:[{turn_clock:clock}]}]};
const review=r=>({complete:true,input_version:6,source_sha256:sha(r),model:'independent-offline-fixture',reviews:[{id:'decisions:0:0',input_sha256:sha(input(r.records[0],r,6)),review:{response_ok:true,memory_ok:true,action_ok:true,naturalness:4}}]});
assert.equal(adapt(measured,review(measured))[0].quality.memory_ok,true);
const forged=structuredClone(measured);forged.records[0].canonical_observations[0].measured_at=clock;
assert.equal(adapt(forged,review(forged))[0].quality.memory_ok,false);
assert.throws(()=>adapt(measured,{...review(measured),input_version:5}),/input v6/);
console.log('PASS strict authored-state audit: exact committed/canonical observations, literal provenance, local occurrence dates, genuine forgetting and unchanged-state snapshots; historical review inputs preserved');
