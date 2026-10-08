"use strict";
const fs=require("node:fs"),crypto=require("node:crypto"),{summarize}=require("./bm_decisions_benchmark");
function load(p){const bytes=fs.readFileSync(p);return {artifact_sha256:crypto.createHash("sha256").update(bytes).digest("hex"),...JSON.parse(bytes)};}
function main(){
 const benchmark=load("tmp/retrieval-step/benchmark.json"),quality=load("tmp/retrieval-step/quality.json"),qualityOriginal=load("tmp/retrieval-step/quality-original.json");
 if(!benchmark.complete||!quality.complete||benchmark.records.length!==40||quality.reviews.length!==40)throw Error("complete_20_pairs_required");
 const summary=summarize(benchmark.records,benchmark.rates),rows=benchmark.records,baseline=summary.optimized,candidate=summary.decisions;
 for(const [v,s]of Object.entries(summary)){const records=rows.filter(r=>r.variant===v);delete s.route_completed;
  s.classifier_completed=records.filter(r=>r.retrieval_trace.some(t=>t.status==="completed")).length;
  s.final_only_accepted=records.filter(r=>r.retrieval_trace.some(t=>t.accepted===true)).length;}
 const reviews=quality.reviews.filter(r=>r.conversation_id==="decisions"),qualityPass=reviews.every(r=>["excellent","acceptable"].includes(r.review?.verdict)&&!r.review.hard_contradiction&&!r.review.unsafe_claim);
 const pairs=Array.from({length:20},(_,pair)=>{const a=rows.find(r=>r.pair===pair&&r.variant==="optimized"),b=rows.find(r=>r.pair===pair&&r.variant==="decisions");return {pair,case_id:a.case_id,both_functional:a.passed&&b.passed,baseline_model_calls:a.model_calls,candidate_model_calls:b.model_calls,removed_model_calls:a.model_calls-b.model_calls,first_text_delta_ms:b.first_text_ms-a.first_text_ms,final_only:b.retrieval_trace.some(t=>t.accepted===true)};});
 const qualityRegressions=quality.reviews.filter(r=>r.conversation_id==="decisions"&&r.review?.verdict==="poor"&&quality.reviews.some(a=>a.conversation_id==="optimized"&&a.turn===r.turn&&["excellent","acceptable"].includes(a.review?.verdict))).map(r=>r.turn);
 const gates={first_text_faster:candidate.first_text_ms.p50<baseline.first_text_ms.p50,final_faster:candidate.final_ms.p50<baseline.final_ms.p50,
  first_text_p95_no_regression:candidate.first_text_ms.p95<=baseline.first_text_ms.p95,final_p95_no_regression:candidate.final_ms.p95<=baseline.final_ms.p95,
  fewer_generative_calls:candidate.model_calls<baseline.model_calls,no_more_functional_errors:candidate.errors<=baseline.errors,
  lower_complete_estimated_cost:candidate.total_estimated_cost_usd!=null&&baseline.total_estimated_cost_usd!=null&&candidate.total_estimated_cost_usd<baseline.total_estimated_cost_usd,
  all_candidate_outputs_acceptable_by_model:qualityPass,no_new_paired_quality_failures:qualityRegressions.length===0,qa_cleanup_all_passed:benchmark.cleanup.length===5&&benchmark.cleanup.every(r=>r.passed),independent_human_validated:false,physical_device_tested:false,activation:false};
 const verification={checked_at:new Date().toISOString(),passed:true,files:[]};for(const [variant,hashes]of Object.entries(benchmark.sourceHashes))for(const [name,expected]of Object.entries(hashes)){
  const root=variant==="optimized"?"../Codigo-decisions":".",actual=crypto.createHash("sha256").update(fs.readFileSync(root+"/netlify/functions/"+name)).digest("hex");verification.files.push({variant,name,expected,actual,passed:actual===expected});if(actual!==expected)verification.passed=false;}
 if(!verification.passed)throw Error("frozen_runtime_hash_changed");
 const evidence={schema_version:1,generated_at:new Date().toISOString(),hypothesis:"The time saved by removing a generative retrieval decision exceeds classifier time, while preserving output quality.",benchmark:{...benchmark,summary},quality,original_quality_without_complete_date_session_context:qualityOriginal,paired_comparison:pairs,paired_quality_regressions:qualityRegressions,frozen_source_verification:verification,gates,
  limitations:["20 authored questions, one repetition each, synthetic known facts; no statistical or production-quality certification","Actual providers/QA DB through local handlers; Netlify transport and iPhone not measured","Quality judge is a second model, not an independent human","All original failures/aborts retained; unknown billed requests never priced as free","Dedicated Decisions tested; no new Jev runtime tested"]};
 fs.writeFileSync("docs/BM_RETRIEVAL_STEP_EVIDENCE_2026-10-08.json",JSON.stringify(evidence,null,2)+"\n");console.log(JSON.stringify({summary,gates,quality:quality.by_variant,removed_model_calls:pairs.reduce((s,r)=>s+r.removed_model_calls,0),hashes_verified:verification.files.length}));
}
if(require.main===module)try{main();}catch(e){console.error(e.message);process.exitCode=1;}module.exports={load};
