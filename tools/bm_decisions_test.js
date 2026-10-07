"use strict";
const assert=require("node:assert/strict"),d=require("../netlify/functions/bm-decisions");
async function main(){
 const id="11111111-1111-4111-8111-111111111111",run="22222222-2222-4222-8222-222222222222",payload=d.request("Do I have recorded sleep?");
 const body={model:d.MODEL,answers:payload.questions.map(q=>({name:q.name,type:"predicate",probability:q.name==="observations"?1:0})),usage:{input_tokens:500,output_tokens:0}};
 const result=d.validate(body,payload);assert.deepEqual(d.selected(result),["observations"]);
 assert.deepEqual(d.selected({...result,answers:{...result.answers,unsafe:.1}}),[]);
 assert.throws(()=>d.validate({...body,answers:[...body.answers,body.answers[0]]},payload));
 assert.throws(()=>d.validate({...body,answers:body.answers.map((a,i)=>i? a:{...a,probability:NaN})},payload));
 assert.deepEqual(d.selected(d.validate({...body,answers:body.answers.map(a=>({...a,type:"refusal"}))},payload)),[]);
 const env={BM_DECISIONS_QA_ENABLED:"true",BM_DECISIONS_DATA_POLICY:"synthetic-private-qa",BM_DECISIONS_QA_USERS:id,SUPABASE_URL:"https://njqbovsmoowkhhsqmitn.supabase.co",OPENAI_API_KEY:"test-key",SUPABASE_SERVICE_ROLE_KEY:"test-service"};
 assert.equal(d.enabled(id,{}),false);assert(d.enabled(id,env));assert.equal(d.enabled(id,{...env,SUPABASE_URL:"https://vhiikgyyfisejjwqtxfc.supabase.co"}),false);
 let calls=0,logs=[],info=console.info;console.info=x=>logs.push(x);
 try{
  assert.equal(await d.start(id,"x",{env:{},fetcher:async()=>{calls++;}}),null);assert.equal(calls,0);
  assert.equal(await d.start(id,"x",{env,fetcher:async()=>({ok:true,json:async()=>({id,app_metadata:{}})})}),null);
  const actual=await d.start(id,"private-synthetic-input",{env,fetcher:async(url,o)=>{calls++;if(url===d.ENDPOINT){assert.equal(o.redirect,"error");assert.equal(o.headers.authorization,"Bearer test-key");return {ok:true,json:async()=>body};}return {ok:true,json:async()=>({id,app_metadata:{synthetic_staging_run:run}})};}});
  assert.deepEqual(d.selected(actual),["observations"]);
  assert.equal(await d.start(id,"x",{env,fetcher:async()=>{throw Error("secret-echo");}}),null);
 }finally{console.info=info;}
 assert(!logs.join().includes("private-synthetic-input")&&!logs.join().includes("secret-echo")&&!logs.join().includes("test-key"));
 let reads=[];const input={userId:id,identity:{anonymous_user_id:"owner"},cutoff:"2026-10-07T00:00:00Z",timezone:"Europe/Madrid",db:()=>{},read:async(u,i,q,cutoff)=>{reads.push({u,i,q,cutoff});return {source:q.source};}};
 assert.equal((await d.prefetch(result,input)).length,1);assert.equal(reads[0].cutoff,input.cutoff);assert.equal(reads[0].u,id);
 assert.deepEqual(await d.prefetch(result,{...input,existing:[{source:"observations"}]}),[]);
 assert.deepEqual(await d.prefetch({...result,answers:{...result.answers,unsafe:1}},input),[]);
 const meter=require("./bm_decisions_meter"),u={input_tokens:100,output_tokens:10,input_tokens_details:{cached_tokens:20,cache_write_tokens:10}};
 assert.equal(meter.estimate({endpoint:"responses",usage:meter.usage(u),service_tier:"default"},{input:.2,cached:.02,output:1.2}),.0000289);
 assert.equal(meter.estimate({endpoint:"responses"},{input:.2}),null);
 const event='data: '+JSON.stringify({type:"response.completed",response:{model:"gpt-5.6-luna",service_tier:"default",usage:u}})+'\r\n\r\n',bytes=new TextEncoder().encode(event),record={};
 const response=await meter.meterResponse(new Response(new ReadableStream({start(c){for(const b of bytes)c.enqueue(Uint8Array.of(b));c.close();}}),{headers:{"content-type":"text/event-stream"}}),record);
 assert.equal(await response.text(),event);assert.deepEqual(record.usage,meter.usage(u));
 console.log("PASS Decisions: typed/refusal validation, off/private/synthetic gates, fallback, privacy, owner/cutoff and duplicate source preservation");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
