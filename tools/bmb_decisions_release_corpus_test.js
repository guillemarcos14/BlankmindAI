"use strict";
const assert=require('node:assert/strict'),{build}=require('./bmb_decisions_release_corpus'),{evaluateTurn}=require('./bm_semantic_oracle'),{emptyState}=require('../netlify/functions/bm-semantic-state'),{measureConversationCoverage}=require('./bm_conversation_coverage');
const d=build({clock:'2026-10-09T12:00:00.000Z'});assert.equal(d.conversations.length,200);
const {materializeFixture}=require('./bmb_decisions_release_adapter'),{digest}=require('./bm_semantic_oracle');
for(const c of d.conversations){
 const actual=materializeFixture(c.context.bmb_release_fixture),facts=c.turns[0].expect.factual_expectation,source=facts.source_fixture;
 assert.deepEqual(source.sleep_rows,actual.observations.map(r=>({date:new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(r.measured_at)),value_number:r.value_number,unit:r.unit,source:r.source,measurement:r.measurement})),c.id);
 assert.deepEqual(source.protection_sessions,actual.sessions.map(({id,observed_at,...r})=>r),c.id);
 if(c.context.bmb_release_fixture.profile==='missing'&&facts.metric==='sleep_duration'){assert.equal(facts.night_count,0);assert.deepEqual(source.sleep_rows,[]);assert.equal(source.current_sleep.available,false);}
}
// Profile names and recipe defaults cannot manufacture distinct coverage.
const scrub=value=>JSON.parse(JSON.stringify(value,(key,v)=>['profile','clock','interpretation'].includes(key)?undefined:v));
assert.equal(new Set(d.conversations.map(c=>digest(c.turns.map(t=>({input:t.input,expected:scrub(t.expect)}))))).size,200);
const monday=build({clock:'2026-10-12T12:00:00.000Z'});
for(const c of d.conversations)for(const row of require('./bmb_decisions_release_adapter').materializeFixture(c.context.bmb_release_fixture).observations)assert.match(row.id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
assert.equal(monday.conversations.find(c=>c.id==='bmb-sleep_week-measured-es-1').turns[0].expect.factual_expectation.expected_minutes,null);
assert.equal(monday.conversations.find(c=>c.id==='bmb-protection_week-recorded-es-1').turns[0].expect.factual_expectation.expected_minutes,0);
const runs=d.conversations.map(c=>({turns:c.turns.map((t,i)=>({turn:i+1,input:t.input,source:'openai:fixture',status:'unverified',expected:t.expect}))}));
const r={runs,summary:{conversations:200,turns:200,passed:0,failed:0,unverified:200,active_model_turns:200}};assert.equal(measureConversationCoverage(r).unique_conversations,200);
const expected=d.conversations[0].turns[0].expect,body={plan:{semantic_state:emptyState('es'),actions:[],message_text:'9 horas y 3 minutos.'},semantic_decision:{type:'none',slot:null}};
const evaluated=evaluateTurn({expected,body});assert.deepEqual(evaluated.expected.factual_expectation,expected.factual_expectation);assert(!evaluated.issues.some(i=>i.dimension!=='visible_equivalence'));
const wrong=evaluateTurn({expected,body:{...body,plan:{...body.plan,actions:[{type:'start_protection',minutes:30}]}}});assert.equal(wrong.status,'failed');
const wrongFact=evaluateTurn({expected,body:{...body,plan:{...body.plan,message_text:'8 horas y 1 minuto.'}}});assert(wrongFact.issues.some(i=>i.code==='visible_factual_duration_contradiction'));
const missing=d.conversations.find(c=>c.context.bmb_release_fixture.profile==='missing').turns[0].expect;
assert(evaluateTurn({expected:missing,body}).issues.some(i=>i.code==='visible_unknown_fact_duration'));
const week=d.conversations.find(c=>c.id==='bmb-sleep_week-measured-es-1').turns[0].expect;
const checkText=(expect,text)=>evaluateTurn({expected:expect,body:{...body,plan:{...body.plan,message_text:text}}});
assert(!checkText(week,'Media 482 minutos. Noches de 421, 482 y 543 minutos.').issues.some(i=>i.code==='visible_factual_duration_contradiction'));
assert(checkText(week,'Media 482 minutos. Una noche de 500 minutos.').issues.some(i=>i.code==='visible_factual_duration_contradiction'));
assert(!checkText(missing,'No duration is available, not 0 minutes.').issues.some(i=>i.code==='visible_unknown_fact_duration'));
assert(checkText(missing,'Your sleep was 0 minutes.').issues.some(i=>i.code==='visible_unknown_fact_duration'));
const zero=d.conversations.find(c=>c.id==='bmb-protection_week-zero-es-1').turns[0].expect;
assert(!checkText(zero,'0 minutos registrados desde el lunes a las 00:00.').issues.some(i=>i.code==='visible_clock_contradiction'));
assert(checkText(zero,'0 minutos registrados desde las 12:34.').issues.some(i=>i.code==='visible_clock_contradiction'));
assert(checkText(zero,'Not 0 minutes.').issues.some(i=>i.code==='visible_factual_duration_negated'));
assert.notEqual(checkText(week,'Media 482 minutos.').status,'passed','lexical consistency never proves equivalence without a bound independent review');
 const daily=evaluateTurn({expected,body:{...body,plan:{...body.plan,message_text:'9 hours 3 minutes from one daily sleep summary.'}}});assert(!daily.issues.some(i=>i.code==='visible_recurrence_contradiction'));
 const invented=evaluateTurn({expected,body:{...body,plan:{...body.plan,message_text:'Daily blocking is scheduled.'}}});assert(invented.issues.some(i=>i.code==='visible_recurrence_contradiction'));
console.log('PASS BMB corpus: 200 measured unique input/expectation sequences, preserved factual gold for independent judge, unchanged rejection of unexpected actions');
async function verifyV3(){
 const {readSource}=require('../netlify/functions/bmb-sources'),v3=build({clock:'2026-10-09T12:00:00.000Z',version:3});
 for(const c of v3.conversations){
  const fixture=c.context.bmb_release_fixture,{observations,sessions}=materializeFixture(fixture),f=c.turns[0].expect.factual_expectation,src=f.source_fixture;
  for(const row of src.sleep_rows){assert(observations.some(r=>r.measured_at===row.measured_at&&r.value_number===row.value_number));assert.equal(row.date,row.local_date);assert.equal(row.local_date_timezone,'Europe/Madrid');}
  if(f.metric!=='recorded_protection_duration')continue;
  const db=async path=>{assert(path.includes('auth_user_id=eq.owner'));const query=new URLSearchParams(path.split('?')[1]),to=Date.parse(query.get('started_at').slice(3)),from=Date.parse(query.get('or').match(/ended_at\.gte\.([^,]+)/)[1]);return sessions.filter(r=>Date.parse(r.started_at)<to&&Date.parse(r.ended_at)>=from);};
  const actual=await readSource('owner',{}, {source:'protection_statistics',offset:0,timezone:src.timezone,...src.queried_period},null,db),gold=src.returned_protection_statistics;
  for(const key of ['available','protected_seconds','session_count','break_count','partial','metric','saved_time_available'])assert.deepEqual(actual.rows[0][key],gold[key],c.id+':'+key);
  assert.equal(actual.coverage,gold.coverage);
 }
 console.log('PASS V3 gold: actual UTC/local-day fields and all100protection flags/counts compared with the real server read; no provider calls');
}
verifyV3().catch(e=>{console.error(e);process.exitCode=1;});
