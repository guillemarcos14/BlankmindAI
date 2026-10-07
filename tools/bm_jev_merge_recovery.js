"use strict";
const fs=require("node:fs"),crypto=require("node:crypto"),{summarize}=require("./bm_jev_benchmark");
function main(){
 const originalRaw=fs.readFileSync("tmp/jev/benchmark-original.json"),recoveryRaw=fs.readFileSync("tmp/jev/benchmark-recovery.json"),original=JSON.parse(originalRaw),recovery=JSON.parse(recoveryRaw);
 if(!original.complete||!recovery.complete||JSON.stringify(original.sourceHashes)!==JSON.stringify(recovery.sourceHashes))throw Error("jev_recovery_incomplete_or_changed_source");
 const affected=new Set(original.records.filter(r=>r.status===401).map(r=>r.pair));
 if(!affected.size||recovery.records.some(r=>!affected.has(r.pair)||r.status===401))throw Error("jev_recovery_invalid_pairs");
 const records=[...original.records.filter(r=>!affected.has(r.pair)),...recovery.records];
 for(const variant of ["optimized","jev"])if(records.filter(r=>r.variant===variant).length!==300||new Set(records.filter(r=>r.variant===variant).map(r=>r.pair)).size!==300)throw Error("jev_recovery_missing_pairs");
 const sha=raw=>crypto.createHash("sha256").update(raw).digest("hex");
 const report={...original,run_ids:{original:original.run_id,session_renewal:recovery.run_id},records,summary:summarize(records,original.rates),cleanup:[...original.cleanup,...recovery.cleanup],
  infrastructure_recovery:{cause:"One-hour synthetic access token expired; final 43 pairs returned HTTP401 without reaching DB or providers",original_sha256:sha(originalRaw),recovery_sha256:sha(recoveryRaw),
   excluded_attempts:original.records.filter(r=>affected.has(r.pair)),original_attempts:original.records.length,repeated_pairs:affected.size,total_attempted_turns:original.records.length+recovery.records.length,
   action:"Both members of each affected pair repeated on identical fresh fixtures, same frozen handlers and original AB/BA order; auth renewed before every pair"},
  limitations:[...original.limitations,"An expired-token infrastructure attempt is preserved separately; the 300+300 comparison contains only pairs reaching valid app authentication","Per-request billing counters exist only in the 43 recovered pairs; aggregate original billing is not fully verified"],gates_passed:false};
 fs.writeFileSync("tmp/jev/benchmark.json",JSON.stringify(report,null,2));console.log(JSON.stringify({complete:true,actual_pairs:300,recovered_pairs:affected.size,attempts:report.infrastructure_recovery.total_attempted_turns,summary:report.summary,cleanup:report.cleanup.every(x=>x.passed)}));
}
if(require.main===module)try{main();}catch(e){console.error(e.message);process.exitCode=1;}
