"use strict";
const assert = require("node:assert/strict");
const { isGrounded, plannerAuthorityViolations } = require("../netlify/functions/bm-contextual-response");
const { handler, enforceSemanticBoundary } = require("../netlify/functions/blanked-agent");
const { whatsappReplyText } = require("../netlify/functions/whatsapp-agent");
const { whatsappReplyText: smsReplyText } = require("../netlify/functions/sms-agent");
const { evaluateTurn, projectState } = require("./bm_semantic_oracle");

// Spanish live failure plus independent authority mutations. These assertions
// test the receipt boundary even when the parser recognizes no action intent.
{
const semantic={decision:{type:"none",slot:null},state:{intent:"general",status:"idle"}};
const unsafe=[
  "Listo. Instagram y TikTok quedan limitados a 20 minutos al día durante los próximos 7 días, empezando ahora.",
  "Entendido. El límite de 20 minutos para Instagram y TikTok se mantendrá solo durante 7 días y se desactivará después.",
  "Your apps are now blocked for 30 minutes.",
  "I have scheduled the block from 9pm to 10pm.",
  "Voy a bloquear tus distracciones ahora.",
  "El horario está programado y se activará esta noche.",
  "Your daily limit will expire after seven days.",
  "A daily limit expires automatically after seven days.",
  "El límite diario caduca automáticamente después de siete días.",
  "No worries, your apps are blocked.",
  "No he aplicado un bloqueo, pero tus apps están bloqueadas.",
  "If your apps are blocked, I've unblocked them.",
  "Si tus apps están bloqueadas, las he desbloqueado.",
  "You said you are ready and I have applied the daily limit.",
  "Me dices que estás listo y he aplicado el límite diario.",
  "If you are ready I have blocked your distractions.",
  "Si estás listo he bloqueado tus distracciones.",
];
for(const text of unsafe){
  const plan={response_text:text,message_text:text,speech_text:text,actions:[],native_receipt:{status:"verified"}};
  const gated=enforceSemanticBoundary(plan,semantic,text.startsWith("Your")||text.startsWith("I ")||text.startsWith("A ")?"en":"es");
  assert.equal(gated.execution_boundary?.decision,"rejected",text);
  assert.deepEqual(gated.actions,[]);assert.equal(gated.response_text,gated.message_text);assert.equal(gated.response_text,gated.speech_text);
  assert.doesNotMatch(gated.response_text,/quedan limitados|se desactivara|are now blocked|have scheduled|will expire/);
}
const natural=[
  "You said your apps are blocked. What happened next?",
  "Me dices que tus apps están bloqueadas. ¿Qué ocurrió después?",
  "I would block distracting apps for 30 minutes while you study.",
  "Podrías probar un bloqueo de 30 minutos mientras estudias.",
  "I haven't applied any changes. A daily limit does not expire automatically.",
  "No he aplicado cambios. El límite diario no caduca automáticamente.",
  "A daily limit will block distractions after you use your allowance.",
  "Un límite diario se activará cuando agotas tu tiempo de uso.",
  "I've withdrawn this instruction. If protection has already started on your iPhone, you'll need to stop it there.",
  "He retirado esta instrucción. Si la protección ya empezó en tu iPhone, tendrás que detenerla allí.",
  "Thanks for telling me. What usually pulls you back into scrolling?",
  "If your apps are blocked, open Blankmind to inspect the current protection.",
  "Si tus apps están bloqueadas, abre Blankmind para revisar la protección actual.",
  "If your apps are blocked then open Blankmind to inspect the current protection.",
  "Si tus apps están bloqueadas entonces abre Blankmind para revisar la protección actual.",
  "You said your apps are blocked and you are ready to review the settings.",
  "If your apps are blocked and I have already applied the limit, open Blankmind to check its current state.",
  "Si tus apps están bloqueadas y he aplicado el límite, abre Blankmind para comprobar el estado actual.",
];
for(const text of natural){const plan={response_text:text,message_text:text,actions:[]};assert.equal(enforceSemanticBoundary(plan,semantic,"en").response_text,text,text);assert.deepEqual(plannerAuthorityViolations(plan),[],text);}
for(const type of ["start_protection","set_daily_limit","enable_adult_filter","enable_allow_only"]){
  const plan={actions:[{type,minutes:20}],response_text:"We can discuss this.",bullets:["Activation ready"],followup_text:"Apply",blocking_ready:true};
  const gated=enforceSemanticBoundary(plan,semantic,"en");
  assert.deepEqual(gated.actions,[]);assert.deepEqual(gated.bullets,[]);assert.equal(gated.followup_text,"");assert.equal(gated.blocking_ready,null);
  assert.ok(gated.execution_boundary.reasons.includes("unvalidated_model_action"));
}
const adviceState={state:{status:"idle",intent:"advice"},decision:{type:"none"}};
const advice={response_text:"Based on your stronger adherence, keep the lunch window and move it earlier on difficult days.",actions:[{type:"apply_schedule",start_minute:765,end_minute:840}]};
const boundedAdvice=enforceSemanticBoundary(advice,adviceState,"en");
assert.equal(boundedAdvice.response_text,advice.response_text);assert.deepEqual(boundedAdvice.actions,[]);
assert.equal(boundedAdvice.execution_boundary.decision,"advice_only");
assert.equal(enforceSemanticBoundary({...advice,response_text:"Your apps are blocked."},adviceState,"en").execution_boundary.decision,"rejected");
assert.equal(isGrounded("I have applied your daily limit of 20 minutes.",{response_contract:{operation:"semantic_ready",action_type:"daily_limit"},actions:[{type:"set_daily_limit",minutes:20}]},{}),false);
assert.equal(isGrounded("Your daily limit of 20 minutes will expire after 7 days.",{response_contract:{operation:"semantic_ready",action_type:"daily_limit"},actions:[{type:"set_daily_limit",minutes:20}]},{}),false);
}

