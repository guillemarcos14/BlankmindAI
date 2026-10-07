"use strict";
const fs=require("node:fs"),path=require("node:path");
const {summary}=require("./bm_latency_benchmark");
function compare(baseline,candidate){
 const base=summary(baseline.records),next=summary(candidate.records);
 const reduction=(a,b)=>Number.isFinite(a)&&a>0&&Number.isFinite(b)?Math.round((1-b/a)*10000)/100:null;
 const improvement=Object.fromEntries(Object.keys(base).map(group=>[group,{
   first_text_p50_percent:reduction(base[group].first_text_ms.p50,next[group].first_text_ms.p50),
   first_text_p95_percent:reduction(base[group].first_text_ms.p95,next[group].first_text_ms.p95),
   final_p50_percent:reduction(base[group].final_ms.p50,next[group].final_ms.p50),
   baseline_errors:base[group].errors,candidate_errors:next[group].errors,
 }]));
 const comparable=baseline.complete===true&&candidate.complete===true&&baseline.records.length===candidate.records.length
   &&baseline.records.every((r,i)=>r.group===candidate.records[i]?.group);
 return {schema_version:1,generated_at:new Date().toISOString(),comparable,baseline:base,candidate:next,improvement,
   acceptance:{simple_first_text_p90_under_2s:next.simple.first_text_ms.p90!=null&&next.simple.first_text_ms.p90<=2000,
     first_text_p95_improved_30_percent:improvement.all.first_text_p95_percent>=30,
     final_p50_improved_25_percent:improvement.all.final_p50_percent>=25,
     no_increased_errors:next.all.errors<=base.all.errors,
     cleanup_verified:[baseline,candidate].every(r=>r.cleanup?.length>0&&r.cleanup.every(x=>x.passed))},
   physical_device_tested:false,netlify_transport_tested:false,
   limitation:"Real provider and QA database, local production handler. Not iPhone, Wi-Fi/mobile or Netlify cold-start evidence. Percentiles exclude failed turns; errors are reported separately."};
}
if(require.main===module){
 const [baseline,candidate,output="tmp/latency/comparison.json"]=process.argv.slice(2);
 if(!baseline||!candidate)throw Error("baseline_candidate_files_required");
 const report=compare(JSON.parse(fs.readFileSync(baseline)),JSON.parse(fs.readFileSync(candidate)));
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));if(!report.comparable||!report.acceptance.cleanup_verified)process.exitCode=1;
}
module.exports={compare};
