"use strict";
const assert = require("node:assert/strict");
const { extractWithModel, parseCandidate, schema } = require("../netlify/functions/bm-semantic-extraction");
const { advanceSemanticState } = require("../netlify/functions/bm-semantic-state");
const { readModelJson } = require("../netlify/functions/bm-model-request");

const bodyFor = fields => ({ model: "gpt-5.6-luna", status: "completed", output_text: JSON.stringify({ fields, ambiguities: [] }) });
const field = (slot, value, evidence) => ({ slot, value, evidence });

async function verifyRequestDiagnostics() {
  const secret = "private-diagnostic-sentinel";
  const request = { model: "mock-model", input: [{ role: "user", content: secret }], max_output_tokens: 700 };
  const safe = metrics => {
    assert.doesNotMatch(JSON.stringify(metrics), /private-diagnostic-sentinel|authorization|Bearer|prompt|output_text|input_text|stack/i);
    assert.ok(Number.isFinite(metrics.elapsed_ms) && metrics.elapsed_ms >= 0);
  };
  const successful = await readModelJson({ request, timeoutMs: 20000, errorPrefix: "semantic_model",
    fetchImpl: async (_url, options) => {
      assert.deepEqual(JSON.parse(options.body), request, "instrumentation must preserve the model request");
      assert.ok(options.signal instanceof AbortSignal);
      return { ok: true, status: 200, headers: new Headers({ "x-request-id": "req_fixture_123", "openai-processing-ms": "7.5", authorization: `Bearer ${secret}` }),
        json: async () => ({ model: "mock-model", status: "completed", output_text: secret,
          usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30, input_tokens_details: { cached_tokens: 5, secret }, output_tokens_details: { reasoning_tokens: 7, secret }, secret } }) };
    } });
  assert.equal(successful.body.output_text, secret, "the response body remains available to its existing parser");
  assert.equal(successful.metrics.phase, "complete");
  assert.equal(successful.metrics.budget_ms, 20000);
  assert.equal(successful.metrics.http_status, 200);
  assert.equal(successful.metrics.request_id, "req_fixture_123");
  assert.equal(successful.metrics.processing_ms, 7.5);
  assert.deepEqual(successful.metrics.usage, { input_tokens: 10, output_tokens: 20, total_tokens: 30, cached_input_tokens: 5, reasoning_tokens: 7 });
  assert.ok(successful.metrics.headers_ms >= 0 && successful.metrics.body_ms >= 0);
  safe(successful.metrics);

  // These doubles obey the actual AbortSignal, including after headers have
  // arrived. The short helper budget avoids twenty-second unit tests.
  for (const phase of ["headers", "body"]) {
    let calls = 0, signalSeen;
    const keepAlive = setTimeout(() => {}, 1000);
    try {
      await assert.rejects(() => readModelJson({ request, timeoutMs: 10, errorPrefix: "semantic_model",
        fetchImpl: async (_url, options) => {
          calls++; signalSeen = options.signal;
          const aborted = () => new Promise((resolve, reject) => {
            if (signalSeen.aborted) reject(signalSeen.reason);
            else signalSeen.addEventListener("abort", () => reject(signalSeen.reason), { once: true });
          });
          if (phase === "headers") return aborted();
          return { ok: true, status: 200, headers: new Headers({ "x-request-id": "req_body_timeout" }), json: aborted };
        } }), error => {
        assert.equal(error.name, "TimeoutError");
        assert.ok(signalSeen instanceof AbortSignal && signalSeen.aborted);
        const metrics = error.model_request_metrics;
        assert.equal(metrics.phase, phase);
        assert.equal(metrics.budget_ms, 10);
        assert.equal(metrics.error_name, "TimeoutError");
        if (phase === "body") { assert.equal(metrics.http_status, 200); assert.equal(metrics.request_id, "req_body_timeout"); }
        else assert.equal(metrics.http_status, undefined);
        safe(metrics); return true;
      });
      assert.equal(calls, 1, "the request helper itself never retries");
    } finally { clearTimeout(keepAlive); }
  }

  let reads = 0, cancelled = 0;
  await assert.rejects(() => readModelJson({ request, timeoutMs: 20000, errorPrefix: "semantic_model",
    fetchImpl: async () => ({ ok: false, status: 429,
      headers: new Headers({ "x-request-id": `Bearer ${secret}`, "openai-processing-ms": "-1" }),
      body: { cancel: async () => { cancelled++; throw new Error(`Bearer ${secret}`); } },
      json: async () => { reads++; throw new Error(secret); }, text: async () => { reads++; return secret; } }) }), error => {
    assert.equal(error.message, "semantic_model_http_429", "cancelling an error body cannot replace its original HTTP error");
    assert.equal(error.model_request_metrics.http_status, 429);
    assert.equal(error.model_request_metrics.request_id, undefined);
    assert.equal(error.model_request_metrics.processing_ms, undefined);
    safe(error.model_request_metrics); return true;
  });
  assert.equal(reads, 0, "provider error bodies are never read into diagnostics");
  assert.equal(cancelled, 1);
  let pendingCancel = 0, cancelGuard;
  try {
    await assert.rejects(() => Promise.race([
      readModelJson({ request, timeoutMs: 20000, errorPrefix: "semantic_model", fetchImpl: async () => ({
        ok: false, status: 503, body: { cancel: () => { pendingCancel++; return new Promise(() => {}); } },
      }) }),
      new Promise((_, reject) => { cancelGuard = setTimeout(() => reject(new Error("pending_cancel_blocked_http_failure")), 250); }),
    ]), { message: "semantic_model_http_503" });
    assert.equal(pendingCancel, 1, "best-effort cancellation must not retain the request deadline");
  } finally { clearTimeout(cancelGuard); }
  for (const cause of ["ECONNRESET", `Bearer ${secret}`]) {
    await assert.rejects(() => readModelJson({ request, timeoutMs: 20000, errorPrefix: "semantic_model", fetchImpl: async () => {
      const error = new TypeError(`authorization: Bearer ${secret}`); error.cause = { code: cause }; throw error;
    } }), error => {
      assert.equal(error.model_request_metrics.phase, "headers");
      assert.equal(error.model_request_metrics.error_name, "TypeError");
      assert.equal(error.model_request_metrics.cause_code, cause === "ECONNRESET" ? cause : undefined);
      safe(error.model_request_metrics); return true;
    });
  }
}

