"use strict";
// Fully exposed fixture facts; separate model judgement, never human certification.
const fs=require("node:fs"),{reviewTurns,summarize}=require("./bm_sol_quality_judge");
async function main(){
 if(!process.argv.includes("--run")||!process.env.OPENAI_API_KEY)throw Error("explicit_quality_run_required");
 const report=JSON.parse(fs.readFileSync("tmp/retrieval-step/benchmark.json"));if(!report.complete)throw Error("complete_benchmark_required");
 const timezone="Europe/Madrid",today=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(Date.parse(report.fixture_clock));
 const turns=report.records.map(r=>({conversation_id:r.variant,turn:r.pair,input:r.synthetic_input,response:r.synthetic_response||"",status:r.passed?"passed":"failed",channel:"app",
  expected:{language:r.language,...r.expected,current_time:report.fixture_clock,timezone,local_today:today,
   requested_period:require("../netlify/functions/bm-brain-data").periodBounds({period:r.group.endsWith("yesterday")?"yesterday":"this_week"},{timezone,week_starts_on:2},Date.parse(report.fixture_clock)),
   ...(r.group.startsWith("protection")?{recorded_session_count:r.profile==="standard"?2:0,partial_recording:true,
    coverage_interpretation:"All persisted overlapping sessions were queried; the native observation is older than the requested interval, so the statistics tool flags partial=true. Session count 2 (standard) or 0 (empty) and that partial caveat are supported. Physical activity may be unknown; the recorded total is nevertheless the supplied number."}:{}),
   required_action:"No action, no memory write, no device success claim. Direct factual retrieval answer only.",quality_criterion:"Correct value or truthful absence; preserve measured/recorded scope, requested period, units, language, concise natural answer, no invented data or unsupported outcome. In empty protection fixtures the recorded total is exactly zero, while actual physical protection may be unknown. A response may say no recorded minutes rather than the digit 0, but withholding the computable recorded total is not correct. Relative-day dates can be derived from the supplied current_time/timezone."},
  evaluation_context:{has_selected_apps:true,screen_time_authorized:true,device_execution_ready:true},actual:{visible:r.synthetic_response||"",actions:r.action_id_present?[{unexpected:true}]:[]}}));
 const file="tmp/retrieval-step/quality.json",previous=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)).reviews:[];
 await reviewTurns(turns,{concurrency:4,previousReviews:previous,judgeOptions:{maxAttempts:1},onCheckpoint:reviews=>fs.writeFileSync(file,JSON.stringify({schema_version:1,complete:reviews.length===turns.length,source_run_id:report.run_id,provenance:"Independent model judgement with exact fixture facts; not human review",reviews,
  by_variant:Object.fromEntries(["optimized","decisions"].map(v=>[v,summarize(reviews.filter(r=>r.conversation_id===v))]))},null,2)+"\n")});
 console.log(JSON.stringify(JSON.parse(fs.readFileSync(file)).by_variant));
}
main().catch(()=>{console.error("retrieval_quality_failed");process.exitCode=1;});
