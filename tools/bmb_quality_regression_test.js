"use strict";
const assert=require('node:assert/strict'),sources=require('../netlify/functions/bmb-sources'),brain=require('../netlify/functions/bmb-brain');
const uuid='91a27460-0123-4567-89ab-0123456789ab';
const final=()=>({phase:'final',response_language:'en',message_kind:'question',decision:'respond',evidence:'rest',response_text:'A quieter evening may help.',accepted_proposal:null,pending_request:null,action:null,queries:[],memory:null,observations:[],followup_resolution:null,longitudinal_review:null,cited_sources:[]});
const context=()=>({language:'en',memory:{},brain_snapshot:{generated_at:new Date().toISOString(),timezone:'Europe/Madrid',sessions:[]}});
const db=async path=>{if(path.startsWith('bmb_accounts')||path.startsWith('bmb_followups')||path.startsWith('assistant_app_turns'))return [];throw Error(path);};
async function main(){
 assert.equal(sources.cleanCitations('Recorded 6 h. ['+uuid+', '+uuid+']'),'Recorded 6 h.');
 assert.equal(sources.cleanCitations('Recorded 6 h. '+uuid),'Recorded 6 h.');
 assert.equal(sources.cleanCitations('Keep ['+uuid+']',{quotedIn:'Repeat ['+uuid+']'}),'Keep ['+uuid+']');
 assert.equal(sources.cleanCitations('Values [Monday, Tuesday].'),'Values [Monday, Tuesday].');
 assert.equal(sources.cleanCitations('Total 402'),'Total 402');
 for(let i=1;i<=uuid.length;i++)assert.equal(sources.cleanCitations('Recorded sleep. '+uuid.slice(0,i),{partial:true}),'Recorded sleep.','UUID prefix leaked at '+i);
 for(let i=1;i<=uuid.length;i++)assert.equal(sources.cleanCitations('Recorded sleep. ['+uuid.slice(0,i),{partial:true}),'Recorded sleep.','bracket prefix leaked at '+i);
 const invalid=[{id:'bad-unit',metric:'sleep_duration',value_number:510,unit:'hours'},{id:'bad-type',metric:'sleep_duration',value_number:'510',unit:'minutes'},{id:'bad-range',metric:'sleep_duration',value_number:1500,unit:'minutes'}];
 const q={source:'observations',offset:0};let pathSeen;
 const read=await sources.readSource('owner',{},q,null,async path=>{pathSeen=path;return [...invalid,{id:'zero',metric:'sleep_duration',value_number:0,unit:'minutes'},{id:'valid',metric:'sleep_duration',value_number:402,unit:'minutes'},{id:'other',metric:'energy',value_number:5,unit:'score_0_10'}];});
 assert(pathSeen.includes('auth_user_id=eq.owner'));assert.deepEqual(read.rows.map(r=>r.id),['zero','valid','other']);assert.equal(read.rejected_sleep_measurements.length,3);
 const page=await sources.readSource('owner',{},q,null,async()=>Array.from({length:41},(_,i)=>({...invalid[0],id:String(i)})));assert.equal(page.next_offset,40);assert.equal(page.rows.length,0);
 let calls=0;const repaired=await brain.plan({prompt:'rest',context:context(),userId:'owner',identity:{}},{db,memories:[],run:async input=>{calls++;if(calls===1)return {...final(),response_text:'',decision:'silent'};assert.equal(input.tool_budget_remaining,0);return final();}});assert.equal(calls,2);assert.equal(repaired.plan.response_text,'A quieter evening may help.');assert.deepEqual(repaired.plan.actions,[]);
 calls=0;await assert.rejects(()=>brain.plan({prompt:'rest',context:context(),userId:'owner',identity:{}},{db,memories:[],run:async()=>++calls===1?{...final(),response_text:'',decision:'silent'}:{...final(),pending_request:'changed'}}),/repair_changed_effects/);
 calls=0;const citationRepair=await brain.plan({prompt:'rest',context:context(),userId:'owner',identity:{}},{db,memories:[],run:async()=>++calls===1?{...final(),response_text:'Reply: help'}:{...final(),response_text:'Recorded 6 h. ['+uuid+']'}});assert.equal(citationRepair.plan.response_text,'Recorded 6 h.');
 let request;await brain.generate({current_message:'rest',mode:'reactive'},{model:async x=>{request=x.request;return {body:{status:'completed',output_text:'{}'}};}});assert(!request.text.format.schema.properties.decision.enum.includes('silent'));
 await brain.generate({current_message:'',mode:'proactive'},{model:async x=>{request=x.request;return {body:{status:'completed',output_text:'{}'}};}});assert(request.text.format.schema.properties.decision.enum.includes('silent'));
 const silent=await brain.plan({prompt:'',proactive:{kind:'daily_review'},context:context(),userId:'owner',identity:{}},{db,memories:[],run:async()=>({...final(),response_text:'',decision:'silent',evidence:''})});assert.equal(silent.plan.proactive_decision,'silent');
 console.log('PASS quality regressions: final/stream UUIDs, literal quotes, invalid units/zero/pagination, reactive recovery/effect authority, repaired prose and proactive silence');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