(async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key-never-sent";
  try {
    await verifyRequestDiagnostics();
    await require("./bm_bounded_attempts_test").verifyBoundedAttempts();
    const first = advanceSemanticState({ prompt: "Block Instagram now for 30 minutes" });
    let request;
    const extracted = await extractWithModel({
      prompt: "Just once", previousState: first.state,
      fetchImpl: async (_url, options) => { request = JSON.parse(options.body); return { ok: true, json: async () => bodyFor([field("recurrence", { type: "once", weekdays: [] }, "Just once")]) }; },
    });
    assert.equal(extracted.model_returned, "gpt-5.6-luna");
    assert.equal(extracted.attempt_metrics.length, 1);
    assert.equal(extracted.attempt_metrics[0].phase, "complete");
    assert.ok(extracted.attempt_metrics[0].budget_ms > 19000 && extracted.attempt_metrics[0].budget_ms <= 20000);
    assert.deepEqual(extracted.trace.attempt_metrics, extracted.attempt_metrics);
    assert.ok(!request.text.format.schema.properties.actions, "extractor cannot return executable actions");
    for (const key of ["duration_minutes", "schedule_horizon_days"]) {
      const valueSchema=schema.properties.fields.items.anyOf.find(item=>item.properties.slot.enum[0]===key).properties.value;
      assert.deepEqual(valueSchema,{type:"integer"},"extraction represents unsupported quantities; action limits stay downstream");
    }
    const unsupportedPrompt="Block selected apps from 10am to 11am weekdays for 40 days.";
    const unsupported=await extractWithModel({prompt:unsupportedPrompt,fetchImpl:async()=>({ok:true,json:async()=>bodyFor([field("schedule_horizon_days",40,"40 days")])})});
    assert.equal(unsupported.extraction.set.schedule_horizon_days,40);
    assert.deepEqual(unsupported.rejected,[{slot:"schedule_horizon_days",code:"ungrounded_model_fact"}]);
    const unsupportedResult=advanceSemanticState({prompt:unsupportedPrompt,extraction:unsupported.extraction});
    assert.deepEqual(unsupportedResult.actions,[]);
    assert.equal(unsupportedResult.decision.slot,"schedule_horizon_days");
    const accepted = advanceSemanticState({ prompt: "Just once", previousState: first.state, extraction: extracted.extraction });
    assert.equal(accepted.state.slots.recurrence.value.type, "once");
    assert.deepEqual(accepted.actions, [{ type:"start_protection", minutes:30, hard_mode:false }], "the user's final fact authorizes the explicit activation request");

    const hostile = await extractWithModel({ prompt: "45 minutes", previousState: first.state, fetchImpl: async () => ({ ok: true, json: async () => bodyFor([field("duration_minutes", 5, "45 minutes"), field("apps", ["TikTok"], "45 minutes")]) }) });
    const safe = advanceSemanticState({ prompt: "45 minutes", previousState: first.state, extraction: hostile.extraction });
    assert.equal(safe.state.slots.duration_minutes.value, 45);
    assert.deepEqual(safe.state.slots.apps.value, ["Instagram"]);
    assert.equal(hostile.rejected.length, 2, "wrong duration and unrelated app are rejected");
    assert.deepEqual(safe.actions, []);

    const morning = parseCandidate(bodyFor([field("moment", "mornings", "mornings")]), "I want to scroll less in the mornings");
    assert.equal(morning.candidate.set.moment, "mornings", "a native string must never be reparsed as a JSON document");
    assert.equal(parseCandidate(bodyFor([field("duration_minutes", 45, "45 minutes")]), "45 minutes").candidate.set.duration_minutes, 45);
    assert.deepEqual(parseCandidate(bodyFor([field("apps", ["Instagram"], "Instagram")]), "Instagram").candidate.set.apps, ["Instagram"]);
    assert.throws(() => parseCandidate(bodyFor([{slot:"moment",value_json:"mornings",evidence:"mornings"}]), "mornings"), /invalid_semantic_extraction_field/);

    assert.throws(() => parseCandidate(bodyFor([field("start", { type: "time", minute: 600 }, "10am")]), "11am"), /ungrounded/);
    assert.throws(() => parseCandidate(bodyFor([field("confirmation", true, "yes")]), "yes"), /invalid_semantic_extraction_slot/);
    assert.throws(() => parseCandidate(bodyFor([field("end", 600, "10am"), field("end", 660, "10am")]), "10am"), /duplicate/);
    let retryCalls = 0;
    const repaired = await extractWithModel({ prompt: "45 minutes", previousState:first.state,
      fetchImpl: async (_url, options) => {
        retryCalls++;
        if (retryCalls === 2) assert.match(JSON.parse(options.body).input.at(-1).content,/repeated a slot/);
        return { ok:true, json:async()=>bodyFor(retryCalls === 1
          ? [field("duration_minutes",30,"45 minutes"),field("duration_minutes",45,"45 minutes")]
          : [field("duration_minutes",45,"45 minutes")]) };
      } });
    assert.equal(retryCalls,2); assert.equal(repaired.extraction.set.duration_minutes,45);
    assert.deepEqual(repaired.attempt_errors,["duplicate_semantic_extraction_slot"]);
    assert.deepEqual(repaired.trace.attempt_errors,repaired.attempt_errors);
    assert.equal(repaired.attempt_metrics.length, 2, "both parsed responses retain their separate request measurements");
    assert.ok(repaired.attempt_metrics.every(metrics => metrics.phase === "complete"));
    assert.deepEqual(repaired.trace.attempt_metrics, repaired.attempt_metrics);
    let failedCalls=0;
    await assert.rejects(()=>extractWithModel({prompt:"45 minutes",fetchImpl:async()=>{
      failedCalls++; return {ok:true,json:async()=>bodyFor([field("duration_minutes",30,"45 minutes"),field("duration_minutes",45,"45 minutes")])};
    }}),error=>{
      assert.match(error.message,/duplicate/); assert.equal(error.semantic_attempt_count,2);
      assert.deepEqual(error.semantic_attempt_errors,["duplicate_semantic_extraction_slot","duplicate_semantic_extraction_slot"]);return true;
    });
    assert.equal(failedCalls,2,"malformed extraction retry is bounded");

    const evidencePrompt = "Pon un límite de uso de 20 minutos al día para mis distracciones desde ahora, pero solo durante los próximos 7 días.";
    const nonliteralEvidence = bodyFor([field("action_type","daily_limit","Un límite de uso de 20 minutos al día")]);
    const literalEvidence = bodyFor([
      field("action_type","daily_limit","un límite de uso de 20 minutos al día"),
      field("duration_minutes",20,"20 minutos"),
      field("schedule_horizon_days",7,"durante los próximos 7 días"),
    ]);
    assert.throws(()=>parseCandidate(nonliteralEvidence,evidencePrompt),/ungrounded_semantic_extraction_evidence/,"capitalization changes must not pass exact evidence validation");
    let evidenceCalls=0;
    const evidenceRepaired=await extractWithModel({prompt:evidencePrompt,fetchImpl:async(_url,options)=>{
      evidenceCalls++;
      if(evidenceCalls===2){
        const hint=JSON.parse(options.body).input.at(-1).content;
        assert.match(hint,/Copy evidence literally/); assert.match(hint,/Omit any field/);
        assert.doesNotMatch(hint,/Un límite/,"repair instruction must not reflect rejected model content");
      }
      return {ok:true,json:async()=>evidenceCalls===1?nonliteralEvidence:literalEvidence};
    }});
    assert.equal(evidenceCalls,2); assert.equal(evidenceRepaired.attempt_count,2);
    assert.deepEqual(evidenceRepaired.attempt_errors,["ungrounded_semantic_extraction_evidence"]);
    assert.deepEqual(evidenceRepaired.trace.attempt_errors,evidenceRepaired.attempt_errors);
    const expiryAfterRepair=advanceSemanticState({prompt:evidencePrompt,extraction:evidenceRepaired.extraction,context:{channel:"ios",screen_time_authorized:true,has_selected_apps:true}});
    assert.equal(expiryAfterRepair.state.slots.duration_minutes.value,20);
    assert.equal(expiryAfterRepair.state.slots.schedule_horizon_days.value,7);
    assert.equal(expiryAfterRepair.decision.slot,"schedule_horizon_days"); assert.deepEqual(expiryAfterRepair.actions,[]);
    let repeatedEvidenceCalls=0;
    await assert.rejects(()=>extractWithModel({prompt:evidencePrompt,fetchImpl:async()=>{
      repeatedEvidenceCalls++; return {ok:true,json:async()=>nonliteralEvidence};
    }}),error=>{
      assert.equal(error.semantic_attempt_count,2);
      assert.deepEqual(error.semantic_attempt_errors,["ungrounded_semantic_extraction_evidence","ungrounded_semantic_extraction_evidence"]);return true;
    });
    assert.equal(repeatedEvidenceCalls,2,"a second invalid quote must fail, never start a third attempt");

    let inventedValueCalls=0;
    const inventedValue=await extractWithModel({prompt:"25 minutes",previousState:first.state,fetchImpl:async()=>{
      inventedValueCalls++;return {ok:true,json:async()=>bodyFor([field("duration_minutes",45,inventedValueCalls===1?"25 MINUTES":"25 minutes")])};
    }});
    assert.equal(inventedValueCalls,2);
    assert.deepEqual(inventedValue.rejected,[{slot:"duration_minutes",code:"ungrounded_model_fact"}],"literal evidence does not authorize an invented value");
    const safeRepair=advanceSemanticState({prompt:"25 minutes",previousState:first.state,extraction:inventedValue.extraction});
    assert.equal(safeRepair.state.slots.duration_minutes.value,25);assert.deepEqual(safeRepair.actions,[]);
    let omittedCalls=0;
    const omitted=await extractWithModel({prompt:"25 minutes",fetchImpl:async()=>{
      omittedCalls++;return {ok:true,json:async()=>bodyFor(omittedCalls===1
        ? [field("duration_minutes",25,"25 minutes"),field("apps",["TikTok"],"not in the message")]
        : [])};
    }});
    assert.equal(omittedCalls,2);assert.deepEqual(omitted.extraction,{set:{},evidence:{}},"second candidate must not inherit any earlier rejected candidate fields");
    let quotaAfterRepairCalls=0;
    await assert.rejects(()=>extractWithModel({prompt:evidencePrompt,fetchImpl:async()=>{
      quotaAfterRepairCalls++;return quotaAfterRepairCalls===1?{ok:true,json:async()=>nonliteralEvidence}:{ok:false,status:429};
    }}),error=>{
      assert.equal(error.message,"semantic_model_http_429"); assert.equal(error.semantic_attempt_count,2);
      assert.equal(error.semantic_attempt_metrics.length, 2);
      assert.equal(error.semantic_attempt_metrics[0].phase, "complete");
      assert.equal(error.semantic_attempt_metrics[1].http_status, 429);
      assert.deepEqual(error.semantic_attempt_errors,["ungrounded_semantic_extraction_evidence","semantic_model_http_429"]);return true;
    });
    assert.equal(quotaAfterRepairCalls,2,"quota after repair attempt must not trigger a third request");

    const realNow=Date.now, realTimeout=AbortSignal.timeout;
    const budgets=[]; let elapsed=0;
    try {
      Date.now=()=>100000+elapsed;
      AbortSignal.timeout=(milliseconds)=>{budgets.push(milliseconds);return new AbortController().signal;};
      await extractWithModel({prompt:"45 minutes",fetchImpl:async()=>{
        const firstAttempt=elapsed===0; elapsed+=5000;
        return {ok:true,json:async()=>bodyFor(firstAttempt
          ? [field("duration_minutes",30,"45 minutes"),field("duration_minutes",45,"45 minutes")]
          : [field("duration_minutes",45,"45 minutes")])};
      }});
      assert.deepEqual(budgets,[20000,15000],"initial extraction gets its full deadline; an early failure leaves only the remaining budget");
    } finally { Date.now=realNow; AbortSignal.timeout=realTimeout; }
    const evidenceBudgets=[];let evidenceElapsed=0,boundedEvidenceCalls=0;
    try {
      Date.now=()=>100000+evidenceElapsed;
      AbortSignal.timeout=milliseconds=>{evidenceBudgets.push(milliseconds);return new AbortController().signal;};
      await extractWithModel({prompt:evidencePrompt,fetchImpl:async()=>{
        boundedEvidenceCalls++;if(boundedEvidenceCalls===1)evidenceElapsed=12000;
        return {ok:true,json:async()=>boundedEvidenceCalls===1?nonliteralEvidence:literalEvidence};
      }});
      assert.equal(boundedEvidenceCalls,2);assert.deepEqual(evidenceBudgets,[20000,8000],"quote repair uses the same remaining deadline");
    } finally { Date.now=realNow; AbortSignal.timeout=realTimeout; }
    let expiredEvidenceElapsed=0,expiredEvidenceCalls=0;
    try {
      Date.now=()=>100000+expiredEvidenceElapsed;
      await assert.rejects(()=>extractWithModel({prompt:evidencePrompt,fetchImpl:async()=>{
        expiredEvidenceCalls++;expiredEvidenceElapsed=19001;return {ok:true,json:async()=>nonliteralEvidence};
      }}),error=>error.semantic_attempt_count===1&&error.message==="ungrounded_semantic_extraction_evidence");
      assert.equal(expiredEvidenceCalls,1,"less than a second remaining must not start quote repair");
    } finally { Date.now=realNow; }
    let timeoutCalls=0;
    await assert.rejects(()=>extractWithModel({prompt:"yes",fetchImpl:async()=>{
      timeoutCalls++; const error=new Error("timed out");error.name="TimeoutError";throw error;
    }}),{name:"TimeoutError"});
    assert.equal(timeoutCalls,2,"a transient timeout gets one retry inside the same deadline");
    let incompleteCalls=0;
    const recovered=await extractWithModel({prompt:"45 minutes",fetchImpl:async(_url,options)=>{
      incompleteCalls++; const candidateRequest=JSON.parse(options.body);
      if(incompleteCalls===1) return {ok:true,json:async()=>({status:"incomplete",incomplete_details:{reason:"max_output_tokens"}})};
      assert.equal(candidateRequest.max_output_tokens,1400);
      return {ok:true,json:async()=>bodyFor([field("duration_minutes",45,"45 minutes")])};
    }});
    assert.deepEqual(recovered.attempt_errors,["semantic_model_incomplete"]);
    assert.equal(recovered.attempt_count,2);
    const timeoutBudgets=[]; let timeoutElapsed=0, boundedCalls=0;
    try {
      Date.now=()=>100000+timeoutElapsed;
      AbortSignal.timeout=(milliseconds)=>{timeoutBudgets.push(milliseconds);return new AbortController().signal;};
      const bounded=await extractWithModel({prompt:"45 minutes",fetchImpl:async()=>{
        boundedCalls++;
        if(boundedCalls===1){timeoutElapsed+=12000;const error=new Error("timeout");error.name="TimeoutError";throw error;}
        return {ok:true,json:async()=>bodyFor([field("duration_minutes",45,"45 minutes")])};
      }});
      assert.deepEqual(timeoutBudgets,[20000,8000]);
      assert.deepEqual(bounded.attempt_errors,["semantic_model_timeout"]);
    } finally { Date.now=realNow; AbortSignal.timeout=realTimeout; }
    const exhaustedBudgets=[];let exhaustedElapsed=0,exhaustedCalls=0;
    try {
      Date.now=()=>100000+exhaustedElapsed;
      AbortSignal.timeout=milliseconds=>{exhaustedBudgets.push(milliseconds);return new AbortController().signal;};
      await assert.rejects(()=>extractWithModel({prompt:"yes",fetchImpl:async()=>{
        exhaustedCalls++;exhaustedElapsed=20000;
        const error=new Error("deadline exhausted");error.name="TimeoutError";throw error;
      }}),error=>{
        assert.equal(error.name,"TimeoutError");assert.equal(error.semantic_attempt_count,1);
        assert.deepEqual(error.semantic_attempt_errors,["semantic_model_timeout"]);return true;
      });
      assert.equal(exhaustedCalls,1,"a timeout exhausting the shared deadline must never start a second request");
      assert.deepEqual(exhaustedBudgets,[20000]);
    } finally { Date.now=realNow; AbortSignal.timeout=realTimeout; }
    let authCalls=0;
    await assert.rejects(()=>extractWithModel({prompt:"yes",fetchImpl:async()=>{authCalls++;return {ok:false,status:401};}}),/semantic_model_http_401/);
    assert.equal(authCalls,1,"authentication failure must not trigger repeated requests");
    await assert.rejects(() => extractWithModel({ prompt: "yes", fetchImpl: async () => ({ ok: false, status: 503 }) }), /semantic_model_http_503/);
    await assert.rejects(() => extractWithModel({ prompt: "yes", fetchImpl: async () => ({ ok: true, json: async () => ({ status: "incomplete" }) }) }), /semantic_model_incomplete/);
    console.log("semantic extraction: evidence, hostile fields, authority, duplicate/schema and API failure checks passed");
  } finally {
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
