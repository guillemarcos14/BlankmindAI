"use strict";
const assert=require('assert/strict'),{validate}=require('./bm_recorded_release_gate'),o=require('./bm_semantic_oracle'),j=require('./bm_sol_quality_judge');
const {emptyState}=require('../netlify/functions/bm-semantic-state'),{build}=require('./bmb_decisions_release_corpus');
const clone=x=>JSON.parse(JSON.stringify(x)),scenario=build({clock:'2026-10-09T12:00:00Z'}).conversations[0],dataset={version:1,id:'local-mutation-fixture',conversations:[scenario]};
const state=emptyState('es'),plan={intent:'general',semantic_state:state,actions:[],message_text:'9 horas y 3 minutos.',response_text:'9 horas y 3 minutos.'};
const body={plan,semantic_state:state,semantic_decision:{type:'none',slot:null}},ev=o.evaluateTurn({expected:scenario.turns[0].expect,body});
const turn={...ev,turn:1,input:scenario.turns[0].input,state,source:'openai:local-mutation-fixture',trace:{final_plan:plan}};
const source={revision:'a'.repeat(40),dirty:false,snapshot:{'netlify/functions/example.js':'b'.repeat(64)}};
const raw={revision:source.revision,source_dirty:false,source_changed_during_replay:false,source_capture:{version:1,before_turns:true},source_snapshot:source.snapshot,dataset:{sha256:o.digest(dataset)},execution:{model_requested:true},summary:{conversations:1,turns:1,active_model_turns:1,passed:0,failed:0,unverified:1},runs:[{id:scenario.id,repetition:1,mode:'bm_final',channel:'ios',turns:[turn]}]};
const flat=j.flattenReport(raw)[0],review={verdict:'excellent',hard_contradiction:false,unsafe_claim:false,understanding:5,context:5,usefulness:5,naturalness:5,minimality:5,rationale:'Local mutation fixture; no provider request.',model_requested:j.DEFAULT_MODEL,model_returned:j.DEFAULT_MODEL};
const rawText=JSON.stringify(raw),model=clone(raw);model.runs[0].turns[0].status='passed';model.summary.passed=1;model.summary.unverified=0;model.release_eligible=true;model.recorded_provider_replay={new_provider_calls:0,raw_model_sha256:o.digest(rawText)};
const quality={complete:true,source_report:'/model.json',original_source_sha256:o.digest(rawText),reviews:[{conversation_id:scenario.id,turn:1,language:'es',review_binding:turn.review_binding,input_sha256:j.reviewDigest(flat,[]),review}]};
quality.summary={...j.summarize(quality.reviews),functional_failures:0};
const base={model,quality,raw,rawText,dataset,modelPath:'/model.json',source,minimum:1};
let result=validate(base);assert(result.passed,JSON.stringify(result));assert.equal(result.new_provider_calls,0);assert.equal(result.physical_device_tested,false);
const mutations=[
 x=>x.model.revision='c'.repeat(40),x=>x.source.dirty=true,x=>x.model.source_dirty=true,
 x=>x.model.source_snapshot={'changed':true},x=>x.model.source_capture.before_turns=false,
 x=>x.quality.complete=false,x=>x.quality.source_report='/other.json',x=>x.quality.reviews[0].input_sha256='d'.repeat(64),
 x=>x.quality.reviews[0].review.model_returned='other',x=>x.quality.reviews[0].review.hard_contradiction=true,
 x=>x.model.recorded_provider_replay.raw_model_sha256='e'.repeat(64),x=>x.dataset.conversations[0].turns[0].expect.factual_expectation.expected_minutes=400,
 x=>x.model.summary.active_model_turns=0,x=>x.model.runs[0].turns[0].trace.final_plan.message_text='8 horas.',
 x=>x.model.runs[0].turns[0].state.intent='start_protection',x=>x.model.runs[0].turns[0].status='unverified',
 x=>x.quality.reviews=[],x=>x.model.summary.turns=200,x=>x.minimum=200,
 x=>x.quality.summary.judged=200,x=>x.raw.revision='f'.repeat(40),x=>x.quality.reviews[0].language='en',
];
for(const mutate of mutations){const x=clone(base);mutate(x);assert.equal(validate(x).passed,false,'mutation accepted: '+mutate.toString());}
console.log('PASS recorded release gate: 22 source, coverage, output, review and authority mutations rejected; no provider calls.');
