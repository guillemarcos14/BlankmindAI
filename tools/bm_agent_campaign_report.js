"use strict";
// Read-only aggregation of unchanged real receipts and their original reviews.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {adapt}=require('./bm_agent_report'),{estimate}=require('./bm_decisions_meter');
const {assess}=require('../netlify/functions/bm-agent-evidence');
const percentile=(v,p)=>v.length?[...v].sort((a,b)=>a-b)[Math.max(0,Math.ceil(v.length*p)-1)]:null;
function summarize(rows,rawRows,rates){
 const costs=rawRows.flatMap(r=>r.provider_requests).map(r=>estimate(r,rates));
 return {turns:rows.length,functional_passed:rawRows.filter(r=>r.passed).length,
  response_ok:rows.filter(r=>r.quality.response_ok).length,memory_ok:rows.filter(r=>r.quality.memory_ok).length,action_ok:rows.filter(r=>r.quality.action_ok).length,
  fully_accepted:rows.filter(r=>r.quality.response_ok&&r.quality.memory_ok&&r.quality.action_ok&&!r.error).length,
  first_text_p50_ms:percentile(rows.map(r=>r.first_text_ms).filter(Number.isFinite),.5),first_text_p95_ms:percentile(rows.map(r=>r.first_text_ms).filter(Number.isFinite),.95),
  known_runtime_cost_usd:costs.reduce((n,c)=>n+(c??0),0),unknown_runtime_requests:costs.filter(c=>c===null).length,
  complete_runtime_cost_usd:costs.every(Number.isFinite)?costs.reduce((a,b)=>a+b,0):null};
}
function collect(directory,runtimeRoot){
 const hashes=require(path.resolve(runtimeRoot,'tools/bm_agent_runtime')).verify();
 const features={},requests=[],reviews=[],failures=[],allIds=new Set();
 for(const qualityName of fs.readdirSync(directory).filter(n=>n.endsWith('-quality.json'))){
  const name=qualityName.replace(/-quality\.json$/,'.json'),raw=JSON.parse(fs.readFileSync(path.join(directory,name))),quality=JSON.parse(fs.readFileSync(path.join(directory,qualityName)));
  assert.deepEqual(raw.agent_source_hashes,hashes,'Never combine stale runtime receipts');
  const adapted=adapt(raw,quality),feature=raw.agent_feature;
  features[feature]||={rows:[],raw:[],reports:[],rates:raw.rates};
  for(const row of adapted){const id=feature+':'+row.variant+':'+row.case_id;assert(!allIds.has(id),'Duplicate paired case');allIds.add(id);}
  features[feature].rows.push(...adapted);features[feature].raw.push(...raw.records);features[feature].reports.push(name);
  requests.push(...raw.records.flatMap(r=>r.provider_requests));
  reviews.push(...JSON.parse(fs.readFileSync(path.join(directory,qualityName+'.requests.json'))));
  for(const q of quality.reviews){const r=raw.records.find(r=>q.id===r.variant+':'+r.pair+':'+r.step),a=adapted.find(a=>a.case_id===r.case_id+':'+r.step&&a.variant===(r.variant==='decisions'?'candidate':'baseline'));
   if(q.error||!a.quality.response_ok||!a.quality.memory_ok||!a.quality.action_ok||!r.passed)failures.push({feature,report:name,case_id:r.case_id,variant:a.variant,functional:r.passed,quality:a.quality,rationale:q.review?.rationale,error:q.error});
  }
 }
 const result={version:1,provider_real:true,approved:false,physical_device_tested:false,audio_pairs:0,source_hashes:hashes,features:{},failures};
 for(const [feature,f] of Object.entries(features)){
  const metrics=rows=>Object.fromEntries(['baseline','candidate'].map(variant=>{const subset=rows.filter(r=>r.variant===variant),raw=f.raw.filter(r=>subset.some(a=>a.case_id===r.case_id+':'+r.step&&a.variant===(r.variant==='decisions'?'candidate':'baseline')));return [variant,summarize(subset,raw,f.rates)];}));
  result.features[feature]={raw_pairs:new Set(f.raw.map(r=>r.case_id)).size,original_assessment:assess(f.rows,{feature,sourceHashes:hashes}),text_only_metrics:metrics(f.rows),by_language:Object.fromEntries(['es','en'].map(l=>[l,metrics(f.rows.filter(r=>r.language===l))])),by_group:Object.fromEntries(['chat','query','action','memory'].map(g=>[g,metrics(f.rows.filter(r=>r.group===g))])),reports:f.reports,measured_rows:f.rows};
 }
 const uniqueIds=new Set();for(const r of [...requests,...reviews])if(r.provider_request_id){assert(!uniqueIds.has(r.provider_request_id),'Reused provider request ID');uniqueIds.add(r.provider_request_id);}
 const reviewerCosts=reviews.map(r=>estimate(r,{input:4,cached:.4,output:20}));
 result.independent_review={model:'gpt-5.6-sol',requests:reviews.length,known_cost_usd:reviewerCosts.reduce((a,b)=>a+(b??0),0),unknown_cost_requests:reviewerCosts.filter(c=>c===null).length};
 result.real_provider_request_ids=uniqueIds.size;return result;
}
if(require.main===module){const [directory,runtimeRoot]=process.argv.slice(2);if(!directory||!runtimeRoot)throw Error('Receipts directory and frozen runtime root required');const report=collect(directory,runtimeRoot);fs.writeFileSync(path.join(directory,'campaign-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({approved:report.approved,features:Object.fromEntries(Object.entries(report.features).map(([f,v])=>[f,{pairs:v.raw_pairs,metrics:v.text_only_metrics,reasons:v.original_assessment.reasons}])),review:report.independent_review}));}
module.exports={collect,summarize};
