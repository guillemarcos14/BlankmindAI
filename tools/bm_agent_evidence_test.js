"use strict";
const assert=require("node:assert/strict"),{assess}=require("../netlify/functions/bm-agent-evidence"),{digests,approved}=require("../netlify/functions/bm-agent-activation");
// Invented offline measurements test rejection only; never provider evidence.
const hashes=digests(),groups=["chat","query","action","memory"];
const fixtures=()=>Array.from({length:200},(_,i)=>["baseline","candidate"].map(variant=>({feature:"tools",variant,case_id:"fixture-"+i,language:i%2?"es":"en",group:groups[Math.floor(i/2)%4],audio_requested:i%3!==0,
 provider_measured:true,model:"gpt-5.6-luna",provider_request_ids:["req_fixture_"+variant+"_"+i],first_text_ms:variant==="candidate"?90:100,first_audio_ms:i%3===0?null:variant==="candidate"?190:200,
 cost_usd:variant==="candidate"?.001:.002,background_cost_usd:0,error:false,quality:{response_ok:true,memory_ok:true,action_ok:true,reviewed:true,reviewer:"offline-fixture"},source_hashes:hashes}))).flat();
const check=rows=>assess(rows,{feature:"tools",sourceHashes:hashes});
let rows=fixtures(),result=check(rows);assert.equal(result.approved,true);assert.equal(approved("tools",{version:1,features:{tools:result}},hashes),true);
for(const mutate of [
 rs=>{rs[1].cost_usd=3;},rs=>{rs[1].quality.action_ok=false;},rs=>{rs.forEach(r=>{if(r.variant==="candidate")r.first_text_ms=10000;});},
 rs=>{rs[1].background_cost_usd=3;},rs=>{rs[1].cost_usd=null;},rs=>{rs[1].quality.reviewed=false;},
 rs=>{rs[1].source_hashes={};},rs=>{rs[1].provider_request_ids=rs[0].provider_request_ids;},
 rs=>{rs[1].audio_requested=true;rs[1].first_audio_ms=190;},rs=>{rs.forEach(r=>r.language="es");},
 rs=>{rs.forEach(r=>{if(r.variant==="candidate"&&r.group==="memory")r.cost_usd=.003;});}
]){rows=fixtures();mutate(rows);assert.equal(check(rows).approved,false,"Incomplete or regressed evidence activated");}
assert.equal(assess(fixtures(),{feature:"tools"}).approved,false);
assert.equal(check(fixtures().slice(0,398)).approved,false);
assert.equal(approved("tools",{version:1,features:{tools:{...result,case_count:undefined}}},hashes),false);
assert.equal(approved("tools",{version:1,features:{tools:result}},{...hashes,"bmb-brain.js":"changed"}),false);
console.log("PASS agent evidence: paired coverage, runtime hashes, independent quality, audio/background cost, subgroups, missing/reused receipts and regressions; fixtures do not activate runtime");
