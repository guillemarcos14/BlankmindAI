"use strict";

const assert = require("node:assert/strict");
const { advanceSemanticState, normalizeSemanticState, buildSemanticActions, extractSemanticPatch, validateSemanticPatch, TTL_MS } = require("../netlify/functions/bm-semantic-state");
const NOW = Date.parse("2026-09-15T10:00:00Z");
const DEVICE = { channel:"ios", screen_time_authorized:true, has_selected_apps:true, selected_app_names:["Instagram"] };
let checks = 0;
function test(name, fn) { try { fn(); checks++; } catch (error) { error.message = `${name}: ${error.message}`; throw error; } }
function turn(prompt, previousState, context = DEVICE, language = "en") { return advanceSemanticState({ prompt, previousState, context, language, now:NOW }); }
function chat(prompts, context = DEVICE, language = "en") { let state; return prompts.map(p => { const result = turn(p,state,context,language); state = result.state; return result; }); }
function slot(result,name) { return result.state.slots[name]?.value ?? null; }
function none(result) { assert.deepEqual(result.actions,[]); }
function equalSlot(result,name,expected) { assert.deepEqual(slot(result,name),expected); }

test("no invented duration or recurrence", () => {
  const r = turn("Block Instagram now");
  assert.deepEqual(r.state.pending_slots,["end_or_duration","recurrence"]);
  equalSlot(r,"duration_minutes",null); equalSlot(r,"recurrence",null); none(r);
});
test("data then automatic activation", () => {
  const [a,b,c] = chat(["Block Instagram now for 30 minutes", "Just once", "Yes"]);
  assert.deepEqual(a.state.pending_slots,["recurrence"]); none(a);
  assert.equal(b.state.status,"ready");
  assert.deepEqual(b.actions,[{type:"start_protection",minutes:30,hard_mode:false}]);
  assert.equal(b.state.slots.confirmation.source.text,"Just once");
  assert.match(b.responseText,/sending it to your linked device/i);
  assert.match(b.responseText,/only report success after the device verifies/i);
  assert.doesNotMatch(b.responseText,/review it in Blankmind|applied|started successfully/i);
  none(c);
});
test("common affirmative variants do not duplicate an activated request", () => {
  for (const reply of ["Yeah", "Yea", "Yep"]) {
    const [activated, repeated] = chat(["Block Instagram now for 30 minutes once", reply]);
    assert.equal(activated.state.slots.confirmation.value.status, "confirmed");
    assert.equal(activated.actions[0].type, "start_protection");
    none(repeated);
  }
});
test("a missing-field answer completes the authorized request", () => {
  const results = chat(["Block Instagram now for 30 minutes","yes","once"]);
  none(results[0]); none(results[1]); assert.equal(results[2].state.status,"ready"); assert.equal(results[2].actions[0].type,"start_protection");
});
test("duration correction becomes a new authorized activation", () => {
  const results = chat(["Block Instagram now for 30 minutes once","yes","Actually 45 minutes"]);
  const corrected = results[2]; equalSlot(corrected,"duration_minutes",45); assert.equal(slot(corrected,"confirmation").status,"confirmed"); assert.equal(corrected.actions[0].minutes,45);
  assert.ok(corrected.state.corrections.some(c => c.slot === "duration_minutes" && c.previous === 30 && c.replacement === 45));
});
test("minutes are duration and never an hour of day", () => {
  const results = chat(["Block Instagram at 10am every day for 7 days", "one hour", "No, 45 minutes", "yes"]);
  const r = results[2]; equalSlot(r,"start",{type:"time",minute:600}); equalSlot(r,"end",645);
  assert.equal(r.actions[0].start_minute,600); assert.equal(r.actions[0].end_minute,645);
  assert.equal(r.state.slots.end.source.kind,"derived"); assert.deepEqual(r.state.slots.end.source.depends_on,["start","duration_minutes"]);
  assert.match(r.responseText,/10:00 to 10:45/);
});
test("end correction replaces duration and recalculates", () => {
  const results = chat(["Block Instagram at 10am for one hour every day", "Until 12pm"]);
  equalSlot(results[1],"end",720); equalSlot(results[1],"duration_minutes",120);
  assert.equal(results[1].state.slots.duration_minutes.source.kind,"derived");
});
test("start correction recalculates dependent end only", () => {
  const results = chat(["Block Instagram at 10am for one hour every day", "Actually start at 11am"]);
  equalSlot(results[1],"start",{type:"time",minute:660}); equalSlot(results[1],"end",720);
});
test("start correction preserves explicitly supplied end", () => {
  const results = chat(["Block Instagram from 10am to 12pm every day", "Actually start at 11am"]);
  equalSlot(results[1],"end",720); equalSlot(results[1],"duration_minutes",60);
});
test("same-turn inconsistent duration and end cannot act", () => {
  const results = chat(["Block Instagram from 10am to 11am for 90 minutes every day", "yes"]);
  results.forEach(none); assert.ok(results[1].state.errors.some(e => e.code === "time_duration_conflict"));
});
test("end correction resolves time conflict", () => {
  const results = chat(["Block Instagram from 10am to 11am for 90 minutes every day", "Until 11am"]);
  assert.equal(results[1].state.errors.length,0); equalSlot(results[1],"duration_minutes",60);
});
test("app correction replaces instead of concatenating history", () => {
  const results = chat(["Block Instagram now for 30 minutes once", "Not Instagram, TikTok"], {...DEVICE,selected_app_names:["TikTok"]});
  equalSlot(results[1],"apps",["TikTok"]); none(results[1]);
});
test("instead-of removes the rejected alternative", () => {
  const results = chat(["Block Instagram now for 30 minutes once", "TikTok instead of Instagram"], {...DEVICE,selected_app_names:["TikTok"]});
  equalSlot(results[1],"apps",["TikTok"]);
});
test("explicit app addition preserves earlier selection", () => {
  const results = chat(["Block Instagram now for 30 minutes once", "Add TikTok too"]);
  equalSlot(results[1],"apps",["Instagram","TikTok"]);
});
test("exclusion removes an app without adding it back", () => {
  const results = chat(["Block Instagram and TikTok now for 30 minutes once", "Remove TikTok"]);
  equalSlot(results[1],"apps",["Instagram"]);
});
test("nested app aliases cannot invent extra YouTube target", () => {
  const r = turn("Block YouTube Shorts now for 30 minutes once"); equalSlot(r,"apps",["YouTube Shorts"]);
});
test("category never expands to invented apps", () => {
  const r = turn("Block social media now for 30 minutes once"); equalSlot(r,"app_category","social_apps"); equalSlot(r,"apps",null); assert.equal(r.actions[0].type,"start_protection");
});
test("the canonical selection is reused for named-app requests", () => {
  const result = turn("Block TikTok now for 30 minutes once");
  assert.deepEqual(result.actions,[{type:"start_protection",minutes:30,hard_mode:false}]);
});
test("explicit selected-apps reference can use known selection", () => {
  const result = turn("Block my selected apps now for 30 minutes once", null, {...DEVICE,selected_app_names:undefined});
  assert.equal(result.actions[0].type,"start_protection");
});
test("scheduled requests reuse the canonical distraction selection", () => {
  const result = turn("Block Instagram from 10am to 11am every day for 7 days");
  assert.deepEqual(result.actions,[{
    type:"apply_schedule",name:"Protection",start_minute:600,end_minute:660,
    weekdays:[1,2,3,4,5,6,7],duration_days:7,
  }]);
});
test("bare ambiguous times ask AM/PM", () => {
  const r = turn("Block Instagram from 10 to 7 every day"); equalSlot(r,"start",null); equalSlot(r,"end",null); none(r);
  assert.ok(r.state.errors.some(e => e.code === "ambiguous_start"));
});
test("grammatically shared meridiem in range", () => {
  const r = turn("Block Instagram from 10 to 11 am every day"); equalSlot(r,"start",{type:"time",minute:600}); equalSlot(r,"end",660); none(r);
});
test("overnight explicit clocks stay exact", () => {
  const r = turn("Block Instagram from 10pm to 7am every day"); equalSlot(r,"start",{type:"time",minute:1320}); equalSlot(r,"end",420); equalSlot(r,"duration_minutes",540);
});
test("24-hour notation preserves midnight", () => {
  const r = turn("Block Instagram from 23:30 to 00:15 every day"); equalSlot(r,"start",{type:"time",minute:1410}); equalSlot(r,"end",15); equalSlot(r,"duration_minutes",45);
});
test("invalid clock never normalizes modulo 24", () => {
  const r = turn("Block Instagram from 25:30 to 27:15 every day"); equalSlot(r,"start",null); equalSlot(r,"end",null); none(r);
});
test("relative events do not invent 60 minutes or daily recurrence", () => {
  const results = chat(["Block Instagram after breakfast","at 10am"]);
  equalSlot(results[1],"duration_minutes",null); equalSlot(results[1],"recurrence",null); none(results[1]);
});
test("no implicit tomorrow datetime conversion", () => {
  const r = turn("Block Instagram tomorrow from 10am to 11am");
  assert.equal(r.decision.slot,"calendar_date"); none(r);
});
test("one-off schedule capability limit stays explicit", () => {
  const results = chat(["Block Instagram from 10am to 11am once","yes"]); results.forEach(none); assert.equal(results[1].decision.slot,"calendar_date");
});
test("a named date/day is not an inferred weekly recurrence", () => {
  const r = turn("Block Instagram on Monday from 10am to 11am"); equalSlot(r,"recurrence",null); none(r);
});
test("recurrence correction supersedes daily value", () => {
  const results = chat(["Block Instagram from 10am to 11am every day", "No, weekdays only"]);
  equalSlot(results[1],"recurrence",{type:"weekly",weekdays:[1,2,3,4,5]});
});
test("duration units and compounds retain exact quantities", () => {
  for (const [text,expected] of [["half an hour",30],["una hora y media",90],["two hours and fifteen minutes",135],["1.5 hours",90]]) equalSlot(turn(`Block Instagram now for ${text} once`),"duration_minutes",expected);
});
test("ambiguous duration alternatives never summed", () => {
  const r = turn("Block Instagram now for 30 minutes or 60 minutes once"); equalSlot(r,"duration_minutes",null); none(r);
});
test("unsupported native duration is rejected without clamping", () => {
  for (const amount of [1,4,241,300]) { const r = turn(`Block Instagram now for ${amount} minutes once`); equalSlot(r,"duration_minutes",amount); assert.equal(r.decision.slot,"duration_minutes"); none(r); }
});
test("unbounded promise cannot become indefinite executable", () => {
  const r = turn("Block Instagram now forever once"); none(r); assert.ok(r.state.errors.some(e => e.code === "unbounded_duration"));
});
test("explicit cancellation erases pending facts", () => {
  const results = chat(["Block Instagram now for 30 minutes once","cancel","yes"]);
  assert.equal(results[1].state.intent,"cancelled"); equalSlot(results[1],"apps",null); none(results[1]); none(results[2]);
});
test("negated action is not an affirmative request", () => {
  const r = turn("Don't block Instagram now for 30 minutes"); assert.equal(r.state.intent,"cancelled"); none(r);
});
test("advice changes intent and clears old authorization", () => {
  const results = chat(["Block Instagram now for 30 minutes once","yes","Why do I check my phone?"]);
  assert.equal(results[2].state.intent,"advice"); equalSlot(results[2],"confirmation",null); equalSlot(results[2],"apps",null); none(results[2]);
});
test("elliptic advice answers keep facts without authorizing actions", () => {
  const results = chat(["How can I scroll less in the morning?","11am Instagram","one hour","Actually 45 minutes"]);
  equalSlot(results[3],"start",{type:"time",minute:660}); equalSlot(results[3],"end",705); equalSlot(results[3],"apps",["Instagram"]);
  equalSlot(results[3],"action_type",null); assert.equal(results[3].state.intent,"advice");
  assert.match(results[1].responseText,/selected distractions/i); assert.match(results[1].responseText,/11:00/);
  results.forEach(none);
});
test("advice needs explicit action intent before automatic activation", () => {
  const results = chat(["How can I scroll less in the morning?","11am Instagram","one hour","every day for 7 days","yes"]);
  assert.equal(results[3].decision.slot,"action_type"); assert.equal(results[4].state.intent,"block"); assert.equal(results[4].actions[0].type,"apply_schedule");
});
test("Spanish facts and replies stay Spanish", () => {
  const result = chat(["Bloquea Instagram ahora durante una hora solo esta vez"],DEVICE,"es")[0];
  equalSlot(result,"duration_minutes",60); assert.match(result.responseText,/distracciones seleccionadas.*60 minutos/i); assert.equal(result.state.language,"es");
});
test("all supported channels use identical facts", () => {
  const states = ["whatsapp","sms","web","ios","android"].map(channel => turn("Block Instagram now for 30 minutes once",null,{...DEVICE,channel,app_presence_state:"recently_seen"}));
  for (const r of states) { assert.deepEqual(r.actions,states[0].actions); assert.deepEqual(r.state.slots,states[0].state.slots); }
});
test("missing app presence suppresses executable action", () => {
  const r = turn("Block Instagram now for 30 minutes once",null,{...DEVICE,channel:"whatsapp"}); assert.equal(r.decision.slot,"app_presence"); assert.equal(r.actions[0].type,"start_protection"); assert.equal(r.reviewOnlyAppPresence,true);
});
test("app possession claims are not device presence evidence", () => {
  const r = chat(["Block Instagram now for 30 minutes once","I have it"],{...DEVICE,channel:"whatsapp"})[1]; assert.equal(r.decision.slot,"app_presence"); none(r); assert.equal(r.reviewOnlyAppPresence,false); assert.equal(r.actionReplaySuppressed,true);
});
test("permission setup contains no hidden executable payload", () => {
  const r = turn("Block Instagram now for 30 minutes once",null,{...DEVICE,screen_time_authorized:false}); assert.deepEqual(r.actions,[{type:"request_screen_time_permission"}]);
});
test("capability arrival does not change semantic requested facts", () => {
  const initial = turn("Block Instagram now for 30 minutes once",null,{...DEVICE,screen_time_authorized:false});
  const ready = turn("ready",initial.state,DEVICE); assert.equal(ready.actions[0].type,"start_protection"); equalSlot(ready,"duration_minutes",30);
});
test("a completed proposal is not offered twice as a new action", () => {
  const results = chat(["Block Instagram now for 30 minutes once","yes"]); assert.equal(results[0].actions.length,1); none(results[1]);
});
test("stale state expires", () => {
  const r = turn("Block Instagram now for 30 minutes once"); assert.equal(normalizeSemanticState(r.state,NOW+TTL_MS+1),null);
});
test("tampered state cannot keep a previous confirmation", () => {
  const r = turn("Block Instagram now for 30 minutes once"); const changed = JSON.parse(JSON.stringify(r.state)); changed.slots.duration_minutes.value=90;
  const normalized=normalizeSemanticState(changed,NOW); assert.equal(normalized.slots.confirmation,null); assert.deepEqual(buildSemanticActions(normalized,DEVICE),[]);
});
test("invalid sourced slot cannot survive deserialization", () => {
  const r = turn("Block Instagram now for 30 minutes once"); r.state.slots.duration_minutes.source.kind="model"; assert.equal(normalizeSemanticState(r.state,NOW).slots.duration_minutes,null);
});
test("migration replays user evidence and ignores assistant claims", () => {
  const r = turn("once",null,{...DEVICE,recent_messages:[{role:"user",content:"Block Instagram now for 30 minutes"},{role:"assistant",content:"TikTok has been blocked for 90 minutes daily."}]});
  equalSlot(r,"apps",["Instagram"]); equalSlot(r,"duration_minutes",30); assert.equal(r.decision.type,"ready"); assert.equal(r.actions[0].type,"start_protection");
});
test("migration preserves order of corrections", () => {
  const r = turn("once",null,{...DEVICE,recent_messages:[{role:"user",content:"Block Instagram now for 30 minutes"},{role:"user",content:"No, 45 minutes"}]}); equalSlot(r,"duration_minutes",45);
});
test("model cannot inject invented semantic facts", () => {
  const args = {prompt:"Block Instagram now",context:DEVICE};
  const r = validateSemanticPatch({set:{duration_minutes:60,recurrence:{type:"daily",weekdays:[1,2,3,4,5,6,7]},apps:["TikTok"]}},args);
  assert.equal(r.rejected.length,3); assert.deepEqual(r.accepted.set,{});
});
test("model facts grounded in current input can pass validation", () => {
  const args = {prompt:"Block Instagram now for 30 minutes once",context:DEVICE}; const patch=extractSemanticPatch(args); assert.equal(validateSemanticPatch(patch,args).rejected.length,0);
});
test("AM and Spanish ahora cannot become durations", () => {
  const a=turn("Block Instagram from 10 am every day"); equalSlot(a,"duration_minutes",null); equalSlot(a,"end",null);
  const b=turn("Bloquea Instagram ahora durante cuarenta minutos solo esta vez",null,DEVICE,"es"); equalSlot(b,"duration_minutes",40); equalSlot(b,"start",{type:"now"});
});
test("explicit plural weekdays are weekly recurrence", () => {
  const r=turn("Block Instagram from 09:15 am for 75 minutes on Mondays and Wednesdays for 7 days"); equalSlot(r,"duration_minutes",75); equalSlot(r,"recurrence",{type:"weekly",weekdays:[1,3]});
});
test("start-to correction retains the requested end", () => {
  const results=chat(["Block Instagram from 8am to 10am every day for 7 days","Move the start to 8:20 am and keep the same end"]);
  equalSlot(results[1],"start",{type:"time",minute:500}); equalSlot(results[1],"end",600); equalSlot(results[1],"duration_minutes",100);
});
test("multiple sentence cancellation cannot leave executable old proposal", () => {
  const results=chat(["Block Instagram now for 30 minutes once","No, leave it alone. Cancel that.","yes"]); assert.equal(results[1].state.intent,"cancelled"); none(results[2]);
});
test("negated first app with positive replacement preserves new request", () => {
  const r=turn("Don't block Instagram; block TikTok now for 30 minutes once instead"); equalSlot(r,"apps",["TikTok"]); assert.equal(r.state.intent,"block");
});
test("recurring schedule never inherits implicit seven-day expiry", () => {
  const results=chat(["Block Instagram from 10am to 11am every day","yes"]); assert.equal(results[1].decision.slot,"schedule_horizon_days"); none(results[1]);
});
test("explicit horizon is carried identically to state text and native action", () => {
  const results=chat(["Block Instagram from 10am to 11am every day","for 9 days"]);
  equalSlot(results[1],"schedule_horizon_days",9); assert.equal(results[1].actions[0].duration_days,9); assert.match(results[1].responseText,/for 9 days/);
});
test("unsupported schedule horizon never clamps", () => {
  const r=turn("Block Instagram from 10am to 11am every day for 40 days"); assert.equal(r.decision.slot,"schedule_horizon_days"); none(r); assert.ok(r.state.errors.some(e=>e.code==="unsupported_schedule_horizon"));
});
test("model atomic duration evidence can disambiguate role but not units", () => {
  const previous=turn("Block Instagram now once").state;
  const args={prompt:"Make that a stretch of 45 minutes",state:previous,context:DEVICE};
  const good=validateSemanticPatch({set:{duration_minutes:45},fields:[{slot:"duration_minutes",value:45,evidence:"45 minutes"}]},args); assert.equal(good.rejected.length,0);
  const bad=validateSemanticPatch({set:{start:{type:"time",minute:45}} ,fields:[{slot:"start",value:{type:"time",minute:45},evidence:"45 minutes"}]},args); assert.equal(bad.rejected.length,1);
});
test("model evidence cannot replace the canonical device selection", () => {
  const previous=turn("Block apps now for 30 minutes once").state;
  const r=advanceSemanticState({prompt:"Forest",previousState:previous,context:DEVICE,now:NOW,extraction:{set:{apps:["Forest"]},fields:[{slot:"apps",value:["Forest"],evidence:"Forest"}]}});
  equalSlot(r,"apps",["Forest"]); none(r);
  assert.equal(r.decision.slot,null);
  assert.equal(r.state.last_action_fingerprint, previous.last_action_fingerprint);
});
test("model cannot use stale or negated atomic evidence", () => {
  const args={prompt:"Not Forest, please",state:turn("Block apps now for 30 minutes once").state,context:DEVICE};
  const r=validateSemanticPatch({set:{apps:["Forest"]},fields:[{slot:"apps",value:["Forest"],evidence:"Forest"}]},args); assert.equal(r.rejected.length,1);
});
test("negated app wording does not mutate the canonical device selection", () => {
  const r=chat(["Block Instagram now for 30 minutes once","Not Instagram"])[1]; equalSlot(r,"apps",null); none(r); assert.equal(r.decision.type,"ready");
});
test("negated recurrence without replacement becomes pending", () => {
  const r=chat(["Block Instagram from 10am to 11am every day for 7 days","Not daily"])[1]; equalSlot(r,"recurrence",null); equalSlot(r,"schedule_horizon_days",null); none(r);
});
test("negated time removes dependent end instead of preserving it", () => {
  const r=chat(["Block Instagram from 10am for one hour every day for 7 days","Not at 10am"])[1]; equalSlot(r,"start",null); equalSlot(r,"end",null); none(r);
});
test("keeping and removing apps are separate clause operations", () => {
  const r=chat(["Block Instagram and TikTok now for 30 minutes once","Keep TikTok; remove Instagram from this block."])[1]; equalSlot(r,"apps",["TikTok"]); none(r);
});
test("canonical ISO weekdays map to native Sunday-one values", () => {
  const r=turn("Block Instagram from 10am to 11am on weekends for 7 days"); equalSlot(r,"recurrence",{type:"weekly",weekdays:[6,7]}); assert.deepEqual(r.actions[0].weekdays,[1,7]);
});
test("short numeric horizon answer cannot overwrite a clock", () => {
  const r=chat(["Block Instagram from 10am to 11am every day","7"])[1]; equalSlot(r,"schedule_horizon_days",7); equalSlot(r,"start",{type:"time",minute:600}); assert.equal(r.state.status,"ready"); assert.equal(r.actions[0].type,"apply_schedule");
});
test("explicit end assignments replace old values across formulations", () => {
  for (const correction of ["Make the end 00:35.","Change the end time to 00:35.","Set the finish at 00:35.","End time is 00:35.","Cambia el fin a las 00:35."]) {
    const results=chat(["Block Instagram from 23:40 to 00:20 every day for 4 days",correction]);
    equalSlot(results[1],"end",35); equalSlot(results[1],"duration_minutes",55); assert.equal(results[1].actions[0].end_minute,35);
  }
});
test("explicit start assignments replace old values without losing the end", () => {
  for (const correction of ["Make the start 09:25.","Change the start time to 09:25.","Set the beginning at 09:25.","Inicio: 09:25."]) {
    const r=chat(["Block Instagram from 09:00 to 10:00 every day for 4 days",correction])[1];
    equalSlot(r,"start",{type:"time",minute:565}); equalSlot(r,"end",600); equalSlot(r,"duration_minutes",35); assert.equal(r.actions[0].start_minute,565);
  }
});
test("unresolved explicit corrections cannot reconfirm the stale schedule", () => {
  for (const correction of ["Make the end later.","Change the start time to after breakfast."]) {
    const results=chat(["Block Instagram from 09:00 to 10:00 every day for 4 days",correction,"Confirmed"]);
    assert.ok(results[1].state.errors.some(e=>e.code.startsWith("unresolved_"))); none(results[2]); equalSlot(results[2],"confirmation",null);
  }
});
test("cancellation objects and polite variations withdraw the whole request", () => {
  for (const cancellation of ["Cancel this request.","Please discard that proposal.","Withdraw my instruction.","Drop the schedule please.","Cancela esta solicitud.","Por favor anula la propuesta."]) {
    const results=chat(["Block Instagram now for 27 minutes once",cancellation,"Confirmed"]);
    assert.equal(results[1].state.intent,"cancelled"); equalSlot(results[1],"apps",null); equalSlot(results[1],"confirmation",null); none(results[2]);
  }
});
test("declarative goals and day-part morphology preserve conversational facts", () => {
  for (const prompt of ["I want to scroll less in the mornings","I need to reduce phone use in the morning","I'm trying to stop checking Instagram in the mornings","Quiero usar menos el movil por las mananas"]) {
    const results=chat([prompt,"Instagram at 10am","1 hour","No, from 10 to 11 am"]);
    assert.equal(results[0].state.intent,"advice"); equalSlot(results[0],"moment","morning");
    equalSlot(results[3],"start",{type:"time",minute:600}); equalSlot(results[3],"end",660); equalSlot(results[3],"duration_minutes",60); equalSlot(results[3],"action_type",null); results.forEach(none);
  }
});
test("a past block duration is never a future blocking instruction", () => {
  for (const prompt of ["I broke the block yesterday after 15 minutes.","I finished my protection after 40 minutes yesterday.","Ayer rompi el bloqueo despues de 20 minutos."]) {
    const results=chat([prompt,"yes"]); assert.equal(results[0].state.intent,"advice"); equalSlot(results[0],"requested_capability","past_block_review"); equalSlot(results[0],"duration_minutes",null); equalSlot(results[0],"action_type",null); results.forEach(none);
  }
});
test("explicit hard mode is preserved and fingerprinted before native execution", () => {
  const result=turn("Start a strict block for selected apps now for 45 minutes once");
  equalSlot(result,"hard_mode",true); assert.equal(result.actions[0].hard_mode,true); assert.match(result.responseText,/hard mode/);
  const corrected=turn("Use a normal block",result.state); equalSlot(corrected,"hard_mode",false); assert.equal(slot(corrected,"confirmation").status,"confirmed");
  assert.deepEqual(corrected.actions,[{type:"start_protection",minutes:45,hard_mode:false}]);
  none(turn("Yes",corrected.state));
});

