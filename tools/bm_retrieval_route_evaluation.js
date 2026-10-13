"use strict";
// Real classifier diagnostic over authored fixtures; never account/source reads.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),meter=require('./bm_decisions_meter');
const arg=(k,d)=>process.argv.includes(k)?process.argv[process.argv.indexOf(k)+1]:d;
async function main(){
 if(!process.argv.includes('--run')||!process.env.OPENAI_API_KEY)throw Error('route_evaluation_explicit_provider_required');
 const root=path.resolve(arg('--runtime','.')),route=require(path.join(root,'netlify/functions/bm-retrieval-step'));
 const cases=JSON.parse(fs.readFileSync(arg('--cases','tools/datasets/bm_decisions_global_holdout_2026-10-09.json'))).cases;
 if(cases.length>300)throw Error('route_evaluation_limit');
 const budgetFile=arg('--budget-file','../Codigo-retrieval/tmp/retrieval-wide/budget.json'),output=arg('--output','tmp/decisions-production/routes.json'),rows=[];
 const report={runtime_commit:require('child_process').execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),runtime_sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'netlify/functions/bm-retrieval-step.js'))).digest('hex'),provider_real:true,source_reads:0,records:rows,complete:false};
 const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2));
 for(const c of cases){
  const text=c.turns?.[0]||c.text,expected=Object.hasOwn(route.ROUTES,c.route)?c.route:c.route==='contextual'?'sleep_week':null;
  const row={case_id:c.id,input:text,expected,selected:null,answers:null,passed:false};rows.push(row);
  if(!route.candidate(text)){row.prefilter_rejected=true;row.passed=expected===null;save();continue;}
  const payload=route.request(text),body=JSON.stringify(payload),budget=JSON.parse(fs.readFileSync(budgetFile));
  const upper=Buffer.byteLength(body)*.1/1e6;if(budget.reserved_upper_usd+upper>budget.limit_usd)throw Error('route_evaluation_spend_limit');
  budget.reserved_upper_usd+=upper;budget.requests++;fs.writeFileSync(budgetFile,JSON.stringify(budget,null,2));
  row.provider={endpoint:'decisions',synthetic_request:payload,reserved_upper_usd:upper};
  try{
   const response=await meter.meterResponse(await fetch('https://api.openai.com/v1/decisions',{method:'POST',headers:{authorization:'Bearer '+process.env.OPENAI_API_KEY,'content-type':'application/json'},body,signal:AbortSignal.timeout(5000)}),row.provider);
   if(!response.ok)throw Error('route_evaluation_http_'+response.status);
   const result=require(path.join(root,'netlify/functions/bm-decisions')).validate(await response.json(),payload);row.answers=result.answers;row.selected=route.selected(result);row.passed=row.selected===expected;
  }catch(e){row.error=e.name==='TimeoutError'?'timeout':/^route_evaluation_http_\d+$/.test(e.message)?e.message:'provider_or_schema';}
  const measured=meter.estimate(row.provider,{decisions_input:.1}),latest=JSON.parse(fs.readFileSync(budgetFile));
  if(measured!==null){latest.known_usd+=measured;latest.reserved_upper_usd-=upper-measured;}fs.writeFileSync(budgetFile,JSON.stringify(latest,null,2));save();
 }
 report.complete=true;report.summary={cases:rows.length,passed:rows.filter(x=>x.passed).length,false_accepts:rows.filter(x=>x.selected&&x.selected!==x.expected).length,rejections:rows.filter(x=>x.expected&&!x.selected).length,unknown_usage:rows.filter(x=>x.provider&&!x.provider.usage).length};save();console.log(JSON.stringify(report.summary));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
