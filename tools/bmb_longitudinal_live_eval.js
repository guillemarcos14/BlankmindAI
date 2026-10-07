"use strict";
// Real provider, synthetic account/evidence. Never sends a push or mutates cloud.
const fs=require("node:fs"),assert=require("node:assert/strict");
const {plan,generate}=require("../netlify/functions/bmb-brain");
const L=require("../netlify/functions/bmb-longitudinal");
const {readModelJson}=require("../netlify/functions/bm-model-request");
const {settings}=require("../netlify/functions/bmb-policy");
const now=Date.now(),userId="synthetic-longitudinal",identity={anonymous_user_id:"synthetic-link"};
const account={auth_user_id:userId,app_install_id:"synthetic-install",settings:settings({timezone:"UTC"}),version:1};
const f={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",status:"open",question:"Has your routine changed, or is it harder to fall asleep?",metric:"sleep_onset",created_at:new Date().toISOString(),evidence_ids:["sleep-1"]};
let calls=0,tokens=0,observations=[],open=[];
const records=[];
const context=()=>({language:"en",memory:{},has_selected_apps:true,screen_time_authorized:true,
 brain_snapshot:{generated_at:new Date().toISOString(),timezone:"UTC",sessions:[]}});
const db=async(path,opts={})=>{
 if(path.startsWith("bmb_accounts?"))return [account];
 if(path.startsWith("bmb_observations?"))return observations;
 if(path.startsWith("bmb_followups?"))return open;
 if(path==="rpc/bmb_claim_daily_review")return {claimed:true,token:"synthetic-lease",cutoff:null};
 if(path==="rpc/bmb_finish_daily_review")return {saved:true};
 if(path==="rpc/bmb_fail_daily_review")return null;
 return [];
};
const run=input=>generate(input,{model:async options=>{
 if(calls>=12||tokens>=60000)throw Error("evaluation_budget_reached");calls++;
 const r=await readModelJson(options);tokens+=r.body.usage?.total_tokens||0;return r;
}});
const liveBrain=args=>plan(args,{db,memories:[],run});
async function test(name,fn){try{await fn();records.push({name,passed:true});}catch(e){records.push({name,passed:false,error:e.message});}}
async function main(){
 if(!process.argv.includes("--run")||!process.env.OPENAI_API_KEY)throw Error("explicit_live_run_required");
 observations=Array.from({length:32},(_,i)=>({id:`sleep-${i+1}`,metric:"sleep_onset",value_number:i<4?1380:1320,value_text:null,
   unit:"local_minute",source:"user_statement",measurement:"declared",status:"active",measured_at:new Date(now-(i+1)*86400000).toISOString(),timezone:"UTC",evidence:i<4?"23:00":"22:00",confidence:1}));
 await test("four_later_nights_multiple_hypotheses",async()=>{
   let assessment;
   await L.dailyReview(account,identity,context(),async args=>{const r=await liveBrain(args);assessment=r.plan.longitudinal_review;return r;},db);
   assert(assessment.question&&assessment.evidence_ids.length,"Meaningful unexplained change had no question");
   assert(assessment.hypotheses.length>=2,"Uncertainty collapsed to one explanation");
   assert(assessment.hypotheses.filter(h=>/stress|less.*sleep|better.*sleep/i.test(h.explanation)).every(h=>h.status!=="supported"),"Unsupported sleep/stress cause");
 });
 observations=observations.slice(0,1);
 await test("sparse_history_no_invented_pattern",async()=>{
   let assessment;
   await L.dailyReview(account,identity,context(),async args=>{const r=await liveBrain(args);assessment=r.plan.longitudinal_review;return r;},db);
   assert(!assessment.hypotheses.some(h=>h.status==="supported"&&/pattern|trend|later|stress/i.test(h.explanation)),"One night became a trend");
 });
 open=[f];
 await test("answer_multiple_observations",async()=>{
   const r=await liveBrain({prompt:"My work schedule changed. Yesterday I fell asleep at 23:00 and woke at 07:00. My stress is 7 out of 10.",context:context(),userId,identity});
   assert.equal(r.context.brain_memory_effect?.followup_resolution?.id,f.id);
   assert(r.context.brain_memory_effect.observations.length>=2);
   assert(!r.plan.actions.length);
 });
 await test("detour_preserves_pending_question",async()=>{
   const r=await liveBrain({prompt:"Can you explain what Blankmind can do?",context:context(),userId,identity});
   assert(!r.context.brain_memory_effect?.followup_resolution);assert(!r.context.brain_memory_effect?.observations?.length);
 });
 await test("hypothetical_is_not_a_health_fact",async()=>{
   const r=await liveBrain({prompt:"Could stress make someone sleep less, or could they just need less sleep?",context:context(),userId,identity});
   assert(!r.context.brain_memory_effect);assert(!r.plan.actions.length);
 });
 const report={provider_real:true,sources:"synthetic",cloud_mutations:0,notifications_sent:0,native_actions_executed:0,
   model:process.env.OPENAI_MODEL||"gpt-5.6-luna",calls,tokens,passed:records.filter(r=>r.passed).length,total:records.length,records};
 fs.mkdirSync("tmp/bmb",{recursive:true});fs.writeFileSync("tmp/bmb/longitudinal-live-eval.json",JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));if(report.passed!==report.total)process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