test("model-quoted historical quantities cannot populate operational slots", () => {
  const prompt = "I broke the block yesterday after 15 minutes.";
  const extraction = { set: { duration_minutes: 15, start: {type:"time",minute:900} },
    evidence: { duration_minutes: "15 minutes", start: "15" } };
  const past = advanceSemanticState({ prompt, context: DEVICE, now: NOW, extraction });
  equalSlot(past,"requested_capability","past_block_review"); equalSlot(past,"duration_minutes",null); equalSlot(past,"start",null); none(past);
  assert.equal(past.extractionValidation.rejected.length,2);
  const yes = turn("Yes.",past.state); equalSlot(yes,"duration_minutes",null); none(yes);
  const fresh = advanceSemanticState({ prompt:"Block selected apps now for 30 minutes once", previousState:yes.state, context:DEVICE, now:NOW,
    extraction:{set:{duration_minutes:30},evidence:{duration_minutes:"30 minutes"}} });
  equalSlot(fresh,"requested_capability",null); equalSlot(fresh,"duration_minutes",30);
  assert.deepEqual(fresh.actions,[{type:"start_protection",minutes:30,hard_mode:false}]);
});

test("rejecting duration preserves start and recurrence across confirmation and replacement", () => {
  for (const rejected of ["Not 30 minutes.", "No 30 minutos."]) {
    const [initial, missing, confirmation, repaired] = chat(["Block selected apps now for 30 minutes once", rejected, "Yes.", "45 minutes."]);
    assert.equal(initial.actions[0].minutes,30);
    for (const result of [missing, confirmation]) {
      equalSlot(result,"start",{type:"now"}); equalSlot(result,"duration_minutes",null);
      equalSlot(result,"recurrence",{type:"once",weekdays:[]});
      assert.deepEqual(result.state.pending_slots,["end_or_duration"]); none(result);
    }
    assert.deepEqual(repaired.actions,[{type:"start_protection",minutes:45,hard_mode:false}]);
    assert.ok(missing.state.corrections.some(c => c.slot === "duration_minutes" && c.replacement === null));
  }
});

