"use strict";
const finite = n => Number.isFinite(n) && n >= 0;
const percentile = (values,p) => values.length?[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)]:null;
const KEYS=["first_text_p50_ms","first_text_p95_ms","first_audio_p50_ms","first_audio_p95_ms","total_cost_usd","errors","bad_responses","memory_errors","action_errors"];
function compare(baseline,candidate) {
  if(!baseline||!candidate||KEYS.some(k=>!finite(baseline[k])||!finite(candidate[k])))return {no_regression:false,improved:false};
  return {no_regression:KEYS.every(k=>candidate[k]<=baseline[k]),improved:KEYS.some(k=>candidate[k]<baseline[k])};
}
function summarize(rows) {
  const audio=rows.filter(r=>r.audio_requested);
  return {first_text_p50_ms:percentile(rows.map(r=>r.first_text_ms),.5),first_text_p95_ms:percentile(rows.map(r=>r.first_text_ms),.95),
    first_audio_p50_ms:percentile(audio.map(r=>r.first_audio_ms),.5),first_audio_p95_ms:percentile(audio.map(r=>r.first_audio_ms),.95),
    total_cost_usd:rows.reduce((s,r)=>s+r.cost_usd+r.background_cost_usd,0),errors:rows.filter(r=>r.error).length,
    bad_responses:rows.filter(r=>!r.quality.response_ok).length,memory_errors:rows.filter(r=>!r.quality.memory_ok).length,action_errors:rows.filter(r=>!r.quality.action_ok).length};
}
function assess(rows,{feature,sourceHashes,model="gpt-5.6-luna",minimumCases=200}={}){
  const reasons=[],pairs=new Map(),requests=new Set(),groups=["chat","query","action","memory"];
  if(!sourceHashes||!Object.keys(sourceHashes).length||Object.values(sourceHashes).some(h=>!/^[a-f0-9]{64}$/.test(h)))reasons.push("missing_source_hashes");
  for(const r of rows){
    if(r.feature!==feature)continue;
    if(!["baseline","candidate"].includes(r.variant)||typeof r.case_id!=="string"||!r.case_id||!["es","en"].includes(r.language)||!groups.includes(r.group)
      ||r.provider_measured!==true||r.model!==model||!Array.isArray(r.provider_request_ids)||!r.provider_request_ids.length
      ||r.provider_request_ids.some(id=>!/^req_[a-zA-Z0-9_-]+$/.test(id))
      ||![r.first_text_ms,r.cost_usd,r.background_cost_usd].every(finite)||typeof r.audio_requested!=="boolean"
      ||(r.audio_requested?!finite(r.first_audio_ms):r.first_audio_ms!==null)
      ||typeof r.error!=="boolean"||![r.quality?.response_ok,r.quality?.memory_ok,r.quality?.action_ok].every(v=>typeof v==="boolean")
      ||r.quality?.reviewed!==true||typeof r.quality?.reviewer!=="string"||!r.quality.reviewer.trim()||r.quality.reviewer===model){reasons.push("incomplete_measurement");continue;}
    for(const id of r.provider_request_ids){if(requests.has(id))reasons.push("reused_provider_request");requests.add(id);}
    if(r.variant==="candidate"&&Object.entries(sourceHashes||{}).some(([name,hash])=>r.source_hashes?.[name]!==hash)){reasons.push("stale_source");continue;}
    if(!pairs.has(r.case_id))pairs.set(r.case_id,{});
    const pair=pairs.get(r.case_id);if(pair[r.variant])reasons.push("duplicate_case");else pair[r.variant]=r;
  }
  const complete=[...pairs.values()].filter(p=>p.baseline&&p.candidate&&["language","group","audio_requested"].every(k=>p.baseline[k]===p.candidate[k]));
  if(complete.length!==pairs.size||complete.length<minimumCases)reasons.push("insufficient_pairs");
  if(["es","en"].some(lang=>complete.filter(p=>p.baseline.language===lang).length<minimumCases/4))reasons.push("language_coverage");
  if(complete.filter(p=>p.baseline.audio_requested).length<minimumCases/4)reasons.push("audio_coverage");
  const subsets=[...["es","en"].map(lang=>[lang,complete.filter(p=>p.baseline.language===lang)]),...groups.map(group=>[group,complete.filter(p=>p.baseline.group===group)])];
  const by_group={};
  for(const [name,subset] of subsets){
    if(subset.length<minimumCases/10||!subset.some(p=>p.baseline.audio_requested)){reasons.push("subgroup_coverage");continue;}
    by_group[name]={baseline:summarize(subset.map(p=>p.baseline)),candidate:summarize(subset.map(p=>p.candidate))};
    if(!compare(by_group[name].baseline,by_group[name].candidate).no_regression)reasons.push("subgroup_regression");
  }
  const baseline=complete.length?summarize(complete.map(p=>p.baseline)):null,candidate=complete.length?summarize(complete.map(p=>p.candidate)):null;
  const metrics={baseline,candidate,by_group,...compare(baseline,candidate)};
  if(!metrics.no_regression||!metrics.improved)reasons.push("metrics_not_improved");
  return {approved:!reasons.length,provider_measured:!reasons.includes("incomplete_measurement"),quality_reviewed:!reasons.includes("incomplete_measurement"),
    coverage_passed:!reasons.some(r=>/coverage|pairs|regression/.test(r)),model,case_count:complete.length,source_hashes:sourceHashes,metrics,reasons:[...new Set(reasons)]};
}
module.exports={KEYS,compare,summarize,assess};