// Both public provider adapters must honor the real delivery receipt, even if
// the planner prematurely told the user to tap a notification.
for (const reply of [whatsappReplyText, (plan, delivery) => smsReplyText(plan, "", delivery)]) {
  for (const type of ["request_screen_time_permission", "open_app_picker", "set_daily_limit"]) {
    const action = { type, minutes:35, name:"Daily Limit" };
    const plan = { response_language:"en", message_text:"Tap the Blankmind notification to choose the apps and apply the block.", actions:[action] };
    const unsent = reply(plan);
    assert.match(unsent,/haven't sent the request yet/);
    assert.doesNotMatch(unsent,/tap.*notification/i);
    const failed = reply(plan,{action,push:{sent:false,reason:"missing_device_token"}});
    assert.match(failed,/couldn't send a notification/i);
    assert.match(failed,/Open Blankmind/);
    assert.doesNotMatch(failed,/tap.*notification/i);
    const sent = reply(plan,{action,push:{sent:true}});
    assert.match(sent,/Tap the Blankmind notification/);
    if (type === "request_screen_time_permission") {
      for (const text of [failed,sent]) {
        assert.match(text,/grant blocking permission.*tell me/);
        assert.doesNotMatch(text,/choose|selection|apply/i);
      }
    } else {
      for (const text of [failed,sent]) assert.match(text,/35 minutes per day/);
      if (type === "open_app_picker") assert.match(sent,/notification.*choose.*confirm the selection.*apply/i);
      assert.match(sent,/verif/i);
    }
  }
  const genericPicker={type:"open_app_picker",minutes:null,start_minute:null,end_minute:null};
  const generic=reply({actions:[genericPicker]},{action:genericPicker,push:{sent:true}});
  assert.match(generic,/no complete blocking proposal/i);
  assert.doesNotMatch(generic,/apply/i);
  for (const type of ["apply_schedule","update_schedule","open_app_picker"]) {
    const action={type,start_minute:1320,end_minute:420,weekdays:[2,4],duration_days:7,hard_mode:true};
    const output=reply({actions:[action]},{action,push:{sent:true}});
    assert.match(output,/22:00 to 07:00.*Monday, Wednesday/);
    if(type === "update_schedule") { assert.match(output,/keeping its existing expiry/); assert.doesNotMatch(output,/7 days/); }
    else assert.match(output,/7 days/);
    assert.match(output,/hard block/);
    assert.doesNotMatch(output,/already|has been applied|is active/i);
  }
  const dailyPicker={type:"open_app_picker",name:"Daily Limit",minutes:30,start_minute:600,end_minute:660};
  assert.match(reply({actions:[dailyPicker]},{action:dailyPicker,push:{sent:true}}),/30 minutes per day/);
  const legacySchedule={type:"apply_schedule",start_minute:600,end_minute:660};
  assert.match(reply({actions:[legacySchedule]},{action:legacySchedule,push:{sent:true}}),/every day.*7 days/);
  const original="Open Blankmind to connect your device before continuing.";
  assert.equal(reply({message_text:original,actions:[],semantic_state:{status:"needs_setup"}}),original);
  const review=reply({actions:[{type:"start_protection",minutes:30}],review_only_actions:true},
    {action:{type:"start_protection"},push:{sent:true}});
  assert.match(review,/Open Blankmind.*Execution is not verified/);
  assert.doesNotMatch(review,/tap.*notification/i);
}

// Reproduce observed model outputs through the real endpoint's final boundary.
// No provider calls: the extraction and rewrite responses are injected, while
// parser/reducer/contract/gates and public surfaces remain the production code.
const semantic = { operation:"semantic_ready", action_type:"daily_limit" };
for (const text of [
  "Your selected distractions are limited to 45 minutes per day, starting now.",
  "Your selected distractions are now set for 30 minutes per day.",
  "I've set your daily limit to 30 minutes.",
  "I'm sending a daily limit that blocks your selected apps for 30 minutes, starting now. Tap the Blankmind notification.",
]) assert.equal(isGrounded(text,{actions:[],response_contract:semantic},{}),false,text);
assert.equal(isGrounded("A daily limit of 30 minutes is ready for approval.",{actions:[],response_contract:semantic},{}),true);
assert.equal(isGrounded("A daily limit blocks the selected distractions after you use 30 minutes per day.",{actions:[],response_contract:semantic},{}),true);

async function verifyFreeformDeadlines() {
  const old={fetch:global.fetch,key:process.env.OPENAI_API_KEY,timeout:AbortSignal.timeout};
  process.env.OPENAI_API_KEY="mock-not-sent";
  const aborted=signal=>new Promise((_,reject)=>{
    if(signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort",()=>reject(signal.reason),{once:true});
  });
  try {
    for(const [prompt,kind,source] of [
      ["Hello","conversation","deterministic_conversation_fallback_after_model_error"],
      ["How can I reduce my screen time?","planner","deterministic_fallback_after_model_error"],
    ]) {
      const invoke=async()=>{
        const result=await handler({httpMethod:"POST",body:JSON.stringify({prompt,context:{channel:"whatsapp",language:"en"}})});
        assert.equal(result.statusCode,200); const body=JSON.parse(result.body);
        assert.equal(body.source,source); assert.deepEqual(body.plan.actions,[]); assert.ok(body.plan.message_text);
        return body;
      };
      // The same fetch signal must bound both waiting for headers and consuming
      // the response body; a mock that throws immediately would not prove this.
      for(const phase of ["headers","body"]) {
        let calls=0; const budgets=[];
        AbortSignal.timeout=ms=>{budgets.push(ms);const c=new AbortController();setImmediate(()=>c.abort(new DOMException("timed out","TimeoutError")));return c.signal;};
        global.fetch=async(url,options)=>{
          assert.equal(url,"https://api.openai.com/v1/responses"); calls++; assert.ok(options.signal);
          if(phase==="headers") return aborted(options.signal);
          return {ok:true,status:200,json:()=>aborted(options.signal)};
        };
        assert.equal((await invoke()).model_error,`openai_${kind}_timeout`);
        assert.deepEqual(budgets,[30000]); assert.equal(calls,1,"free conversation and planner do not retry a timed-out request");
      }
      for(const fault of ["http","network"]) {
        let calls=0,reads=0,cancelled=0;
        AbortSignal.timeout=ms=>{assert.equal(ms,30000);return new AbortController().signal;};
        global.fetch=async()=>{
          calls++;
          if(fault==="network") throw new Error("Authorization: Bearer synthetic-private-value");
          return {ok:false,status:503,body:{cancel:async()=>{cancelled++;}},text:async()=>{reads++;return "Authorization: Bearer synthetic-private-value";}};
        };
        const body=await invoke();
        assert.equal(body.model_error,fault==="http"?(kind==="conversation"?"openai_conversation_failed_503":"openai_failed_503"):`openai_${kind}_failed`);
        assert.doesNotMatch(JSON.stringify(body),/synthetic-private-value|Authorization:/);
        assert.equal(calls,1); assert.equal(reads,0); if(fault==="http") assert.equal(cancelled,1);
      }
    }
  } finally {
    global.fetch=old.fetch; AbortSignal.timeout=old.timeout;
    if(old.key===undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY=old.key;
  }
}

async function verifyInstrumentedSemanticDeadlines() {
  const old = { fetch: global.fetch, key: process.env.OPENAI_API_KEY, timeout: AbortSignal.timeout, info: console.info,
    url: process.env.SUPABASE_URL, service: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.OPENAI_API_KEY = "instrumentation-key-never-sent";
  process.env.SUPABASE_URL = ""; process.env.SUPABASE_SERVICE_ROLE_KEY = "";
  const keepAlive = setTimeout(() => {}, 2000);
  try {
    for (const stage of ["extraction", "contextual"]) {
      for (const phase of ["headers", "body"]) {
        const budgets = [], stages = []; let calls = 0, trace;
        console.info = (...values) => {
          if (values[0] === "bm_harness") stages.push(JSON.parse(values[1]));
          else old.info(...values);
        };
        // Preserve the real AbortSignal implementation while accelerating the
        // clock. The requested production budgets are asserted separately.
        AbortSignal.timeout = milliseconds => { budgets.push(milliseconds); return old.timeout(10); };
        global.fetch = async (url, options) => {
          assert.equal(String(url), "https://api.openai.com/v1/responses"); calls++;
          const structured = Boolean(JSON.parse(options.body).text?.format?.schema);
          if (stage === "contextual" && structured) return { ok: true, status: 200,
            headers: new Headers({ "x-request-id": "req_internal_extraction_success" }),
            json: async () => ({ model: "mock-model", status: "completed", output_text: JSON.stringify({ fields: [], ambiguities: [] }),
              usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, output_tokens_details: { reasoning_tokens: 3 } } }) };
          const aborted = () => new Promise((_, reject) => {
            if (options.signal.aborted) reject(options.signal.reason);
            else options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
          });
          if (phase === "headers") return aborted();
          return { ok: true, status: 200, headers: new Headers({ "x-request-id": "req_internal_body_timeout" }), json: aborted };
        };
        const prompt = stage === "extraction" ? "Block selected apps now for 30 minutes once."
          : "What should I do about selected apps now for 30 minutes once?";
        const response = await handler({ httpMethod: "POST", body: JSON.stringify({ prompt, context: {
          channel: "whatsapp", language: "en", protection_target: "selected_distractions", has_selected_apps: true,
          screen_time_authorized: true, app_presence: { app_present: true, app_ready: true, last_seen_at: new Date().toISOString() },
        } }) }, { captureSemanticTrace: value => { trace = value; } });
        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.model_error, stage === "extraction" ? "semantic_model_timeout" : "contextual_response_timeout");
        assert.ok(budgets[0] > 19000 && budgets[0] <= 20000, "initial extraction retains its original shared twenty-second deadline");
        assert.ok(trace.model_requests);
        if (stage === "extraction") {
          assert.equal(calls, 2, "an early aborted double gets at most the existing second attempt");
          assert.ok(budgets[1] <= budgets[0] && budgets[1] > 19000);
          assert.equal(trace.model_requests.extraction.length, 2);
          assert.equal(trace.model_requests.extraction_execution.winner_attempt, null);
          assert.equal(trace.model_requests.extraction_execution.attempts.length, 2);
          assert.equal(trace.model_requests.contextual, null, "canonical block recovery cannot make a rewrite call");
          assert.ok(trace.model_requests.extraction.every(metrics => metrics.phase === phase && metrics.error_name === "TimeoutError"));
        } else {
          assert.equal(calls, 2);
          assert.equal(budgets[1], 12000, "contextual naturalization keeps its original twelve-second budget");
          assert.equal(trace.model_requests.extraction.length, 1);
          assert.equal(trace.model_requests.extraction_execution.winner_attempt, 1);
          assert.equal(trace.model_requests.extraction[0].phase, "complete");
          assert.deepEqual(trace.model_requests.extraction[0].usage, { input_tokens: 10, output_tokens: 5, total_tokens: 15, reasoning_tokens: 3 });
          assert.ok(stages.some(stage => stage.request_metrics?.usage_input === 10 && stage.request_metrics?.usage_reasoning === 3),
            "numeric usage survives the stage privacy filter without exposing provider payloads");
          assert.equal(trace.model_requests.contextual.phase, phase);
          assert.equal(trace.model_requests.contextual.budget_ms, 12000);
          assert.equal(trace.model_requests.contextual.error_name, "TimeoutError");
        }
        const measured = stage === "extraction" ? trace.model_requests.extraction[0] : trace.model_requests.contextual;
        if (phase === "body") { assert.equal(measured.http_status, 200); assert.equal(measured.request_id, "req_internal_body_timeout"); }
        else assert.equal(measured.http_status, undefined);
        assert.equal(body.model_requests, undefined);
        assert.equal(body.harness?.model_requests, undefined);
        assert.doesNotMatch(JSON.stringify(body), /req_internal_|attempt_metrics|request_metrics|model_requests|attempt_execution|instrumentation-key-never-sent|"authorization"\s*:|Bearer/i,
          "internal transport diagnostics and request IDs must never appear in the public response or harness metadata");
      }
    }
  } finally {
    clearTimeout(keepAlive);
    global.fetch = old.fetch; AbortSignal.timeout = old.timeout; console.info = old.info;
    for (const [key, value] of [["OPENAI_API_KEY", old.key], ["SUPABASE_URL", old.url], ["SUPABASE_SERVICE_ROLE_KEY", old.service]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

(async()=>{
  await verifyFreeformDeadlines();
  await verifyInstrumentedSemanticDeadlines();
  const oldFetch=global.fetch, oldKey=process.env.OPENAI_API_KEY;
  const oldURL=process.env.SUPABASE_URL, oldService=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.OPENAI_API_KEY="mock-key-not-sent";
  process.env.SUPABASE_URL=""; process.env.SUPABASE_SERVICE_ROLE_KEY="";
  let rewrite=null, rewriteFailure=null, extractionFailure=false, failedExtractions=0; const calls=[];
  global.fetch=async(url,options)=>{
    assert.equal(String(url),"https://api.openai.com/v1/responses");
    const request=JSON.parse(options.body); calls.push(request);
    const structured=Boolean(request.text?.format?.schema);
    if (!structured && rewriteFailure) throw rewriteFailure;
    if(structured && extractionFailure) {
      failedExtractions++;
      if(failedExtractions===2) {const error=new Error("timeout");error.name="TimeoutError";throw error;}
      const body={model:"mock-model",status:"completed",output_text:JSON.stringify({fields:[
        {slot:"duration_minutes",value:30,evidence:"30 minutes"},
        {slot:"duration_minutes",value:40,evidence:"30 minutes"},
      ],ambiguities:[]})};
      return {ok:true,status:200,json:async()=>body};
    }
    const payload=JSON.parse(request.input.find(item=>item.role==="user").content);
    const text=structured ? JSON.stringify({fields:[],ambiguities:[]})
      : rewrite || payload.deterministic_fallback || "I can help you understand your digital habits.";
    const body={model:"mock-model",status:"completed",output_text:text};
    return {ok:true,status:200,json:async()=>body,text:async()=>JSON.stringify(body)};
  };
  const context={channel:"whatsapp",assistant_channel:"whatsapp",language:"en",has_selected_apps:true,selection_count:3,
    protection_target:"selected_distractions",screen_time_authorized:true,
    app_presence:{app_present:true,app_ready:true,last_seen_at:new Date().toISOString()},app_presence_recent:true,app_presence_state:"recently_seen"};
  async function call(prompt,state,patch={},runtime={}) {
    const response=await handler({httpMethod:"POST",body:JSON.stringify({prompt,context:{...context,...patch,semantic_state:state}})},runtime);
    assert.equal(response.statusCode,200); const body=JSON.parse(response.body); assert.equal(body.ok,true); return body;
  }
  try {
    rewrite="Listo. Instagram y TikTok quedan limitados a 20 minutos al día durante los próximos 7 días, empezando ahora.";
    const noAuthority=await call("Hola",null,{language:"es",locale:"es_ES"});
    assert.equal(noAuthority.plan.execution_boundary?.decision,"rejected","a conversation response has no execution authority, including when its input has no recognized action intent");
    assert.deepEqual(noAuthority.plan.actions,[]);
    assert.doesNotMatch(noAuthority.plan.message_text,/quedan limitados|proximos 7|próximos 7/);
    assert.equal(noAuthority.plan.response_text,noAuthority.plan.speech_text);
    rewrite="Your selected distractions can be blocked now for 2 minutes, but immediate blocks need to be 5–240 minutes. What duration do you want?";
    const rejectedDurationBefore=calls.length;
    const rejectedDuration=await call("Block selected apps now for 2 minutes, once.");
    assert.equal(calls.length-rejectedDurationBefore,1,"native capability rejection allows extraction but does not rewrite a rejected quantity into executable facts");
    assert.deepEqual(rejectedDuration.plan.actions,[]);
    assert.equal(rejectedDuration.plan.semantic_decision.slot,"duration_minutes");
    assert.match(rejectedDuration.plan.message_text,/5 to 240 minutes/);
    assert.doesNotMatch(rejectedDuration.plan.message_text,/can be blocked|will be blocked/);
    rewrite=null;
    const first=await call("Block selected apps now for 30 minutes once.");
    const cancelled=await call("Cancel this request.",first.plan.semantic_state);
    assert.match(cancelled.plan.message_text,/withdrawn this instruction/);
    assert.match(cancelled.plan.message_text,/If protection has already started on your device/);
    rewrite="Do you want me to restart the old block? Nothing is active.";
    const before=calls.length;
    const acknowledged=await call("Yes.",cancelled.plan.semantic_state,{recent_messages:[
      {role:"user",content:"Block selected apps now for 30 minutes once."},
      {role:"assistant",content:"Tap the notification to block for 30 minutes."},
      {role:"user",content:"Cancel this request."},
    ]});
    assert.equal(calls.length-before,1,"cancelled acknowledgement only extracts; it never invokes free conversation or an execution rewrite");
    assert.equal(acknowledged.plan.semantic_state.intent,"cancelled");
    assert.deepEqual(acknowledged.plan.actions,[]); assert.deepEqual(acknowledged.plan.bullets,[]);
    assert.doesNotMatch(acknowledged.plan.message_text,/restart|nothing (?:is active|will start)/i);

    rewrite="Your selected distractions are limited to 45 minutes per day, starting now. Tap the Blankmind notification to finish.";
    const limitBefore=calls.length;
    const limit=await call("Set a 45-minute daily limit for selected apps now.");
    assert.match(limit.source,/grounded_canonical_response/);
    assert.equal(calls.length-limitBefore,1,"a validated block uses extraction and canonical copy, with no second model call");
    assert.match(limit.plan.message_text,/45 minutes per day/);
    assert.doesNotMatch(limit.plan.message_text,/are limited/);
    assert.equal(limit.plan.actions[0].type,"set_daily_limit");

    rewrite="Got it: your selected distractions now for 35 minutes. Tap the Blankmind notification and grant permission, then tell me when ready.";
    const permission=await call("Set a 35-minute daily limit for selected apps now.",null,{screen_time_authorized:false});
    assert.match(permission.source,/grounded_canonical_response/);
    assert.match(permission.plan.message_text,/35 minutes per day/);
    assert.match(permission.plan.message_text,/grant blocking permission/);
    assert.equal(permission.plan.actions[0].type,"request_screen_time_permission");
    assert.equal(permission.semantic_state.slots.action_type.value,"daily_limit");
    assert.equal(permission.semantic_state.slots.duration_minutes.value,35);

    rewrite="Your selected distractions will run from 10:00 AM to 11:00 AM every day for 7 days. Choose your distractions in Blankmind, then tap the Blankmind notification and confirm.";
    const picker=await call("Block selected apps from 10am to 11am every day for 7 days.",null,{has_selected_apps:false,selection_count:0});
    assert.match(picker.source,/grounded_canonical_response/);
    const visible=picker.plan.message_text;
    assert.ok(visible.indexOf("Blankmind notification")<visible.indexOf("choose"));
    assert.ok(visible.indexOf("choose")<visible.indexOf("confirm the selection"));
    assert.match(visible,/every day.*7 days/); assert.equal(picker.plan.actions[0].type,"open_app_picker");
    assert.match(visible,/device verifies/);

    rewrite="Limit your selected distractions to 50 minutes per day, starting now. Tap the Blankmind notification, choose your distractions, and accept the picker so your phone can apply the plan.";
    const limitNeedsSelection=await call("Set a 50-minute daily limit for selected apps now.",null,{has_selected_apps:false,selection_count:0});
    assert.equal(limitNeedsSelection.plan.actions[0].type,"open_app_picker");
    const selectionRecovered=await call("Ready.",limitNeedsSelection.plan.semantic_state,{has_selected_apps:true,selection_count:3});
    assert.equal(selectionRecovered.plan.title,"Request prepared","a suppressed replay must not show a sending title");
    assert.deepEqual(selectionRecovered.plan.actions,[],"the native picker already carried this executable daily limit");
    assert.match(selectionRecovered.source,/grounded_execution_boundary/);
    assert.doesNotMatch(selectionRecovered.plan.message_text,/choose your distractions|picker/);
    assert.match(selectionRecovered.plan.message_text,/50 minutes per day/);
    assert.match(selectionRecovered.plan.message_text,/already prepared/);

    rewrite=null;
    const unsupportedBefore=calls.length;
    const unsupported=await call("Set a 60-minute daily limit for selected apps at 09:00 for 7 days.");
    assert.equal(calls.length-unsupportedBefore,1,"a rejected native capability is not rewritten as an executable promise");
    assert.match(unsupported.source,/grounded_execution_boundary/);
    assert.match(unsupported.plan.message_text,/daily limit.*60 minutes per day/);
    assert.match(unsupported.plan.message_text,/only start now/);
    assert.deepEqual(unsupported.plan.actions,[]);
    const ordinary=await call("Can you read the contents of my private messages?");
    assert.deepEqual(ordinary.plan.bullets,[],"internal diagnostic bullets are absent from conversation surfaces");

    // Blocking requests never invoke the contextual model. Advice still can,
    // and a timeout there must remain visible instead of silently passing safety.
    const advicePrompt="What should I do about selected apps now for 30 minutes once?";
    const advice=await call(advicePrompt);
    assert.equal(advice.semantic_state.intent,"advice");
    rewriteFailure=Object.assign(new Error("request timed out"),{name:"TimeoutError"});
    const canonicalBefore=calls.length;
    const canonical=await call("Block selected apps now for 30 minutes once.");
    assert.equal(calls.length-canonicalBefore,1); assert.equal(canonical.model_error,null);
    assert.deepEqual(canonical.plan.actions,first.plan.actions);
    let timeoutTrace;
    const prompt=advicePrompt;
    const timedOut=await call(prompt,null,{}, {captureSemanticTrace:value=>{timeoutTrace=value;}});
    assert.deepEqual(timedOut.plan.actions,advice.plan.actions);
    assert.deepEqual(projectState(timedOut.plan.semantic_state),projectState(advice.plan.semantic_state));
    assert.match(timedOut.source,/grounded_deterministic_after_model_error/);
    assert.match(timedOut.plan.message_text,/30 minutes/);
    assert.doesNotMatch(timedOut.plan.message_text,/already blocked|is active|has been applied/i);
    assert.equal(timedOut.model_error,"contextual_response_timeout");
    assert.deepEqual(timedOut.contextual_response_failure,{code:"contextual_response_timeout",name:"TimeoutError"});
    assert.deepEqual(timeoutTrace.contextual_response_failure,timedOut.contextual_response_failure);
    const assessment=evaluateTurn({body:timedOut,inputs:[prompt],context,expected:{
      state:projectState(advice.plan.semantic_state),decision:advice.plan.semantic_decision,actions:advice.plan.actions,language:"en",
    }});
    assert.equal(assessment.dimensions.actions,"passed");
    assert.equal(assessment.dimensions.safety,"failed");
    assert.ok(assessment.issues.some(issue=>issue.code==="model_failure_masked_by_fallback"&&issue.actual==="contextual_response_timeout"));
    for(const [error,code] of [
      [new Error("contextual_response_http_503"),"contextual_response_http_503"],
      [Object.assign(new Error("fetch failed"),{name:"TypeError"}),"contextual_response_network_error"],
      [new Error("Authorization: Bearer private-fixture-value"),"contextual_response_error"],
    ]) {
      rewriteFailure=error;
      const failed=await call(prompt);
      assert.equal(failed.model_error,code);
      assert.equal(failed.contextual_response_failure.code,code);
      assert.doesNotMatch(JSON.stringify(failed),/private-fixture-value|Authorization:/);
      assert.deepEqual(failed.plan.actions,advice.plan.actions);
    }

    // Schedule management and personal recommendations retain contextual AI.
    // Their existing deterministic recovery must expose the same bounded,
    // redacted failure contract, including when an authorized action is queued.
    const scheduleContext={schedule:{enabled:true,windows:[{
      id:"2D7B82F5-3F07-48F2-8D20-D4E7EA02967E",name:"Lunch focus",enabled:true,
      start_minute:780,end_minute:840,weekdays:[1,2,3,4,5,6,7],
    }]},recent_plan_outcomes:[{outcome:"held"}]};
    for(const [contextPrompt,source,actionTypes] of [
      ["Delete all blocking windows.","schedule_management_v2",["delete_all_schedules"]],
      ["What should I do this week?","personal_context_v2",[]],
    ]) {
      rewriteFailure=null;
      const healthy=await call(contextPrompt,null,scheduleContext);
      assert.equal(healthy.model_error,null);
      assert.deepEqual(healthy.plan.actions.map(item=>item.type),actionTypes);
      for(const [error,code] of [
        [Object.assign(new Error("timeout"),{name:"TimeoutError"}),"contextual_response_timeout"],
        [new Error("contextual_response_http_503"),"contextual_response_http_503"],
        [Object.assign(new Error("fetch failed"),{name:"TypeError"}),"contextual_response_network_error"],
        [new Error("Authorization: Bearer private-fixture-value"),"contextual_response_error"],
      ]) {
        rewriteFailure=error;
        const beforeFailure=calls.length;
        const failed=await call(contextPrompt,null,scheduleContext);
        assert.equal(calls.length-beforeFailure,1);
        assert.equal(failed.source,`${source}+grounded_deterministic_after_model_error`);
        assert.equal(failed.model_error,code);
        assert.equal(failed.contextual_response_failure.code,code);
        assert.deepEqual(failed.plan.actions,healthy.plan.actions);
        assert.equal(failed.plan.message_text,healthy.plan.message_text);
        assert.doesNotMatch(JSON.stringify(failed),/private-fixture-value|Authorization:/);
      }
    }
    rewriteFailure=Object.assign(new Error("request timed out"),{name:"TimeoutError"});
    extractionFailure=true;
    const degraded=await call(advicePrompt);
    assert.equal(degraded.model_error,"semantic_model_timeout","terminal degradation remains externally observable");
    assert.equal(degraded.extraction_failure.attempt_count,2);
    assert.deepEqual(degraded.extraction_failure.attempt_errors,["duplicate_semantic_extraction_slot","semantic_model_timeout"]);
    assert.deepEqual(degraded.contextual_response_failure,{code:"contextual_response_timeout",name:"TimeoutError"});
    assert.equal(degraded.model_error,"semantic_model_timeout","extraction failure takes precedence while both failures remain observable");
    assert.deepEqual(degraded.plan.actions,[],"an advice extraction failure cannot invent an action");
    assert.equal(degraded.semantic_state.slots.duration_minutes.value,30,"failed extraction cannot invent an action quantity");
    console.log("BM response reliability: historical live copy mutations rejected, cancellation stays closed, native setup order and daily-limit meaning preserved (mock model, real endpoint)");
  } finally {
    global.fetch=oldFetch;
    for(const [key,value] of [["OPENAI_API_KEY",oldKey],["SUPABASE_URL",oldURL],["SUPABASE_SERVICE_ROLE_KEY",oldService]]) {
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
