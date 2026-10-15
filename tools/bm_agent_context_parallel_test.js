"use strict";
const assert=require('node:assert/strict'),activation=require('../netlify/functions/bm-agent-activation'),rest=require('../netlify/functions/bmb-rest'),brain=require('../netlify/functions/bmb-brain');
const saved={...process.env},contextBefore=rest.context;
async function main(){
 Object.assign(process.env,{BM_AGENT_QA_ENABLED:'true',BM_AGENT_QA_FEATURES:'retrieval',SUPABASE_URL:activation.QA,OPENAI_API_KEY:'',BM_DECISIONS_QA_ENABLED:'false',BM_RETRIEVAL_STEP_ENABLED:'false'});
 for(const feature of ['tools','retrieval','labels']){
  process.env.BM_AGENT_QA_FEATURES=feature;
  let release,historyEntered=false,restEntered=false;const barrier=new Promise(r=>{release=r;});
  rest.context=async()=>{restEntered=true;await barrier;return {source_id:'rest_evidence',available:false,rows:[]};};
  const db=async p=>{if(p.startsWith('assistant_app_turns')){historyEntered=true;await barrier;return [];}return [];};
  const result=brain.plan({userId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',identity:{},prompt:'Hello',context:{language:'en',brain_snapshot:{timezone:'Europe/Madrid'},personal_profile:{rest_snapshot:{schema_version:1}}}},{db,memories:[],run:async input=>{
   assert.deepEqual(input.sources.slice(0,3).map(s=>s.source_id),['history','current_sleep','rest_evidence']);
   return {phase:'final',response_language:'en',message_kind:'social',evidence:'Hello',decision:'respond',response_text:'Hello.',action:null,memory:null,accepted_proposal:null,pending_request:null,queries:[],observations:[],followup_resolution:null,longitudinal_review:null,cited_sources:[]};
  }});
  await new Promise(setImmediate);const overlapped=historyEntered&&restEntered;release();await result;
  assert(overlapped,feature+': independent history and rest reads still serialized');
 }
 console.log('PASS candidate context concurrency by dependency barriers, all three gates and original evidence ordering; no latency measurement');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{rest.context=contextBefore;for(const k of Object.keys(process.env))if(!Object.hasOwn(saved,k))delete process.env[k];Object.assign(process.env,saved);});
