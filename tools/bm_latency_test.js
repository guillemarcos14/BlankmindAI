"use strict";
const assert=require("node:assert/strict");
const timing=require("../netlify/functions/bm-turn-timing");
const {percentile,summary}=require("./bm_latency_benchmark");
async function main(){
  const samples=[];
  let finish;
  const gate=new Promise(r=>finish=r);
  const first=timing.run({turnId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",action:"send"},async()=>{
    await timing.span("context",async()=>{await gate;timing.firstText("");timing.firstText("A");timing.usage({total_tokens:10});});
    return {statusCode:200};
  },s=>samples.push(s));
  await timing.run({turnId:"secret injected identifier",action:"send"},async()=>{
    await timing.span("context",async()=>{timing.usage({total_tokens:20});});
    return {statusCode:503};
  },s=>samples.push(s));
  finish();await first;
  assert.equal(samples[0].first_text_ms,null);assert.equal(samples[0].turn_id,undefined);
  assert.equal(samples[0].usage.total_tokens,20);assert.equal(samples[1].usage.total_tokens,10);
  assert(samples[1].first_text_ms!=null);assert.equal(samples[1].stages.context.calls,1);
  assert(!JSON.stringify(samples).includes("secret injected"));
  await timing.run({},async()=>({statusCode:200}),()=>{throw Error("metrics_failure");});
  await assert.rejects(()=>timing.run({},async()=>{throw Error("original_failure");},s=>samples.push(s)),/original_failure/);
  assert.equal(samples.at(-1).status,503);
  assert.equal(percentile([1,2,3,4,5],.9),5);assert.equal(percentile([], .5),null);
  const s=summary([{group:"simple",passed:true,first_text_ms:10,elapsed_ms:20},{group:"simple",passed:false,first_text_ms:1,elapsed_ms:2}]);
  assert.equal(s.simple.errors,1);assert.equal(s.simple.final_ms.p50,20,"Failures cannot improve success latency");

  // Real context adapter with a scoped transport stub. Identity reuse cannot
  // accept a different connect code, and app bypass preserves the durable state.
  const membership=require("../netlify/functions/_membership");
  const calls=[];
  membership.supabaseFetch=async route=>{calls.push(route);return route.startsWith("bm_user_context_snapshots")
    ?[{context:{is_blank_active:true,context_revision:99,anonymous_user_id:"anonymous-A"}}]
    :route.startsWith("blankmind_identity_links")?[{auth_user_id:"A",anonymous_user_id:"anonymous-A",assistant_connect_code:"CODE-A"}]:[];};
  const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL="https://qa.invalid";process.env.SUPABASE_SERVICE_ROLE_KEY="test-only";
  try{
    const adapter=require("../netlify/functions/_bm_user_context");
    const identity={auth_user_id:"A",anonymous_user_id:"anonymous-A",assistant_connect_code:"CODE-A"};
    const context=await adapter.enrichAssistantContext({is_blank_active:false},"CODE-A",{identity,includeLegacySources:false});
    assert.equal(context.is_blank_active,true);assert.equal(context.context_revision,99);assert.equal(calls.length,1);
    calls.length=0;await adapter.enrichAssistantContext({},"CODE-A",{identity:{...identity,assistant_connect_code:"CODE-B"},includeLegacySources:false});
    assert(calls.some(p=>p.startsWith("blankmind_identity_links")),"Wrong identity cannot be reused");
    calls.length=0;await adapter.enrichAssistantContext({},"CODE-A");
    assert(calls.some(p=>p.startsWith("onboarding_responses")),"Messaging keeps its source enrichment");
  }finally{if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;}

  // Account reads begin together, while history MUST await the memory cutoff.
  const readStarts=[];let releaseMemory;
  const saved=new Promise(r=>releaseMemory=r);
  membership.supabaseFetch=async p=>p.startsWith("bm_brain_memories")?saved:[];
  const brain=require("../netlify/functions/bmb-brain");
  const db=async p=>{readStarts.push(p);return [];};
  const result=brain.plan({prompt:"hello",context:{memory:{}},userId:"A",identity:{}},{db,run:async input=>{
    assert.equal(input.sources[0].personalization_after,"2026-10-01T00:00:00Z");
    return {phase:"final",message_kind:"social",decision:"respond",response_language:"en",evidence:"hello",response_text:"Hello",action:null,memory:null,cited_sources:[]};
  }});
  await new Promise(r=>setImmediate(r));
  assert(readStarts.some(p=>p.startsWith("bmb_accounts")));assert(readStarts.some(p=>p.startsWith("bmb_followups")));
  assert(!readStarts.some(p=>p.startsWith("assistant_app_turns")),"History cannot race the forget cutoff");
  releaseMemory([{key:"goal",value:null,source_at:"2026-10-01T00:00:00Z"}]);await result;
  assert(readStarts.some(p=>p.includes("created_at=gt.")));
  console.log("PASS latency: request isolation/privacy/failures, percentiles, current snapshot/identity, legacy sources and parallel reads with forget cutoff");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
