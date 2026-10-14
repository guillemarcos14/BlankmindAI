"use strict";
// Real Decisions + real disposable PostgreSQL. Never touches cloud schema.
const fs=require("node:fs"),crypto=require("node:crypto"),cp=require("node:child_process"),assert=require("node:assert/strict");
const arg=(k,d)=>process.argv.includes(k)?process.argv[process.argv.indexOf(k)+1]:d;
const CONTAINER="blank-agent-20261014";
function sql(query){return cp.execFileSync("docker",["exec","-i",CONTAINER,"psql","-At","-v","ON_ERROR_STOP=1","-U","postgres","-d","blank_test","-c",query],{encoding:"utf8",windowsHide:true}).trim();}
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
async function main(){
 if(!process.argv.includes("--run")||!process.env.OPENAI_API_KEY)throw Error("Explicit provider probe required");
 assert.equal(sql("select current_database()"),"blank_test");
 const budget=arg("--budget-file"),output=arg("--output"),rates=JSON.parse(fs.readFileSync(arg("--rates")));
 if(!budget||!output||!fs.existsSync(budget))throw Error("Existing budget/output required");
 const meter=require("./bm_shared_budget").install({budgetFile:budget,requestsFile:output+".requests.json",rates});
 const labels=require("../netlify/functions/bm-agent-labels"),activation=require("../netlify/functions/bm-agent-activation");
 const user=crypto.randomUUID(),env={...process.env,SUPABASE_URL:activation.QA,BM_AGENT_QA_ENABLED:"true",BM_AGENT_QA_FEATURES:"labels",BM_AGENT_LABEL_DAILY_USD:"0.5"};
 let calls=0;const records=[];sql("insert into auth.users(id) values("+quote(user)+")");
 try{
  const db=async(route,options)=>{
   const b=JSON.parse(options.body);assert.equal(b.p_user,user);
   if(route.endsWith("reserve"))return JSON.parse(sql("select bm_agent_labels_reserve("+[quote(b.p_user),quote(b.p_turn),b.p_daily_limit].join(",")+")"));
   assert(route.endsWith("finish"));
   return JSON.parse(sql("select bm_agent_labels_finish("+[quote(b.p_user),quote(b.p_turn),quote(b.p_token),quote(b.p_source_hash),b.p_result===null?"null":quote(JSON.stringify(b.p_result))+"::jsonb",b.p_attempted?"true":"false"].join(",")+")"));
  };
  for(const [key,value,text]of [
   ["bedtime","23:00","Normalmente me acuesto a las 23:00"],
   ["bedtime","01:00","Corrijo mi horario anterior, ahora me acuesto a la 01:00"],
   ["preferences","silencio","Mi preferencia para dormir es el silencio"]]){
   const turn=crypto.randomUUID(),effect={operation:"set",key,value,evidence:value};
   sql("insert into assistant_app_turns(id,auth_user_id,user_text,assistant_text,status,completed_at,brain_memory_effect) values("+[quote(turn),quote(user),quote(text),quote("Anotado"),quote("completed"),"clock_timestamp()",quote(JSON.stringify(effect))+"::jsonb"].join(",")+");select commit_assistant_brain_memory("+quote(user)+","+quote(turn)+")");
   const result=await labels.organize({userId:user,turnId:turn},{env,db,fetcher:async(...args)=>{calls++;return meter(...args);}});
   assert(result,"Real provider result did not persist");
   records.push({key,turn,result});
   await labels.organize({userId:user,turnId:turn},{env,db,fetcher:async(...args)=>{calls++;return meter(...args);}});
  }
  assert.equal(calls,3,"Replay repeated paid labeling");
  const remaining=JSON.parse(sql("select coalesce(jsonb_agg(jsonb_build_object('turn_id',turn_id,'result',result)),'[]') from bm_agent_labels where auth_user_id="+quote(user)));
  assert.equal(remaining.length,2,"Correction did not invalidate old metadata");
  const turn=crypto.randomUUID(),effect={operation:"forget_all",key:null,value:null,evidence:"Olvida todo"};
  sql("insert into assistant_app_turns(id,auth_user_id,user_text,assistant_text,status,completed_at,brain_memory_effect) values("+[quote(turn),quote(user),quote("Olvida todo"),quote("Hecho"),quote("completed"),"clock_timestamp()",quote(JSON.stringify(effect))+"::jsonb"].join(",")+");select commit_assistant_brain_memory("+quote(user)+","+quote(turn)+")");
  assert.equal(sql("select count(*) from bm_agent_labels where auth_user_id="+quote(user)),"0");
  const report={version:1,source_hashes:require("./bm_agent_runtime").verify(),provider_measured:true,database_real:true,cloud_schema_mutations:0,calls,records,correction_invalidation:true,forgetting_invalidation:true,gates_passed:false};
  fs.writeFileSync(output,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify({passed:true,calls,labels:records.map(r=>r.result.labels)}));
 }finally{sql("delete from auth.users where id="+quote(user));}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={sql};
