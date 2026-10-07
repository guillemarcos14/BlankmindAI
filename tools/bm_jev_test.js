"use strict";
const assert = require("node:assert/strict"), crypto = require("node:crypto"), fs = require("node:fs");
const jev=require("../netlify/functions/bm-jev"),evaluation=require("./bm_jev_eval"),timing=require("../netlify/functions/bm-turn-timing");
const userId=crypto.randomUUID(),turnId=crypto.randomUUID();
const env={BM_JEV_SHADOW_ENABLED:"true",BM_JEV_PREFETCH_EXPERIMENT:"true",BM_JEV_DATA_POLICY:"synthetic-private-qa",BM_JEV_QA_USERS:userId,
  BM_JEV_QA_SINCE:new Date(Date.now()-60000).toISOString(),BM_JEV_QA_PERCENT:"100",SUPABASE_URL:"https://njqbovsmoowkhhsqmitn.supabase.co",TYPESAFE_API_KEY:"test-only-key"};
const payload=jev.request({current_message:"hello"});
function response() {
  return {model:jev.taxonomy.model,usage:{input_tokens:1000,output_tokens:0},answers:Object.fromEntries(Object.entries(payload.questions).map(([k,q])=>[k,q.type==="noul"?
    {type:"noul",noul:(k==="topic_sleep"||k==="source_wearables")?.99:0}:
    {type:"choice",choice:"question",confidence:1,probabilities:Object.fromEntries(Object.keys(q.criteria).map(x=>[x,x==="question"?1:0]))}]))};
}
async function main() {
  const body=response();body.answers.topic_sleep.noul=.99;body.answers.source_wearables.noul=.99;
  assert.equal(jev.validate(body,payload),body);
  for(const bad of [ {...body,model:"jev-latest"}, {...body,usage:{input_tokens:-1,output_tokens:0}}, {...body,answers:{}} ])assert.throws(()=>jev.validate(bad,payload));
  for(const val of [NaN,Infinity,-.1,1.1,"0.9"]) {const b=structuredClone(body);b.answers.topic_sleep.noul=val;assert.throws(()=>jev.validate(b,payload));}
  const thresholds={topic:.95,source:.95,intent:.95,ambiguity:.1};
  assert.deepEqual(jev.select(body,thresholds).topics,["sleep"]);assert.deepEqual(jev.select(body,null).topics,[]);
  const uncertain=structuredClone(body);uncertain.answers.ambiguous.noul=.5;assert(jev.select(uncertain,thresholds).abstained);
  assert.equal(jev.configuration({}).enabled,false);
  const cohort=jev.configuration({...env,BM_JEV_QA_USERS:userId.toUpperCase(),BM_JEV_QA_PERCENT:"5"});
  assert.equal(jev.eligible(userId.toUpperCase(),turnId.toUpperCase(),cohort),jev.eligible(userId,turnId,cohort),"SQL and client UUID casing must not change the cohort");
  for(const change of [{SUPABASE_URL:"https://vhiikgyyfisejjwqtxfc.supabase.co"},{BM_JEV_DATA_POLICY:"real"},{TYPESAFE_API_KEY:""},{BM_JEV_QA_USERS:"client-supplied"},{BM_JEV_QA_SINCE:"invalid"}])assert.equal(jev.configuration({...env,...change}).enabled,false);
  let calls=[],vendor=0;
  const db=async(route,options)=>{calls.push({route,body:JSON.parse(options.body)});return route.endsWith("reserve")?{claimed:true,token:crypto.randomUUID(),text:"Do I have sleep records?"}:{saved:true};};
  const fetcher=async(url,options)=>{vendor++;assert.equal(url,jev.ENDPOINT);assert.equal(options.redirect,"error");return {ok:true,text:async()=>JSON.stringify(body)};};
  assert.equal(await jev.classify({userId,turnId},{env:{},db,fetcher}),null);assert.equal(calls.length,0);
  assert.equal(await jev.classify({userId:crypto.randomUUID(),turnId},{env,db,fetcher}),null);
  const result=await jev.classify({userId,turnId,mode:"experiment"},{env,db,fetcher});
  assert.equal(vendor,1);assert.equal(result.taxonomy,jev.taxonomy.version);assert.equal(result.cost_usd,.000042);assert.equal(result.intent,"question");
  const echoed=structuredClone(body);echoed.usage.echo="untrusted-provider-content";
  assert.deepEqual(jev.metadata(echoed,"shadow",1,null).usage,{input_tokens:1000,output_tokens:0});
  assert(!JSON.stringify(result).includes("sleep records"));assert(!JSON.stringify(result).includes("test-only-key"));
  assert.equal(await jev.classify({userId,turnId},{env,db:async()=>({claimed:false}),fetcher}),null);assert.equal(vendor,1);
  const failed=await jev.classify({userId,turnId},{env,db,fetcher:async()=>({ok:false,status:429})});
  assert.equal(failed,null);assert.equal(calls.at(-1).body.p_error,"jev_http_429");
  const lost=await jev.classify({userId,turnId},{env,db:async(route)=>route.endsWith("reserve")?{claimed:true,token:"x",text:"x"}:{saved:false},fetcher});assert.equal(lost,null);
  const before=Date.now();
  assert.equal(await jev.startPrefetch(userId,{config:jev.configuration(env),turnId,classifyTurn:async(_,opts)=>new Promise(resolve=>opts.signal.addEventListener("abort",()=>resolve(null)))}),null);
  assert(Date.now()-before<1000,"Timeout did not bound experimental classification");
  let reads=[];
  const prefetched=await jev.prefetch({...result,sources:["wearables","history","observations","reviews","features","wearables"]},{userId,identity:{anonymous_user_id:"verified"},cutoff:"2026-10-01T00:00:00Z",timezone:"Europe/Madrid",db,
    read:async(u,i,q,cutoff)=>{reads.push({u,i,q,cutoff});return {source:q.source,available:false,reason:"no_rows"};}});
  assert.equal(reads.length,3);assert(reads.every(r=>r.u===userId&&r.cutoff==="2026-10-01T00:00:00Z"));assert(!reads.some(r=>r.q.source==="history"));assert.equal(prefetched.length,3);
  reads=[];assert.deepEqual(await jev.prefetch({...result,intent:"forget"},{userId,db,read:async()=>reads.push(1)}),[]);assert.equal(reads.length,0);
  assert.deepEqual(await jev.prefetch({...result,mode:"shadow"},{userId,db}),[]);
  let drafts=[];
  await timing.run({turnId,action:"send"},async()=>{assert.equal(timing.currentTurn(),turnId);timing.advisory({status:"completed"});return {statusCode:200};},s=>drafts.push(s));
  assert.equal(drafts[0].jev[0].status,"completed");assert.equal(timing.currentTurn(),null);
  let sampled=false;
  await jev.drain({config:jev.configuration({...env,BM_JEV_QA_PERCENT:"5"}),db:async(route,options)=>{assert.equal(route,"rpc/bm_jev_pending_sampled");assert.equal(JSON.parse(options.body).p_percent,5);sampled=true;return [];}});
  assert(sampled,"Cohort must be applied before the database batch limit");
  const meter=require("./bm_jev_benchmark"),rates={input:1,cached:0.1,output:2};
  const row={variant:"jev",passed:true,first_text_ms:10,elapsed_ms:20,database_calls:1,model_calls:2,jev_calls:1,jev_known_cost_usd:.01,jev_unknown_cost_upper_usd:0,usage:{input_tokens:100,output_tokens:10}};
  assert.equal(meter.summarize([row],rates).jev.total_cost_usd,null,"Aggregate usage cannot certify all retries were metered");
  assert.equal(meter.summarize([{...row,usage_records:2,metered_usage:row.usage}],rates).jev.total_cost_usd,.01012);
  assert.equal(meter.summarize([{...row,usage_records:2,jev_unknown_cost_upper_usd:.001}],rates).jev.total_cost_usd,null);
  const corpus=require("./datasets/bm_jev_v1.json"),manifest=require("./datasets/bm_jev_v1.manifest.json");
  assert.equal(corpus.cases.length,300);assert.equal(new Set(corpus.cases.map(c=>c.id)).size,300);assert.equal(new Set(corpus.cases.map(c=>c.current_message)).size,300);
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync("tools/datasets/bm_jev_v1.json","utf8").replace(/\r\n/g,"\n")).digest("hex"),manifest.sha256);
  for(const c of corpus.cases){assert.equal(c.independent_human_review,false);assert(c.expected.topics.every(t=>Object.keys(jev.taxonomy.topics).includes(t)));assert(corpus.cases.filter(x=>x.pair_id===c.pair_id).every(x=>x.split===c.split));}
  const perfect=Object.fromEntries(corpus.cases.map(c=>[c.id,{...c.expected,abstained:c.expected.abstain}]));
  assert.equal(evaluation.score(corpus.cases,perfect).precision,1);
  const badScore=evaluation.score(corpus.cases,Object.fromEntries(corpus.cases.map(c=>[c.id,{topics:["sleep"],sources:[],abstained:false}])));
  assert(badScore.precision<.95);assert(badScore.ambiguous_incorrectly_accepted>0);
  console.log("PASS Jev: schema/probabilities/version, disabled/privacy/identity gates, durable claim/fallback, timeout, authorized source catalog/cutoff, isolated telemetry, 300-case split and metric integrity (mock contract tests, no live performance claim)");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
