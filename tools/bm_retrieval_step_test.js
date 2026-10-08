"use strict";
const assert=require("node:assert/strict"),r=require("../netlify/functions/bm-retrieval-step");
async function main(){
 const probabilities={eligible:1,sleep_yesterday:1,sleep_week:0,protection_yesterday:0,protection_week:0};
 assert.equal(r.selected({answers:probabilities}),"sleep_yesterday");
 for(const answers of [{...probabilities,eligible:null},{...probabilities,sleep_week:.95},{...probabilities,protection_week:null},{...probabilities,sleep_yesterday:.94}])assert.equal(r.selected({answers}),null);
 assert.equal(r.enabled("11111111-1111-4111-8111-111111111111",{}),false);
 let calls=0;assert.equal(await r.start("11111111-1111-4111-8111-111111111111","x",{env:{},fetcher:async()=>calls++}),null);assert.equal(calls,0);
 const options={userId:"owner",identity:{anonymous_user_id:"verified-link"},cutoff:"2026-10-07T08:00:00Z",timezone:"Europe/Madrid",now:Date.parse("2026-10-08T10:00:00Z"),db:()=>{}};
 let qSeen;const read=async(u,i,q,cutoff)=>{assert.equal(u,"owner");assert.equal(i.anonymous_user_id,"verified-link");assert.equal(cutoff,options.cutoff);qSeen=q;return {source:q.source,available:true,rows:[{id:"s",metric:"sleep_duration",value_number:0,unit:"minutes"},{metric:"energy",value_number:8,unit:"score_0_10"}],next_offset:null};};
 const ready=await r.prepare("sleep_yesterday",{...options,read});assert.equal(ready.source.rows.length,1);assert.equal(ready.source.rows[0].value_number,0);assert.equal(qSeen.from,"2026-10-06T22:00:00.000Z");assert.equal(qSeen.to,"2026-10-07T22:00:00.000Z");
 assert.equal(await r.prepare("sleep_yesterday",{...options,read:async()=>({available:true,rows:[],next_offset:40})}),null);
 assert.equal(await r.prepare("protection_week",{...options,read:async()=>({rows:[],coverage:"first_10000_overlapping_rows"})}),null);
 const valid={phase:"final",message_kind:"question",decision:"respond",action:null,memory:null,accepted_proposal:null,pending_request:null,queries:[],observations:[],followup_resolution:null,longitudinal_review:null};
 assert(r.safeFinal(valid));let seen;const result=await r.answer({},async i=>{seen=i;return valid;},ready.contract);assert.equal(result,valid);assert.equal(seen.tool_budget_remaining,0);
 for(const change of [{action:{type:"start_protection"}},{memory:{operation:"set"}},{phase:"read"},{observations:[{}]},{message_kind:"action_request"},{followup_resolution:{}}])assert.equal(await r.answer({},async()=>({...valid,...change}),ready.contract),null);
 assert.equal(await r.answer({},async()=>{throw Error("failed");},ready.contract),null);
 // Cross DST: yesterday in Madrid on spring transition is 23 hours.
 await r.prepare("sleep_yesterday",{...options,now:Date.parse("2026-03-30T10:00:00Z"),read:async(u,i,q)=>{assert.equal(Date.parse(q.to)-Date.parse(q.from),23*3600000);return {available:true,rows:[],next_offset:null};}});
 console.log("PASS retrieval step: conservative routes, off gate, owner/cutoff, exact local dates/DST, complete reads, zero preservation, final-only authority and fallback");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
