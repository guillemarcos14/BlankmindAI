"use strict";
// Committed real-model replies -> actual voice handler -> ElevenLabs PCM.
// Auth/lease isolation is tested separately against QA; physical playback is not.
const fs=require("node:fs"),crypto=require("node:crypto"),path=require("node:path"),assert=require("node:assert/strict");
const {sql}=require("./bm_agent_label_provider_probe");
const arg=(k,d)=>process.argv.includes(k)?process.argv[process.argv.indexOf(k)+1]:d;
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
async function main(){
 if(!process.argv.includes("--run")||!process.env.ELEVENLABS_API_KEY)throw Error("Explicit voice probe/key required");
 assert.equal(sql("select current_database()"),"blank_test");
 const budgetFile=arg("--budget-file"),output=arg("--output"),source=JSON.parse(fs.readFileSync(arg("--input")));
 if(!source.complete||!budgetFile||!output)throw Error("Frozen source and existing budget required");
 const budget=JSON.parse(fs.readFileSync(budgetFile));if(budget.reserved_upper_usd+1>budget.limit_usd)throw Error("shared_budget_spend_limit");
 const run=crypto.randomUUID();
 budget.reserved_upper_usd+=1;budget.remote_opaque_reservations||=[];budget.remote_opaque_reservations.push({run_id:run,kind:"agent-voice-probe",reserved_upper_usd:1,character_cap:800,usage_usd:null,reason:"Prepaid credits; exact monetary usage not returned. Never increases the existing restricted-key limit."});
 fs.writeFileSync(budgetFile,JSON.stringify(budget,null,2)+"\n");
 Object.assign(process.env,{BM_VOICE_ENABLED:"true",BM_VOICE_PROVIDER:"elevenlabs"});
 const user=crypto.randomUUID(),records=[];let consumed=0;
 sql("insert into auth.users(id) values("+quote(user)+")");
 try{
  // All four behavior groups, both languages when the available character cap permits.
  const selected=source.records.filter(r=>r.variant==="decisions"&&r.passed&&r.synthetic_response?.length<160&&["chat","query","action","memory","bedtime"].includes(r.group));
  const seen=new Set();
  for(const row of selected){
   const key=row.group+":"+row.language;if(seen.has(key))continue;
   const text=row.synthetic_response;if(consumed+text.length>800)continue;
   seen.add(key);consumed+=text.length;const turn=crypto.randomUUID();
   sql("insert into assistant_app_turns(id,auth_user_id,user_text,assistant_text,response_language,status,completed_at) values("+[quote(turn),quote(user),quote("Synthetic recorded voice probe"),quote(text),quote(row.language),quote("completed"),"clock_timestamp()"].join(",")+")");
   const started=performance.now();let first=null,bytes=0,status=null,requestId=null;
   const response=await require("../netlify/functions/bm-voice-output").voice(new Request("http://localhost/assistant-app-voice",{method:"POST",body:JSON.stringify({turn_id:turn,request_id:crypto.randomUUID(),synchronized:true,elevenlabs_consent:true})}),{
    authenticate:async()=>({user:{id:user}}),
    readTurn:async(id,t)=>{assert.equal(id,user);return JSON.parse(sql("select to_jsonb(t) from assistant_app_turns t where auth_user_id="+quote(id)+" and id="+quote(t)));},
    reserve:async b=>JSON.parse(sql("select jsonb_build_array(to_jsonb(r)) from reserve_assistant_voice("+[quote(b.p_auth_user_id),quote(b.p_turn_id),quote(b.p_request_id)].join(",")+") r")),
    fetch:async(url,options)=>{assert(/^https:\/\/api.elevenlabs.io\/v1\/text-to-speech\/[a-zA-Z0-9]{20}\/with-timestamps\?output_format=pcm_24000$/.test(url));const body=JSON.parse(options.body);assert.equal(body.text,text);assert.equal(body.model_id,"eleven_multilingual_v2");const r=await fetch(url,options);status=r.status;requestId=r.headers.get("request-id");return r;}
   });
   let error=null;
   if(response.ok){
    const decoder=new TextDecoder(),reader=response.body.getReader();let buffer="";
    while(true){const next=await reader.read();if(next.done)break;buffer+=decoder.decode(next.value,{stream:true});let i;while((i=buffer.indexOf("\n"))>=0){const frame=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);if(frame.type==="audio"){first??=performance.now()-started;bytes+=Buffer.from(frame.pcm,"base64").length;}if(frame.type==="error")error=frame.error;}}
   }else error=(await response.json()).error;
   records.push({case_id:row.case_id,group:row.group,language:row.language,status:response.status,provider_status:status,provider_request_id:requestId,characters:text.length,first_audio_ms:first,audio_bytes:bytes,error,passed:response.ok&&bytes>0&&first!==null&&!error});
   if(!records.at(-1).passed)break;
  }
  const report={version:1,source_run_id:source.run_id,runtime_hashes:require("./bm_agent_runtime").verify(),records,characters:consumed,reserved_upper_usd:1,known_cost_usd:null,physical_playback_tested:false,paired_latency_gate:false,passed:records.length>=2&&records.every(r=>r.passed)};
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));
  if(!report.passed)process.exitCode=1;
 }finally{sql("delete from auth.users where id="+quote(user));}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
