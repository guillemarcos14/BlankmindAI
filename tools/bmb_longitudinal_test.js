"use strict";
const assert=require("node:assert/strict");
const L=require("../netlify/functions/bmb-longitudinal");
const brain=require("../netlify/functions/bmb-brain");
const {settings}=require("../netlify/functions/bmb-policy");
const {tickAccount,opportunities}=require("../netlify/functions/bmb-service");
const now=Date.parse("2026-10-07T12:00:00Z");
const obs=(metric,value,i,extra={})=>({id:`${metric}-${i}`,metric,value_number:value,status:"active",source:"user_statement",measurement:"declared",
 measured_at:new Date(now-i*86400000).toISOString(),timezone:"Europe/Madrid",...extra});
const clockRows=()=>Array.from({length:32},(_,i)=>obs("sleep_onset",i<4?1380:1320,i+1));
const base=()=>({phase:"final",response_text:"Thanks, that helps me understand your routine.",response_language:"en",message_kind:"statement",decision:"respond",evidence:"help",accepted_proposal:null,pending_request:null,action:null,queries:[],memory:null,cited_sources:[],observations:[],followup_resolution:null,longitudinal_review:null});
async function main(){
 assert.equal(L.day(Date.parse("2026-10-06T23:30:00Z"),"Europe/Madrid"),"2026-10-07");
 const change=L.variations(clockRows(),"Europe/Madrid",now);assert.equal(change.length,1);assert.equal(change[0].delta,60);assert.equal(change[0].recent_days,4);
 assert.equal(L.variations(clockRows().slice(0,4),"Europe/Madrid",now).length,0,"Missing baseline became evidence");
 assert.equal(L.variations(clockRows().map(r=>({...r,measurement:"routine_statement"})),"Europe/Madrid",now).length,0,"Habit became repeated measurements");
 assert.equal(L.variations(clockRows().map(r=>({...r,value_number:1320})),"Europe/Madrid",now).length,0);
 const midnight=L.variations(clockRows().map((r,i)=>({...r,value_number:i<4?30:1410})),"Europe/Madrid",now);assert.equal(midnight[0].delta,60);
 const duplicates=clockRows().slice(0,3).flatMap(r=>Array.from({length:15},(_,i)=>({...r,id:r.id+":"+i})));
 assert.equal(L.variations(duplicates,"Europe/Madrid",now).length,0,"Multiple uploads became multiple nights");
 assert.equal(L.variations(clockRows().map((r,i)=>({...r,source:i<4?"native_health":"user_statement"})),"Europe/Madrid",now).length,0,"Different measurements were merged");
 const prompt="Ayer me dormí a las 23:00. Ahora salgo más tarde del trabajo.";
 const observation={metric:"sleep_onset",value_number:1380,value_text:null,unit:"local_minute",measurement:"declared",timezone:"Europe/Madrid",measured_at:null,evidence:"me dormí a las 23:00"};
 assert.equal(L.validateEffects({...base(),observations:[observation]},prompt,false,[],now).observations.length,1);
 assert.throws(()=>L.validateEffects({...base(),message_kind:"question",observations:[observation]},prompt,false,[],now),/ungrounded/);
 assert.throws(()=>L.validateEffects({...base(),observations:[observation]},prompt,true,[],now),/proactive/);
 assert.throws(()=>L.validateEffects({...base(),observations:[{...observation,value_number:1440}]},prompt,false,[],now),/value/);
 assert.throws(()=>L.validateEffects({...base(),observations:[{...observation,evidence:"invented"}]},prompt,false,[],now),/ungrounded/);
 const f={id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",status:"open",question:"Has your work routine changed?",metric:"sleep_onset",created_at:new Date().toISOString(),evidence_ids:["sleep-1"]};
 const resolution={id:f.id,status:"answered",evidence:"Ahora salgo más tarde del trabajo"};
 assert(L.validateEffects({...base(),followup_resolution:resolution},prompt,false,[f],now).followup_resolution);
 assert.throws(()=>L.validateEffects({...base(),followup_resolution:resolution},prompt,false,[],now),/ungrounded/);
 const payload={privacy:{raw_health_samples_sent:false},daily:[{date:"2026-10-05T00:00:00Z",bedtime_local:"23:00",wake_time_local:"07:00",sleep_total_minutes:440}]};
 const native=L.nativeDaily([{id:"old",created_at:"2026-10-06",payload},{id:"new",created_at:"2026-10-07",payload}],"Europe/Madrid");
 assert.equal(native.length,3);assert(native.every(r=>r.id.startsWith("new:")));assert.equal(native.find(r=>r.metric==="sleep_onset").value_number,1380);
 assert.equal(L.nativeDaily([{payload:{common_features:{sleep:440}},id:"aggregate"}],"UTC").length,0,"Averages fabricated exact nights");
 assert.equal(L.nativeDaily([{id:"old",payload}],"UTC","2026-10-06").length,0,"Forgotten health summaries resurfaced");
 // Same generative authority: reactive reply captures multiple observations and resolves a pending question.
 const db=async path=>path.startsWith("bmb_followups?")?[f]:path.startsWith("bmb_accounts?")?[]:[];
 const result=await brain.plan({prompt,context:{memory:{},brain_snapshot:{generated_at:new Date().toISOString(),timezone:"Europe/Madrid"}},userId:"A",identity:{}},
   {db,memories:[],run:async input=>{assert.equal(input.open_followups[0].id,f.id);return {...base(),evidence:"me dormí",observations:[observation],followup_resolution:resolution};}});
 assert.equal(result.context.brain_memory_effect.observations.length,1);assert.equal(result.context.brain_memory_effect.followup_resolution.id,f.id);
 let repairs=0;
 const repaired=await brain.plan({prompt,context:{memory:{}},userId:"A",identity:{}},{db,memories:[],run:async()=>{
   repairs++;return {...base(),evidence:"me dormí",observations:[{...observation,unit:repairs===1?"minutes":"local_minute"}]};
 }});
 assert.equal(repairs,2);assert.equal(repaired.context.brain_memory_effect.observations[0].unit,"local_minute");assert.equal(repaired.plan.actions.length,0);
 repairs=0;
 await assert.rejects(()=>brain.plan({prompt,context:{memory:{}},userId:"A",identity:{}},{db,memories:[],run:async()=>{
   repairs++;return {...base(),evidence:"me dormí",decision:repairs===1?"respond":"execute",action:repairs===1?null:{type:"start_protection",minutes:30},
     observations:[{...observation,unit:"minutes"}]};
 }}),/repair_changed_authority/);
 // Daily review is separate from sending; evidence is owner-scoped and failures release a bounded lease.
 let finished=0,failed=0,reviewCalls=0;
 const report={summary:"A later sleep onset warrants checking the current routine.",confidence:.7,hypotheses:[{explanation:"Routine change",status:"possible",evidence_ids:["row-A"]}],missing_information:["Work schedule"],question:"Has your work routine changed?",question_metric:"sleep_onset",evidence_ids:["row-A"]};
 const reviewDB=async(path,options={})=>{
   if(path==="rpc/bmb_claim_daily_review")return {claimed:true,token:"lease",cutoff:null};
   if(path==="rpc/bmb_finish_daily_review"){finished++;assert.equal(JSON.parse(options.body).p_user,"account-A");return {saved:true};}
   if(path==="rpc/bmb_fail_daily_review"){failed++;return null;}
   if(path.startsWith("bmb_observations?")){assert(path.includes("auth_user_id=eq.account-A"));return [{id:"row-A",...obs("sleep_onset",1380,1)}].map(r=>({...r,id:"row-A"}));}
   return [];
 };
 const a={auth_user_id:"account-A",app_install_id:"install-A",version:1,settings:settings({timezone:"UTC",notifications:{enabled:true,start_minute:0,end_minute:0}})};
 await L.dailyReview(a,{}, {},async args=>{reviewCalls++;assert.equal(args.proactive.can_execute,false);return {plan:{longitudinal_review:report,proactive_decision:"silent"}};},reviewDB,now);
 assert.equal(finished,1);
 await assert.rejects(()=>L.dailyReview(a,{}, {},async()=>({plan:{longitudinal_review:{...report,evidence_ids:["another-account"]},proactive_decision:"silent"}}),reviewDB,now),/ungrounded/);assert.equal(failed,1);
 assert.equal(await L.dailyReview(a,{}, {},async()=>{throw Error("should not call");},async()=>({claimed:false}),now),null);
 // Notification handoff resolves only delivered/open questions from this account.
 const eventID="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
 let sent=true;
 assert.equal((await L.greetingContext("account-A",async path=>{assert(path.includes("auth_user_id=eq.account-A"));return path.startsWith("bmb_events?")?[{facts:{followup_id:f.id},outcome:{transport:{sent}}}]:[f];},eventID)).id,f.id);
 sent=false;assert.equal(await L.greetingContext("account-A",async path=>path.startsWith("bmb_events?")?[{facts:{followup_id:f.id},outcome:{transport:{sent}}}]:[f],eventID),null);
 assert.equal(opportunities([1,2].map(id=>({id,ended_reason:"manual",ended_at:new Date().toISOString()})),[]).length,0,"Obsolete two-exit heuristic survived");
 // A daily followup uses the normal reservation/budget path, with no autonomous action.
 let ledger=[],notices=0,modelCalls=0;
 const context={notification_authorized:true,memory:{},has_selected_apps:true,screen_time_authorized:true};
 const loopDB=async(path,options={})=>{
   const p=options.body?JSON.parse(options.body):{};
   if(path==="rpc/bmb_claim_daily_review")return {claimed:false};
   if(path.startsWith("bmb_followups?"))return [f];
   if(path.startsWith("bmb_daily_reviews?"))return [];
   if(path.startsWith("bmb_accounts?"))return [a];
   if(path.startsWith("bmb_events?"))return ledger;
   if(path.startsWith("bmb_sessions?")||path.startsWith("bmb_device_signals?"))return [];
   if(path==="rpc/bmb_claim_assessment")return true;
   if(path==="rpc/bmb_claim_event"){ledger.push({...p.p_event,id:eventID,created_at:new Date().toISOString(),grant_version:a.version,outcome:{message_text:p.p_event.message_text}});return {claimed:true,id:eventID};}
   if(path==="rpc/bmb_merge_outcome"){Object.assign(ledger[0].outcome,p.p_patch);return null;}
   throw Error(path);
 };
 const deps={db:loopDB,identityLookup:async()=>({app_install_id:a.app_install_id}),getMemory:async()=>({}),getContext:async()=>context,
   brain:async args=>{modelCalls++;assert.equal(args.proactive.can_execute,false);return {plan:{proactive_decision:"ask",message_text:f.question,proactive_action:null}};},
   push:async()=>{throw Error("Unauthorized action");},notify:async()=>{notices++;return {sent:notices>1};}};
 await tickAccount(a,deps);assert.equal(notices,1);assert.equal(ledger.length,1);
 ledger[0].outcome.next_retry_at="2020-01-01";await tickAccount(a,deps);assert.equal(notices,2);assert.equal(modelCalls,1);assert.equal(ledger.length,1);
 await tickAccount(a,deps);assert.equal(notices,2);assert.equal(modelCalls,1,"Accepted delivery or topic repeated");
 const insight={id:"review-A",created_at:new Date().toISOString(),report:{confidence:.8,question:null,evidence_ids:["row-A"],
   recommendation:{kind:"experiment",summary:"Try a shorter evening protection once.",success_metric:"restfulness",review_after_days:4}}};
 assert.equal((await L.reviewOpportunities(a.auth_user_id,"UTC",async()=>[insight])).length,1);
 assert.equal((await L.reviewOpportunities(a.auth_user_id,"UTC",async()=>[{...insight,report:{...insight.report,question:"Need more context"}}])).length,0);
 assert.equal((await L.reviewOpportunities(a.auth_user_id,"UTC",async()=>[{...insight,report:{...insight.report,confidence:.4}}])).length,0);
 ledger=[];
 const insightDB=async(path,options)=>path.startsWith("bmb_daily_reviews?")?[insight]:path.startsWith("bmb_followups?")?[]:loopDB(path,options);
 const outside=await tickAccount(a,{...deps,db:insightDB,brain:async args=>{
   assert.equal(args.proactive.selected.facts.source,"longitudinal_insight");assert.equal(args.proactive.can_execute,false);
   return {plan:{proactive_decision:"execute",proactive_action:{type:"start_protection",minutes:30},message_text:"Trying"}};
 }});
 assert.equal(outside.skipped,"model_action_outside_grant");assert.equal(ledger.length,0,"A recommendation bypassed action permission");
 console.log("PASS longitudinal: personal baselines/midnight, sparse/conflicting data, multiple facts, grounded answers, daily evidence/leases, privacy, contextual notification and retry without actions");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
