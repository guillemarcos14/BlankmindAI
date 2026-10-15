"use strict";
const assert=require('node:assert/strict'),labels=require('../netlify/functions/bm-agent-labels'),routing=require('../netlify/functions/bm-agent-decisions'),activation=require('../netlify/functions/bm-agent-activation'),brain=require('../netlify/functions/bmb-brain');
const env={BM_AGENT_QA_ENABLED:'true',BM_AGENT_QA_FEATURES:'labels,retrieval',SUPABASE_URL:activation.QA,OPENAI_API_KEY:'offline-fixture'},user='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function main(){
 let cases=0;
 for(const language of ['es','en']){
  const text=language==='es'?'Normalmente tomo 2 cafés.':'I usually drink 2 coffees.',input={current_message:text};
  const raw={observations:[{metric:'caffeine',unit:'servings',value_number:2,value_text:null,measured_at:null,timezone:'Europe/Madrid',evidence:text}],memory:null,action:null};
  for(const kind of ['http','timeout','malformed','oversized','refusal','low','duplicate','usage']){
   let calls=0,cancelled=0;
   const fetcher=async(_,o)=>{calls++;const p=JSON.parse(o.body),choices=p.questions.at(-1).choices;
    if(kind==='http')return {ok:false,body:{cancel:async()=>{cancelled++;}}};
    if(kind==='timeout')throw new DOMException('injected','TimeoutError');
    if(kind==='malformed')return new Response('{');if(kind==='oversized')return new Response('x'.repeat(64001));
    const a={name:'measurement_0',type:'choice',choice:'routine_statement',probabilities:choices.map(c=>({value:c.value,probability:c.value==='routine_statement'?(kind==='low'?.8:1):(kind==='low'?.1:0)}))};
    return new Response(JSON.stringify({model:'gpt-6-luna',usage:kind==='usage'?{}:{input_tokens:10},answers:kind==='duplicate'?[a,a]:kind==='refusal'?[{name:a.name,type:'refusal'}]:[a]}));
   };
   const before=JSON.stringify(raw);assert.equal(await labels.complete(raw,input,{env,fetcher}),null,kind);assert.equal(calls,1);assert.equal(JSON.stringify(raw),before);if(kind==='http')assert.equal(cancelled,1);cases++;
  }
  const prompt=language==='es'?'¿Cuánto dormí ayer?':'How much sleep yesterday?';
  for(const kind of ['http','timeout','malformed','oversized','refusal','duplicate','usage','ambiguous']){
   let calls=0;
   assert.equal(await routing.start(user,prompt,{env,fetcher:async(_,o)=>{calls++;const p=JSON.parse(o.body);
    if(kind==='http')return new Response('',{status:503});if(kind==='timeout')throw new DOMException('injected','TimeoutError');
    if(kind==='malformed')return new Response('{');if(kind==='oversized')return new Response('x'.repeat(64001));
    const answers=p.questions.map(q=>q.type==='predicate'?{name:q.name,type:q.type,probability:q.name==='eligible'||q.name==='metric_sleep_duration'||kind==='ambiguous'&&q.name==='metric_protection_duration'?1:0}:{name:q.name,type:'choice',choice:'yesterday',probabilities:q.choices.map(c=>({value:c.value,probability:c.value==='yesterday'?1:0}))});
    if(kind==='refusal')answers[0]={name:answers[0].name,type:'refusal'};if(kind==='duplicate')answers[1]=answers[0];
    return new Response(JSON.stringify({model:'gpt-6-luna',usage:kind==='usage'?{}:{input_tokens:10},answers}));
   }}),null,kind);assert.equal(calls,1);cases++;
  }
 }
 const old={...process.env};Object.assign(process.env,{...env,BM_AGENT_QA_FEATURES:'tools'});
 try{for(const call_id of [undefined,'',null]){
  let calls=0;await assert.rejects(()=>brain.generate({mode:'reactive',current_message:'Show my history',sources:[],memories:[],coverage:[]},{model:async()=>{
   calls++;return {body:{output:[{type:'function_call',call_id,name:'consultar_contexto',arguments:JSON.stringify({response_language:'en',message_kind:'question',evidence:'Show my history',queries:[{source:'history'}]})}]}};
  }}),/invalid_model_json/);assert.equal(calls,2,'Malformed calls escaped the one-retry bound');cases++;
 }}finally{for(const k of Object.keys(process.env))if(!Object.hasOwn(old,k))delete process.env[k];Object.assign(process.env,old);}
 console.log(`PASS ${cases} local ES/EN provider/protocol fault scenarios: fail closed, one classification attempt, bounded JSON repair, unchanged extraction; zero real requests`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
