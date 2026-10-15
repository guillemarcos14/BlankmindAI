"use strict";
const assert=require('node:assert/strict'),routing=require('../netlify/functions/bm-agent-decisions'),activation=require('../netlify/functions/bm-agent-activation');
const userId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const env={BM_AGENT_QA_ENABLED:'true',BM_AGENT_QA_FEATURES:'retrieval',SUPABASE_URL:activation.QA,OPENAI_API_KEY:'offline-fixture'};
function response(payload,metric,period){return {model:'gpt-6-luna',usage:{input_tokens:20},answers:payload.questions.map(q=>q.type==='predicate'?{name:q.name,type:q.type,probability:q.name==='eligible'||q.name==='metric_'+metric?.99:.01}:{name:q.name,type:q.type,choice:period,probabilities:q.choices.map(c=>({value:c.value,probability:c.value===period?1:0}))})};}
async function main(){
 let calls=0;
 for(const [text,metric,period] of [
  ['¿Cuánto dormí ayer?','sleep_duration','yesterday'],['Dime cuánto dormí ayer','sleep_duration','yesterday'],
  ['¿Cuál es mi media de sueño esta semana?','sleep_duration','this_week'],['What was my average sleep this calendar week?','sleep_duration','this_week'],
  ['¿Cuántas sesiones de protección tengo esta semana?','protection_sessions','this_week'],['How many protection sessions did I record yesterday?','protection_sessions','yesterday'],
  ['¿Cuántas interrupciones de protección tuve ayer?','protection_breaks','yesterday'],['How many protection breaks this week?','protection_breaks','this_week'],
  ['Muéstrame mi protección de ayer','protection_duration','yesterday'],['Show my protected time yesterday','protection_duration','yesterday']]){
  assert(routing.candidate(text),text);
  assert.deepEqual(await routing.start(userId,text,{env,fetcher:async(_,o)=>{calls++;return new Response(JSON.stringify(response(JSON.parse(o.body),metric,period)));}}),{metric,period});
 }
 assert.equal(calls,10);
 for(const text of ['¿Cuánto dormí ayer? Olvida mis datos.','Translate: how much sleep yesterday?','Repeat: how much sleep yesterday?','¿Cuánto durmió mi pareja ayer?','¿Por qué dormí mal ayer?','Block my distractions this week','¿Cuánto dormí anteayer?']){
  assert.equal(await routing.start(userId,text,{env,fetcher:async()=>{throw Error('unrelated_turn_reached_provider');}}),null,text);
  assert.equal(routing.candidate(text),false,text);
 }
 const payload=routing.request('How many protection sessions yesterday?');
 const low=response(payload,'protection_sessions','yesterday');low.answers[0].probability=.89;
 assert.equal(routing.selected(routing.validate(low,payload)),null);
 const ambiguous=response(payload,'protection_sessions','yesterday');ambiguous.answers.find(a=>a.name==='metric_protection_breaks').probability=.9;
 assert.equal(routing.selected(routing.validate(ambiguous,payload)),null);
 for(const language of ['es','en'])for(const metric of ['protection_sessions','protection_breaks']){
  const prepared=await routing.prepare({metric,period:'yesterday'},{userId,identity:{},timezone:'Europe/Madrid',now:Date.parse('2026-10-15T10:00:00Z'),db:async()=>[],read:async(u,i,q)=>{
   assert.equal(u,userId);assert.equal(q.from,'2026-10-13T22:00:00.000Z');assert.equal(q.to,'2026-10-14T22:00:00.000Z');
   return {available:true,coverage:'all_persisted_overlapping_rows',source:'protection_statistics',source_id:'protection_statistics',rows:[{available:true,protected_seconds:0,session_count:0,break_count:0,partial:true}]};}});
  assert.equal(prepared.contract.facts.count,0);
  const input={current_message:language==='es'?'¿Cuántas tuve ayer?':'How many yesterday?',retrieval_contract:prepared.contract};
  const reply=n=>({response_text:language==='es'?`${n} sesiones registradas.`:`${n} recorded sessions.`,response_language:language,cited_sources:['protection_statistics']});
  assert.equal(routing.expandProse(reply('0'),input).action,null);
  for(const wrong of ['10','-0','0.5','0,5'])assert.throws(()=>routing.expandProse(reply(wrong),input),/not_grounded/);
 }
 assert.equal(await routing.prepare({metric:'none',period:'yesterday'},{}),null);
 console.log('PASS retrieval ES/EN: ten supported selections, unrelated-turn bypass, low/ambiguous confidence fallback, dated counts/zero and decimal/sign rejection; mocked provider only');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
