"use strict";
const fs=require("node:fs"),crypto=require("node:crypto"),{performance}=require("node:perf_hooks"),d=require("../netlify/functions/bm-decisions"),dataset=require("./datasets/bm_jev_v1.json");
function summarize(records){return Object.fromEntries(["es","en"].map(language=>{
 const rows=records.filter(r=>r.language===language),per_source=Object.fromEntries(Object.keys(require("../netlify/functions/bm-jev-taxonomy.json").sources).map(s=>[s,{tp:0,fp:0,fn:0}]));
 for(const r of rows)for(const [s,v]of Object.entries(per_source)){if(r.selected.includes(s))v[r.expected.includes(s)?"tp":"fp"]++;else if(r.expected.includes(s))v.fn++;}
 const totals=Object.values(per_source).reduce((a,v)=>({tp:a.tp+v.tp,fp:a.fp+v.fp,fn:a.fn+v.fn}),{tp:0,fp:0,fn:0}),div=(a,b)=>b?a/b:0;
 return [language,{samples:rows.length,errors:rows.filter(r=>r.error).length,source_precision:div(totals.tp,totals.tp+totals.fp),source_recall:div(totals.tp,totals.tp+totals.fn),exact_source_match:div(rows.filter(r=>r.selected.slice().sort().join()===r.expected.slice().sort().join()).length,rows.length),per_source,...totals}];
}));}
async function main(){if(!process.argv.includes("--run")||!process.env.OPENAI_API_KEY)throw Error("decisions_explicit_test_required");
 const args=process.argv,get=(k,f)=>args.includes(k)?args[args.indexOf(k)+1]:f,split=get("--split","all"),cases=dataset.cases.filter(c=>split==="all"||c.split===split);
 if(!cases.length)throw Error("decisions_empty_split");
 fs.mkdirSync("tmp/decisions",{recursive:true});const records=[],file=get("--output","tmp/decisions/classification.json"),report={schema_version:1,model:d.MODEL,provider_real:true,authored_synthetic_only:true,independent_human_review:false,previous_turn_provided:false,thresholds_preregistered:{source:.95,unsafe:.1},records,complete:false};
 const save=()=>fs.writeFileSync(file,JSON.stringify({...report,summary:summarize(records)},null,2));let next=0;
 await Promise.all(Array.from({length:4},async()=>{while(next<cases.length){const c=cases[next++],start=performance.now(),row={id:c.id,language:c.language,split:c.split,expected:c.expected.sources,selected:[],request_sha256:crypto.createHash("sha256").update(JSON.stringify(d.request(c.current_message))).digest("hex")};
  try{row.result=await d.classify(c.current_message);row.selected=d.selected(row.result);}catch(e){row.error=/^decisions_/.test(e.message)?e.message:"decisions_transport_failed";}
  row.elapsed_ms=performance.now()-start;records.push(row);save();
 }}));report.complete=true;save();console.log(JSON.stringify({complete:true,summary:summarize(records),known_cost_usd:records.reduce((s,r)=>s+(r.result?.usage.input_tokens||0)*.1/1e6,0)}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});module.exports={summarize};
