"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{install}=require('./bm_shared_budget');
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'decisions-ledger-')),budgetFile=path.join(dir,'budget.json'),requestsFile=path.join(dir,'requests.json');
 const rates={model:'gpt-5.6-luna',input:.2,cached:.02,output:1.2,decisions_input:.1};
 fs.writeFileSync(budgetFile,JSON.stringify({limit_usd:1,known_usd:.1,reserved_upper_usd:.2,requests:7}));
 const request={body:JSON.stringify({model:rates.model,max_output_tokens:10}),headers:{authorization:'secret-not-recorded'}};
 const call=install({budgetFile,requestsFile,rates,fetcher:async()=>new Response(JSON.stringify({model:rates.model,usage:{input_tokens:100,output_tokens:10}}),{headers:{'content-type':'application/json','x-request-id':'req_fixture'}})});
 await Promise.all([call('https://api.openai.com/v1/responses',request),call('https://api.openai.com/v1/responses',request)]);
 const settled=JSON.parse(fs.readFileSync(budgetFile));assert.equal(settled.requests,9);assert(Math.abs(settled.known_usd-.100064)<1e-10);assert(Math.abs(settled.reserved_upper_usd-.200064)<1e-10);
 assert.equal(JSON.parse(fs.readFileSync(requestsFile))[0].provider_request_id,'req_fixture',"Non-streamed provider receipt lost");
 const unknown=install({budgetFile,requestsFile,rates,fetcher:async()=>{throw Error('timeout');}});await assert.rejects(()=>unknown('https://api.openai.com/v1/responses',request));assert(JSON.parse(fs.readFileSync(budgetFile)).reserved_upper_usd>settled.reserved_upper_usd);
 const stream=install({budgetFile,requestsFile,rates,fetcher:async()=>new Response('data: '+JSON.stringify({type:'response.completed',response:{model:rates.model,usage:{input_tokens:20,output_tokens:5}}})+'\n\n',{headers:{'content-type':'text/event-stream'}})});
 const response=await stream('https://api.openai.com/v1/responses',request);const before=JSON.parse(fs.readFileSync(budgetFile)).known_usd;await response.text();assert(JSON.parse(fs.readFileSync(budgetFile)).known_usd>before);
 assert(!fs.readFileSync(requestsFile,'utf8').includes('secret-not-recorded'));await assert.rejects(()=>call('https://api.openai.com/v1/responses',{body:JSON.stringify({model:'unpriced'})}),/unpriced/);
 const campaign=JSON.parse(fs.readFileSync(budgetFile)),guardFile=path.join(dir,'campaign.json'),oldGuard=process.env.BM_PROVIDER_SPEND_LIMIT_FILE;
 const guard={version:1,budget_file:budgetFile,initial_reserved_upper_usd:campaign.reserved_upper_usd,maximum_additional_usd:.000001,authorized_cumulative_limit_usd:1};
 fs.writeFileSync(guardFile,JSON.stringify(guard));process.env.BM_PROVIDER_SPEND_LIMIT_FILE=guardFile;
 try{
  const unchanged=fs.readFileSync(budgetFile,'utf8');let dispatched=0;
  const guarded=install({budgetFile,requestsFile,rates,fetcher:async()=>{dispatched++;throw Error('must_not_dispatch');}});
  await assert.rejects(()=>guarded('https://api.openai.com/v1/responses',request),/spend_limit/);assert.equal(dispatched,0);assert.equal(fs.readFileSync(budgetFile,'utf8'),unchanged);
  fs.writeFileSync(guardFile,JSON.stringify({...guard,budget_file:path.join(dir,'wrong.json')}));await assert.rejects(()=>guarded('https://api.openai.com/v1/responses',request),/invalid_campaign_guard/);
  fs.writeFileSync(guardFile,JSON.stringify({...guard,maximum_additional_usd:100}));assert.equal(require('./bm_provider_spend_limit').limit(budgetFile,campaign),1,'Campaign cannot raise the shared cap');
 }finally{if(oldGuard===undefined)delete process.env.BM_PROVIDER_SPEND_LIMIT_FILE;else process.env.BM_PROVIDER_SPEND_LIMIT_FILE=oldGuard;}
 const exhausted=JSON.parse(fs.readFileSync(budgetFile));exhausted.limit_usd=exhausted.reserved_upper_usd;fs.writeFileSync(budgetFile,JSON.stringify(exhausted));await assert.rejects(()=>call('https://api.openai.com/v1/responses',request),/spend_limit/);
 console.log('PASS shared budget: concurrent settlements, retained unknown reservations, streamed usage, no secrets, unpriced/exhausted rejection');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
