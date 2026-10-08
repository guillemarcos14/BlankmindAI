"use strict";
const assert=require("node:assert/strict");
const membership=require("../netlify/functions/_membership");
membership.supabaseFetch=async()=>[];
const {normalizeUserContext,buildAgentContext}=require("../netlify/functions/bm-context");
const {sleepContext}=require("../netlify/functions/bmb-sleep-context");
const brain=require("../netlify/functions/bmb-brain");
const now=new Date(),today=now.toISOString().slice(0,10);
const nights=Array.from({length:14},(_,i)=>({date:new Date(now.getTime()-(13-i)*86400000).toISOString().slice(0,10),
  source:"synthetic_qa",sleep_minutes:i<7?420:480,deep_minutes:75,rem_minutes:90,
  bedtime_minute:1380,wake_minute:450}));
function context(source="synthetic_qa") {
  return buildAgentContext({channel:"app",user_context:normalizeUserContext({
    sleep_data_available:true,personal_profile:{sleep_source:source,sleep_is_synthetic:source==="synthetic_qa",
      sleep_nights:nights.map(n=>({...n,source}))},brain_snapshot:{schema_version:1,
      generated_at:now.toISOString(),timezone:"Europe/Madrid",local_date:today,sessions:[],history_complete:true,
      account:{signed_in:true,premium_access:true}}}),memory:{semantic_store_version:0}});
}
async function main() {
  for(const source of ["synthetic_qa","apple_health"]) {
    const ctx=context(source);let received;
    const prompt="Compara mi sueño de esta semana con la anterior";
    const result=await brain.plan({prompt,context:ctx,userId:"test",identity:{}},{memories:[],db:async()=>[],run:async input=>{
      received=input.sources.find(s=>s.source_id==="current_sleep");
      return {phase:"final",response_language:"es",message_kind:"question",decision:"respond",evidence:prompt,
        response_text:"Esta semana son 8 horas frente a 7 en la anterior.",accepted_proposal:null,pending_request:null,
        action:null,queries:[],memory:null,observations:[],followup_resolution:null,longitudinal_review:null,
        cited_sources:[received.rows[0].id,"current_sleep"]};
    }});
    assert.equal(received.rows.length,14,"Actual BMB model input lost the dated sleep rows");
    assert.equal(received.source,source);assert.equal(received.is_synthetic,source==="synthetic_qa");
    assert.equal(received.rows.slice(0,7).reduce((sum,r)=>sum+r.sleep_minutes,0)/7,420);
    assert.equal(received.rows.slice(7).reduce((sum,r)=>sum+r.sleep_minutes,0)/7,480);
    assert.equal(result.context.brain_memory_effect,undefined,"Fixture became a user memory");
    assert.deepEqual(result.plan.actions,[]);
  }
  const disabled=context();disabled.sleep_data_available=false;
  assert.equal(sleepContext(disabled).rows.length,0,"Disabled source retained previous nights");
  const stale=context();stale.brain_snapshot.generated_at="2000-01-01T00:00:00Z";
  assert.equal(sleepContext(stale).reason,"stale_device_snapshot");
  const malformed=context();malformed.personal_profile.sleep_nights=[
    {...nights[0],sleep_minutes:2000},{...nights[1],source:"apple_health"},
    {...nights[2],date:"2099-01-01"},nights[3],nights[3]];
  assert.equal(sleepContext(malformed).rows.length,1,"Invalid, mixed or duplicate nights accepted");
  assert.equal(sleepContext(context("unknown")).rows.length,0);
  const reset=context();reset.personal_profile.sleep_is_synthetic=false;
  assert.equal(sleepContext(reset).rows.length,0,"Contradictory provenance accepted");
  assert.match(brain.INSTRUCTIONS,/Do not reject available simulated records as absent/);
  console.log("BMB sleep: actual model input, 14 dated nights, weekly comparison evidence, real/synthetic provenance, disable, stale, mixed/invalid rows and no fixture memory passed");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
