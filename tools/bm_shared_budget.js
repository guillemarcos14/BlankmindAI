"use strict";
// Preload for paid local replay/judge processes. One active paid process only.
// Never stores headers, keys or personal request bodies.
const fs=require('node:fs'),crypto=require('node:crypto'),meter=require('./bm_decisions_meter');
function install({budgetFile,requestsFile,fetcher=global.fetch,rates}){
 const requests=fs.existsSync(requestsFile)?JSON.parse(fs.readFileSync(requestsFile)):[];
 const save=()=>fs.writeFileSync(requestsFile,JSON.stringify(requests,null,2));
 return async(url,options)=>{
  if(!['https://api.openai.com/v1/responses','https://api.openai.com/v1/decisions'].includes(String(url)))return fetcher(url,options);
  const request=JSON.parse(options.body),endpoint=String(url).endsWith('/decisions')?'decisions':'responses';
  const price=endpoint==='decisions'?{...rates,input:rates.decisions_input,cached:0,output:0}:request.model==='gpt-5.6-sol'?{input:4,cached:.4,output:20}:rates;
  if(endpoint==='responses'&&request.model!==rates.model&&request.model!=='gpt-5.6-sol')throw Error('shared_budget_unpriced_model');
  const upper=(Buffer.byteLength(options.body)*1.25*price.input+(request.max_output_tokens||10000)*price.output)/1e6;
  const budget=JSON.parse(fs.readFileSync(budgetFile));
  if(budget.reserved_upper_usd+upper>budget.limit_usd)throw Error('shared_budget_spend_limit');
  budget.reserved_upper_usd+=upper;budget.requests++;fs.writeFileSync(budgetFile,JSON.stringify(budget,null,2));
  const row={endpoint,model:request.model,reserved_upper_usd:upper,request_sha256:crypto.createHash('sha256').update(options.body).digest('hex')};requests.push(row);save();
  let settled=false;
  const settle=()=>{if(settled)return;settled=true;const measured=meter.estimate(row,price);if(measured!==null){const fresh=JSON.parse(fs.readFileSync(budgetFile));fresh.known_usd+=measured;fresh.reserved_upper_usd-=upper-measured;if(request.model==='gpt-5.6-sol')fresh.reviewer_known_usd=(fresh.reviewer_known_usd||0)+measured;fs.writeFileSync(budgetFile,JSON.stringify(fresh,null,2));}save();};
  try{
   const response=await meter.meterResponse(await fetcher(url,options),row);
   if(!response.headers.get('content-type')?.includes('text/event-stream')){settle();return response;}
   const stream=response.body.pipeThrough(new TransformStream({transform(chunk,c){c.enqueue(chunk);},flush(){settle();}}));
   return new Response(stream,{status:response.status,statusText:response.statusText,headers:response.headers});
  }catch(error){row.error=error.name;save();throw error;}
 };
}
if(process.env.BM_SHARED_BUDGET_FILE){
 if(!process.env.BM_SHARED_REQUESTS_FILE||!process.env.BM_SHARED_RATES_FILE)throw Error('shared_budget_paths_required');
 global.fetch=install({budgetFile:process.env.BM_SHARED_BUDGET_FILE,requestsFile:process.env.BM_SHARED_REQUESTS_FILE,rates:JSON.parse(fs.readFileSync(process.env.BM_SHARED_RATES_FILE))});
}
module.exports={install};
