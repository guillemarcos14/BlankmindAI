"use strict";
// Instrument the actual BMB planner. This is a provider replay, not DB/device QA.
const {plan,generate}=require('../netlify/functions/bmb-brain'),{dayOffset,midnight}=require('../netlify/functions/bm-brain-data');
const owner='11111111-1111-4111-8111-111111111111',timezone='Europe/Madrid';
async function traceTurn({prompt,context}){
 const fixture=context.bmb_release_fixture;if(!fixture)throw Error('bmb_fixture_required');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(fixture.clock));
 const dates=[-3,-2,-1].map(offset=>dayOffset(today,offset)),iso=(date)=>new Date(midnight(date,timezone)+3600000).toISOString();
 const observations=['missing'].includes(fixture.profile)?[]:dates.map((date,i)=>({id:'sleep-'+i,metric:'sleep_duration',value_number:fixture.sleep_minutes[i],unit:fixture.profile==='invalid'?'hours':'minutes',measured_at:iso(date),timezone,source:fixture.profile==='declared'?'user_report':'native_health',measurement:fixture.profile==='declared'?'declared':'measured',status:'active',created_at:iso(date)}));
 const sessions=['missing','zero'].includes(fixture.profile)?[]:[{id:'22222222-2222-4222-8222-222222222222',started_at:iso(dates[2]),ended_at:new Date(Date.parse(iso(dates[2]))+75*60000).toISOString(),observed_at:iso(dates[2])},...(fixture.profile==='overlap'?[{id:'33333333-3333-4333-8333-333333333333',started_at:new Date(Date.parse(iso(dates[2]))+30*60000).toISOString(),ended_at:new Date(Date.parse(iso(dates[2]))+90*60000).toISOString(),observed_at:iso(dates[2])}]:[])];
 const db=async path=>{
  if(!path.includes(encodeURIComponent(owner)))throw Error('bmb_fixture_owner_scope');
  const query=new URLSearchParams(path.split('?')[1]),filter=(rows,key)=>rows.filter(row=>{for(const value of query.getAll(key)){const [op,...rest]=value.split('.'),bound=Date.parse(rest.join('.')),at=Date.parse(row[key]);if(op==='gte'&&at<bound||op==='lt'&&at>=bound||op==='gt'&&at<=bound)return false;}return true;});
  if(path.startsWith('bmb_observations?'))return filter(observations,'measured_at');
  if(path.startsWith('bmb_sessions?'))return filter(sessions,'started_at');
  return [];
 };
 const local={...context,language:context.language,brain_snapshot:{generated_at:new Date().toISOString(),timezone,sessions:[]},memory:{conversation_state:{}}};
 if(fixture.profile==='native')Object.assign(local,{sleep_data_available:true,personal_profile:{sleep_source:'apple_health',sleep_is_synthetic:false,sleep_nights:dates.map((date,i)=>({date,source:'apple_health',sleep_minutes:fixture.sleep_minutes[i]}))}});
 let generated=0;const result=await plan({prompt,context:local,userId:owner,identity:{anonymous_user_id:'fixture-account'}},{db,memories:[],run:async input=>{const value=await generate(input);generated++;return value;}});
 if(!generated||result.modelUnavailable)throw Error('bmb_active_provider_required');
 if(result.context.brain_memory_effect)throw Error('bmb_unrequested_fixture_write');
 // BMB's own general/idle state is returned unchanged. A no-action conversation
 // has no legacy operational next-slot decision; unexpected actions still fail.
 return {...result,source:'openai:'+process.env.OPENAI_MODEL+':bmb',semantic_state:result.plan.semantic_state,semantic_decision:{type:result.plan.actions.length?'ready':'none',slot:null},trace:{context:{has_selected_apps:local.has_selected_apps,screen_time_authorized:local.screen_time_authorized,device_execution_ready:local.device_execution_ready},bmb_state:result.plan.bmb_state,proactive_decision:result.plan.proactive_decision,cited_sources:result.plan.cited_sources,final_plan:result.plan,fixture_mode:'isolated_in_memory_account_records'}};
}
module.exports={traceTurn};
