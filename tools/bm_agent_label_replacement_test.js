"use strict";
const assert=require('node:assert/strict'),labels=require('../netlify/functions/bm-agent-labels'),brain=require('../netlify/functions/bmb-brain'),activation=require('../netlify/functions/bm-agent-activation');
const env={BM_AGENT_QA_ENABLED:'true',BM_AGENT_QA_FEATURES:'labels',SUPABASE_URL:activation.QA,OPENAI_API_KEY:'fixture'};
const observation=(evidence,value=1380)=>({metric:'bedtime',value_number:value,value_text:null,unit:'local_minute',measured_at:null,timezone:'Europe/Madrid',evidence});
function response(payload,values,confidence=1){return {model:'gpt-6-luna',usage:{input_tokens:100},answers:payload.questions.map((q,i)=>({name:q.name,type:'choice',choice:values[i],probabilities:q.choices.map(c=>({value:c.value,probability:c.value===values[i]?confidence:(1-confidence)/2}))}))};}
async function main(){
 const before=JSON.stringify(brain.schema),extraction=labels.extractionSchema(brain.schema);
 assert(!Object.hasOwn(extraction.properties.observations.items.properties,'measurement'));
 assert(!extraction.properties.observations.items.required.includes('measurement'));assert.equal(JSON.stringify(brain.schema),before);
 let calls=0;
 const input={current_message:'Normalmente me acuesto a las 23:00. Ayer me acosté a las 22:00.'};
 const raw={observations:[observation('Normalmente me acuesto a las 23:00'),observation('Ayer me acosté a las 22:00',1320)],memory:null,action:null};
 const run=(values,confidence=1)=>labels.complete(raw,input,{env,fetcher:async(_,options)=>{calls++;const payload=JSON.parse(options.body);assert.equal(payload.questions.length,2);return new Response(JSON.stringify(response(payload,values,confidence)));}});
 const completed=await run(['routine_statement','declared']);assert.equal(calls,1,'Independent classifications must be batched');
 assert.deepEqual(completed.observations.map(o=>o.measurement),['routine_statement','declared']);
 assert.deepEqual(completed.observations.map(({measurement,...o})=>o),raw.observations,'Classification changed extracted authority/values');assert(!Object.hasOwn(raw.observations[0],'measurement'));
 assert.equal(await run(['uncertain','declared']),null);assert.equal(await run(['routine_statement','declared'],.7),null);
 const empty={observations:[],action:null};assert.equal(await labels.complete(empty,input,{env}),empty);
 assert.equal(await labels.complete(completed,input,{env}),null,'Generated or already classified observations cannot be classified twice');
 assert.equal(await labels.complete({...raw,observations:[observation('invented')]},input,{env}),null);
 const saved={...process.env};Object.assign(process.env,env);
 try{
  const final={phase:'final',response_language:'es',message_kind:'statement',decision:'respond',evidence:input.current_message,response_text:'Lo tengo en cuenta.',observations:raw.observations,action:null,memory:null};
  let generated=0,classified=0;
  const result=await brain.generate({...input,mode:'reactive',sources:[],memories:[],coverage:[]},{model:async({request})=>{
   generated++;assert(!request.text.format.schema.properties.observations.items.required.includes('measurement'));
   return {body:{output_text:JSON.stringify(final)}};
  },labeler:async(r,i)=>{classified++;assert.equal(i.current_message,input.current_message);return {...r,observations:completed.observations};}});
  assert.equal(generated,1);assert.equal(classified,1);assert.deepEqual(result.observations,completed.observations);
  generated=0;classified=0;
  const fallback=await brain.generate({...input,mode:'reactive',sources:[],memories:[],coverage:[]},{model:async({request})=>{
   generated++;assert.equal(request.text.format.schema.properties.observations.items.required.includes('measurement'),generated===2);
   return {body:{output_text:JSON.stringify({...final,observations:generated===1?raw.observations:completed.observations})}};
  },labeler:async()=>{classified++;return null;}});
  assert.equal(generated,2);assert.equal(classified,1);assert.deepEqual(fallback.observations,completed.observations);
 }finally{for(const k of Object.keys(process.env))if(!Object.hasOwn(saved,k))delete process.env[k];Object.assign(process.env,saved);}
 console.log('PASS labels replacement: removed generated classification, batched Decisions, exact extraction retained, no duplicate/replay work, uncertainty returns once to canonical generator; mocked providers only');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