test("answering unsupported hard schedule style preserves the authored schedule", () => {
  const [unsupported, regular, confirmation] = chat([
    "Start a strict block for selected apps from 10am to 11am every day for 7 days",
    "Use a normal block.", "Yes."]);
  assert.equal(unsupported.decision.slot,"hard_mode"); none(unsupported);
  equalSlot(regular,"apps",["selected_apps"]); equalSlot(regular,"start",{type:"time",minute:600});
  equalSlot(regular,"hard_mode",false); equalSlot(regular,"schedule_horizon_days",7);
  assert.deepEqual(regular.actions.map(({name,...fields})=>fields),[{type:"apply_schedule",start_minute:600,end_minute:660,weekdays:[1,2,3,4,5,6,7],duration_days:7}]);
  assert.ok(regular.state.corrections.some(c => c.slot === "hard_mode" && c.previous === true && c.replacement === false));
  none(confirmation);
  const fresh = turn("Block selected apps now for 20 minutes once in normal mode", regular.state);
  equalSlot(fresh,"schedule_horizon_days",null); equalSlot(fresh,"start",{type:"now"});
  assert.equal(fresh.actions[0].minutes,20);
});

test("daily limit never drops a requested expiry without an explicit adjustment", () => {
  const [initial, now, yes, accepted] = chat([
    "Set a 60-minute daily limit for selected apps starting at 09:00 for 7 days.",
    "Start now.", "Yes.", "Keep it until I remove it."]);
  assert.deepEqual(initial.state.pending_slots,["start","schedule_horizon_days"]);
  for (const r of [initial,now,yes]) { none(r); equalSlot(r,"schedule_horizon_days",7); }
  assert.equal(now.decision.slot,"schedule_horizon_days");
  assert.match(now.responseText,/cannot expire automatically/);
  equalSlot(accepted,"schedule_horizon_days",null);
  assert.deepEqual(accepted.actions,[{type:"set_daily_limit",minutes:60}]);
});
test("unsupported scheduled hard mode cannot silently become regular protection", () => {
  const results=chat(["Start a strict block for selected apps from 10am to 11am every day for 7 days","yes"]);
  equalSlot(results[1],"hard_mode",true); assert.equal(results[1].decision.slot,"hard_mode"); results.forEach(none);
});
test("nonblocking capabilities preserve their meaning and cannot be confirmed as app blocks", () => {
  const cases=[["Only let me use WhatsApp and Maps","allow_only"],["Block everything except WhatsApp and Maps","allow_only"],["Help me block adult websites","adult_filter"],["Ayudame a bloquear porno","adult_filter"],["Block TikTok but I need TikTok for work","work_use_constraint"],["Quiero bloquear Instagram pero lo necesito para trabajar","work_use_constraint"]];
  for (const [prompt,capability] of cases) {
    const results=chat(["Block Instagram now for 30 minutes once",prompt,"yes"]); equalSlot(results[1],"requested_capability",capability); equalSlot(results[1],"confirmation",null); equalSlot(results[1],"action_type",null); assert.equal(results[1].decision.type,"none"); assert.equal(results[0].actions[0].type,"start_protection"); none(results[1]); none(results[2]);
  }
});
test("weekly review reads provided metrics without creating a proposal", () => {
  const r=turn("Review my week",null,{...DEVICE,weekly_protected_minutes:80,weekly_break_count:0}); equalSlot(r,"requested_capability","weekly_review"); none(r); assert.match(r.responseText,/80 protected minutes and 0 breaks/);
});
test("legacy mode wording targets the canonical distraction selection", () => {
  const r=turn("Start Work mode for 45 minutes once",null,DEVICE); equalSlot(r,"duration_minutes",45); equalSlot(r,"action_type","strict_block"); equalSlot(r,"start",{type:"now"}); assert.equal(r.actions[0].type,"start_protection");
});
test("daily limits cannot discard an explicitly requested hard flag", () => {
  const results=chat(["Set a 30-minute daily limit for Instagram now with hard mode","yes"]);
  equalSlot(results[1],"hard_mode",true); assert.equal(results[1].decision.slot,"hard_mode"); results.forEach(none);
  const normal=turn("Use a regular limit",results[1].state); equalSlot(normal,"hard_mode",false); assert.equal(normal.actions[0].type,"set_daily_limit"); assert.equal(normal.state.status,"ready");
});
test("daily limits default to now and ask for an explicit duration", () => {
  const result=turn("Set a daily limit for Instagram",null,DEVICE);
  equalSlot(result,"action_type","daily_limit"); equalSlot(result,"start",{type:"now"});
  assert.equal(result.decision.slot,"end_or_duration"); assert.equal(result.actions.length,0);
  assert.match(result.responseText,/duration|minutes/i);
});
test("recurring protection cannot turn now into a repeating clock or a one-off action", () => {
  for (const recurrence of ["every day","weekdays","weekends"]) {
    const results=chat([`Block Instagram now for 30 minutes ${recurrence}`,"yes"]);
    equalSlot(results[1],"start",{type:"now"}); assert.equal(results[1].decision.slot,"start"); results.forEach(none); assert.deepEqual(buildSemanticActions(results[1].state,DEVICE),[]);
  }
});
test("repeating an already activated request starts a fresh incomplete activation", () => {
  const completed = chat(["Block Instagram now for 5 minutes", "Just once"])[1];
  assert.equal(completed.state.status, "ready");
  const repeated = turn("Block Instagram now for 5 minutes", completed.state);
  equalSlot(repeated, "recurrence", null);
  assert.equal(slot(repeated, "confirmation").status, "confirmed");
  assert.equal(repeated.decision.slot, "recurrence");
  assert.match(repeated.responseText, /once or recurring/i);
  none(repeated);
});
test("an unrelated follow-up cannot requeue or claim to resend the same ready action", () => {
  const completed = chat(["Block Instagram now for 5 minutes", "Just once"])[1];
  const followup = turn("Yes, do it", completed.state, DEVICE);
  assert.equal(followup.actionReplaySuppressed, true);
  none(followup);
  assert.match(followup.responseText, /already prepared/i);
  assert.doesNotMatch(followup.responseText, /already waiting|is pending/i);
  assert.doesNotMatch(followup.responseText, /I'm sending it/i);
});

test("withdrawal clauses preserve cancellation through explanation and acknowledgement", () => {
  for (const prompt of ["Cancela esa petición; no quiero aplicarla.","Retira esta instrucción pendiente. Gracias.","Anula la solicitud; he cambiado de idea.","Please cancel this pending request; I changed my mind.","Withdraw my instruction. Thanks.","Don't apply it.","No quiero aplicarla.","No, cancela esa propuesta.","Cancela la petición, por favor.","Cancel that request, please.","Do not apply a usage limit of 20 minutes per day.","Cancel that request because I no longer need it.","Cancela esa petición porque no quiero aplicarla.","Cancel that request for now.","Cancela esa petición por ahora.","Cancela esa petición por ahora, porque necesito trabajar."]) {
    const results = chat(["Block selected apps now for 30 minutes once", prompt, "Gracias.", "Yes."]);
    for (const result of results.slice(1)) {
      assert.equal(result.state.intent,"cancelled",prompt); none(result);
      assert.ok(Object.values(result.state.slots).every(v=>v===null));
      if (result === results[2]) assert.equal(result.responseText,"You're welcome.");
      else assert.match(result.responseText,/If protection has already started/);
    }
  }
});

test("negated withdrawal and unrelated objects do not cancel the current instruction", () => {
  const initial = turn("Block selected apps now for 30 minutes once");
  for (const prompt of ["Don't cancel that request.","No canceles la petición.","What does cancel mean?","Cancel my dinner booking.","No quiero aplicarlo a otra cuenta.","Don't cancel that request because I still need it.","No canceles la petición por ahora porque la necesito.","Cancel my dinner booking because I need to focus."]) {
    const result = turn(prompt,initial.state); assert.notEqual(result.state.intent,"cancelled",prompt); none(result);
  }
});

test("thanks after withdrawal acknowledges naturally without restoring authorization", () => {
  for (const [language,prompts,reply] of [
    ["es",["Gracias.","¡Gracias!","Muchas gracias.","Gracias 🙏"],"De nada."],
    ["en",["Thanks.","Thank you!","Thanks a lot.","Thank you very much.","Thanks,"],"You're welcome."],
  ]) {
    const initial = turn("Block selected apps now for 30 minutes once",null,DEVICE,language);
    const cancelled = turn("Cancel that request.",initial.state,DEVICE,language);
    const before = JSON.stringify(cancelled.state);
    for (const prompt of prompts) {
      const result = turn(prompt,cancelled.state,DEVICE,language);
      assert.equal(result.responseText,reply,prompt);
      assert.equal(result.handled,true,prompt);
      assert.equal(result.state.intent,"cancelled"); assert.equal(result.state.status,"cancelled");
      assert.deepEqual(result.decision,{type:"cancelled",slot:null}); none(result);
      assert.ok(Object.values(result.state.slots).every(v=>v===null));
      assert.equal(result.state.delivery,null); assert.equal(result.state.last_action_fingerprint,null);
      assert.equal(JSON.stringify(cancelled.state),before,"an acknowledgement must not mutate supplied state");
    }
  }
});

test("thanks inside instructions never replaces a cancellation warning or changes unrelated authorization", () => {
  const initial = turn("Block selected apps now for 30 minutes once");
  const cancelled = turn("Cancel that request.",initial.state);
  for (const prompt of ["Thanks; cancel that request.","Thanks; don't cancel that request.","Gracias; no canceles esa petición.","Thanks for cancelling my dinner booking."]) {
    const result = turn(prompt,cancelled.state);
    assert.match(result.responseText,/If protection has already started/,prompt);
    assert.equal(result.state.intent,"cancelled"); none(result);
    assert.ok(Object.values(result.state.slots).every(v=>v===null));
  }
  for (const prompt of ["Thanks; don't cancel that request.","Gracias; no canceles esa petición.","Thanks; cancel my dinner booking."]) {
    const result = turn(prompt,initial.state);
    assert.equal(result.state.intent,"block",prompt); none(result);
    assert.deepEqual(result.state.slots,initial.state.slots,prompt);
    assert.deepEqual(result.state.delivery,initial.state.delivery,prompt);
    assert.notEqual(result.responseText,"You're welcome.",prompt);
  }
});

test("a new instruction after withdrawal can replace the original with block or usage limit", () => {
  const initial = turn("Block selected apps now for 30 minutes once");
  assert.deepEqual(turn("Cancel that request; block selected apps now for 15 minutes once.",initial.state).actions,[{type:"start_protection",minutes:15,hard_mode:false}]);
  assert.deepEqual(turn("Cancel that request because it is too long; block selected apps now for 15 minutes once.",initial.state).actions,[{type:"start_protection",minutes:15,hard_mode:false}]);
  none(turn("Cancel that request because I previously said block selected apps now for 15 minutes once.",initial.state));
  for (const prompt of ["Cancel that request; set a daily limit of 20 minutes for selected apps now.","No bloquees Instagram; pon un límite de uso de 20 minutos al día."]) {
    assert.deepEqual(turn(prompt,initial.state).actions,[{type:"set_daily_limit",minutes:20}],prompt);
  }
  const withExpiry = turn("Cancel that request; set a daily limit of 20 minutes now; only for the next 7 days.",initial.state);
  none(withExpiry); equalSlot(withExpiry,"schedule_horizon_days",7);
});

test("the last withdrawal defeats earlier replacement but negated cancellation preserves a correction", () => {
  const initial = turn("Block selected apps now for 30 minutes once");
  for (const prompt of ["Cancel that request; block selected apps now for 15 minutes once; cancel that request.","Cancel that request; block selected apps now for 15 minutes once; do not apply it.","Cancela esa petición; bloquea mis distracciones ahora 15 minutos una vez; cancela esa petición.","Cancela esa petición; pon un límite de 20 minutos al día; no quiero aplicarlo.","Cancel that request; block selected apps now for 15 minutes once; cancel that request because I changed my mind."]) {
    const result = turn(prompt,initial.state); assert.equal(result.state.intent,"cancelled",prompt); none(result);
  }
  for (const prompt of ["No canceles la petición; cambia la duración a 45 minutos.","Don't cancel the request; change the duration to 45 minutes."]) {
    const result = turn(prompt,initial.state);
    assert.deepEqual(result.actions,[{type:"start_protection",minutes:45,hard_mode:false}]);
    assert.ok(result.state.corrections.some(c=>c.slot==="duration_minutes"&&c.previous===30&&c.replacement===45));
  }
});

test("incidental day wording cannot override once-only recurrence", () => {
  const result = turn("Block selected apps now for 30 minutes, just once. I have a day off.");
  assert.deepEqual(result.actions,[{type:"start_protection",minutes:30,hard_mode:false}]);
});

test("negative and zero quantities cannot become positive through parsing or shortened model evidence", () => {
  for (const amount of ["-5","−5","- 5","minus five","menos cinco","0"]) {
    const prompt = `Block selected apps now for ${amount} minutes once.`;
    const result = advanceSemanticState({prompt,context:DEVICE,now:NOW,extraction:{set:{duration_minutes:5},evidence:{duration_minutes:"5 minutes"}}});
    none(result); equalSlot(result,"duration_minutes",null);
    assert.ok(result.state.errors.some(e=>e.code==="unsupported_duration"),prompt);
    none(turn("Yes.",result.state));
  }
  assert.deepEqual(turn("Block selected apps now for 5 minutes once.").actions,[{type:"start_protection",minutes:5,hard_mode:false}]);
});

test("usage allowance and explicit limit vocabulary preserve the canonical daily budget", () => {
  for (const prompt of ["Quiero poder usar mis distracciones 20 minutos al día; al consumirlos, que se bloqueen. Pon ese límite desde ahora.","Fija un límite de uso de 20 minutos al día para mis distracciones.","Apply a usage limit of 20 minutes per day to my distractions now."]) {
    const result=turn(prompt); equalSlot(result,"action_type","daily_limit");
    assert.deepEqual(result.actions,[{type:"set_daily_limit",minutes:20}],prompt);
  }
  none(turn("¿Cómo puedo usar menos mis distracciones cada día?"));
});

test("Spanish daily expiry cannot be waived by yes or a refusal of an indefinite limit", () => {
  const results = chat(["Pon un límite de uso de 20 minutos al día para mis distracciones desde ahora, pero solo durante los próximos 7 días.","Sí, hazlo.","No quiero que dure indefinidamente: mantén los 7 días."],DEVICE,"es");
  for (const result of results) {
    equalSlot(result,"schedule_horizon_days",7); equalSlot(result,"duration_minutes",20); equalSlot(result,"action_type","daily_limit"); none(result);
    assert.equal(result.decision.slot,"schedule_horizon_days"); assert.match(result.responseText,/no pueden caducar automáticamente/);
  }
});

test("next and following day qualifiers preserve the exact finite horizon", () => {
  for (const ending of ["durante los próximos 7 días","durante las próximas 1 semanas","for the next 7 days","for the following 1 weeks"]) {
    const result=turn(`Set a daily limit of 20 minutes for selected apps now ${ending}`);
    equalSlot(result,"schedule_horizon_days",7); none(result);
  }
});

test("unsupported one-off dates are restated as requested rather than replaced with now", () => {
  for (const [prompt,language] of [["Block selected apps now for 30 minutes tomorrow.","en"],["Bloquea mis distracciones ahora durante 30 minutos mañana.","es"]]) {
    const result=turn(prompt,null,DEVICE,language); none(result); assert.equal(result.decision.slot,"calendar_date");
    assert.match(result.responseText,language==="es"?/mañana/:/tomorrow/);
    assert.match(result.responseText,/30/); assert.doesNotMatch(result.responseText,/\bnow\b|\bahora\b/);
    assert.match(result.responseText,language==="es"?/no admite una fecha única/:/cannot target a specific one-off date/);
    assert.equal((result.responseText.match(/\?/g)||[]).length,1);
  }
});

test("unsupported daily start and expiry are both explained before one useful choice", () => {
  for (const [prompt,language] of [["Set a 60-minute daily limit for selected apps starting at 09:00 for 7 days.","en"],["Pon un límite de uso de 60 minutos al día desde las 09:00 durante 7 días.","es"]]) {
    const result=turn(prompt,null,DEVICE,language); none(result);
    assert.match(result.responseText,language==="es"?/Pides/:/You requested/);
    assert.match(result.responseText,/60/); assert.match(result.responseText,/7/); assert.match(result.responseText,/9:00 AM/);
    assert.match(result.responseText,language==="es"?/solo pueden empezar ahora y no pueden caducar automáticamente/:/can only start now and cannot expire automatically/);
    assert.equal((result.responseText.match(/\?/g)||[]).length,1);
  }
});

test("conflicting clock times and duration are both visible without promising execution", () => {
  for (const [prompt,language] of [["Block selected apps from 10am to 11am for 90 minutes every day for 7 days.","en"],["Bloquea mis distracciones de 10am a 11am durante 90 minutos cada día durante 7 días.","es"]]) {
    const result=turn(prompt,null,DEVICE,language); none(result); assert.equal(result.decision.slot,"time_consistency");
    assert.match(result.responseText,/10:00 AM/); assert.match(result.responseText,/11:00 AM/); assert.match(result.responseText,/90/);
    assert.match(result.responseText,language==="es"?/no coinciden/:/details conflict/);
    assert.equal((result.responseText.match(/\?/g)||[]).length,1);
  }
});

test("accepting a past-block review starts the reflection without repeating the offer", () => {
  for (const [prompt,yes,language] of [["Yesterday I ended a 30-minute block after 15 minutes.","Yes.","en"],["Ayer terminé un bloqueo de 30 minutos después de 15 minutos.","Sí.","es"]]) {
    const first=turn(prompt,null,DEVICE,language); none(first);
    const next=turn(yes,first.state,DEVICE,language); none(next);
    assert.equal(next.state.slots.requested_capability.value,"past_block_review");
    assert.notEqual(next.responseText,first.responseText);
    assert.match(next.responseText,language==="es"?/Qué te llevó/:/What led you/);
    assert.equal(next.state.slots.duration_minutes,null,"historical quantities never become a new instruction");
  }
});

test("recurring blocks ask for a fixed clock time instead of offering now again", () => {
  for (const [prompt,language,nowReply,clockReply] of [
    ["Block Instagram now for 30 minutes every day.","en","Now.","Start at 09:00."],
    ["Block Instagram now for 30 minutes on weekends.","en","Now.","Start at 09:00."],
    ["Bloquea Instagram ahora durante 30 minutos cada día.","es","Ahora.","Empieza a las 09:00."],
    ["Bloquea Instagram ahora durante 30 minutos los fines de semana.","es","Ahora.","Empieza a las 09:00."],
  ]) {
    const [first,repeated,resolved] = chat([prompt,nowReply,clockReply],DEVICE,language);
    for (const result of [first,repeated]) {
      none(result); assert.equal(result.decision.slot,"start");
      assert.match(result.responseText,language === "es" ? /horario recurrente necesita una hora fija/ : /recurring schedule needs a fixed time/);
      assert.match(result.responseText,language === "es" ? /A qué hora exacta debe empezar/ : /What exact time should it start/);
      assert.doesNotMatch(result.responseText,/now or|ahora o/i);
    }
    equalSlot(resolved,"start",{type:"time",minute:540});
    assert.equal(resolved.decision.slot,"schedule_horizon_days"); none(resolved);
  }
});

test("one-time blocks still offer an immediate start", () => {
  for (const [prompt,language] of [["Block Instagram for 30 minutes once.","en"],["Bloquea Instagram durante 30 minutos una vez.","es"]]) {
    const result=turn(prompt,null,DEVICE,language); none(result);
    assert.equal(result.decision.slot,"start");
    assert.match(result.responseText,language === "es" ? /ahora o a qué hora exacta/ : /now or at what exact time/);
  }
});

test("daily allowance receipts name the limit while immediate blocks keep their own result", () => {
  for (const [daily,block,language] of [
    ["Set a 20-minute daily limit for Instagram now.","Block Instagram now for 20 minutes once.","en"],
    ["Pon un límite de uso de 20 minutos al día para Instagram desde ahora.","Bloquea Instagram ahora durante 20 minutos una vez.","es"],
  ]) {
    const limit=turn(daily,null,DEVICE,language), protection=turn(block,null,DEVICE,language);
    assert.deepEqual(limit.actions,[{type:"set_daily_limit",minutes:20}]);
    assert.match(limit.responseText,language === "es" ? /cuando el dispositivo verifique el límite/ : /after the device verifies the limit/);
    assert.doesNotMatch(limit.responseText,/verifies the block|verifique el bloqueo/);
    assert.deepEqual(protection.actions,[{type:"start_protection",minutes:20,hard_mode:false}]);
    assert.match(protection.responseText,language === "es" ? /cuando el dispositivo verifique el bloqueo/ : /after the device verifies the block/);
  }
});

test("an ambiguous yes asks one precise recurrence question without repeating known details", () => {
  for (const [request,yes,once,language] of [
    ["Block Instagram now for 30 minutes.","Yes.","Just once.","en"],
    ["Bloquea Instagram ahora durante 30 minutos.","Sí.","Solo esta vez.","es"],
  ]) {
    const [first,ambiguous,resolved] = chat([request,yes,once],DEVICE,language);
    none(first); none(ambiguous);
    assert.equal(ambiguous.decision.slot,"recurrence");
    equalSlot(ambiguous,"duration_minutes",30); equalSlot(ambiguous,"start",{type:"now"});
    assert.equal(ambiguous.state.slots.recurrence,null,"yes cannot select a repeat pattern");
    assert.notEqual(ambiguous.responseText,first.responseText);
    assert.equal((ambiguous.responseText.match(/\?/g)||[]).length,1);
    assert.match(ambiguous.responseText,language === "es" ? /solo esta vez, cada día o en días concretos/ : /just once, every day, or on specific days/);
    assert.doesNotMatch(ambiguous.responseText,/30|Instagram/);
    assert.deepEqual(resolved.actions,[{type:"start_protection",minutes:30,hard_mode:false}]);
  }
});

console.log(`BM semantic state: ${checks}/${checks} independent transition and invariant checks passed`);
