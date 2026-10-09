"use strict";
const assert=require("node:assert/strict"),r=require("../netlify/functions/bm-retrieval-step");
const user="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222";
async function main(){
 const env={SUPABASE_URL:"https://vhiikgyyfisejjwqtxfc.supabase.co",OPENAI_API_KEY:"fixture",SUPABASE_SERVICE_ROLE_KEY:"fixture",BM_RETRIEVAL_STEP_ENABLED:"true",BM_DECISIONS_DATA_POLICY:"authenticated-account-records"};
 assert(r.enabled(user,env));assert(r.enabled(other,env));assert(!r.enabled("anonymous",env));
 for(const change of [{BM_RETRIEVAL_STEP_ENABLED:"false"},{BM_DECISIONS_DATA_POLICY:"synthetic-private-qa"},{SUPABASE_URL:"https://untrusted.invalid"},{OPENAI_API_KEY:""}])assert(!r.enabled(user,{...env,...change}));
 let calls=0;const fetcher=async(url,options)=>{calls++;assert.equal(url,"https://api.openai.com/v1/decisions");const payload=JSON.parse(options.body);assert(!options.body.includes(user));return {ok:true,json:async()=>({model:"gpt-6-luna",answers:payload.questions.map(q=>({name:q.name,type:"predicate",probability:["eligible","sleep_yesterday"].includes(q.name)?1:0})),usage:{input_tokens:50,output_tokens:0}})};};
 assert.equal(await r.start(user,"How much sleep did I record yesterday?",{env,fetcher}),"sleep_yesterday");assert.equal(calls,1);
 for(const text of ["Block my apps for 30 minutes now, once.","Hola", "¿Y ayer?", "Translate how much sleep did I record yesterday?", "Compara mi sueño de esta semana con la pasada."]){assert.equal(await r.start(user,text,{env,fetcher}),null);}assert.equal(calls,1);
 assert.equal(await r.start(user,"How much sleep did I record yesterday?",{env:{...env,BM_RETRIEVAL_STEP_ENABLED:"false"},fetcher}),null);assert.equal(calls,1);
 const options={userId:user,identity:{anonymous_user_id:"verified"},timezone:"Europe/Madrid",now:Date.parse("2026-10-09T10:00:00Z"),db:async()=>{throw Error("native source must not read database");},currentSleep:{source_id:"current_sleep",available:true,timezone:"Europe/Madrid",is_synthetic:false,measurement:"native_health_daily_summary",provenance:"Apple Health daily summaries",rows:[{id:"current_sleep:2026-10-05",date:"2026-10-05",sleep_minutes:421},{id:"current_sleep:2026-10-08",date:"2026-10-08",sleep_minutes:487},{id:"current_sleep:2026-10-04",date:"2026-10-04",sleep_minutes:800}]}};
 const yesterday=await r.prepare("sleep_yesterday",options);assert.equal(yesterday.contract.facts.minutes,487);assert.equal(yesterday.contract.facts.is_synthetic,false);
 const week=await r.prepare("sleep_week",options);assert.equal(week.contract.facts.minutes,454);assert.equal(week.contract.facts.measurement_count,2);
 const request=r.proseRequest({retrieval_contract:week.contract,sources:[week.source],current_message:"What is my sleep average this week?",timezone:options.timezone});assert(JSON.stringify(request).includes("Apple Health daily summaries"));assert(!JSON.stringify(request).includes("800"));
 const forgotten=await r.prepare("sleep_week",{...options,cutoff:"2026-10-07T12:00:00Z"});assert.equal(forgotten.contract.facts.minutes,487);
 const simulated=await r.prepare("sleep_yesterday",{...options,currentSleep:{...options.currentSleep,is_synthetic:true,measurement:"synthetic_qa_fixture"}});assert(simulated.contract.facts.is_synthetic);
 assert.equal(await r.prepare("sleep_week",{...options,currentSleep:null,read:async()=>({available:true,source:"observations",rows:[],rejected_sleep_measurements:[{reason:"unsupported_duration_unit"}]})}),null);
 assert.equal(await r.prepare("sleep_week",{...options,currentSleep:{...options.currentSleep,timezone:"UTC"}}),null);
 console.log("PASS production global/off gates, no cohort, rejection-only filter, bounded native sleep, provenance, cutoff and invalid-unit fallback");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
