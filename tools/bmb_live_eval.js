"use strict";
// Synthetic account sources, real configured provider, zero queued/device actions.
const fs=require("node:fs");
const membership=require("../netlify/functions/_membership");
let oldRows=[],memories=[],policy=[];
membership.supabaseFetch=async path=>path.startsWith("bm_brain_memories")?memories:path.startsWith("bmb_accounts")?policy:path.startsWith("assistant_app_turns")?oldRows:[];
const brain=require("../netlify/functions/bmb-brain");
const {readModelJson}=require("../netlify/functions/bm-model-request");
let calls=0,tokens=0;
const run=input=>brain.generate(input,{model:async options=>{
  if(calls>=16||tokens>=50000)throw Error("evaluation_budget_reached");calls++;
  const result=await readModelJson(options);tokens+=result.body.usage?.total_tokens||0;return result;
}});
const context=()=>({language:"en",memory:{semantic_store_version:0},has_selected_apps:true,screen_time_authorized:true,is_blank_active:false,
  brain_snapshot:{schema_version:1,generated_at:new Date().toISOString(),timezone:"Europe/Madrid",history_complete:true,sessions:[]}});
async function main(){
  if(!process.argv.includes("--run")||!process.env.OPENAI_API_KEY)throw Error("explicit_live_run_required");
  const records=[];let pending=null;
  const cases=[
    {prompt:"How can I sleep better? I keep using my phone in bed.",check:p=>!p.actions.length&&p.response_text.length>20},
    {prompt:"I go to bed at 23:00 and wake up at 07:00.",check:p=>!p.actions.length},
    {prompt:"Block my distractions now for 30 minutes, only once.",check:p=>p.actions[0]?.type==="start_protection"&&p.actions[0].minutes===30},
    {prompt:"Block my distractions now",check:p=>!p.actions.length&&p.response_text.includes("?")},
    {prompt:"Actually, I had a rough morning and kept scrolling.",check:p=>!p.actions.length},
    {prompt:"Forget the block",check:p=>!p.actions.length&&p.bmb_state.pending_request===null&&p.bmb_invalidates},
    {prompt:"¿Qué recuerdas de mí?",check:p=>p.response_language==="es"&&!p.actions.length},
    {prompt:"Which day do I actually use my phone most?",check:p=>!p.actions.length&&/usage|use|data|screen time/i.test(p.response_text)},
    {prompt:"Block my distractions tonight from 22:30 to 07:00, only tonight.",check:p=>p.actions[0]?.recurrence==="once"&&p.actions[0]?.starts_at&&p.actions[0]?.ends_at},
  ];
  for(const [index,test] of cases.entries()){
    const ctx=context();if(pending)ctx.memory.conversation_state={bmb_state:pending};
    if(index===6)memories=[{key:"goal",value:"dormir mejor",source_at:"2026-09-01T10:00:00Z",source:"user_statement"}];else memories=[];
    const record={prompt:test.prompt};
    try{const {plan}=await brain.plan({prompt:test.prompt,context:ctx,userId:"synthetic-A",identity:{anonymous_user_id:"synthetic-linked-A"}},{run});record.plan=plan;record.passed=Boolean(test.check(plan));pending=plan.bmb_state;}
    catch(error){record.passed=false;record.error=error.message;}
    records.push(record);
  }
  const report={provider_real:true,deployed_model_tested:false,sources:"synthetic",native_actions_executed:0,model:process.env.OPENAI_MODEL||"gpt-5.6-luna",calls,tokens,passed:records.filter(r=>r.passed).length,total:records.length,records};
  fs.mkdirSync("tmp/bmb",{recursive:true});fs.writeFileSync("tmp/bmb/live-eval.json",JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,records:undefined}));if(report.passed!==report.total)process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
