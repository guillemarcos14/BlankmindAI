"use strict";
// Semantic provider review of synthetic replies. Not independent human review.
// Missing native parameter diagnostics explicitly prevent an authority gate.
const fs=require("node:fs"),path=require("node:path");
const {reviewTurns,summarize}=require("./bm_sol_quality_judge");
function turns(report){return report.records.map(r=>({conversation_id:r.variant,turn:r.pair,input:r.synthetic_input,response:r.synthetic_response||"",channel:"app",status:r.passed?"passed":"failed",
 evaluation_context:{has_selected_apps:true,screen_time_authorized:true,device_execution_ready:true},
 expected:{language:r.group==="rest"||r.group==="habits"?"es":"en",known_goal:"sleep better",known_bedtime:"23:00",source_records_available:false,device_execution_acknowledged:false,
  required_action:r.group==="action"?"Prepare immediate once-only 30 minute block of selected distractions; no device success claim":"No new action; advice or retrieval as asked",action_parameters_exposed:false},
 actual:{visible:r.synthetic_response||"",actions:r.action_id_present?[{type:"unknown_parameters",queued_action_present:true,auto_apply:r.auto_apply}]:[]}}));}
async function main(){
 if(!process.argv.includes("--run")||!process.env.OPENAI_API_KEY)throw Error("jev_explicit_semantic_review_required");
 const source=path.resolve("tmp/jev/benchmark.json"),file=path.resolve("tmp/jev/quality.json");let previous=[];
 if(fs.existsSync(file))previous=JSON.parse(fs.readFileSync(file)).reviews||[];
 let last=0;do{
  const report=JSON.parse(fs.readFileSync(source));
  if(report.records.length>last){const input=turns(report),checkpoint=(reviews,error)=>{previous=reviews;fs.writeFileSync(file,JSON.stringify({schema_version:1,generated_at:new Date().toISOString(),source_run_id:report.run_id,
   provenance:"Independent provider judgement using original BM quality judge, synthetic replies; not human review",source_complete:report.complete,complete:report.complete&&reviews.length===600,
   native_action_parameters_reviewed:false,physical_device_tested:false,gates_passed:false,reviews,infrastructure_error:error,
   by_variant:Object.fromEntries(["optimized","jev"].map(v=>[v,summarize(reviews.filter(x=>x.conversation_id===v))]))},null,2));};
   try{await reviewTurns(input,{concurrency:4,previousReviews:previous,judgeOptions:{maxAttempts:1},onCheckpoint:checkpoint});}catch(_){console.error("jev_semantic_review_partial");}
   last=report.records.length;console.log(JSON.stringify({reviewed:last,source_complete:report.complete}));
  }
  if(report.complete||!process.argv.includes("--watch"))break;
  await new Promise(resolve=>setTimeout(resolve,15000));
 }while(true);
}
if(require.main===module)main().catch(()=>{console.error("jev_semantic_review_failed");process.exitCode=1;});
module.exports={turns};
