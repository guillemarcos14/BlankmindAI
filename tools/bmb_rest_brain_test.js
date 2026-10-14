"use strict";
const assert=require("node:assert/strict"),membership=require("../netlify/functions/_membership");
const owner="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const nights=Array.from({length:14},(_,i)=>{const end=new Date(Date.now()-(i+1)*86400000);return {id:"watch:"+i,date:end.toISOString().slice(0,10),
 start_at:new Date(end-480*60000).toISOString(),end_at:end.toISOString(),source:"apple_watch",source_bundle:"Watch",manual:false,complete:true,
 sleep_minutes:440,awake_minutes:40,timezone:"UTC"};});
let calls=[],active=null;
membership.supabaseFetch=async(path,options)=>{
 calls.push(path);if(path==="rpc/bmb_rest_global_prior")return {available:false,reason:"global_learning_not_enabled"};
 if(path.startsWith("bmb_rest_nights?")){assert(path.includes("auth_user_id=eq."+owner));return nights;}
 if(path.startsWith("bmb_rest_experiments?"))return active?[active]:[];
 if(path.startsWith("bmb_rest_context?"))return [{snapshot:{health_context:{metrics:[{id:"HKQuantityTypeIdentifierHeartRate",family:"Heart",unit:"bpm",points:[{date:nights[0].date,value:58,count:8,sources:["Watch"]}]}]},checkins:[{date:nights[0].date,score:5}],digital:{available:false,reason:"ineligible_region"}}}];
 if(path.startsWith("bm_brain_memories?"))return [];
 if(path.startsWith("bmb_accounts?")||path.startsWith("bmb_followups?")||path.startsWith("assistant_app_turns?")||path.startsWith("bmb_rest_protection?")||path.startsWith("bmb_observations?"))return [];
 throw Error("Unexpected data source "+path);
};
const B=require("../netlify/functions/bmb-brain"),ctx=()=>({channel:"app",memory:{semantic_store_version:0},has_selected_apps:true,screen_time_authorized:true,
 personal_profile:{rest_snapshot:{schema_version:1}},brain_snapshot:{generated_at:new Date().toISOString(),timezone:"UTC",local_date:new Date().toISOString().slice(0,10)}});
const result=(prompt)=>({phase:"final",response_text:"Let's test this evening window against your measured sleep.",response_language:"en",message_kind:"action_request",decision:"propose",evidence:prompt,
 accepted_proposal:null,pending_request:null,memory:null,queries:[],observations:[],followup_resolution:null,longitudinal_review:null,rest_claim:null,rest_preferences:null,rest_exclusions:null,cited_sources:["rest_evidence"],
 action:{type:"apply_schedule",minutes:null,start_minute:1350,end_minute:420,start_mode:"scheduled",weekdays:[2,3,4,5],duration_days:14,local_date:null,timezone:"UTC",recurrence:"weekly",window_id:null,hours:null,hard_mode:false},
 rest_experiment:{hypothesis:"An earlier distraction boundary may improve sleep continuity",metric:"sleep_continuity",target_minutes:null,reference_minute:null,target_evidence:"",review_after_days:14,evidence_ids:["rest_evidence"]}});
(async()=>{
 const prompt="Protect my evening from 22:30 to 07:00 Monday to Thursday for two weeks.";let observed;
 const proposed=await B.plan({prompt,context:ctx(),userId:owner,identity:{}},{run:async input=>{observed=input;return result(prompt);}});
 assert.equal(proposed.plan.actions.length,0,"Proposal executed without acceptance");
 assert.equal(proposed.plan.bmb_state.proposal.rest_experiment.metric,"sleep_continuity");
 const evidence=observed.sources.find(s=>s.source_id==="rest_evidence");assert.equal(evidence.rows.length,14);assert.equal(evidence.health_catalog[0].unit,"bpm");
 assert.equal(evidence.subjective_context[0].score,5);assert.equal(evidence.digital_coverage.available,false);
 assert(!calls.some(p=>p.includes("bai_global_plan_patterns")||p.includes("bai_user_plan_outcomes")),"Legacy adherence pool reached the brain");
 const acceptedContext=ctx();acceptedContext.memory.conversation_state={bmb_state:{proposal:proposed.plan.bmb_state.proposal}};
 const accepted=await B.plan({prompt:"Yes",context:acceptedContext,userId:owner,identity:{}},{run:async()=>({...result("Yes"),rest_experiment:null,
   message_kind:"acceptance",decision:"execute",accepted_proposal:proposed.plan.bmb_state.proposal.fingerprint})});
 assert.equal(accepted.plan.actions.length,1);assert.equal(accepted.context.brain_memory_effect.rest_experiment.metric,"sleep_continuity");
 assert.equal(accepted.context.brain_memory_effect.rest_experiment.action.start_minute,1350);
 await assert.rejects(()=>B.plan({prompt:"Did it help?",context:ctx(),userId:owner,identity:{}},{run:async()=>({...result("Did it help?"),
   message_kind:"question",decision:"respond",action:null,rest_experiment:null,rest_claim:{experiment_id:"imagined",metric:"sleep_continuity",status:"improved"}})}),/unsupported_efficacy_claim/);
 const preference=await B.plan({prompt:"No weekend blocks",context:ctx(),userId:owner,identity:{}},{run:async()=>({...result("No weekend blocks"),
   message_kind:"statement",decision:"respond",action:null,rest_experiment:null,rest_preferences:{excluded_weekdays:[1,7],evidence:"No weekend blocks"}})});
 assert.deepEqual(preference.context.brain_memory_effect.rest_preferences.excluded_weekdays,[1,7]);assert.equal(preference.plan.actions.length,0);
 const before={...process.env};
 Object.assign(process.env,{BM_AGENT_QA_ENABLED:"true",BM_AGENT_QA_FEATURES:"tools",SUPABASE_URL:require("../netlify/functions/bm-agent-activation").QA,OPENAI_API_KEY:""});
 try {
   const direct=result(prompt),managed={...direct};delete managed.phase;delete managed.queries;
   let request;
   const toolPlan=await B.plan({prompt,context:ctx(),userId:owner,identity:{}},{run:input=>B.generate(input,{model:async payload=>{
     request=payload.request;return {body:{output:[{type:"function_call",name:"gestionar",arguments:JSON.stringify(managed)}]}};
   }})});
   assert(request.tools[1].parameters.required.includes("rest_experiment"));
   assert.equal(toolPlan.plan.bmb_state.proposal.rest_experiment.metric,"sleep_continuity","Two-tool path discarded the rest hypothesis");
   assert.equal(toolPlan.plan.actions.length,0,"Two-tool proposal bypassed acceptance");
 } finally {for(const key of Object.keys(process.env))if(!Object.hasOwn(before,key))delete process.env[key];Object.assign(process.env,before);}
 console.log("Rest brain: actual model input, consented contextual sources, unavailable usage, no legacy pools, durable hypothesis/acceptance, measured claim validation and narrowing preferences passed");
})().catch(e=>{console.error(e);process.exitCode=1;});
