"use strict";
// Re-evaluate the very same paid outputs; never regenerate to fit a verdict.
const fs=require('node:fs'),path=require('node:path'),{digest,evaluateTurn}=require('./bm_semantic_oracle'),judge=require('./bm_sol_quality_judge'),{reportResults}=require('./bm_semantic_replay');
const arg=(key)=>process.argv[process.argv.indexOf(key)+1];
function apply({modelFile,qualityFile,datasetFile,outModel,outQuality}){
 const raw=JSON.parse(fs.readFileSync(modelFile)),quality=JSON.parse(fs.readFileSync(qualityFile)),dataset=JSON.parse(fs.readFileSync(datasetFile));
 if(path.resolve(quality.source_report)!==path.resolve(modelFile)||!quality.complete||raw.dataset.sha256!==digest(dataset))throw Error('recorded_review_source_mismatch');
 const turns=judge.flattenReport(raw),reviews=judge.oracleReviews(quality.reviews);
 if(turns.length!==quality.reviews.length||turns.some(t=>!quality.reviews.some(q=>q.conversation_id===t.conversation_id&&q.turn===t.turn&&q.input_sha256===judge.reviewDigest(t,t.history||[]))))throw Error('recorded_review_digest_mismatch');
 const runs=raw.runs.map(run=>{const scenario=dataset.conversations.find(c=>c.id===run.id),inputs=[];let previousState=null;
  const evaluated=run.turns.map((turn,index)=>{inputs.push(turn.input);const expected=scenario.turns[index].expect,body={plan:turn.trace.final_plan,semantic_state:turn.state,semantic_decision:turn.actual.decision};
   if(digest(require('./bm_semantic_oracle').visibleSurfaces(body.plan))!==turn.review_binding.response_sha256||digest(expected)!==turn.review_binding.expectation_sha256)throw Error('recorded_output_changed');
   const result=evaluateTurn({expected,body,inputs,previousState,context:{...scenario.context,channel:scenario.channel},reviews,mode:run.mode});previousState=turn.state;
   return {...turn,...result,original_unreviewed_status:turn.status};});
  return {...run,turns:evaluated,status:evaluated.some(t=>t.status==='failed')?'failed':evaluated.some(t=>t.status==='unverified')?'unverified':'passed'};
 });
 const result=reportResults(dataset,runs,{...raw.execution,model:raw.execution.model_requested,sourceStart:{revision:raw.revision,dirty:raw.source_dirty,snapshot:raw.source_snapshot,capture:raw.source_capture},sourceSnapshot:raw.source_snapshot,sourceChanged:raw.source_changed_during_replay},raw);
 result.recorded_provider_replay={new_provider_calls:0,raw_model_report:path.resolve(modelFile),raw_model_sha256:digest(fs.readFileSync(modelFile,'utf8')),original_quality_report:path.resolve(qualityFile),quality_sha256:digest(fs.readFileSync(qualityFile,'utf8')),all_exact_original_input_digests_verified:true,all_visible_response_and_expectation_digests_verified:true};
 const rebound={...quality,source_report:path.resolve(outModel),original_source_report:quality.source_report,original_source_sha256:result.recorded_provider_replay.raw_model_sha256,original_quality_report:path.resolve(qualityFile),review_input_status:'Exact original pre-review deterministic status, bound to retained raw report; re-evaluation changes status only, never provider output, facts or expectation.'};
 fs.writeFileSync(outModel,JSON.stringify(result,null,2));fs.writeFileSync(outQuality,JSON.stringify(rebound,null,2));return result;
}
if(require.main===module){const r=apply({modelFile:arg('--model'),qualityFile:arg('--quality'),datasetFile:arg('--dataset'),outModel:arg('--out-model'),outQuality:arg('--out-quality')});console.log(JSON.stringify({release_eligible:r.release_eligible,summary:r.summary,paid_outputs_regenerated:false}));}
module.exports={apply};
