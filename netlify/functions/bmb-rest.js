"use strict";
// Watch evidence owns efficacy. BMB owns hypotheses; the canonical inbox owns actions.
const crypto=require("node:crypto");
const {supabaseFetch}=require("./_membership");
const {zone}=require("./bmb-policy");
const OBJECTIVE="improve_apple_watch_measured_sleep";
const METRICS=["sleep_continuity","sleep_duration_target","sleep_regularity"];
const iso=v=>typeof v==="string"&&Number.isFinite(Date.parse(v));
const date=v=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+"T12:00:00Z"))&&new Date(v+"T12:00:00Z").toISOString().slice(0,10)===v;
const number=(v,lo,hi)=>typeof v==="number"&&Number.isFinite(v)&&v>=lo&&v<=hi;
const median=v=>{const a=v.filter(Number.isFinite).sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:null;};
const localDay=(v,tz)=>new Intl.DateTimeFormat("en-CA",{timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(v));
const weekday=d=>new Date(d+"T12:00:00Z").getUTCDay()+1;
const circle=(a,b)=>((a-b+2160)%1440)-720;
const hash=v=>crypto.createHash("sha256").update(JSON.stringify(v)).digest("hex");
function normalizeSnapshot(input,now=Date.now()) {
  if(!input||input.schema_version!==1||!iso(input.observed_at)||Date.parse(input.observed_at)>now+30000
    ||Date.parse(input.observed_at)<now-24*3600000)throw Error("rest_stale_snapshot");
  let timezone;try{if(typeof input.timezone!=="string")throw Error();timezone=zone(input.timezone);}catch(_){throw Error("rest_invalid_timezone");}
  if(!Array.isArray(input.nights)||input.nights.length>35)throw Error("rest_invalid_nights");
  const seen=new Set(),today=localDay(now,timezone);
  const nights=input.nights.map(n=>{
    if(!date(n.date)||n.date>today||seen.has(n.date)||!iso(n.start_at)||!iso(n.end_at)
      ||Date.parse(n.end_at)>now||Date.parse(n.start_at)>=Date.parse(n.end_at)
      ||localDay(n.end_at,timezone)!==n.date||!number(n.sleep_minutes,1,1200)
      ||n.sleep_minutes>(Date.parse(n.end_at)-Date.parse(n.start_at))/60000+1
      ||typeof n.source_bundle!=="string"||n.source_bundle.length>160
      ||!["apple_watch","apple_health","synthetic"].includes(n.source)
      ||typeof n.manual!=="boolean"||typeof n.complete!=="boolean")throw Error("rest_invalid_night");
    seen.add(n.date);
    const row={date:n.date,start_at:n.start_at,end_at:n.end_at,sleep_minutes:n.sleep_minutes,
      source:n.source,source_bundle:n.source_bundle,manual:n.manual,complete:n.complete,timezone};
    for(const key of ["awake_minutes","rem_minutes","deep_minutes","core_minutes","in_bed_minutes"]){
      if(n[key]!=null){if(!number(n[key],0,1440))throw Error("rest_invalid_night_unit");row[key]=n[key];}
    }
    if(row.awake_minutes!=null&&row.sleep_minutes+row.awake_minutes>(Date.parse(n.end_at)-Date.parse(n.start_at))/60000+2)throw Error("rest_invalid_coverage");
    if(["rem_minutes","deep_minutes","core_minutes"].reduce((sum,k)=>sum+(row[k]||0),0)>row.sleep_minutes+2)throw Error("rest_invalid_stages");
    return row;
  });
  const checkins=(input.checkins||[]).map(r=>{
    if(!date(r.date)||r.date>today||!Number.isInteger(r.score)||r.score<1||r.score>5)throw Error("rest_invalid_checkin");
    return {date:r.date,score:r.score,unit:"score_1_5",source:"user_checkin",role:"acceptability_context_only"};
  });
  if(checkins.length>35)throw Error("rest_invalid_checkins");
  const health=input.health_context;
  if(health!=null&&(typeof health!=="object"||Array.isArray(health)||JSON.stringify(health).length>1500000))throw Error("rest_invalid_health_context");
  const intervals=input.protection_intervals||[];
  if(!Array.isArray(intervals)||intervals.length>140||intervals.some(r=>!/^[-\da-f]{36}$/i.test(r.id)||!/^[-\da-f]{36}$/i.test(r.window_id)
    ||r.source!=="native_schedule_shield"||!iso(r.started_at)||Date.parse(r.started_at)>now
    ||r.ended_at!=null&&(!iso(r.ended_at)||Date.parse(r.ended_at)>now||Date.parse(r.ended_at)<Date.parse(r.started_at))))throw Error("rest_invalid_protection_intervals");
  const digital=normalizeDigital(input.digital,timezone,now);
  const schedule=input.schedule||{enabled:false,windows:[]};
  if(typeof schedule.enabled!=="boolean"||!Array.isArray(schedule.windows)||schedule.windows.length>20)throw Error("rest_invalid_schedule_snapshot");
  const phoneContext=input.phone_context||[];
  if(!Array.isArray(phoneContext)||phoneContext.length>60||phoneContext.some(r=>r.source!=="user_selection"||!iso(r.occurred_at)
    ||Date.parse(r.occurred_at)>now||!["bored","anxious","tired","neededApp","procrastinating","other"].includes(r.reason)))throw Error("rest_invalid_phone_context");
  return {schema_version:1,objective:OBJECTIVE,observed_at:input.observed_at,timezone,nights,checkins,phone_context:phoneContext,
    health_context:health||null,schedule,protection_intervals:intervals.map(r=>({id:r.id,window_id:r.window_id,started_at:r.started_at,ended_at:r.ended_at||null,source:r.source,plan:r.plan||{},uncertain:r.uncertain===true})),digital};
}
function normalizeDigital(value,timezone,now=Date.now()) {
  if(!value||value.available!==true)return {available:false,reason:String(value?.reason||"usage_access_unavailable").slice(0,120),rows:[]};
  if(value.source!=="apple_activity_data"||!iso(value.observed_at)||Date.parse(value.observed_at)<now-24*3600000
    ||Date.parse(value.observed_at)>now+30000||!Array.isArray(value.rows)||value.rows.length>840)throw Error("rest_invalid_digital_source");
  const seen=new Set();
  const rows=value.rows.map(r=>{
    if(!iso(r.start_at)||!iso(r.end_at)||Date.parse(r.end_at)>now||Date.parse(r.end_at)<=Date.parse(r.start_at)
      ||!number(r.usage_minutes,0,(Date.parse(r.end_at)-Date.parse(r.start_at))/60000+1)
      ||!Number.isInteger(r.pickups)||r.pickups<0||r.pickups>10000||seen.has(r.start_at))throw Error("rest_invalid_digital_record");
    seen.add(r.start_at);return {start_at:r.start_at,end_at:r.end_at,usage_minutes:r.usage_minutes,pickups:r.pickups,source:"apple_activity_data",timezone};
  });
  return {available:true,source:value.source,observed_at:value.observed_at,rows};
}
function measured(n){return n.source==="apple_watch"&&n.manual===false&&n.complete===true;}
function metricValue(n,metric,target,reference) {
  if(!measured(n))return null;
  if(metric==="sleep_continuity"){
    const span=(Date.parse(n.end_at)-Date.parse(n.start_at))/60000;
    // Unknown gaps remain in the denominator; missing awake records are not zero.
    return number(n.awake_minutes,0,1440)&&span>=n.sleep_minutes?100*n.sleep_minutes/span:null;
  }
  if(metric==="sleep_duration_target")return number(target,180,720)?-Math.abs(n.sleep_minutes-target):null;
  if(metric==="sleep_regularity"){
    if(!number(reference,0,1439))return null;
    const p=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:n.timezone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(n.start_at)).map(x=>[x.type,x.value]));
    return -Math.abs(circle(+p.hour*60 + +p.minute,reference));
  }
  return null;
}
function digitalSleepLinks(nights,digital) {
  if(digital?.available!==true)return {available:false,reason:digital?.reason||"usage_access_unavailable",rows:[]};
  const rows=[];
  for(const n of nights.filter(measured)){
    const onset=Date.parse(n.start_at);
    const bins=digital.rows.filter(r=>Date.parse(r.end_at)<=onset&&Date.parse(r.end_at)>onset-2*3600000
      &&Date.parse(r.start_at)>=onset-2*3600000).sort((a,b)=>Date.parse(b.end_at)-Date.parse(a.end_at));
    const bin=bins[0];if(!bin)continue;
    rows.push({night_id:n.id||n.date,date:n.date,watch_sleep_minutes:n.sleep_minutes,watch_awake_minutes:n.awake_minutes??null,
      usage_start_at:bin.start_at,usage_end_at:bin.end_at,phone_usage_minutes:bin.usage_minutes,pickups:bin.pickups,
      meaning:"Last complete measured phone-usage bin before the measured sleep episode. Its exact times are supplied; not exact usage in the final pre-sleep minutes.",causal:false});
  }
  return {available:rows.length>0,rows,coverage:"Matched source-tagged device bins and Watch nights; association only. Missing bins are unknown."};
}
function normalizeHypothesis(value) {
  if(!value)return null;
  if(!METRICS.includes(value.metric)||typeof value.hypothesis!=="string"||!value.hypothesis.trim()||value.hypothesis.length>600
    ||!Number.isInteger(value.review_after_days)||value.review_after_days<7||value.review_after_days>14
    ||!Array.isArray(value.evidence_ids)||value.evidence_ids.length>12||!value.evidence_ids.length)throw Error("rest_invalid_hypothesis");
  if(value.metric==="sleep_duration_target"&&!number(value.target_minutes,180,720))throw Error("rest_missing_explicit_duration_target");
  if(value.metric==="sleep_regularity"&&!number(value.reference_minute,0,1439))throw Error("rest_missing_explicit_sleep_time");
  return {hypothesis:value.hypothesis.trim(),metric:value.metric,review_after_days:value.review_after_days,
    target_minutes:value.metric==="sleep_duration_target"?value.target_minutes:null,
    reference_minute:value.metric==="sleep_regularity"?value.reference_minute:null,target_evidence:value.target_evidence||"",evidence_ids:value.evidence_ids};
}
function targetGrounded(hypothesis,declarations) {
  const text=hypothesis.target_evidence;
  if(!text?.trim()||!declarations.some(d=>d.includes(text)))return false;
  if(hypothesis.metric==="sleep_duration_target"){
    const m=/\b(\d+(?:[.,]\d+)?)\s*(?:hours?|horas?|h)\b/i.exec(text);
    const mins=/\b(\d+)\s*(?:minutes?|minutos?|min)\b/i.exec(text);
    return !!(m||mins)&&Math.round((m?Number(m[1].replace(",","."))*60:0)+(mins?+mins[1]:0))===hypothesis.target_minutes;
  }
  const m=/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i.exec(text)||/\b(\d{1,2})()\s*(am|pm)\b/i.exec(text);
  if(!m)return false;
  const hour=m[3]?(+m[1]%12)+(m[3].toLowerCase()==="pm"?12:0):+m[1];
  return hour<24&&+(m[2]||0)<60&&hour*60 + +(m[2]||0)===hypothesis.reference_minute;
}
function evaluate(experiment,nights,{now=Date.now(),protection=[]}={}) {
  const empty={status:"awaiting",objective:OBJECTIVE,metric:experiment.metric,baseline_count:0,intervention_count:0,
    measured_improvement:false,causal:false,reason:"awaiting_verified_execution",evidence_ids:[]};
  if(experiment.status!=="active"||!iso(experiment.verified_at))return empty;
  const excluded=new Set(experiment.excluded_dates||[]),days=experiment.action.weekdays||[];
  const baseline=(experiment.baseline||[]).filter(n=>measured(n)&&!excluded.has(n.date));
  const baselineKeys=new Set(baseline.map(n=>n.date));
  const window=experiment.action.window_id||String(experiment.action_id||"").slice(4);
  const intervention=nights.filter(n=>measured(n)&&Date.parse(n.start_at)>=Date.parse(experiment.verified_at)
    &&!baselineKeys.has(n.date)&&!excluded.has(n.date)&&days.includes(weekday(localDay(n.start_at,n.timezone))));
  const pairs=[];
  for(const night of intervention){
    const execution=protection.find(p=>p.window_id.toLowerCase()===window.toLowerCase()&&p.source==="native_schedule_shield"&&p.uncertain!==true&&iso(p.ended_at)
      &&p.plan?.start_minute===experiment.action.start_minute&&p.plan?.end_minute===experiment.action.end_minute
      &&p.plan?.timezone===experiment.action.timezone&&JSON.stringify([...(p.plan?.weekdays||[])].sort())===JSON.stringify([...days].sort())
      &&Date.parse(p.started_at)<=Date.parse(night.start_at)-5*60000&&Date.parse(p.ended_at)>=Date.parse(night.start_at));
    if(!execution)continue;
    const value=metricValue(night,experiment.metric,experiment.target_minutes,experiment.reference_minute);
    const comparable=baseline.filter(n=>n.source_bundle===night.source_bundle&&n.timezone===night.timezone
      &&weekday(localDay(n.start_at,n.timezone))===weekday(localDay(night.start_at,night.timezone)))
      .map(n=>({n,value:metricValue(n,experiment.metric,experiment.target_minutes,experiment.reference_minute)})).filter(n=>n.value!=null);
    if(value!=null&&comparable.length>=2)pairs.push({night,reference:median(comparable.map(n=>n.value)),value,
      duration_delta:night.sleep_minutes-median(comparable.map(n=>n.n.sleep_minutes)),baseline_ids:comparable.map(n=>n.n.id||n.n.date),execution_id:execution.id});
  }
  const result={...empty,baseline_count:baseline.length,intervention_count:pairs.length,reason:"insufficient_comparable_watch_nights",
    excluded_dates:[...excluded],evidence_ids:[...new Set(pairs.flatMap(p=>[p.night.id||p.night.date,p.execution_id,...p.baseline_ids]))]};
  if(now<Date.parse(experiment.verified_at)+experiment.review_after_days*86400000)return {...result,reason:"experiment_still_running"};
  if(pairs.length<7)return {...result,status:"inconclusive"};
  const deltas=pairs.map(p=>p.value-p.reference),delta=median(deltas),durationDelta=median(pairs.map(p=>p.duration_delta));
  // Product decision thresholds, not a validated clinical score or significance test.
  const threshold=experiment.metric==="sleep_continuity"?2:15;
  const positive=deltas.filter(d=>d>=threshold).length/pairs.length,negative=deltas.filter(d=>d<=-threshold).length/pairs.length;
  const status=durationDelta < -30?"worse":delta>=threshold&&positive>=.7?"improved":delta<=-threshold&&negative>=.7?"worse":"unchanged";
  return {...result,status,reason:status==="worse"&&durationDelta < -30?"sleep_duration_regression":"watch_comparison_completed",
    baseline_value:median(pairs.map(p=>p.reference)),intervention_value:median(pairs.map(p=>p.value)),delta,
    unit:experiment.metric==="sleep_continuity"?"percentage_points":"minutes",sleep_duration_delta_minutes:durationDelta,
    measured_improvement:status==="improved",reviewed_at:new Date(now).toISOString(),threshold,consistent_fraction:Math.max(positive,negative)};
}
async function sync(userId,install,snapshot,db=supabaseFetch) {
  const normalized=normalizeSnapshot(snapshot);
  return db("rpc/bmb_sync_rest",{method:"POST",body:JSON.stringify({p_user:userId,p_install:install,p_snapshot:normalized})});
}
async function context(userId,db=supabaseFetch) {
  const [nights,experiments,prior,snapshots,protection,confounders]=await Promise.all([
    db(`bmb_rest_nights?auth_user_id=eq.${encodeURIComponent(userId)}&select=*&order=date.desc&limit=90`,{method:"GET"}),
    db(`bmb_rest_experiments?auth_user_id=eq.${encodeURIComponent(userId)}&status=in.(awaiting_execution,active,completed)&select=*&order=created_at.desc&limit=5`,{method:"GET"}),
    db("rpc/bmb_rest_global_prior",{method:"POST",body:JSON.stringify({p_user:userId})}),
    db(`bmb_rest_context?auth_user_id=eq.${encodeURIComponent(userId)}&select=snapshot,observed_at&limit=1`,{method:"GET"}),
    db(`bmb_rest_protection?auth_user_id=eq.${encodeURIComponent(userId)}&select=*&order=started_at.desc&limit=140`,{method:"GET"}),
    db(`bmb_observations?auth_user_id=eq.${encodeURIComponent(userId)}&status=eq.active&measurement=eq.declared&metric=in.(illness,travel)&select=id,metric,measured_at,timezone,source&order=measured_at.desc&limit=70`,{method:"GET"})]);
  const active=experiments.find(e=>["awaiting_execution","active"].includes(e.status))||null,snapshot=snapshots[0]?.snapshot;
  if(active){
    const exclusions=new Set(active.excluded_dates||[]);
    for(const row of confounders.filter(r=>r.source==="user_statement"&&iso(r.measured_at))){
      const d=localDay(row.measured_at,row.timezone||snapshot?.timezone||"UTC");
      exclusions.add(d);exclusions.add(new Date(Date.parse(d+"T12:00:00Z")+86400000).toISOString().slice(0,10));
    }
    active.excluded_dates=[...exclusions];
  }
  return {source_id:"rest_evidence",objective:OBJECTIVE,available:nights.some(measured),rows:nights,
    experiment:active,evaluation:active?evaluate(active,nights,{protection}):null,latest_outcome:experiments.find(e=>e.status==="completed")||null,global_prior:prior,
    health_catalog:(snapshot?.health_context?.metrics||[]).map(m=>({id:m.id,family:m.family,unit:m.unit,coverage:m.points?.length||0,latest:m.points?.at(-1),note:m.note})),
    health_traits:snapshot?.health_context?.traits||[],subjective_context:snapshot?.checkins||[],phone_context:snapshot?.phone_context||[],
    digital_coverage:snapshot?.digital?.available===true?{available:true,rows:snapshot.digital.rows.length,observed_at:snapshot.digital.observed_at}:snapshot?.digital||{available:false,reason:"usage_access_unavailable"},
    digital_sleep_links:digitalSleepLinks(nights,snapshot?.digital),
    quality_definition:"A measured comparison of the experiment's fixed Watch sleep metric, not a universal sleep-quality score."};
}
async function readContext(userId,q,db=supabaseFetch) {
  const rows=await db(`bmb_rest_context?auth_user_id=eq.${encodeURIComponent(userId)}&select=snapshot,observed_at&limit=1`,{method:"GET"});
  const snapshot=rows[0]?.snapshot;
  if(!snapshot)return {source_id:q.source,available:false,reason:"rest_snapshot_unavailable",rows:[]};
  let values=q.source==="health_context"?[...(snapshot.health_context?.metrics||[]),...(snapshot.health_context?.traits||[])]:snapshot.digital?.rows||[];
  if(q.term)values=values.filter(r=>JSON.stringify([r.id,r.family,r.title]).toLowerCase().includes(q.term.toLowerCase()));
  if(q.source==="digital_usage")values=values.filter(r=>(!q.from||Date.parse(r.end_at)>Date.parse(q.from))&&(!q.to||Date.parse(r.start_at)<Date.parse(q.to)));
  return {source_id:q.source,available:q.source==="digital_usage"?snapshot.digital?.available===true:!!snapshot.health_context,
    reason:q.source==="digital_usage"?snapshot.digital?.reason:null,observed_at:rows[0].observed_at,
    rows:values.slice(q.offset,q.offset+40),next_offset:values.length>q.offset+40?q.offset+40:null,
    coverage:"Consented summaries; dates, source, unit and coverage retained. Protection is not usage."};
}
async function receipt(userId,actionId,status,evidence,db=supabaseFetch) {
  return db("rpc/bmb_rest_execution",{method:"POST",body:JSON.stringify({p_user:userId,p_action_id:actionId,p_status:status,p_evidence:evidence})});
}
async function assess(userId,db=supabaseFetch) {
  const evidence=await context(userId,db),experiment=evidence.experiment;
  if(!experiment)return null;
  const result=evidence.evaluation;
  if(["improved","worse","unchanged"].includes(result.status)){
    await db("rpc/bmb_finish_rest_experiment",{method:"POST",body:JSON.stringify({p_user:userId,p_id:experiment.id,p_evaluation:result})});
  }
  return {experiment,result};
}
function adjustment(experiment,policy,context) {
  if(!policy.rest?.adjustments_enabled||!experiment?.evaluation||experiment.evaluation.status==="improved")return null;
  const id=experiment.action.window_id||experiment.action_id?.slice(4),window=context.schedule?.windows?.find(w=>w.id?.toLowerCase()===id?.toLowerCase());
  if(!window||window.starts_at||!window.enabled)return null;
  if(window.start_minute!==experiment.action.start_minute||window.end_minute!==experiment.action.end_minute
    ||JSON.stringify([...(window.weekdays||[])].sort())!==JSON.stringify([...(experiment.action.weekdays||[])].sort()))return null;
  const max=policy.rest.max_shift_minutes;
  // One bounded schedule variable. Worsening moves back toward less intervention;
  // no effect tries a slightly earlier start. The next result must be measured.
  const shift=experiment.evaluation.status==="worse"?max:-max;
  const action={...experiment.action,type:"update_schedule",window_id:window.id,start_minute:(window.start_minute+shift+1440)%1440,
    end_minute:window.end_minute,weekdays:window.weekdays,timezone:window.timezone||policy.timezone,
    recurrence:window.recurrence||"continuous",duration_days:window.recurrence==="weekly"?Math.max(1,Math.ceil((window.expires_at*1000-Date.now())/86400000)):null,
    start_mode:"scheduled",hard_mode:false};
  return require("./bmb-policy").actionGate(action,policy,context).allowed?action:null;
}
module.exports={OBJECTIVE,METRICS,normalizeSnapshot,normalizeDigital,normalizeHypothesis,targetGrounded,digitalSleepLinks,measured,metricValue,evaluate,sync,context,readContext,receipt,assess,adjustment,hash,localDay,weekday};
