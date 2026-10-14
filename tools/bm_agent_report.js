"use strict";
// Converts frozen raw receipts; never invents timings, audits, provider usage or
// human review. A separate unpaired voice smoke cannot qualify a latency gate.
const fs=require("node:fs"),crypto=require("node:crypto"),{estimate}=require("./bm_decisions_meter");
const {assess}=require("../netlify/functions/bm-agent-evidence"),{input}=require("./bm_agent_quality");
const sha=value=>crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function committedFact(row,fact){
 if(!fact||typeof fact.key!=="string"||typeof fact.literal!=="string"||!fact.literal)return false;
 const matches=value=>typeof value==="string"&&value.includes(fact.literal);
 return (row.committed_effect||[]).some(({brain_memory_effect:e,brain_memory_applied_at:at})=>{
  if(!e||typeof at!=="string"||!Number.isFinite(Date.parse(at)))return false;
  if(e.operation==="set"&&e.key===fact.key&&matches(e.value))
   return (row.canonical_memories||[]).some(m=>m.key===fact.key&&matches(m.value));
  return (e.observations||[]).some(o=>o.metric===fact.key&&o.unit==="text"&&matches(o.value_text)
   &&(row.canonical_observations||[]).some(saved=>saved.metric===o.metric&&saved.unit===o.unit&&saved.measurement===o.measurement&&matches(saved.value_text)));
 });
}
function adapt(report,quality){
 if(!report.complete||quality.source_sha256!==sha(report)||!quality.complete)throw Error("Complete unchanged source/review required");
 if(quality.model===report.generative_model)throw Error("Independent reviewer required");
 if(new Set(quality.reviews.map(r=>r.id)).size!==quality.reviews.length)throw Error("Duplicate review receipts");
 return report.records.map(r=>{
  const spec=report.case_manifest.cases.find(c=>c.id===r.case_id);
  const review=quality.reviews.find(q=>q.id===r.variant+":"+r.pair+":"+r.step);
  if(!review||review.input_sha256!==sha(input(r,report,quality.input_version||1)))throw Error("Review does not match original turn");
  const parts=r.provider_requests.map(p=>estimate(p,report.rates)),textCost=parts.length&&parts.every(n=>Number.isFinite(n)&&n>=0)?parts.reduce((a,b)=>a+b,0):null;
  const voiceKnown=r.audio_requested!==true||(Number.isFinite(r.voice_cost_usd)&&r.voice_cost_usd>=0);
  const cost=textCost!==null&&voiceKnown?textCost+(r.audio_requested===true?r.voice_cost_usd:0):null;
  const group=["sleep_yesterday","sleep_week","protection_yesterday","protection_week","query"].includes(r.group)?"query":
   ["memory","bedtime","forget","habits"].includes(r.group)?"memory":r.group==="action"||r.group==="actions_combined"?"action":"chat";
  const actionMatches=spec.expected_action?Boolean(r.action_id_present&&r.pending_action&&Object.entries(spec.expected_action).every(([k,v])=>{
    const actual=r.pending_action[k];return k==="weekdays"&&Array.isArray(actual)?JSON.stringify([...actual].sort())===JSON.stringify([...v].sort()):JSON.stringify(actual)===JSON.stringify(v);
  })):!r.action_id_present;
  const clock=spec.expected_memory?.key==="bedtime"&&/^(\d{2}):(\d{2})$/.exec(spec.expected_memory.value);
  const equivalentRoutine=clock&&(r.canonical_observations||[]).some(o=>o.metric==="bedtime"&&o.unit==="local_minute"&&o.measurement==="routine_statement"
    &&o.value_number===Number(clock[1])*60+Number(clock[2])&&o.evidence?.includes(spec.expected_memory.value));
  const memoryMatches=(!spec.expected_memory||equivalentRoutine||(r.canonical_memories||[]).some(m=>m.key===spec.expected_memory.key&&typeof m.value==="string"&&m.value.includes(spec.expected_memory.value)))
    &&(!spec.expected_fact||committedFact(r,spec.expected_fact))
    &&(!spec.forbid_memory||r.canonical_memories?.length===0)&&(r.group!=="forget"||r.forgetting_committed===true);
  return {feature:r.agent_feature||report.agent_feature,variant:r.variant==="decisions"?"candidate":"baseline",case_id:r.case_id+":"+r.step,
   language:r.language,group,model:report.generative_model,source_hashes:report.agent_source_hashes,
   provider_measured:report.provider_real===true,provider_request_ids:r.provider_requests.map(p=>p.provider_request_id),
   first_text_ms:r.first_text_ms,audio_requested:r.audio_requested===true,first_audio_ms:r.audio_requested===true?r.first_audio_ms:null,
   cost_usd:cost,background_cost_usd:0,cost_scope:"All metered foreground/background/retry provider requests combined",
   error:r.status!==200,quality:{response_ok:review.review?.response_ok===true&&review.review?.naturalness>=3,memory_ok:review.review?.memory_ok===true&&memoryMatches,
    action_ok:review.review?.action_ok===true&&actionMatches,reviewed:!review.error&&Boolean(review.review)&&Array.isArray(r.canonical_observations)&&Array.isArray(r.committed_effect),reviewer:quality.model}};
 });
}
if(require.main===module){
 const [source,review,output]=process.argv.slice(2);if(!source||!review||!output)throw Error("source.json quality.json output.json required");
 const rows=adapt(JSON.parse(fs.readFileSync(source)),JSON.parse(fs.readFileSync(review))),hashes=require("./bm_agent_runtime").verify(),feature=rows[0]?.feature;
 const result={version:1,feature,assessment:assess(rows,{feature,sourceHashes:hashes}),measured_rows:rows};
 fs.writeFileSync(output,JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify({feature,approved:result.assessment.approved,reasons:result.assessment.reasons,case_count:result.assessment.case_count}));
 if(!result.assessment.approved)process.exitCode=1;
}
module.exports={adapt,committedFact};
