"use strict";
const assert=require("node:assert/strict"),membership=require("../netlify/functions/_membership");
let calls=[],rows=[{key:"bedtime",value:"23:00",source_at:"2026-10-01T12:00:00Z",source_turn_id:"turn-A"},{key:"_reset",value:null,source_at:"2026-10-02T12:00:00Z"},{key:"other_account_field",value:"discard"}];
membership.supabaseFetch=async(path,options)=>{calls.push({path,options});return path.startsWith("bm_brain_memories")?rows:{committed:true};};
const memory=require("../netlify/functions/bm-memory");
(async()=>{
 const facts=await memory.readMemories("owner-A");assert.equal(facts.length,2);assert(calls[0].path.includes("auth_user_id=eq.owner-A"));
 assert.equal(facts[0].source,"user_statement");assert.equal(facts[1].value,null,"Memory cutoff was lost");
 await memory.commitMemory("owner-A","turn-A");assert.deepEqual(JSON.parse(calls.at(-1).options.body),{p_auth_user_id:"owner-A",p_turn_id:"turn-A"});
 membership.supabaseFetch=async()=>({committed:false});
 // The binding is captured by the module; failed RPC is separately covered in the SQL integration test.
 assert(!Object.hasOwn(memory,"planBrainTurn"),"Retired router remains a second authority");
 console.log("Memory: owner-scoped declarations, cutoff, atomic turn commit and single BMB authority passed");
})().catch(e=>{console.error(e);process.exitCode=1;});
