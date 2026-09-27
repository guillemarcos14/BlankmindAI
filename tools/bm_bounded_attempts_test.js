"use strict";
const assert = require("node:assert/strict");
const { runBoundedAttempts, readModelJson } = require("../netlify/functions/bm-model-request");
const { extractWithModel } = require("../netlify/functions/bm-semantic-extraction");
const { advanceSemanticState } = require("../netlify/functions/bm-semantic-state");
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function verifyBoundedAttempts() {
  let checks = 0;
  const run = options => runBoundedAttempts({ budgetMs: 160, hedgeAfterMs: 60, minRemainingMs: 10, ...options });
  const valid = value => ({ value });
  let calls = 0;
  const fast = await run({ attemptFn: async () => { calls++; return valid("fast"); } });
  await wait(75);
  assert.equal(calls,1); assert.equal(fast.execution.winner_attempt,1); checks++;

  let ignoredSignal;
  const recovered = await run({ attemptFn: async ({attempt,signal}) => {
    if(attempt===1){ignoredSignal=signal;return new Promise(()=>{});}
    return valid("recovered");
  } });
  assert.equal(recovered.value,"recovered"); assert.equal(ignoredSignal.aborted,true);
  assert.deepEqual(recovered.execution.attempts.map(x=>[x.trigger,x.outcome]),[["primary","cancelled"],["hedge","succeeded"]]); checks++;

  // First result remains eligible after the delayed request starts. The losing
  // promise rejects later despite ignoring abort; its rejection is observed.
  const unhandled=[]; const capture=error=>unhandled.push(error);
  process.on("unhandledRejection",capture);
  try {
    const original = await run({ attemptFn: async ({attempt}) => {
      if(attempt===1){await wait(85);return valid("original");}
      await wait(70);throw new Error("late loser");
    } });
    assert.equal(original.value,"original"); assert.equal(original.execution.winner_attempt,1);
    await wait(85); assert.deepEqual(unhandled,[]); checks++;
  } finally { process.off("unhandledRejection",capture); }

  const invalid = new Error("duplicate_semantic_extraction_slot");
  const originalAfterInvalid = await run({ shouldRetry:()=>true,attemptFn:async ({attempt})=>{
    if(attempt===2)throw invalid;
    await wait(85);return valid("validated original");
  } });
  assert.equal(originalAfterInvalid.execution.winner_attempt,1);
  assert.equal(originalAfterInvalid.errors[0].error,invalid); checks++;

  let simultaneousResolve, simultaneousCalls=0;
  const bothReady=new Promise(resolve=>{simultaneousResolve=resolve;});
  const simultaneous=run({attemptFn:async()=>{simultaneousCalls++;await bothReady;return valid("valid");}});
  await wait(90); simultaneousResolve(); const selected=await simultaneous;
  assert.equal(simultaneousCalls,2);
  assert.equal(selected.execution.attempts.filter(x=>x.outcome==="succeeded").length,1); checks++;

  calls=0;let repaired=0;
  await assert.rejects(()=>run({shouldRetry:()=>true,repair:()=>{repaired++;},attemptFn:async()=>{calls++;throw invalid;}}),error=>{
    assert.equal(error.bounded_attempt_execution.attempts.length,2);return true;
  });
  await wait(75);assert.equal(calls,2);assert.equal(repaired,1);checks++;

  const signals=[];
  await assert.rejects(()=>run({attemptFn:async({signal})=>{signals.push(signal);return new Promise(()=>{});}}),error=>{
    assert.equal(error.name,"TimeoutError");
    assert.deepEqual(error.bounded_attempt_execution.attempts.map(x=>x.outcome),["timed_out","timed_out"]);return true;
  });
  assert(signals.every(x=>x.aborted));checks++;

  // The shared timer wins before fetch's abort catch. Preserve live progress
  // before cancelling, then detach the final report from late I/O mutations.
  for(const phase of ["headers","body"]){
    const late=[],observed=[];
    let failure;
    await assert.rejects(()=>run({attemptFn:async({attempt,timeoutMs,signal,observeMetrics})=>{
      const response=()=>({ok:true,status:200,headers:new Headers({"x-request-id":`req_stalled_${attempt}`,"openai-processing-ms":"7.5",authorization:"private-metric-sentinel"}),
        json:async()=>phase==="body"?new Promise(resolve=>late.push(()=>resolve({usage:{input_tokens:100}}))):{usage:{input_tokens:100}}});
      const result=await readModelJson({request:{model:"fixture",input:"private-metric-sentinel"},timeoutMs,signal,errorPrefix:"semantic_model",
        observeMetrics:metrics=>{observed[attempt-1]=metrics;observeMetrics(metrics);},
        fetchImpl:async()=>phase==="headers"?new Promise(resolve=>late.push(()=>resolve(response()))):response()});
      return {value:result.body,metrics:result.metrics};
    }}),error=>{failure=error;return error.name==="TimeoutError";});
    const frozen=JSON.stringify(failure.bounded_attempt_execution);
    const attempts=failure.bounded_attempt_execution.attempts;
    assert.equal(attempts.length,2);
    for(const item of attempts){
      const metrics=item.request_metrics;
      assert.equal(metrics.phase,phase);assert.equal(metrics.error_name,"TimeoutError");
      assert(metrics.budget_ms>0&&metrics.budget_ms<=160);assert(metrics.elapsed_ms>=0);
      if(phase==="body"){
        assert.equal(metrics.request_id,`req_stalled_${item.attempt}`);assert.equal(metrics.processing_ms,7.5);
        assert.equal(metrics.http_status,200);assert(metrics.headers_ms>=0);assert(metrics.body_ms>=0);
      }else{assert.equal(metrics.request_id,undefined);assert.equal(metrics.headers_ms,undefined);}
    }
    assert.doesNotMatch(frozen,/private-metric-sentinel|authorization|Bearer|input_tokens/);
    for(const complete of late)complete();await wait(5);
    for(const metrics of observed){metrics.phase="complete";metrics.usage={input_tokens:999};}
    assert.equal(JSON.stringify(failure.bounded_attempt_execution),frozen,"late response metrics cannot mutate a returned deadline snapshot");checks++;
  }

  let lateBody;const live=[];
  const winnerWithBodyLoser=await run({attemptFn:async({attempt,timeoutMs,signal,observeMetrics})=>{
    const result=await readModelJson({request:{model:"fixture",input:"private-metric-sentinel"},timeoutMs,signal,errorPrefix:"semantic_model",
      observeMetrics:metrics=>{live[attempt-1]=metrics;observeMetrics(metrics);},
      fetchImpl:async()=>({ok:true,status:200,headers:new Headers({"x-request-id":`req_winner_${attempt}`,"openai-processing-ms":"8"}),
        json:async()=>attempt===1?new Promise(resolve=>{lateBody=resolve;}):{usage:{input_tokens:2,output_tokens:3,total_tokens:5}}})});
    return {value:"validated",metrics:result.metrics};
  }});
  const winnerSnapshot=JSON.stringify(winnerWithBodyLoser.execution);
  const loserMetrics=winnerWithBodyLoser.execution.attempts[0].request_metrics;
  assert.equal(loserMetrics.phase,"body");assert.equal(loserMetrics.request_id,"req_winner_1");
  assert.equal(loserMetrics.processing_ms,8);assert.equal(loserMetrics.error_name,"AbortError");assert(loserMetrics.body_ms>=0);
  lateBody({usage:{input_tokens:1000}});await wait(5);
  live[1].usage.input_tokens=999;
  assert.equal(JSON.stringify(winnerWithBodyLoser.execution),winnerSnapshot,"winner and cancelled-loser metrics are deep snapshots");checks++;

  for(const status of [401,403,429]){
    let firstSignal;
    const fatal=new Error(`semantic_model_http_${status}`);
    await assert.rejects(()=>run({isFatal:()=>true,attemptFn:async({attempt,signal})=>{
      if(attempt===1){firstSignal=signal;return new Promise(()=>{});}throw fatal;
    }}),error=>error===fatal);
    assert.equal(firstSignal.aborted,true);checks++;
  }

  // Integration: only verified transient causes gain early recovery. Permanent
  // DNS/auth/quota errors keep fail-fast behavior. No provider call is made.
  const key=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY="bounded-test-not-sent";
  const response={ok:true,status:200,json:async()=>({model:"fixture",output_text:JSON.stringify({fields:[{slot:"duration_minutes",value:400,evidence:"400 minutes"}],ambiguities:[]})})};
  try{
    for(const cause of ["ECONNRESET","UND_ERR_CONNECT_TIMEOUT","EAI_AGAIN"]){
      calls=0;
      const result=await extractWithModel({prompt:"Block selected apps now for 400 minutes once.",fetchImpl:async()=>{
        if(++calls===1)throw new TypeError("fetch failed",{cause:{code:cause}});return response;
      }});
      assert.equal(calls,2);assert.equal(result.trace.attempt_execution.attempts[1].trigger,"retry");
      assert.equal(result.extraction.set.duration_minutes,400,"unsupported input is not clamped or discarded by the race");
      const reduced=advanceSemanticState({prompt:"Block selected apps now for 400 minutes once.",extraction:result.extraction});
      assert.equal(reduced.decision.slot,"duration_minutes");assert.deepEqual(reduced.actions,[]);checks++;
    }
    for(const status of [401,403,429]){
      calls=0;
      await assert.rejects(()=>extractWithModel({prompt:"400 minutes",fetchImpl:async()=>{calls++;return {ok:false,status};}}),new RegExp(`semantic_model_http_${status}`));
      assert.equal(calls,1);checks++;
    }
    calls=0;
    await assert.rejects(()=>extractWithModel({prompt:"400 minutes",fetchImpl:async()=>{calls++;throw new TypeError("fetch failed",{cause:{code:"ENOTFOUND"}});}}),/fetch failed/);
    assert.equal(calls,1);checks++;
  }finally{if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;}
  console.log(`BM bounded attempts: ${checks}/${checks} recovery, validation, cancellation and deadline checks passed (no provider calls)`);
}

module.exports = { verifyBoundedAttempts };
if(require.main===module)verifyBoundedAttempts().catch(error=>{console.error(error);process.exitCode=1;});
