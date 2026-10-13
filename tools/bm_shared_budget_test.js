"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{install}=require('./bm_shared_budget');
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'decisions-ledger-')),budgetFile=path.join(dir,'budget.json'),requestsFile=path.join(dir,'requests.json');
 const rates={model:'gpt-5.6-luna',input:.2,cached:.02,output:1.2,decisions_input:.1};
 fs.writeFileSync(budgetFile,JSON.stringify({limit_usd:1,known_usd:.1,reserved_upper_usd:.2,requests:7}));
 const request={body:JSON.stringify({model:rates.model,max_output_tokens:10}),headers:{authorization:'secret-not-recorded'}};
 const call=install({budgetFile,requestsFile,rates,fetcher:async()=>new Response(JSON.stringify({model:rates.model,usage:{input_tokens:100,output_tokens:10}}),{headers:{'content-type':'application/json'}})});
 await Promise.all([call('https://api.openai.com/v1/responses',request),call('https://api.openai.com/v1/responses',request)]);
 const settled=JSON.parse(fs.readFileSync(budgetFile));assert.equal(settled.requests,9);assert(Math.abs(settled.known_usd-.100064)<1e-10);assert(Math.abs(settled.reserved_upper_usd-.200064)<1e-10);
 const unknown=install({budgetFile,requestsFile,rates,fetcher:async()=>{throw Error('timeout');}});await assert.rejects(()=>unknown('https://api.openai.com/v1/responses',request));assert(JSON.parse(fs.readFileSync(budgetFile)).reserved_upper_usd>settled.reserved_upper_usd);
 const stream=install({budgetFile,requestsFile,rates,fetcher:async()=>new Response('data: '+JSON.stringify({type:'response.completed',response:{model:rates.model,usage:{input_tokens:20,output_tokens:5}}})+'\n\n',{headers:{'content-type':'text/event-stream'}})});
 const response=await stream('https://api.openai.com/v1/responses',request);const before=JSON.parse(fs.readFileSync(budgetFile)).known_usd;await response.text();assert(JSON.parse(fs.readFileSync(budgetFile)).known_usd>before);
 assert(!fs.readFileSync(requestsFile,'utf8').includes('secret-not-recorded'));await assert.rejects(()=>call('https://api.openai.com/v1/responses',{body:JSON.stringify({model:'unpriced'})}),/unpriced/);
 const exhausted=JSON.parse(fs.readFileSync(budgetFile));exhausted.limit_usd=exhausted.reserved_upper_usd;fs.writeFileSync(budgetFile,JSON.stringify(exhausted));await assert.rejects(()=>call('https://api.openai.com/v1/responses',request),/spend_limit/);
 console.log('PASS shared budget: concurrent settlements, retained unknown reservations, streamed usage, no secrets, unpriced/exhausted rejection');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
