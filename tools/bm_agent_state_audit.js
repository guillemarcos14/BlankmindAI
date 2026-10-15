"use strict";
// Strict checks for the new authored plans. Historical review inputs unchanged.
const {dayOffset}=require('../netlify/functions/bm-brain-data');
const localDay=(date,tz)=>new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(date));
const applied=row=>(row.committed_effect||[]).filter(e=>e.brain_memory_effect&&Number.isFinite(Date.parse(e.brain_memory_applied_at)));
const matches=(value,expected)=>Object.entries(expected).every(([k,v])=>value?.[k]===v);
const tuples=(rows,keys)=>rows.map(r=>JSON.stringify(keys.map(k=>r[k]??null))).sort();
function observations(row,spec,clock){
 if(!spec.expected_observations)return true;
 return spec.expected_observations.every(expected=>applied(row).some(({brain_memory_effect:e})=>(e.observations||[]).some(o=>{
  if(!matches(o,expected)||typeof o.evidence!=='string'||!o.evidence.trim()||!row.synthetic_input?.includes(o.evidence))return false;
  return (row.canonical_observations||[]).some(saved=>{
   if(!matches(saved,expected)||saved.evidence!==o.evidence||saved.source!=='user_statement'||saved.status!=='active')return false;
   if(!['metric','value_number','value_text','unit','measurement'].every(k=>(saved[k]??null)===(o[k]??null)))return false;
   if(spec.observation_date_policy==='previous_local_day'){
    if(!Number.isFinite(Date.parse(clock))||!Number.isFinite(Date.parse(saved.measured_at)))return false;
    try{return localDay(saved.measured_at,o.timezone)===dayOffset(localDay(clock,o.timezone),-1);}catch(_){return false;}
   }
   return true;
  });
 })));
}
function noMemoryEffects(row){
 if(!row.initial_state||!Array.isArray(row.initial_state.memories)||!Array.isArray(row.initial_state.observations)||!Array.isArray(row.committed_effect)||!Array.isArray(row.canonical_memories)||!Array.isArray(row.canonical_observations))return false;
 if(row.committed_effect.some(({brain_memory_effect:e})=>e&&Object.entries(e).some(([,v])=>v!=null&&(!Array.isArray(v)||v.length))))return false;
 const memoryKeys=['key','value'],observationKeys=['metric','value_number','value_text','unit','measurement','evidence','measured_at','source','status'];
 return JSON.stringify(tuples(row.initial_state.memories,memoryKeys))===JSON.stringify(tuples(row.canonical_memories,memoryKeys))&&JSON.stringify(tuples(row.initial_state.observations,observationKeys))===JSON.stringify(tuples(row.canonical_observations,observationKeys));
}
function noEffects(row){return !row.action_id_present&&noMemoryEffects(row);}
function forgetting(row,spec){
 if(!spec.expected_forgetting)return true;
 const f=spec.expected_forgetting;
 if(!applied(row).some(({brain_memory_effect:e})=>e.operation===f.operation&&(e.key??null)===f.key))return false;
 const rows=row.canonical_memories||[];
 if(f.operation==='forget_all')return rows.some(m=>m.value===null)&&rows.every(m=>m.value===null);
 return !rows.some(m=>m.key===f.key&&m.value!=null)&&(spec.initial_memories||[]).filter(m=>m.key!==f.key).every(m=>rows.some(r=>matches(r,m)));
}
function check(row,spec,{clock}={}){return observations(row,spec,clock)&&forgetting(row,spec)&&(!spec.forbid_effects||noEffects(row))&&(!spec.forbid_memory_changes||noMemoryEffects(row));}
module.exports={observations,noEffects,forgetting,check};
