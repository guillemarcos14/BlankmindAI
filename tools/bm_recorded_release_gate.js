"use strict";
// Reuse immutable provider outputs and their exact reviews; never regenerate.
const fs=require('fs'),path=require('path'),oracle=require('./bm_semantic_oracle'),judge=require('./bm_sol_quality_judge');
const {captureSource}=require('./bm_semantic_replay'),{measureConversationCoverage}=require('./bm_conversation_coverage');
function validate({model,quality,raw=model,dataset,modelPath,rawText,source=captureSource(),minimum=200}){
 const failures=[],check=(ok,code)=>{if(!ok)failures.push(code);};
 check(model.revision===source.revision,'candidate_commit');check(source.dirty===false&&model.source_dirty===false&&!model.source_changed_during_replay,'clean_source');
 check(model.source_capture?.before_turns===true&&model.source_capture?.version===1,'source_capture');
 check(oracle.digest(model.source_snapshot)===oracle.digest(source.snapshot),'source_snapshot');
 check(model.dataset?.sha256===oracle.digest(dataset),'dataset_sha');
 check(raw.revision===model.revision&&raw.source_dirty===false&&raw.source_changed_during_replay===false&&oracle.digest(raw.source_snapshot)===oracle.digest(model.source_snapshot)&&raw.dataset?.sha256===model.dataset?.sha256,'raw_source_identity');
 const coverage=measureConversationCoverage(model);check(!coverage.failures.length&&coverage.unique_conversations>=minimum,'unique_coverage');
 check(model.execution?.model_requested===true&&model.summary?.active_model_turns===model.summary?.turns,'active_provider');
 check(model.release_eligible===true&&model.summary?.failed===0&&model.summary?.unverified===0,'model_gate');
 check(quality.complete===true&&path.resolve(quality.source_report||'')===path.resolve(modelPath),'quality_source_complete');
 const recomputed=judge.summarize(quality.reviews||[]);check(recomputed.release_eligible&&recomputed.hard_failures===0,'quality_gate');
 check(!quality.infrastructure_error&&quality.summary?.release_eligible===true&&quality.summary?.functional_failures===0&&['judged','excellent','acceptable','poor','hard_failures'].every(k=>quality.summary?.[k]===recomputed[k]),'quality_summary');
 if(model.recorded_provider_replay){
  check(!!rawText&&model.recorded_provider_replay.new_provider_calls===0&&model.recorded_provider_replay.raw_model_sha256===oracle.digest(rawText),'parent_raw_hash');
  check(quality.original_source_sha256===model.recorded_provider_replay.raw_model_sha256,'quality_parent_hash');
 }
 const original=judge.flattenReport(raw),reviews=quality.reviews||[];
 check(original.length===reviews.length&&original.length===model.summary?.turns,'review_coverage');
 for(const t of original){const r=reviews.find(r=>r.conversation_id===t.conversation_id&&r.turn===t.turn);
  check(r?.input_sha256===judge.reviewDigest(t,t.history||[]),'review_input_digest');
  check(r?.review?.model_requested===judge.DEFAULT_MODEL&&r?.review?.model_returned===judge.DEFAULT_MODEL,'independent_reviewer');
 }
 const bound=judge.oracleReviews(reviews);
 for(const run of model.runs||[]){const scenario=dataset.conversations.find(c=>c.id===run.id),inputs=[];let previousState=null;
  check(!!scenario&&run.turns.length===scenario.turns.length,'dataset_sequence');
  for(const [i,t]of run.turns.entries()){
   const expected=scenario?.turns[i]?.expect,plan=t.trace?.final_plan;
   if(!expected||!plan){check(false,'trace_missing');continue;}
   check(t.input===scenario.turns[i].input,'turn_input');inputs.push(t.input);
   check(t.review_binding?.expectation_sha256===oracle.digest(expected)&&t.review_binding?.response_sha256===oracle.digest(oracle.visibleSurfaces(plan)),'output_expectation_digest');
   const parent=raw.runs?.find(r=>r.id===run.id&&r.repetition===run.repetition&&r.mode===run.mode)?.turns[i];
   check(!!parent&&oracle.digest(parent.trace?.final_plan)===oracle.digest(plan)&&oracle.digest(parent.state)===oracle.digest(t.state),'immutable_provider_output');
   const evaluated=oracle.evaluateTurn({expected,body:{plan,semantic_state:t.state,semantic_decision:t.actual?.decision},inputs,previousState,context:{...scenario.context,channel:scenario.channel},reviews:bound,mode:run.mode});
   check(evaluated.status==='passed'&&t.status==='passed','recomputed_oracle');previousState=t.state;
  }
 }
 return {passed:!failures.length,failures:[...new Set(failures)],coverage,active_model_checked:!failures.length,independent_quality_judge_checked:!failures.length,new_provider_calls:0,physical_device_tested:false};
}
function main(){const arg=k=>process.argv[process.argv.indexOf(k)+1];for(const k of ['--model','--quality','--dataset'])if(!process.argv.includes(k))throw Error('recorded_paths_required');
 const modelPath=path.resolve(arg('--model')),model=JSON.parse(fs.readFileSync(modelPath)),quality=JSON.parse(fs.readFileSync(arg('--quality'))),dataset=JSON.parse(fs.readFileSync(arg('--dataset')));
 let raw=model,rawText;if(model.recorded_provider_replay){rawText=fs.readFileSync(model.recorded_provider_replay.raw_model_report,'utf8');raw=JSON.parse(rawText);}
 const result=validate({model,quality,raw,dataset,modelPath,rawText});console.log(JSON.stringify(result));process.exitCode=result.passed?0:1;
}
module.exports={validate};if(require.main===module)main();
