"use strict";
const assert=require('node:assert/strict'),tools=require('../netlify/functions/bm-agent-tools'),labels=require('../netlify/functions/bm-agent-labels'),activation=require('../netlify/functions/bm-agent-activation');
const env={BM_AGENT_QA_ENABLED:'true',BM_AGENT_QA_FEATURES:'labels',SUPABASE_URL:activation.QA,OPENAI_API_KEY:'fixture'};
async function main(){
 let reads=0;const options={userId:'owner',identity:{anonymous_user_id:'same-owner'},timezone:'Europe/Madrid',cutoff:'2026-10-10',prompt:'Show my history',isQuestion:true,
 read:async(u,i,q,cutoff)=>{reads++;assert.equal(u,'owner');return {source_id:q.source,rows:[{cutoff}]};}};
 const read=tools.reader(options),q={source:'history',term:'',from:null,to:null,offset:0,timezone:null,history_evidence:''};
 const reversed=Object.fromEntries(Object.entries(q).reverse());
 const results=await read([q,reversed]);assert.equal(reads,1,'Equivalent reads with reordered fields must share one in-flight request');assert.equal(results[0],results[1]);
 await read([{...q,offset:40}]);assert.equal(reads,2,'A new page was incorrectly cached');
 await read([{...q,history_evidence:'Show my history'}]);assert.equal(reads,3,'Explicit historical authorization lost its separate cutoff');
 const other=tools.reader({...options,userId:'other',read:async u=>{reads++;assert.equal(u,'other');return {rows:[]};}});await other([q]);assert.equal(reads,4,'Cache leaked between users/turns');
 for(const language of ['es','en']){
  const message=language==='es'?'Normalmente me acuesto a las 23:00 y me levanto a las 07:00.':'I usually go to bed at 23:00 and wake at 07:00.';
  const observations=[{metric:'bedtime',value_number:1380,value_text:null,unit:'local_minute',measured_at:null,timezone:'Europe/Madrid',evidence:message},{metric:'wake_time',value_number:420,value_text:null,unit:'local_minute',measured_at:null,timezone:'Europe/Madrid',evidence:message}];
  let calls=0;const result=await labels.complete({observations,action:null,memory:null},{current_message:message},{env,fetcher:async(_,o)=>{
   calls++;const p=JSON.parse(o.body);assert.equal(p.questions.length,1,'The identical fragment was classified twice');assert.equal(JSON.parse(p.input).fragments.length,1);
   return new Response(JSON.stringify({model:'gpt-6-luna',usage:{input_tokens:10},answers:[{name:'measurement_0',type:'choice',choice:'routine_statement',probabilities:[{value:'routine_statement',probability:1},{value:'declared',probability:0},{value:'uncertain',probability:0}]}]}));
  }});
  assert.equal(calls,1);assert.deepEqual(result.observations,observations.map(o=>({...o,measurement:'routine_statement'})));
  const again=await labels.complete({observations}, {current_message:message},{env,fetcher:async()=>{calls++;throw Error('injected_provider_error');}});assert.equal(again,null);assert.equal(calls,2,'Classification cache leaked between turns');
  const mixed=language==='es'?'Normalmente me acuesto a las 23:00. Ayer tomé 2 cafés.':'I usually go to bed at 23:00. Yesterday I drank 2 coffees.';
  assert.equal(await labels.complete({observations:observations.map(o=>({...o,evidence:mixed}))},{current_message:mixed},{env,fetcher:async(_,options)=>{const p=JSON.parse(options.body);return new Response(JSON.stringify({model:'gpt-6-luna',usage:{input_tokens:10},answers:[{name:p.questions[0].name,type:'choice',choice:'uncertain',probabilities:p.questions[0].choices.map(c=>({value:c.value,probability:c.value==='uncertain'?1:0}))}]}));}}),null,'A shared ambiguous fragment must return both extractions to canonical interpretation');
 }
 console.log('PASS local work reuse: query-order-independent in-flight reads, separate pages/authority/users, one classification per exact fragment and no cross-turn cache; no provider timing claim');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
