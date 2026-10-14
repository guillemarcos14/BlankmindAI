"use strict";
const assert=require("node:assert/strict"),crypto=require("node:crypto"),{adapt}=require("./bm_agent_report"),{input}=require("./bm_agent_quality");
const sha=x=>crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex");
const row={agent_feature:"tools",variant:"decisions",pair:0,step:0,case_id:"fixture",language:"es",group:"action",status:200,
 synthetic_input:"Modifica mi ventana",synthetic_response:"Voy a intentarlo",action_id_present:true,auto_apply:true,pending_action:{type:"update_schedule",window_id:"fixture",weekdays:[2,3,4,5,6]},
 expected:{criterion:"Exact update only"},canonical_memories:[],canonical_observations:[],committed_effect:[{brain_memory_effect:null}],
 first_text_ms:100,first_audio_ms:999,cost_usd:0,provider_requests:[{endpoint:"responses",provider_request_id:"req_fixture",usage:{input_tokens:100,output_tokens:10,cached_input_tokens:0,cache_write_tokens:0}}]};
const report={complete:true,run_id:"fixture",provider_real:true,generative_model:"gpt-5.6-luna",rates:{input:.2,cached:.02,output:1.2},agent_source_hashes:{},case_manifest:{cases:[{id:"fixture",expected_action:structuredClone(row.pending_action)}]},records:[row]};
const quality={complete:true,source_sha256:sha(report),model:"gpt-5.6-sol",reviews:[{id:"decisions:0:0",input_sha256:sha(input(row,report)),review:{response_ok:true,memory_ok:true,action_ok:true,naturalness:4}}]};
const converted=adapt(report,quality)[0];
assert.equal(converted.first_audio_ms,null,"An unpaired/unsolicited audio timing was invented");
assert.equal(converted.audio_requested,false);assert.equal(converted.quality.reviewed,true);assert.equal(converted.variant,"candidate");
assert.equal(converted.quality.action_ok,true);
const wrong=structuredClone(report);wrong.records[0].pending_action.weekdays=[1,2,3,4,5];
const wrongReview={...quality,source_sha256:sha(wrong),reviews:[{...quality.reviews[0],input_sha256:sha(input(wrong.records[0],wrong))}]};
assert.equal(adapt(wrong,wrongReview)[0].quality.action_ok,false,"A model approval overrode wrong native parameters");
assert.equal(converted.cost_usd,.000032);assert.equal(converted.background_cost_usd,0);
assert.equal(input(row,report).requested_action.type,"update_schedule","All actions became a hardcoded 30-minute block");
assert(!Object.hasOwn(input(row,report),"variant"),"Reviewer was not blind");
assert.throws(()=>adapt(report,{...quality,source_sha256:"changed"}),/unchanged/);
assert.throws(()=>adapt(report,{...quality,model:report.generative_model}),/Independent/);
assert.throws(()=>adapt(report,{...quality,reviews:[...quality.reviews,...quality.reviews]}),/Duplicate/);
assert.throws(()=>adapt(report,{...quality,reviews:[{...quality.reviews[0],input_sha256:"changed"}]}),/original turn/);
const unaudited=structuredClone(report);delete unaudited.records[0].canonical_observations;
const uq={...quality,source_sha256:sha(unaudited),reviews:[{...quality.reviews[0],input_sha256:sha(input(unaudited.records[0],unaudited))}]};
assert.equal(adapt(unaudited,uq)[0].quality.reviewed,false,"Missing database audit qualified as complete memory review");
console.log("PASS real-receipt adapter: exact source/review binding, independent blind judge, actual action, full cost, missing state audits and no invented audio");
