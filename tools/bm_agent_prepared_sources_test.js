"use strict";
const assert=require('node:assert/strict'),{build}=require('./bm_agent_corpus_v2'),{seed}=require('./bm_retrieval_wide_fixtures'),routing=require('../netlify/functions/bm-agent-decisions');
const now=Date.parse('2026-10-15T10:00:00Z'),user='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function main(){
 const originalNow=Date.now;Date.now=()=>now;
 let count=0;
 try{for(const spec of build('retrieval').cases.filter(c=>c.group==='query')){
  const tables={};let id=0;
  const request=async(route,rows)=>{const table=route.split('/').at(-1);tables[table]=(rows||[]).map(r=>({id:'fixture-'+(++id),status:'active',...r}));return [];};
  const expected=await seed(spec,{request,user,now});
  const db=async p=>{
   const url=new URL('http://offline/'+p),table=url.pathname.slice(1),q=url.searchParams;
   assert.equal(q.get('auth_user_id'),'eq.'+user,'Source read lost verified account scope');
   let rows=(tables[table]||[]).slice();
   for(const field of ['measured_at','started_at'])for(const filter of q.getAll(field)){
    const dot=filter.indexOf('.'),op=filter.slice(0,dot),bound=Date.parse(filter.slice(dot+1));
    rows=rows.filter(r=>op==='gte'?Date.parse(r[field])>=bound:op==='gt'?Date.parse(r[field])>bound:op==='lt'?Date.parse(r[field])<bound:false);
   }
   if(q.get('or')){const m=/ended_at.gte.([^,]+)/.exec(q.get('or'));assert(m);rows=rows.filter(r=>r.ended_at==null||Date.parse(r.ended_at)>=Date.parse(m[1]));}
   const offset=Number(q.get('offset')||0),limit=Number(q.get('limit')||1000);return rows.slice(offset,offset+limit);
  };
  const prepared=await routing.prepare(spec.expected_retrieval,{userId:user,identity:{anonymous_user_id:'fixture'},timezone:'Europe/Madrid',now,db});
  assert(prepared,spec.id);
  if(['protection_sessions','protection_breaks'].includes(spec.expected_retrieval.metric)){
   assert.equal(prepared.contract.facts.count,spec.expected_retrieval.metric==='protection_breaks'?0:['zero','missing'].includes(spec.profile)?0:2,spec.id);
  }else assert.equal(prepared.contract.facts.minutes,expected.minutes,spec.id);
  if(spec.expected_retrieval.metric==='sleep_duration'&&spec.profile==='declared')assert.deepEqual(prepared.contract.facts.measurement_types,['declared']);
  if(spec.expected_retrieval.metric==='sleep_duration'&&spec.profile==='missing')assert.equal(prepared.contract.facts.minutes,null,'Missing sleep became zero');
  const forgotten=await routing.prepare({metric:'sleep_duration',period:'yesterday'},{userId:user,identity:{},timezone:'Europe/Madrid',now,cutoff:'2026-10-15T00:00:00Z',db});
  assert.equal(forgotten.contract.facts.minutes,null,'Forgotten observations leaked through prepared reads');count++;
 }
 const ambiguity=build('labels').cases.find(c=>c.id.endsWith('forget-ambiguous'));let memoryRows;
 await seed(ambiguity,{user,now,request:async(route,rows)=>{if(route.endsWith('/bm_brain_memories'))memoryRows=rows;}});
 assert.equal(memoryRows.length,2);assert(memoryRows.every(m=>m.auth_user_id===user));
 }finally{Date.now=originalNow;}
 console.log(`PASS ${count} prepared ES/EN queries through real fixture seeder, source reader and metric preparation over a local database double: local periods, overlaps/counts, declared/zero/missing/sparse data and forgetting cutoff; no database/provider network`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
