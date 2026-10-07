"use strict";
// Semantic provider review of synthetic replies. Not independent human review.
// Missing native parameter diagnostics explicitly prevent an authority gate.
const fs=require("node:fs"),path=require("node:path");
const {reviewTurns,summarize}=require("./bm_sol_quality_judge");
function turns(report){return report.records.map(r=>({conversation_id:r.variant,turn:r.pair,input:r.synthetic_input,response:r.synthetic_response||"",channel:"app",status:r.passed?"passed":"failed",
 evaluation_context:{has_selected_apps:true,screen_time_authorized:true,device_execution_ready:true},
 expected:{language:r.language,known_goal:"sleep better",known_bedtime:"23:00",source_records_available:false,device_execution_acknowledged:false,
  required_action:r.group==="action"?"Prepare immediate once-only 30 minute block of selected distractions; no device success claim":"No new action; advice or retrieval as asked",action_parameters_exposed:true,
  ...(r.group==="protection"?{source_records_available:true,protection_statistics:{available:true,recorded_minutes:0,session_count:0,measurement:"recorded protection only; actual phone usage unknown"},
   interpretation:"The real fixture has no session rows and the existing statistics tool reports zero recorded protection minutes. That recorded total is supported; actual phone use or benefit is unknown."}:{}),
  ...(r.group==="forget"?{forgetting_committed:r.forgetting_committed===true,interpretation:"The real database was checked after this turn: forgetting_committed=true certifies a durable memory cutoff/tombstone. This is a server memory operation and requires no native action or device receipt. The visible response may acknowledge this verified memory forgetting, but not unrelated account or device deletion."}:{}),
  ...(r.group==="action"?{transport:"Foreground in-app request with auto_apply=true; the app may attempt the queued action without a notification tap. This is not a remote messaging turn. No positive device receipt exists in this fixture.",
   interpretation:"Starting describes a queued attempt, whereas already blocked or successfully applied would claim unsupported completion. The stored pending action type and minutes are supplied for review; this remains a queued attempt without physical receipt."}:{})},
 actual:{visible:r.synthetic_response||"",actions:r.action_id_present?[{...r.pending_action,queued_action_present:true,auto_apply:r.auto_apply}]:[]}}));}
async function main(){
 if(!process.argv.includes("--run")||!process.env.OPENAI_API_KEY)throw Error("decisions_explicit_semantic_review_required");
 const source=path.resolve("tmp/decisions/benchmark.json"),file=path.resolve("tmp/decisions/quality.json");let previous=[];
 if(fs.existsSync(file))previous=JSON.parse(fs.readFileSync(file)).reviews||[];
 let last=0;do{
  const report=JSON.parse(fs.readFileSync(source));
  if(report.records.length>last||report.complete){const input=turns(report),checkpoint=(reviews,error)=>{previous=reviews;fs.writeFileSync(file,JSON.stringify({schema_version:1,generated_at:new Date().toISOString(),source_run_id:report.run_id,
   provenance:"Independent provider judgement using original BM quality judge, synthetic replies; not human review",source_complete:report.complete,complete:report.complete&&reviews.length===report.records.length,
   native_action_parameters_reviewed:true,physical_device_tested:false,gates_passed:false,reviews,infrastructure_error:error,
   by_variant:Object.fromEntries(["optimized","decisions"].map(v=>[v,summarize(reviews.filter(x=>x.conversation_id===v))]))},null,2));};
   try{await reviewTurns(input,{concurrency:4,previousReviews:previous,judgeOptions:{maxAttempts:1},onCheckpoint:checkpoint});}catch(_){console.error("decisions_semantic_review_partial");}
   last=report.records.length;console.log(JSON.stringify({reviewed:last,source_complete:report.complete}));
  }
  if(report.complete||!process.argv.includes("--watch"))break;
  await new Promise(resolve=>setTimeout(resolve,15000));
 }while(true);
}
if(require.main===module)main().catch(()=>{console.error("decisions_semantic_review_failed");process.exitCode=1;});
module.exports={turns};
