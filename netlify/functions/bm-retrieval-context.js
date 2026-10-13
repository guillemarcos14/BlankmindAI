"use strict";
// Short-lived source provenance, not a personal memory or cached measurement.
const {readSource}=require('./bmb-sources'),{periodBounds}=require('./bm-brain-data');
const TTL=20*60*1000;
const forbidden=/\b(?:block|bloquea|schedule|programa|forget|olvida|delete|borra|compare|compara|advice|consejo|partner|pareja|friend|amig[oa])\b/iu;
function followup(text,state,{now=Date.now(),cutoff=null,timezone}={}){
 const at=Date.parse(state?.created_at),age=now-at;
 if(!state||!['observations','current_sleep'].includes(state.source)||state.metric!=='sleep_duration'||state.timezone!==timezone||!Number.isFinite(age)||age<0||age>TTL||!Number.isInteger(state.remaining)||state.remaining<1||state.remaining>3||cutoff&&at<=Date.parse(cutoff))return false;
 const s=String(text).trim();if(s.length>180||/[«»“”"]/u.test(s)||forbidden.test(s))return false;
 // Only reject/recognize a possible continuation; the model interprets it.
 return /^(?:[¿?\s]*)(?:and\b|y\b|is (?:that|it)\b|was (?:that|it)\b|(?:es|era) (?:eso|ese|este|medido|declarado)\b|now (?:tell|say|give|translate)\b|ahora (?:d[ií]melo|dime|en|trad[uú]ce)|(?:d[ií]melo|tell me) (?:en|in)\b)/iu.test(s);
}
async function preload(state,{userId,identity,timezone,cutoff,currentSleep,db,now=Date.now(),read=readSource}){
 if(currentSleep?.available&&(currentSleep.is_synthetic||state.source==='current_sleep'))return null;
 const week=periodBounds({period:'this_week'},{timezone,week_starts_on:2},now),yesterday=periodBounds({period:'yesterday'},{timezone,week_starts_on:2},now);
 const query={source:'observations',from:new Date(Math.min(week.from,yesterday.from)).toISOString(),to:new Date(week.to).toISOString(),timezone,offset:0,term:''};
 try{return await read(userId,identity,query,cutoff,(p,o)=>db(p,{...o,signal:AbortSignal.timeout(800)}));}catch(_){return null;}
}
function seed(source,timezone,now=Date.now()){
 const rows=source?.rows||[];
 if(!source?.available||!rows.length||!['observations','current_sleep'].includes(source.source_id))return null;
 const sleep=rows.filter(r=>r.metric==='sleep_duration'||source.source_id==='current_sleep');if(!sleep.length)return null;
 return {source:source.source_id,metric:'sleep_duration',timezone,created_at:new Date(now).toISOString(),remaining:3,
  measurement_types:[...new Set(sleep.map(r=>r.measurement||source.measurement).filter(Boolean))].slice(0,4),is_synthetic:source.is_synthetic===true};
}
module.exports={followup,preload,seed,TTL};
