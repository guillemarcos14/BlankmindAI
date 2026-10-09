"use strict";
const assert=require('node:assert/strict'),sources=require('../netlify/functions/bmb-sources'),brain=require('../netlify/functions/bmb-brain');
const uuid='91a27460-0123-4567-89ab-0123456789ab';
const final=()=>({phase:'final',response_language:'en',message_kind:'question',decision:'respond',evidence:'rest',response_text:'A quieter evening may help.',accepted_proposal:null,pending_request:null,action:null,queries:[],memory:null,observations:[],followup_resolution:null,longitudinal_review:null,cited_sources:[]});
const context=()=>({language:'en',memory:{},brain_snapshot:{generated_at:new Date().toISOString(),timezone:'Europe/Madrid',sessions:[]}});
const db=async path=>{if(path.startsWith('bmb_accounts')||path.startsWith('bmb_followups')||path.startsWith('assistant_app_turns'))return [];throw Error(path);};
async function main(){
 const app=require('../netlify/functions/assistant-app'),action={type:'start_protection',minutes:30};
 assert.equal(app.visibleReply({bmb_generated:true,response_language:'en',response_text:'You slept 9 hours. I’m starting a 30-minute block now.',actions:[action]},{},action),"You slept 9 hours. I've prepared a 30-minute block now.");
 assert.equal(app.visibleReply({bmb_generated:true,response_language:'es',response_text:'Dormiste 9 horas. He iniciado un bloqueo de 30 minutos.',actions:[action]},{},action),'Dormiste 9 horas. He preparado un bloqueo de 30 minutos.');
 assert.equal(app.visibleReply({bmb_generated:true,response_language:'es',response_text:'Dormiste 9 horas. Bloqueando tus aplicaciones seleccionadas durante 30 minutos.',actions:[action]},{},action),'Dormiste 9 horas. He preparado el bloqueo de tus aplicaciones seleccionadas durante 30 minutos.');
 assert.equal(app.visibleReply({bmb_generated:true,response_language:'en',response_text:'Blocking your selected apps for 30 minutes.',actions:[action]},{},action),"I've prepared the block for your selected apps for 30 minutes.");
 for(const text of ['No estoy bloqueando tus apps.','I am not blocking your apps.','La protección está preparada.'])assert.equal(app.visibleReply({bmb_generated:true,response_text:text,actions:[action]},{},action),text);
 const factual=require('../netlify/functions/bmb-factual-copy'),sleepRows=[462,517,548].map((n,i)=>({id:'night-'+i,metric:'sleep_duration',unit:'minutes',value_number:n,measured_at:'2026-10-0'+(6+i)+'T08:00:00Z'}));
 const sleepPrompt='Muéstrame mi media de sueño durante los siete días anteriores a hoy.';
 const sleepResult={...final(),response_language:'es',evidence:sleepPrompt,response_text:'8 h 28 min el 6, 8 h 37 min el 7 y 9 h 8 min el 8. Media de 8 h 29 min (509 minutos).'};
 const facts=factual.sleepCopyFacts(sleepPrompt,[{rows:sleepRows}],sleepResult);
 assert.deepEqual(factual.unsupportedDurations(sleepResult.response_text,facts),[508]);
 assert.deepEqual(factual.unsupportedDurations('7 h 42 min el 6, 8 h 37 min el 7 y 9 h 8 min el 8. Media 509 minutos.',facts),[]);
 assert.equal(factual.sleepCopyFacts('Quiero consejos para dormir.',[{rows:sleepRows}],sleepResult),null);
 const sleepDb=async path=>path.startsWith('bmb_observations')?sleepRows:db(path);
 for(const mutation of ['correct','new_action','still_wrong']) {
   let steps=0;
   const job=()=>brain.plan({prompt:sleepPrompt,context:context(),userId:'owner',identity:{}},{db:sleepDb,memories:[],run:async input=>{
     steps++;
     if(steps===1)return {...sleepResult,phase:'read',queries:[{source:'observations',term:'sleep_duration',offset:0}]};
     if(steps===2)return sleepResult;
     assert.equal(input.tool_budget_remaining,0);assert.equal(input.sleep_copy_facts.rows[0].remaining_minutes,42);
     return {...sleepResult,response_text:mutation==='still_wrong'?sleepResult.response_text:'Media 8 h 29 min, con 7 h 42 min el 6.',...(mutation==='new_action'?{action}:{})};
   }});
   if(mutation==='correct'){const value=await job();assert.equal(value.plan.response_text,'Media 8 h 29 min, con 7 h 42 min el 6.');assert.equal(steps,3);assert.deepEqual(value.plan.actions,[]);}
   else await assert.rejects(job,mutation==='new_action'?/factual_repair_changed_authority/:/unsupported_sleep_duration/);
 }
 assert.equal(sources.cleanCitations('Recorded 6 h. ['+uuid+', '+uuid+']'),'Recorded 6 h.');
 assert.equal(sources.cleanCitations('Recorded 6 h. '+uuid),'Recorded 6 h.');
 assert.equal(sources.cleanCitations('Keep ['+uuid+']',{quotedIn:'Repeat ['+uuid+']'}),'Keep ['+uuid+']');
 assert.equal(sources.cleanCitations('Values [Monday, Tuesday].'),'Values [Monday, Tuesday].');
 assert.equal(sources.cleanCitations('Total 402'),'Total 402');
 for(let i=1;i<=uuid.length;i++)assert.equal(sources.cleanCitations('Recorded sleep. '+uuid.slice(0,i),{partial:true}),'Recorded sleep.','UUID prefix leaked at '+i);
 for(let i=1;i<=uuid.length;i++)assert.equal(sources.cleanCitations('Recorded sleep. ['+uuid.slice(0,i),{partial:true}),'Recorded sleep.','bracket prefix leaked at '+i);
 const invalid=[{id:'bad-unit',metric:'sleep_duration',value_number:510,unit:'hours'},{id:'bad-type',metric:'sleep_duration',value_number:'510',unit:'minutes'},{id:'bad-range',metric:'sleep_duration',value_number:1500,unit:'minutes'}];
 const q={source:'observations',offset:0};let pathSeen;
 const queryPeriod=require('../netlify/functions/bmb-query-period'),fixedNow=Date.parse('2026-10-09T12:00:00Z');
 for(const text of ['Muéstrame en minutos mi media de sueño durante los siete días anteriores a hoy.','Show my sleep average for the seven days before today.']){
  const period=queryPeriod.previousDays(text,'Europe/Madrid',fixedNow);
  assert.equal(period.from,'2026-10-01T22:00:00.000Z');assert.equal(period.to,'2026-10-08T22:00:00.000Z');
  assert.equal(queryPeriod.boundQuery(q,period,{message_kind:'question'}).to,period.to);
  for(const source of ['history','protection_statistics'])assert.deepEqual(queryPeriod.boundQuery({...q,source},period,{message_kind:'question'}),{...q,source});
  assert.deepEqual(queryPeriod.boundQuery(q,period,{message_kind:'statement'}),q);
  let stages=0,queried=[],requested;
  const value=await brain.plan({prompt:text,context:context(),userId:'owner',identity:{}},{memories:[],db:async path=>{
   if(!path.startsWith('bmb_observations'))return db(path);
   const bounds=new URLSearchParams(path.split('?')[1]).getAll('measured_at');queried=bounds;
   assert.deepEqual(bounds,['gte.'+requested.from,'lt.'+requested.to]);assert.equal(requested.timezone,'Europe/Madrid');
   return [421,482,543].map((n,i)=>({id:'range-'+i,metric:'sleep_duration',unit:'minutes',value_number:n,measured_at:new Date(Date.parse(bounds.find(v=>v.startsWith('lt.')).slice(3))-(3-i)*86400000+3600000).toISOString()}));
  },run:async input=>{
   if(++stages===1){requested=input.requested_observation_period;return {...final(),evidence:text,message_kind:'question',phase:'read',queries:[{...q,to:'2026-10-08',timezone:'UTC'}]};}
   assert.equal(input.sources.at(-1).rows.length,3);
   return {...final(),evidence:text,message_kind:'question',response_text:'482 minutes across three records.'};
  }});
  assert.equal(stages,2);assert.equal(queried.length,2);assert.equal(value.plan.response_text,'482 minutes across three records.');assert.deepEqual(value.plan.actions,[]);assert.equal(value.context.brain_memory_effect,undefined);
 }
 assert.equal(queryPeriod.previousDays('Translate "my sleep over seven days before today".','UTC',fixedNow),null);
 assert.equal(queryPeriod.previousDays('My sleep this week.','UTC',fixedNow),null);
 assert.equal(queryPeriod.previousDays('Compare my sleep yesterday and seven days before today.','UTC',fixedNow),null);
 for(const [clock,hours]of [['2026-03-30T12:00:00Z',167],['2026-10-26T12:00:00Z',169]]){const p=queryPeriod.previousDays('My sleep seven days before today.','Europe/Madrid',Date.parse(clock));assert.equal((Date.parse(p.to)-Date.parse(p.from))/3600000,hours);}
 await sources.readSource('owner',{}, {...q,timezone:'Europe/Madrid',from:'2026-10-08',to:'2026-10-09'},null,async path=>{pathSeen=path;return [];});
 assert.deepEqual(new URLSearchParams(pathSeen.split('?')[1]).getAll('measured_at'),['gte.2026-10-07T22:00:00.000Z','lt.2026-10-08T22:00:00.000Z']);
 const timestamp='2026-10-07T23:00:00.000Z';
 for(const [tz,date]of [['Europe/Madrid','2026-10-08'],['UTC','2026-10-07']]){
   const dated=await sources.readSource('owner',{}, {...q,timezone:tz},null,async()=>[{id:'local-day',metric:'sleep_duration',value_number:543,unit:'minutes',measured_at:timestamp,timezone:'Europe/Madrid'}]);
   assert.equal(dated.rows[0].local_date,date);assert.equal(dated.rows[0].local_date_timezone,tz);assert.equal(dated.rows[0].measured_at,timestamp);
 }
 for(const [at,date]of [['2026-03-28T23:00:00Z','2026-03-29'],['2026-10-24T22:30:00Z','2026-10-25']]){
   const dated=await sources.readSource('owner',{}, {...q,timezone:'Europe/Madrid'},null,async()=>[{id:'dst',metric:'sleep_duration',value_number:543,unit:'minutes',measured_at:at}]);assert.equal(dated.rows[0].local_date,date);
 }
 const read=await sources.readSource('owner',{},q,null,async path=>{pathSeen=path;return [...invalid,{id:'zero',metric:'sleep_duration',value_number:0,unit:'minutes'},{id:'valid',metric:'sleep_duration',value_number:402,unit:'minutes'},{id:'other',metric:'energy',value_number:5,unit:'score_0_10'}];});
 assert(pathSeen.includes('auth_user_id=eq.owner'));assert.deepEqual(read.rows.map(r=>r.id),['zero','valid','other']);assert.equal(read.rejected_sleep_measurements.length,3);
 const page=await sources.readSource('owner',{},q,null,async()=>Array.from({length:41},(_,i)=>({...invalid[0],id:String(i)})));assert.equal(page.next_offset,40);assert.equal(page.rows.length,0);
 const conflicted=await sources.readSource('owner',{},q,null,async()=>[{id:'a',metric:'sleep_duration',value_number:420,unit:'minutes',measurement:'measured',measured_at:'2026-10-08T08:00:00Z'},{id:'b',metric:'sleep_duration',value_number:123,unit:'minutes',measurement:'measured',measured_at:'2026-10-08T08:00:00Z'}]);assert.equal(conflicted.rows.length,0);assert.equal(conflicted.conflicting_sleep_measurements.length,2);
 let calls=0;const repaired=await brain.plan({prompt:'rest',context:context(),userId:'owner',identity:{}},{db,memories:[],run:async input=>{calls++;if(calls===1)return {...final(),response_text:'',decision:'silent'};assert.equal(input.tool_budget_remaining,0);return final();}});assert.equal(calls,2);assert.equal(repaired.plan.response_text,'A quieter evening may help.');assert.deepEqual(repaired.plan.actions,[]);
 calls=0;await assert.rejects(()=>brain.plan({prompt:'rest',context:context(),userId:'owner',identity:{}},{db,memories:[],run:async()=>++calls===1?{...final(),response_text:'',decision:'silent'}:{...final(),pending_request:'changed'}}),/repair_changed_effects/);
 calls=0;const citationRepair=await brain.plan({prompt:'rest',context:context(),userId:'owner',identity:{}},{db,memories:[],run:async()=>{calls++;return {...final(),response_text:'Recorded sleep: 6 h at 22:30. ['+uuid+']'};}});assert.equal(citationRepair.plan.response_text,'Recorded sleep, 6 h at 22:30.');assert.equal(calls,1);
 calls=0;const colonAfterRepair=await brain.plan({prompt:'rest',context:context(),userId:'owner',identity:{}},{db,memories:[],run:async()=>++calls===1?{...final(),evidence:'missing'}:{...final(),response_text:'It was measured: 470, 525, and 556 minutes; bedtime 22:30.'}});assert.equal(calls,2);assert.equal(colonAfterRepair.plan.response_text,'It was measured, 470, 525, and 556 minutes; bedtime 22:30.');assert.deepEqual(colonAfterRepair.plan.actions,[]);assert.equal(colonAfterRepair.context.brain_memory_effect,undefined);
 let request;await brain.generate({current_message:'rest',mode:'reactive',sources:[{source_id:'current_sleep',rows:[{id:'current_sleep:2026-10-07'}]}],coverage:[{source_id:'snapshot'}]},{model:async x=>{request=x.request;return {body:{status:'completed',output_text:'{}'}};}});assert.deepEqual(request.text.format.schema.properties.cited_sources.items.enum,['snapshot','current_sleep','current_sleep:2026-10-07']);
 await brain.generate({current_message:'rest',mode:'reactive'},{model:async x=>{request=x.request;return {body:{status:'completed',output_text:'{}'}};}});assert(!request.text.format.schema.properties.decision.enum.includes('silent'));
 await brain.generate({current_message:'',mode:'proactive'},{model:async x=>{request=x.request;return {body:{status:'completed',output_text:'{}'}};}});assert(request.text.format.schema.properties.decision.enum.includes('silent'));
 const silent=await brain.plan({prompt:'',proactive:{kind:'daily_review'},context:context(),userId:'owner',identity:{}},{db,memories:[],run:async()=>({...final(),response_text:'',decision:'silent',evidence:''})});assert.equal(silent.plan.proactive_decision,'silent');
 let invalidCalls=0;const retried=await brain.generate({current_message:'rest',mode:'reactive'},{model:async()=>({body:{status:'completed',output_text:++invalidCalls===1?'broken':JSON.stringify(final()),usage:{input_tokens:10,output_tokens:10}}})});assert.equal(invalidCalls,2);assert.equal(retried.response_text,final().response_text);assert.equal(retried.action,null);
 invalidCalls=0;await assert.rejects(()=>brain.generate({current_message:'rest',mode:'reactive'},{model:async()=>{invalidCalls++;return {body:{status:'completed',output_text:'broken'}};}}),/invalid_model_json/);assert.equal(invalidCalls,2);
 invalidCalls=0;await assert.rejects(()=>brain.generate({current_message:'rest',mode:'reactive'},{model:async()=>{invalidCalls++;return {body:{status:'completed',output:[{content:[{type:'refusal',refusal:'Refused'}]}]}};}}),/model_refusal/);assert.equal(invalidCalls,1);
 console.log('PASS quality regressions: final/stream UUIDs, literal quotes, invalid units/zero/pagination, reactive recovery/effect authority, repaired prose and proactive silence');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
