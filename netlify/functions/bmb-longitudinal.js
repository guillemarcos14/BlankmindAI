"use strict";
// Longitudinal evidence, not a second planner. BMB remains the only decision maker.
const {supabaseFetch}=require("./_membership");
const {fingerprint,zone}=require("./bmb-policy");
const METRICS={
  bedtime:[0,1439,"local_minute"],sleep_onset:[0,1439,"local_minute"],wake_time:[0,1439,"local_minute"],
  sleep_duration:[0,1440,"minutes"],restfulness:[0,10,"score_0_10"],energy:[0,10,"score_0_10"],
  stress:[0,10,"score_0_10"],mood:[0,10,"score_0_10"],caffeine:[0,30,"servings"],alcohol:[0,30,"servings"],
  work_routine:null,routine_change:null,travel:null,illness:null,goal:null,preferences:null,constraints:null,
  weak_moments:null,exercise:null,environment:null,life_context:null
};
const object=p=>({type:"object",additionalProperties:false,required:Object.keys(p),properties:p});
const nil=p=>({anyOf:[p,{type:"null"}]});
const str={type:"string"};
const observationSchema=object({metric:{type:"string",enum:Object.keys(METRICS)},value_number:nil({type:"number"}),
  value_text:nil(str),unit:str,measurement:{type:"string",enum:["declared","routine_statement"]},measured_at:nil(str),timezone:str,evidence:str});
const followupSchema=nil(object({id:str,status:{type:"string",enum:["answered","dismissed"]},evidence:str}));
const reviewSchema=nil(object({summary:str,confidence:{type:"number",minimum:0,maximum:1},
  hypotheses:{type:"array",maxItems:4,items:object({explanation:str,status:{type:"string",enum:["possible","supported","contradicted"]},
    evidence_ids:{type:"array",items:str,maxItems:12}})},
  missing_information:{type:"array",items:str,maxItems:5},question:nil(str),
  recommendation:nil(object({kind:{type:"string",enum:["maintain","experiment"]},summary:str,
    success_metric:{type:"string",enum:Object.keys(METRICS)},review_after_days:{type:"integer",minimum:1,maximum:14}})),
  question_metric:nil({type:"string",enum:Object.keys(METRICS)}),evidence_ids:{type:"array",items:str,maxItems:20}}));
