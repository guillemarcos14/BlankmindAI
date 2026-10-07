"use strict";
// Compare only the five truly shared intent labels. Topics have no planner enum.
// Real provider, original reply schema/instructions, empty synthetic sources;
// no DB writes or device actions. This first reply call is not a full workflow.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {generate}=require("../netlify/functions/bmb-brain"),{readModelJson}=require("../netlify/functions/bm-model-request");
const {inventory}=require("../netlify/functions/bmb-sources");
const shared=new Set(["question","statement","action_request","acceptance","social"]);
function summary(cases,records){
 return Object.fromEntries(["es","en"].map(language=>{
  const expected=cases.filter(c=>c.language===language&&shared.has(c.expected.intent)),rows=records.filter(r=>r.language===language&&r.comparable);
  return [language,{eligible:expected.length,evaluated:rows.length,errors:rows.filter(r=>r.error).length,
   planner_correct:rows.filter(r=>r.planner_intent===r.expected_intent).length,jev_correct:rows.filter(r=>r.jev_intent===r.expected_intent).length,
   planner_accuracy:rows.length?rows.filter(r=>r.planner_intent===r.expected_intent).length/rows.length:null,
   jev_accuracy:rows.length?rows.filter(r=>r.jev_intent===r.expected_intent).length/rows.length:null}];
 }));
}
async function main(){
 if(!process.argv.includes("--run")||!process.env.OPENAI_API_KEY)throw Error("jev_explicit_planner_comparison_required");
 const dataset=require("./datasets/bm_jev_v1.json"),jevResults=[...require("../tmp/jev/tuning-revised.json").records,...require("../tmp/jev/evaluation-revised.json").records];
 const file=path.resolve("tmp/jev/planner-comparison.json"),records=[],originalInfo=console.info;console.info=()=>{};
 const report={schema_version:1,provider_real:true,model:"gpt-5.6-luna",instruction_sha256:crypto.createHash("sha256").update(require("../netlify/functions/bmb-brain").INSTRUCTIONS).digest("hex"),
  scope:"First original generative reply call, identical synthetic empty-source fixture; shared intent labels only",independent_human_review:false,records,complete:false,gates_passed:false};
 const save=()=>fs.writeFileSync(file,JSON.stringify({...report,summary:summary(dataset.cases,records)},null,2));
 let next=0;try{await Promise.all(Array.from({length:4},async()=>{while(next<dataset.cases.length){
  const c=dataset.cases[next++],row={id:c.id,language:c.language,split:c.split,comparable:shared.has(c.expected.intent),expected_intent:c.expected.intent,jev_intent:jevResults.find(r=>r.id===c.id)?.body?.answers?.intent?.choice||jevResults.find(r=>r.id===c.id)?.received?.answers?.intent?.choice||null};
  const input={current_message:c.current_message,mode:"reactive",proactive:null,now:"2026-10-07T14:00:00Z",timezone:"Europe/Madrid",previous_language:c.language,open_followups:[],context:{has_selected_apps:true,screen_time_authorized:true},
   memories:[],pending:{},settings:null,sources:[{source:"history",rows:c.previous_turn?[{user_text:c.previous_turn.user,assistant_text:c.previous_turn.assistant}]:[]}],source_catalog:inventory(null),coverage:[],tool_budget_remaining:3};
  const start=performance.now();try{const result=await generate(input,{model:options=>readModelJson({...options,observeMetrics:m=>{if(m.usage)row.usage=m.usage;}})});
   row.planner_intent=result.message_kind;row.phase=result.phase;row.source_queries=(result.queries||[]).map(q=>q.source);
  }catch(e){row.error=/^bmb_[a-z0-9_]+$/.test(e.message)?e.message:"planner_failed";}
  row.elapsed_ms=Math.round(performance.now()-start);records.push(row);save();
 }}));report.complete=records.length===300;}finally{console.info=originalInfo;save();}
 console.log(JSON.stringify({file,complete:report.complete,summary:summary(dataset.cases,records)}));
}
if(require.main===module)main().catch(()=>{console.error("jev_planner_comparison_failed");process.exitCode=1;});
module.exports={summary,shared};
