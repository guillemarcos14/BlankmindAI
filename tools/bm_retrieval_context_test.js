"use strict";
const assert=require('node:assert/strict'),rc=require('../netlify/functions/bm-retrieval-context'),r=require('../netlify/functions/bm-retrieval-step');
async function main(){
 const timezone='Europe/Madrid',now=Date.parse('2026-10-09T10:00:00Z');
 const source={source_id:'observations',available:true,rows:[{id:'night',metric:'sleep_duration',value_number:556,unit:'minutes',measurement:'measured'}]};
 const state=rc.seed(source,timezone,now);
 for(const text of ['Y ayer?','¿Es medido o declarado ese dato?','Is that sleep entry measured or declared?','Now tell me in Spanish.','Ahora dímelo en inglés.'])assert(rc.followup(text,state,{timezone,now}));
 for(const text of ['Y bloquea las apps','Y olvida mis datos','Y mi pareja?','Hola','"Y ayer?"'])assert(!rc.followup(text,state,{timezone,now}));
 for(const override of [{timezone:'UTC'},{now:now+rc.TTL+1},{cutoff:new Date(now).toISOString()}])assert(!rc.followup('Y ayer?',state,{timezone,now,...override}));
 assert(!rc.followup('Y ayer?',{...state,remaining:0},{timezone,now}));assert(!JSON.stringify(state).includes('556'));
 let reads=0;
 const read=async(owner,identity,query,cutoff)=>{reads++;assert.equal(owner,'owned');assert.equal(identity.anonymous_user_id,'linked');assert.equal(query.from,'2026-10-04T22:00:00.000Z');assert.equal(query.to,'2026-10-09T10:00:00.000Z');assert.equal(cutoff,'2026-10-06T00:00:00Z');return source;};
 const options={userId:'owned',identity:{anonymous_user_id:'linked'},timezone,now,cutoff:'2026-10-06T00:00:00Z',read};
 assert.equal(await rc.preload(state,options),source);
 assert.equal(await rc.preload(state,{...options,currentSleep:{available:true,is_synthetic:true}}),null);assert.equal(reads,1);
 assert.equal(await rc.preload({...state,source:'current_sleep'},{...options,currentSleep:{available:true}}),null);assert.equal(reads,1);
 assert.equal(await rc.preload(state,{...options,read:async()=>{throw Error('provider unavailable');}}),null);
 const before={...process.env};process.env.BM_RETRIEVAL_STEP_ENABLED='false';process.env.BM_RETRIEVAL_STEP_QA_ENABLED='false';process.env.BM_DECISIONS_QA_ENABLED='false';process.env.BM_JEV_SHADOW_ENABLED='false';process.env.BM_JEV_PREFETCH_EXPERIMENT='false';
 try{
  const {plan}=require('../netlify/functions/bmb-brain'),userId='11111111-1111-4111-8111-111111111111';let observationReads=0;
  const db=async path=>{assert(path.includes(encodeURIComponent(userId))||path.startsWith('rpc/'));if(path.startsWith('bmb_observations?')){observationReads++;return source.rows;}return [];};
  const context={language:'en',brain_snapshot:{timezone},memory:{conversation_state:{}}};
  const invoke=async(prompt,first=false)=>plan({prompt,context,userId,identity:{anonymous_user_id:'linked'}},{db,memories:[],run:async input=>{
    if(first&&!input.sources.some(s=>s.source_id==='observations'))return {phase:'read',queries:[{source:'observations',term:'',from:null,to:null,offset:0}],message_kind:'question'};
    assert(input.sources.some(s=>s.source_id==='observations'&&s.rows.some(row=>row.value_number===556)));
    return {...r.expandProse({response_language:prompt.includes('Spanish')?'es':'en',response_text:'Recorded sleep was 556 minutes.',cited_sources:['observations']},input),evidence:prompt};
  }});
  const first=await invoke('What was my sleep this week?',true);assert(first.plan.bmb_state.retrieval_context);context.memory.conversation_state.bmb_state=first.plan.bmb_state;
  for(const prompt of ['And yesterday?','Is that measured or declared?','Now tell me in Spanish.']){const result=await invoke(prompt);assert.deepEqual(result.plan.actions,[]);assert.equal(result.context.brain_memory_effect,undefined);context.memory.conversation_state.bmb_state=result.plan.bmb_state;}
  assert.equal(observationReads,4);assert.equal(context.memory.conversation_state.bmb_state.retrieval_context.remaining,0);
 }finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);}
 console.log('PASS owner-scoped fresh followup reads, provenance-only state, TTL/cutoff/native isolation and actual four-turn planner');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