function validateEffects(result,prompt,proactive,followups=[],now=Date.now()) {
  const observations=result.observations||[];
  if(!Array.isArray(observations)||observations.length>12)throw Error("bmb_invalid_observations");
  if(proactive&&observations.length)throw Error("bmb_proactive_observation_write");
  if(observations.length&&["question","social","acceptance"].includes(result.message_kind))throw Error("bmb_ungrounded_observation");
  const cleaned=observations.map(o=>{
    if(!Object.hasOwn(METRICS,o.metric)||!o.evidence?.trim()||!prompt.includes(o.evidence))throw Error("bmb_ungrounded_observation");
    const rule=METRICS[o.metric];
    if(rule&&(!Number.isFinite(o.value_number)||o.value_number<rule[0]||o.value_number>rule[1]||o.unit!==rule[2]||o.value_text!==null))throw Error("bmb_invalid_observation_value");
    if(!rule&&(o.value_number!==null||!o.value_text?.trim()||o.value_text.length>400||!prompt.includes(o.value_text)||o.unit!=="text"))throw Error("bmb_invalid_observation_value");
    if(rule&&rule[2]==="local_minute"&&!Number.isInteger(o.value_number))throw Error("bmb_invalid_observation_value");
    if(rule) {
      const numbers=[...o.evidence.matchAll(/\d+(?:[.,]\d+)?/g)].map(m=>Number(m[0].replace(",",".")));
      let grounded=numbers.includes(o.value_number);
      if(rule[2]==="local_minute") {
        grounded=[...o.evidence.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/gi)].some(m=>{
          let hour=Number(m[1]);if(m[3])hour=hour%12+(m[3].toLowerCase()==="pm"?12:0);
          return hour<24&&Number(m[2]||0)<60&&hour*60+Number(m[2]||0)===o.value_number;
        });
      }
      if(rule[2]==="minutes")grounded ||= /horas?|hours?/i.test(o.evidence)&&numbers.some(n=>n*60===o.value_number);
      if(!grounded)throw Error("bmb_ungrounded_observation_value");
    }
    if(o.measured_at!==null&&(!Number.isFinite(Date.parse(o.measured_at))||Date.parse(o.measured_at)>now+30000||Date.parse(o.measured_at)<now-366*86400000))throw Error("bmb_invalid_observation_date");
    if(!["declared","routine_statement"].includes(o.measurement))throw Error("bmb_invalid_measurement");
    return {...o,timezone:zone(o.timezone)};
  });
  const resolution=result.followup_resolution||null;
  if(resolution&&(proactive||!followups.some(f=>f.id===resolution.id&&f.status==="open")||!["answered","dismissed"].includes(resolution.status)
    ||!resolution.evidence?.trim()||!prompt.includes(resolution.evidence)))throw Error("bmb_ungrounded_followup");
  return {observations:cleaned,followup_resolution:resolution};
}
const day=(now,timezone)=>new Intl.DateTimeFormat("en-CA",{timeZone:zone(timezone),year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
const circularDelta=(a,b)=>((a-b+2160)%1440)-720;
const median=values=>{const v=[...values].sort((a,b)=>a-b),m=Math.floor(v.length/2);return v.length%2?v[m]:(v[m-1]+v[m])/2;};
function nativeDaily(rows,timezone,cutoff=null) {
  const byKey=new Map();
  for(const row of [...rows].sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at))) {
    const payload=row.payload||{};
    // These are pre-existing consented daily summaries, not raw HealthKit samples.
    if(payload.privacy?.raw_health_samples_sent===true||payload.privacy?.raw_sleep_stage_timestamps_sent===true)continue;
    for(const d of payload.daily||[]) {
      if(!Number.isFinite(Date.parse(d.date))||cutoff&&Date.parse(d.date)<=Date.parse(cutoff))continue;
      for(const [metric,value] of [["sleep_duration",d.sleep_total_minutes],["sleep_onset",d.bedtime_local],["wake_time",d.wake_time_local]]) {
        if(value===null||value===undefined)continue;
        const clock=metric!=="sleep_duration",match=clock&&/^(\d{2}):(\d{2})$/.exec(value);
        const numeric=clock?match&&Number(match[1])*60+Number(match[2]):value;
        if(!Number.isFinite(numeric)||numeric<0||numeric>METRICS[metric][1])continue;
        const key=[day(Date.parse(d.date),timezone),metric].join(":");
        byKey.set(key,{id:`${row.id}:${key}`,metric,value_number:numeric,value_text:null,unit:METRICS[metric][2],
          measured_at:d.date,timezone,source:"native_health_daily_summary",measurement:"daily_summary_estimate",status:"active",created_at:row.created_at,
          evidence:"Existing on-device daily sleep summary; timing is an estimate, not a raw timestamp or a clinical measurement.",confidence:.65});
      }
    }
  }
  return [...byKey.values()];
}
function reference(values,clock) {
  if(!clock)return median(values);
  const anchor=values[0];return (anchor+median(values.map(v=>circularDelta(v,anchor)))+1440)%1440;
}
function variations(rows,timezone,now=Date.now()) {
  const today=day(now,timezone), findings=[];
  // Last four completed dates versus the preceding 28, matching workday/weekend.
  // Keep source/metric/measurement distinct; averages and declarations never become measured sleep.
  const groups=new Map();
  for(const r of rows) {
    if(!METRICS[r.metric]||!Number.isFinite(r.value_number)||r.status!=="active"||r.measurement==="routine_statement")continue;
    const d=day(Date.parse(r.measured_at),r.timezone||timezone);
    if(d>=today||Date.parse(r.measured_at)<now-33*86400000)continue;
    const key=[r.metric,r.source,r.measurement,r.timezone||timezone].join("|");
    if(!groups.has(key))groups.set(key,new Map());
    const dates=groups.get(key),previous=dates.get(d);
    if(!previous||Date.parse(r.created_at||r.measured_at)>Date.parse(previous.created_at||previous.measured_at))dates.set(d,r);
  }
  for(const [key,dates] of groups) {
    const ordered=[...dates.entries()].sort(([a],[b])=>a.localeCompare(b));
    const cutoff=new Date(Date.parse(today+"T12:00:00Z")-4*86400000).toISOString().slice(0,10);
    const recent=ordered.filter(([d])=>d>=cutoff),base=ordered.filter(([d])=>d<cutoff);
    if(recent.length<3||base.length<7)continue;
    const metric=recent[0][1].metric,clock=METRICS[metric][2]==="local_minute";
    const weekend=d=>[0,6].includes(new Date(d+"T12:00:00Z").getUTCDay());
    const comparisons=recent.map(([d,r])=>{
      const matched=base.filter(([bd])=>weekend(bd)===weekend(d));
      if(matched.length<3)return null;
      const ref=reference(matched.map(([,b])=>b.value_number),clock);
      const spread=median(matched.map(([,b])=>Math.abs(clock?circularDelta(b.value_number,ref):b.value_number-ref)));
      return {reference:ref,delta:clock?circularDelta(r.value_number,ref):r.value_number-ref,spread};
    });
    if(comparisons.some(c=>!c))continue;
    const ref=reference(comparisons.map(c=>c.reference),clock),delta=median(comparisons.map(c=>c.delta));
    const threshold=clock?45:metric==="sleep_duration"?45:2;
    const mad=median(comparisons.map(c=>c.spread));
    if(Math.abs(delta)<Math.max(threshold,3*mad)||comparisons.some(c=>Math.sign(c.delta)!==Math.sign(delta)))continue;
    const ids=[...base,...recent].map(([,r])=>r.id);
    findings.push({id:fingerprint([key,ids]),metric,source:recent[0][1].source,measurement:recent[0][1].measurement,
      reference:ref,recent_value:clock?(ref+delta+1440)%1440:ref+delta,delta,unit:METRICS[metric][2],baseline_days:base.length,recent_days:recent.length,
      confidence:Math.min(.9,.5+base.length/100+recent.length/50),evidence_ids:ids,
      interpretation:"Persistent change against comparable personal days; association is not causation."});
  }
  return findings;
}
async function followups(userId,db=supabaseFetch) {
  try{return await db(`bmb_followups?auth_user_id=eq.${encodeURIComponent(userId)}&status=eq.open&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id,status,question,metric,evidence_ids,created_at&order=created_at.desc&limit=3`,{method:"GET"});}
  catch(e){if(/404|does not exist|column|relation/.test(e.message))return [];throw e;}
}
async function reviewOpportunities(userId,timezone,db=supabaseFetch,now=Date.now()) {
  let rows;
  try {rows=await db(`bmb_daily_reviews?auth_user_id=eq.${encodeURIComponent(userId)}&status=eq.completed&local_day=eq.${day(now,timezone)}&select=id,report,created_at&limit=1`,{method:"GET"});}
  catch(e){if(/404|does not exist|column|relation/.test(e.message))return [];throw e;}
  return rows.filter(r=>r.report?.recommendation?.kind==="experiment"&&!r.report.question&&r.report.confidence>=.7&&r.report.evidence_ids?.length)
    .map(r=>({kind:"opportunity",priority:40,event_key:`insight:${r.id}`,meaning_key:`insight:${r.report.recommendation.success_metric}`,
      expires_at:new Date(Date.parse(r.created_at)+24*3600000).toISOString(),facts:{source:"longitudinal_insight",review_id:r.id,
        recommendation:r.report.recommendation,evidence_ids:r.report.evidence_ids,confidence:r.report.confidence}}));
}
async function greetingContext(userId,db=supabaseFetch,eventID=null) {
  if(eventID) {
    if(!/^[a-f\d-]{36}$/i.test(eventID))throw Error("bmb_invalid_event_id");
    const events=await db(`bmb_events?auth_user_id=eq.${encodeURIComponent(userId)}&id=eq.${encodeURIComponent(eventID)}&kind=eq.notification&select=facts,outcome&limit=1`,{method:"GET"});
    const ev=events[0];
    if(!ev?.outcome?.transport?.sent||!ev.facts?.followup_id)return null;
    const rows=await db(`bmb_followups?auth_user_id=eq.${encodeURIComponent(userId)}&id=eq.${encodeURIComponent(ev.facts.followup_id)}&status=eq.open&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id,status,question,metric,evidence_ids,created_at&limit=1`,{method:"GET"});
    return rows[0]||null;
  }
  const rows=await followups(userId,db);
  // A question saved before delivery is not an invitation to interrupt every chat.
  if(!rows.length)return null;
  const delivered=await db(`bmb_events?auth_user_id=eq.${encodeURIComponent(userId)}&kind=eq.notification&facts->>followup_id=eq.${encodeURIComponent(rows[0].id)}&select=outcome&limit=1`,{method:"GET"});
  return delivered.some(e=>e.outcome?.transport?.sent)?rows[0]:null;
}
async function dailyReview(a,identity,context,brain,db=supabaseFetch,now=Date.now()) {
  const localDay=day(now,a.settings.timezone);
  // Old deployments keep their existing behavior until the migration is installed.
  let claimed;
  try {const result=await db("rpc/bmb_claim_daily_review",{method:"POST",body:JSON.stringify({p_user:a.auth_user_id,p_day:localDay,p_timezone:a.settings.timezone})});claimed=Array.isArray(result)?result[0]:result;}
  catch(e){if(/404|does not exist|column|relation|PGRST202/.test(e.message))return null;throw e;}
  if(!claimed?.claimed)return null;
  try {
    const {readSource}=require("./bmb-sources");
    const from=new Date(Math.max(now-35*86400000,Date.parse(claimed.cutoff)||0)).toISOString(),sources=[];
    for(const source of ["observations","features","onboarding","wellness","wearables","sessions","events","plan_outcomes","recommendation_feedback","learning_changes","reviews","history"]) {
      for(let offset=0;offset<(source==="observations"?2000:80);offset+=40) {
        const s=await readSource(a.auth_user_id,identity,{source,from,to:null,offset},claimed.cutoff,db);sources.push(s);
        if(s.next_offset===null||s.next_offset===undefined)break;
      }
    }
    const memoryRows=await db(`bm_brain_memories?auth_user_id=eq.${encodeURIComponent(a.auth_user_id)}&value=not.is.null&select=key,value,source_text,source_at&limit=8`,{method:"GET"});
    sources.push({source:"personal_memories",source_id:"personal_memories",available:memoryRows.length>0,rows:memoryRows.map(m=>({...m,id:"memory:"+m.key})),coverage:"current_explicit_memories"});
    const observations=sources.filter(s=>s.source==="observations").flatMap(s=>s.rows||[]);
    const native=nativeDaily(sources.filter(s=>s.source==="features").flatMap(s=>s.rows||[]),a.settings.timezone,claimed.cutoff);
    observations.push(...native);
    sources.push({source:"native_daily",source_id:"native_daily",available:native.length>0,rows:native,coverage:"available_consented_daily_summaries"});
    // The assessment gets a bounded digest. Full account sources remain queryable
    // by the same planner; coverage is never upgraded by summarisation.
    const digest=sources.map(s=>({...s,rows:(s.rows||[]).slice(0,s.source==="observations"||s.source==="native_daily"?200:20).map(r=>{
      if(s.source==="features")return {id:r.id,created_at:r.created_at,period_start:r.period_start,period_end:r.period_end,
        profile:r.payload?.profile,weekly:r.payload?.weekly,correlations:r.payload?.correlations,
        note:"Daily sleep metrics are in native_daily; aggregates do not establish causation."};
      if(s.source==="reviews")return {id:r.id,local_day:r.local_day,summary:r.report?.summary,hypotheses:r.report?.hypotheses,recommendation:r.report?.recommendation};
      return r;
    }),digest_truncated:(s.rows||[]).length>(s.source==="observations"||s.source==="native_daily"?200:20)}));
    const changes=variations(observations,a.settings.timezone,now);
    const selected={kind:"opportunity",priority:45,event_key:`review:${localDay}`,meaning_key:`review:${localDay}`,
      expires_at:new Date(now+24*3600000).toISOString(),facts:{source:"longitudinal_review",local_day:localDay,changes}};
    const {plan}=await brain({prompt:"",context,userId:a.auth_user_id,identity,
      proactive:{selected,can_execute:false,can_notify:false,daily_review:{sources:digest,changes,local_day:localDay,
        instruction:"Review evidence now; notification eligibility is evaluated separately. Silence is valid. Do not execute actions during assessment."}}});
    const report=plan.longitudinal_review;
    if(!report||plan.proactive_action||plan.proactive_decision!=="silent")throw Error("bmb_invalid_daily_assessment");
    const ids=new Set(sources.flatMap(s=>(s.rows||[]).map(r=>String(r.id))));
    if(!report.summary?.trim()||report.summary.length>2000||!Number.isFinite(report.confidence)||report.confidence<0||report.confidence>1
      ||report.evidence_ids.some(id=>!ids.has(id))||report.hypotheses.some(h=>h.evidence_ids.some(id=>!ids.has(id))||h.status==="supported"&&!h.evidence_ids.length)
      ||report.question&&(!report.evidence_ids.length||!Object.hasOwn(METRICS,report.question_metric))
      ||report.recommendation&&(!report.evidence_ids.length||!report.recommendation.summary?.trim()||!Object.hasOwn(METRICS,report.recommendation.success_metric)
        ||!Number.isInteger(report.recommendation.review_after_days)||report.recommendation.review_after_days<1||report.recommendation.review_after_days>14))throw Error("bmb_ungrounded_review");
    const saved=await db("rpc/bmb_finish_daily_review",{method:"POST",body:JSON.stringify({p_user:a.auth_user_id,p_day:localDay,p_token:claimed.token,
      p_report:{...report,sources:sources.map(s=>({source:s.source,available:s.available,coverage:s.coverage,next_offset:s.next_offset,reason:s.reason})),changes}})});
    const committed=Array.isArray(saved)?saved[0]:saved;
    if(!committed?.saved)throw Error("bmb_review_commit_lost");
    return committed;
  }catch(e){await db("rpc/bmb_fail_daily_review",{method:"POST",body:JSON.stringify({p_user:a.auth_user_id,p_day:localDay,p_token:claimed.token})}).catch(()=>{});throw e;}
}
module.exports={METRICS,observationSchema,followupSchema,reviewSchema,validateEffects,day,variations,nativeDaily,followups,greetingContext,dailyReview,reviewOpportunities};
