"use strict";
// Reviewable synthetic evidence only. No credentials, environment values,
// account records or local paths containing authentication data are exported.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),{summarize}=require("./bm_jev_benchmark");
const hash=raw=>crypto.createHash("sha256").update(raw).digest("hex");
function load(file){const raw=fs.readFileSync(file);return {sha256:hash(raw),value:JSON.parse(raw)};}
function evaluation(name){
 const {sha256,value:v}=load("tmp/jev/"+name+".json");
 const known=v.records.reduce((s,r)=>s+(r.received?.usage?.input_tokens||r.body?.usage?.input_tokens||0)*.042/1e6,0),unknown=v.records.filter(r=>!r.received?.usage&&!r.body?.usage).length;
 return {artifact_sha256:sha256,model:v.model,dataset_sha256:v.dataset_sha256,provider_real:v.provider_real,completed:v.completed,evaluated_split:v.evaluated_split,tuning_reference:v.tuning_reference,
  by_language:v.by_language,errors:v.errors,known_input_cost_usd:known,unknown_cost_upper_usd:unknown*.001,records:v.records.map(r=>({id:r.id,language:r.language,split:r.split,request_sha256:r.request_sha256,
   elapsed_ms:r.elapsed_ms,error:r.error,received:r.received||r.body}))};
}
function main(){
 const bench=load("tmp/jev/benchmark.json"),quality=load("tmp/jev/quality.json");
 if(!bench.value.complete||!quality.value.complete)throw Error("jev_complete_evidence_required");
 const initial=evaluation("evaluation-initial"),tuning=evaluation("tuning-revised"),heldout=evaluation("evaluation-revised"),shadow=load("tmp/jev/shadow-qa.json"),planner=load("tmp/jev/planner-comparison.json"),annotation=load("tmp/jev/annotation-review.json");
 const b=bench.value,summary=summarize(b.records,b.rates);
 const jevKnown=[initial,tuning,heldout].reduce((s,x)=>s+x.known_input_cost_usd,0)+summary.jev.jev_known_cost_usd+shadow.value.stages.at(-1).known_cost_usd;
 const jevUnknown=[initial,tuning,heldout].reduce((s,x)=>s+x.unknown_cost_upper_usd,0)+summary.jev.jev_unknown_cost_upper_usd+shadow.value.stages.at(-1).unknown_cost_upper_usd;
 const ratio=(key,p)=>summary.jev[key][p]/summary.optimized[key][p];
 const measured={first_text_p50_ratio:ratio("first_text_ms","p50"),first_text_p95_ratio:ratio("first_text_ms","p95"),final_p95_ratio:ratio("final_ms","p95"),
  first_text_median_target_met:ratio("first_text_ms","p50")<=.8,first_text_p95_no_regression:ratio("first_text_ms","p95")<=1,final_p95_no_regression:ratio("final_ms","p95")<=1,
  total_cost_target_met:null,quality_gate_met:false,independent_human_review:false,physical_iphone_cases:0,activation_enabled:false,gates_passed:false};
 const report={schema_version:1,generated_at:new Date().toISOString(),provenance:"Actual provider calls and private QA database; authored synthetic inputs only",dataset_sha256:heldout.dataset_sha256,
  evaluation:{heldout_reused:true,fresh_independent_holdout:false,initial,tuning_revised:tuning,heldout_revised:heldout},annotation_review:{artifact_sha256:annotation.sha256,...annotation.value},planner_comparison:{artifact_sha256:planner.sha256,...planner.value},
  workflow_benchmark:{artifact_sha256:bench.sha256,...b,summary,total_cost_verified:false,limitations:[...b.limitations,"This run predates per-request usage counters; its generative aggregate is a lower-bound estimate and the upper billed amount is unknown","Measured candidate 6578fb8; subsequent changes only sampled worker selection and metadata allowlisting; no new successful release gate is implied"]},
  quality_review:{artifact_sha256:quality.sha256,...quality.value},shadow_qa:{artifact_sha256:shadow.sha256,...shadow.value},
  vendor_spend:{known_jev_usd:jevKnown,unknown_jev_upper_usd:jevUnknown,max_jev_usd:jevKnown+jevUnknown,authorized_limit_usd:1,limit_met:jevKnown+jevUnknown<=1,
   note:"Includes initial rejected responses, revised tuning/heldout, 300-turn variant and shadow; evaluator OpenAI calls are test overhead, outside application turn cost"},gates:measured};
 fs.mkdirSync("docs/evidence",{recursive:true});fs.writeFileSync("docs/evidence/bm_jev_2026-10-07.json",JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify({samples:summary.optimized.samples+summary.jev.samples,summary,spend:report.vendor_spend,gates:measured}));
}
if(require.main===module)try{main();}catch(e){console.error(/^jev_[a-z0-9_]+$/.test(e.message)?e.message:"jev_evidence_export_failed");process.exitCode=1;}
module.exports={evaluation};
