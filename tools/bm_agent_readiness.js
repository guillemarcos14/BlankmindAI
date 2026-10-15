"use strict";
// Read-only readiness: re-assess preserved real receipts against today's source.
// This never calls a provider or writes the activation manifest/shared ledger.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {adapt}=require('./bm_agent_report'),{assess}=require('../netlify/functions/bm-agent-evidence');
function build(){
 const root=path.resolve(__dirname,'..'),hashes=require('./bm_agent_runtime').verify();
 const budgetPath=path.resolve(root,'../Codigo-retrieval/tmp/retrieval-wide/budget.json');
 const budgetBytes=fs.readFileSync(budgetPath),budget=JSON.parse(budgetBytes);
 const sources={tools:['tmp/runtime-fix-20261015/runtime-pilot.json','tmp/runtime-fix-20261015/runtime-pilot-quality.json'],
  retrieval:['tmp/agent-eval/source-final-retrieval.json','tmp/agent-eval/source-final-retrieval-quality-v4.json'],
  labels:['../Codigo-runtime-fix/tmp/labels-replacement-20261015/pilot.json','../Codigo-runtime-fix/tmp/labels-replacement-20261015/pilot-quality-v5.json']};
 const assessments={};
 for(const [feature,files] of Object.entries(sources)){
  try{const [report,review]=files.map(p=>JSON.parse(fs.readFileSync(path.resolve(root,p))));
   assessments[feature]={inputs:files,assessment:assess(adapt(report,review),{feature,sourceHashes:hashes})};
  }catch(error){assessments[feature]={inputs:files,assessment:{approved:false,reasons:['missing_or_invalid_preserved_receipt']},error:error.message};}
 }
 return {source_hashes:hashes,local_only:true,new_provider_calls:0,new_spend_usd:0,activation_ready:false,
  current_manifest:JSON.parse(fs.readFileSync(path.join(root,'netlify/functions/bm-agent-activation.json'))),assessments,
  budget:{sha256:crypto.createHash('sha256').update(budgetBytes).digest('hex'),limit_usd:budget.limit_usd,known_usd:budget.known_usd,reserved_upper_usd:budget.reserved_upper_usd,remaining_usd:budget.limit_usd-budget.reserved_upper_usd,opaque_reservations:budget.remote_opaque_reservations.length,final_cap:budget.final_cap},
  blockers:['No current-source 200 distinct paired cases per feature, >=50 audio pairs, independent review, full costs and non-regressing global/language/group results.','Previous real labels cost/latency and tools subgroup regressions remain negative evidence; free mocks cannot reverse them.','No paid tests authorized in this task; remaining allowance is below the $1 minimum new voice reserve.','Physical iPhone/Watch validation and measured Watch sleep efficacy remain unproven.']};
}
if(require.main===module){const result=build(),out=path.resolve(__dirname,'../tmp/local-regressions-20261015/readiness.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({activation_ready:false,assessments:Object.fromEntries(Object.entries(result.assessments).map(([k,v])=>[k,v.assessment.reasons])),output:out}));}
module.exports={build};
