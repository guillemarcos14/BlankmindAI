"use strict";
const {supabaseFetch}=require("./_membership");
const {zone}=require("./bmb-policy");
const {statistics}=require("./bm-brain-data");
// A closed catalog, explicit columns and a server-verified identity. Never accept
// a table, owner or SQL supplied by the model or device.
const CATALOG={
  observations:["bmb_observations","auth_user_id","id,metric,value_number,value_text,unit,measured_at,timezone,source,measurement,evidence,confidence,status,created_at","measured_at",true],
  reviews:["bmb_daily_reviews","auth_user_id","id,local_day,timezone,report,status,created_at","created_at",true],
  followups:["bmb_followups","auth_user_id","id,question,metric,evidence_ids,status,answer_text,created_at,answered_at","created_at",true],
  history:["assistant_app_turns","auth_user_id","id,user_text,assistant_text,action_id,created_at","created_at",true],
  sessions:["bmb_sessions","auth_user_id","id,started_at,ended_at,pause_started_at,pause_ended_at,ended_reason,entry_mode,observed_at","started_at"],
  features:["digital_wellness_feature_payloads","anonymous_user_id","id,payload,insight,period_start,period_end,created_at","created_at",true,true],
  onboarding:["onboarding_responses","anonymous_user_id","id,name,age_range,goal,profile,daily_hours,ai_goal,weak_moment,selected_plan,locale,created_at","created_at",true,true],
  wellness:["wellness_signal_events","anonymous_user_id","id,signal_type,value_number,value_text,measured_at,source","measured_at",true],
  wearable_connections:["wearable_connections","anonymous_user_id","id,provider,status,scopes,last_sync_at,disconnected_at,updated_at","updated_at"],
  wearables:["wearable_feature_snapshots","anonymous_user_id","id,provider,common_features,provider_features,source_confidence,freshness,period_start,period_end,created_at","created_at",true],
  wearable_outcomes:["wearable_recommendation_outcomes","anonymous_user_id","id,provider,signal_type,action_kind,outcome,confidence,metadata,created_at","created_at"],
  plan_outcomes:["bai_user_plan_outcomes","anonymous_user_id","id,pattern_key,recommendation_kind,proposed_value,outcome,outcome_score,metadata,created_at","created_at"],
  recommendation_decisions:["bai_recommendation_decisions","anonymous_user_id","id,final_recommendation,decision_source,reason,confidence,evidence,created_at","created_at"],
  recommendation_feedback:["bai_recommendation_feedback","anonymous_user_id","id,pattern_key,recommendation_kind,feedback_type,user_note,created_at","created_at",true],
  learned_signals:["bai_user_memory_signals","anonymous_user_id","id,signal_type,signal_value,confidence,source,updated_at","updated_at",true],
  learning_changes:["bai_learning_changes","anonymous_user_id","id,scope,change_type,summary,reason,evidence,impact,previous_value,new_value,created_at","created_at",true],
  feedback:["bmb_events","auth_user_id","id,kind,outcome,feedback,created_at","created_at"],
  events:["bmb_events","auth_user_id","id,kind,facts,outcome,created_at","created_at"],
  device_signals:["bmb_device_signals","auth_user_id","id,kind,occurred_at,threshold_minutes","occurred_at"]
};
const SOURCE_NAMES=[...Object.keys(CATALOG),"protection_statistics"];
function sanitize(value,depth=0) {
  if(depth>12)return null;
  if(typeof value==="string")return value.replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,"[credential removed]").slice(0,4000);
  if(Array.isArray(value))return value.slice(0,100).map(v=>sanitize(v,depth+1));
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).filter(([k])=>!/(token|secret|password|credential|authorization|cookie|connect_code|phone_e164|external_account_hash|app_names|applicationTokens|categoryTokens|webDomainTokens)/i.test(k)).map(([k,v])=>[k,sanitize(v,depth+1)]));
  return value;
}
function inventory(identity) {
  return SOURCE_NAMES.map(source=>({source_id:source,owner_scope:CATALOG[source]?.[1]||"auth_user_id",
    access:CATALOG[source]?.[1]==="anonymous_user_id"&&!identity?.anonymous_user_id?"no_verified_account_link":"query_on_demand",
    measurement:source==="protection_statistics"?"recorded_protection_not_phone_usage":null}));
}
async function readSource(userId,identity,q,cutoff,db=supabaseFetch) {
  if(!Number.isInteger(q.offset)||q.offset<0||q.offset>100000)throw Error("bmb_invalid_cursor");
  const enc=encodeURIComponent;
  if(q.source==="protection_statistics") {
    const now=Date.now(),from=q.from?Date.parse(q.from):now-30*86400000,to=q.to?Math.min(Date.parse(q.to),now):now;
    if(!Number.isFinite(from)||!Number.isFinite(to)||from>=to)throw Error("bmb_invalid_query_date");
    const rows=[];let complete=false;
    // Union intervals handles overlaps, overnight sessions and recorded pauses.
    // Bound database work, report a partial result rather than extrapolating it.
    for(let offset=0;offset<10000;offset+=1000) {
      const page=await db(`bmb_sessions?auth_user_id=eq.${enc(userId)}&started_at=lt.${enc(new Date(to).toISOString())}&or=(ended_at.gte.${enc(new Date(from).toISOString())},ended_at.is.null)&select=${CATALOG.sessions[2]}&order=started_at.desc,id.desc&limit=1000&offset=${offset}`,{method:"GET"});
      rows.push(...page);if(page.length<1000){complete=true;break;}
    }
    const observed=rows.map(r=>r.observed_at).filter(Boolean).sort().at(-1)||null;
    const snapshot={sessions:rows,history_complete:complete,history_started_at:rows.map(r=>r.started_at).sort()[0]||null,generated_at:observed};
    const data=complete&&rows.length===0
      ?{available:true,from,to,timezone:zone(q.timezone||"UTC"),protected_seconds:0,session_count:0,break_count:0,partial:true,observed_at:null,metric:"recorded_protection_duration",saved_time_available:false}
      :statistics(snapshot,{from,to,timezone:zone(q.timezone||"UTC")},now);
    delete data.sessions;
    return {source:q.source,source_id:q.source,available:data.available,reason:data.available?null:"no_recorded_history",rows:[{id:"protection_statistics",...data}],coverage:complete?"all_persisted_overlapping_rows":"first_10000_overlapping_rows",next_offset:null};
  }
  const spec=CATALOG[q.source];if(!spec)throw Error("bmb_unknown_source");
  const [table,filter,select,time,personal,consent]=spec;
  const owner=filter==="auth_user_id"?userId:identity?.anonymous_user_id;
  if(!owner)return {source:q.source,source_id:q.source,available:false,reason:"no_verified_account_link"};
  let path=`${table}?${filter}=eq.${enc(owner)}&select=${select}&order=${time}.desc,id.desc&limit=41&offset=${q.offset}`;
  if(personal&&cutoff)path+=`&${time}=gt.${enc(cutoff)}`;
  if(consent)path+="&data_consent=eq.true";
  if(cutoff&&["features","wearables"].includes(q.source))path+=`&period_start=gt.${enc(cutoff)}`;
  if(q.source==="observations")path+="&status=eq.active";
  if(q.source==="reviews")path+="&status=eq.completed";
  if(q.source==="history") {
    path+="&status=eq.completed";
    if(q.term)path+=`&user_text=ilike.${enc("*"+q.term.replace(/[^\p{L}\p{N} ]/gu,"").slice(0,80)+"*")}`;
  }
  if(q.source==="learning_changes")path+="&scope=eq.user";
  for(const [key,op] of [["from","gte"],["to","lt"]])if(q[key]) {
    if(!Number.isFinite(Date.parse(q[key])))throw Error("bmb_invalid_query_date");path+=`&${time}=${op}.${enc(new Date(q[key]).toISOString())}`;
  }
  try {
    const rows=await db(path,{method:"GET"});
    return {source:q.source,source_id:q.source,available:true,rows:sanitize(rows.slice(0,40)),next_offset:rows.length>40?q.offset+40:null,
      coverage:rows.length?"persisted_verified_account_rows":"no_consented_rows_in_range",personalization_after:personal?cutoff||null:null};
  }catch(error){if(/404|does not exist|column|relation/.test(error.message))return {source:q.source,source_id:q.source,available:false,reason:"source_schema_unavailable"};throw error;}
}
module.exports={SOURCE_NAMES,CATALOG,sanitize,inventory,readSource};
