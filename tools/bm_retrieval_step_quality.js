"use strict";
// Fully exposed fixture facts; separate model judgement, never human certification.
const fs=require("node:fs"),{reviewTurns,summarize}=require("./bm_sol_quality_judge");
async function main(){
 if(!process.argv.includes("--run")||!process.env.OPENAI_API_KEY)throw Error("explicit_quality_run_required");
 const report=JSON.parse(fs.readFileSync("tmp/retrieval-step/benchmark.json"));if(!report.complete)throw Error("complete_benchmark_required");
 const turns=report.records.map(r=>({conversation_id:r.variant,turn:r.pair,input:r.synthetic_input,response:r.synthetic_response||"",status:r.passed?"passed":"failed",channel:"app",
  expected:{language:r.language,...r.expected,required_action:"No action, no memory write, no device success claim. Direct factual retrieval answer only.",quality_criterion:"Correct value or truthful absence; preserve measured/recorded scope, requested period, units, language, concise natural answer, no invented data or unsupported outcome."},
  evaluation_context:{has_selected_apps:true,screen_time_authorized:true,device_execution_ready:true},actual:{visible:r.synthetic_response||"",actions:r.action_id_present?[{unexpected:true}]:[]}}));
 const file="tmp/retrieval-step/quality.json",previous=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)).reviews:[];
 await reviewTurns(turns,{concurrency:4,previousReviews:previous,judgeOptions:{maxAttempts:1},onCheckpoint:reviews=>fs.writeFileSync(file,JSON.stringify({schema_version:1,complete:reviews.length===turns.length,source_run_id:report.run_id,provenance:"Independent model judgement with exact fixture facts; not human review",reviews,
  by_variant:Object.fromEntries(["optimized","decisions"].map(v=>[v,summarize(reviews.filter(r=>r.conversation_id===v))]))},null,2)+"\n")});
 console.log(JSON.stringify(JSON.parse(fs.readFileSync(file)).by_variant));
}
main().catch(()=>{console.error("retrieval_quality_failed");process.exitCode=1;});
