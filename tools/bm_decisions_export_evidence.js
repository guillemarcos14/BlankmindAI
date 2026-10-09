"use strict";
const fs=require('fs'),crypto=require('crypto');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const inputs=['calibration.json','provider-diagnostic.json','provider-diagnostic-detail.json','holdout.json','global-holdout.json','final-holdout.json','guard-holdout.json','routes-before.json','routes-after.json','routes-factorized.json','routes-domain.json'];
function main(){
 const base='tmp/decisions-production/',runs=inputs.filter(n=>fs.existsSync(base+n)).map(n=>{const raw=JSON.parse(fs.readFileSync(base+n));return {local_archive:base+n,archive_sha256:crypto.createHash('sha256').update(fs.readFileSync(base+n)).digest('hex'),evidence:JSON.parse(JSON.stringify(raw,(k,v)=>k==='synthetic_request'?undefined:v)),request_bodies_retained_in_local_archive:true};});
 const final=JSON.parse(fs.readFileSync(base+'final-report.json')),quality=JSON.parse(fs.readFileSync(base+'final-quality.json')),budget=JSON.parse(fs.readFileSync('../Codigo-retrieval/tmp/retrieval-wide/budget.json'));
 const report={schema_version:1,created_at:new Date().toISOString(),final,quality,budget,environment_preflight:JSON.parse(fs.readFileSync(base+'environment-readonly.json')),schema_preflight:JSON.parse(fs.readFileSync(base+'production-schema-preflight.json')),runs,activation_approved:false,scope:'Decisions only. Real providers and isolated DB fixtures; no production personal rows, Apple publication or physical execution.'};
 const output='docs/BM_DECISIONS_GLOBAL_EVIDENCE_2026-10-09.json';fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({output,runs:runs.length,records:runs.reduce((n,r)=>n+(r.evidence.records?.length||0),0),budget,sha256:sha(report)}));
}
if(require.main===module)main();
