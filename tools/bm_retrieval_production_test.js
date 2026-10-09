"use strict";
const assert=require("node:assert/strict"),r=require("../netlify/functions/bm-retrieval-step");
const user="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222";
async function main(){
 const env={SUPABASE_URL:"https://vhiikgyyfisejjwqtxfc.supabase.co",OPENAI_API_KEY:"fixture",SUPABASE_SERVICE_ROLE_KEY:"fixture",BM_RETRIEVAL_STEP_ENABLED:"true",BM_DECISIONS_DATA_POLICY:"authenticated-account-records"};
 assert(r.enabled(user,env));assert(r.enabled(other,env));assert(!r.enabled("anonymous",env));
 assert(r.enabled(other,{...env,SUPABASE_URL:'https://njqbovsmoowkhhsqmitn.supabase.co'}));
 for(const text of ['Retrieve my recorded sleep yesterday in minutes.','Consulta cuánto dormí ayer según mis datos, por favor.','¿Cuánta protección registré ayer?'])assert(r.candidate(text));
 for(const text of ['¿Por qué dormí mal ayer?','Consulta cuánto dormí ayer en este ejemplo hipotético.','¿Qué protección tuve ayer en un caso ficticio?'])assert(!r.candidate(text));
 for(const change of [{BM_RETRIEVAL_STEP_ENABLED:"false"},{BM_DECISIONS_DATA_POLICY:"synthetic-private-qa"},{SUPABASE_URL:"https://untrusted.invalid"},{OPENAI_API_KEY:""}])assert(!r.enabled(user,{...env,...change}));
 let calls=0;const fetcher=async(url,options)=>{calls++;assert.equal(url,"https://api.openai.com/v1/decisions");const payload=JSON.parse(options.body);assert(!options.body.includes(user));return {ok:true,json:async()=>({model:"gpt-6-luna",answers:payload.questions.map(q=>({name:q.name,type:"predicate",probability:["eligible","sleep","yesterday"].includes(q.name)?1:0})),usage:{input_tokens:50,output_tokens:0}})};};
 assert.equal(await r.start(user,"How much sleep did I record yesterday?",{env,fetcher}),"sleep_yesterday");assert.equal(calls,1);
 assert.equal(await r.start(other,'Consulta cuánto dormí ayer según mis datos.',{env:{...env,SUPABASE_URL:'https://njqbovsmoowkhhsqmitn.supabase.co'},fetcher}),'sleep_yesterday');assert.equal(calls,2);
 for(const text of ["Block my apps for 30 minutes now, once.","Hola", "¿Y ayer?", "Translate how much sleep did I record yesterday?", "Compara mi sueño de esta semana con la pasada."]){assert.equal(await r.start(user,text,{env,fetcher}),null);}assert.equal(calls,2);
 assert.equal(await r.start(user,"How much sleep did I record yesterday?",{env:{...env,BM_RETRIEVAL_STEP_ENABLED:"false"},fetcher}),null);assert.equal(calls,2);
 const options={userId:user,identity:{anonymous_user_id:"verified"},timezone:"Europe/Madrid",now:Date.parse("2026-10-09T10:00:00Z"),db:async()=>{throw Error("native source must not read database");},currentSleep:{source_id:"current_sleep",available:true,timezone:"Europe/Madrid",is_synthetic:false,measurement:"native_health_daily_summary",provenance:"Apple Health daily summaries",rows:[{id:"current_sleep:2026-10-05",date:"2026-10-05",sleep_minutes:421},{id:"current_sleep:2026-10-08",date:"2026-10-08",sleep_minutes:487},{id:"current_sleep:2026-10-04",date:"2026-10-04",sleep_minutes:800}]}};
 const yesterday=await r.prepare("sleep_yesterday",options);assert.equal(yesterday.contract.facts.minutes,487);assert.equal(yesterday.contract.facts.is_synthetic,false);
 const week=await r.prepare("sleep_week",options);assert.equal(week.contract.facts.minutes,454);assert.equal(week.contract.facts.measurement_count,2);
 const request=r.proseRequest({retrieval_contract:week.contract,sources:[week.source],current_message:"What is my sleep average this week?",timezone:options.timezone});assert(JSON.stringify(request).includes("Apple Health daily summaries"));assert(!JSON.stringify(request).includes("800"));
 const forgotten=await r.prepare("sleep_week",{...options,cutoff:"2026-10-07T12:00:00Z"});assert.equal(forgotten.contract.facts.minutes,487);
 const simulated=await r.prepare("sleep_yesterday",{...options,currentSleep:{...options.currentSleep,is_synthetic:true,measurement:"synthetic_qa_fixture"}});assert(simulated.contract.facts.is_synthetic);
 assert.equal(await r.prepare("sleep_week",{...options,currentSleep:null,read:async()=>({available:true,source:"observations",rows:[],rejected_sleep_measurements:[{reason:"unsupported_duration_unit"}]})}),null);
 assert.equal(await r.prepare("sleep_week",{...options,currentSleep:{...options.currentSleep,timezone:"UTC"}}),null);
 const declaredInput={current_message:'How much measured sleep yesterday?',retrieval_contract:{facts:{measurement_types:['declared']}}};
 for(const response_text of ['Ayer quedaron medidos 8 horas y 5 minutos, según una medición declarada.','You measured 8 hours of sleep according to your declared record.','You slept 8 hours.'])assert.throws(()=>r.expandProse({response_text},declaredInput),/retrieval_invalid_provenance/);
 assert(r.safeFinal(r.expandProse({response_text:'El registro disponible es declarado, con 8 horas y 5 minutos de sueño.'},declaredInput)));
 // Run the actual authenticated planner path with owner-scoped source reads.
 const envBefore={...process.env},fetchBefore=global.fetch,infoBefore=console.info;
 Object.assign(process.env,env,{BM_RETRIEVAL_STEP_QA_ENABLED:"false",BM_DECISIONS_QA_ENABLED:"false",BM_JEV_SHADOW_ENABLED:"false",BM_JEV_PREFETCH_EXPERIMENT:"false"});global.fetch=fetcher;console.info=()=>{};
 try{
  const plan=require('../netlify/functions/bmb-brain').plan,prompt="How much sleep did I record yesterday?";
  const db=async p=>{assert(p.includes(encodeURIComponent(user))||p.startsWith('rpc/'));return p.startsWith('bmb_observations?')?[{id:'owned-sleep',metric:'sleep_duration',unit:'minutes',value_number:487,measurement:'measured'}]:[];};
  const result=await plan({prompt,context:{language:'en',brain_snapshot:{timezone:'Europe/Madrid'}},userId:user,identity:{anonymous_user_id:'verified'}},{db,memories:Promise.resolve([]),run:async input=>{assert(input.retrieval_contract);assert.equal(input.retrieval_contract.facts.minutes,487);return r.expandProse({response_language:'en',response_text:'You recorded 8 hours 7 minutes of sleep yesterday.',cited_sources:['owned-sleep']},input);}});
  assert.deepEqual(result.plan.actions,[]);assert.equal(result.context.brain_memory_effect,undefined);
  // A rejected accelerated reply must restore the full native source and budget.
  const {dayOffset}=require('../netlify/functions/bm-brain-data'),today=new Date().toISOString().slice(0,10);
  const nights=Array.from({length:14},(_,i)=>({date:dayOffset(today,i-14),source:'apple_health',sleep_minutes:400+i}));
  const ctx={language:'en',sleep_data_available:true,personal_profile:{sleep_source:'apple_health',sleep_is_synthetic:false,sleep_nights:nights},brain_snapshot:{generated_at:new Date().toISOString(),timezone:'Europe/Madrid'}};
  let passes=0;await plan({prompt,context:ctx,userId:user,identity:{anonymous_user_id:'verified'}},{db,memories:[],run:async input=>{
    passes++;const native=input.sources.find(s=>s.source_id==='current_sleep');
    if(input.retrieval_contract){assert.equal(native.rows.length,1);return {phase:'read'};}
    assert.equal(native.rows.length,14);assert.equal(native.source,'apple_health');assert.equal(input.tool_budget_remaining,3);
    return r.expandProse({response_language:'en',response_text:'Your recorded sleep yesterday was 6 hours 53 minutes.',cited_sources:['current_sleep']},input);
  }});assert.equal(passes,2);
 }finally{global.fetch=fetchBefore;console.info=infoBefore;for(const k of Object.keys(process.env))if(!(k in envBefore))delete process.env[k];Object.assign(process.env,envBefore);}
 console.log("PASS production global/off gates, no cohort, rejection-only filter, bounded native sleep, provenance, cutoff and invalid-unit fallback");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
