"use strict";
const fs=require('node:fs'),path=require('node:path'),{coverage,sha,FEATURES}=require('./bm_agent_corpus_v2');
function verify(plan,lock,{feature,hashes,from=0,pairs=200}={}){
 const c=coverage(plan);
 if(!c.coverage_prepared)throw Error('decisions_plan_coverage_invalid');
 if(feature!==plan.feature||!FEATURES.includes(feature))throw Error('decisions_plan_feature_mismatch');
 if(lock?.kind!=='agent-unexecuted-source-lock-v1'||lock.corpora?.[feature]!==sha(plan))throw Error('decisions_plan_corpus_changed');
 if(JSON.stringify(lock.source_hashes)!==JSON.stringify(hashes))throw Error('decisions_plan_stale_source');
 if(!Number.isSafeInteger(pairs)||pairs<1||!Number.isSafeInteger(from)||from<0||from+pairs>plan.cases.length)throw Error('decisions_plan_repeated_or_missing_pairs');
 return {planned_only:true,activation_ready:false,provider_real:false,coverage:c};
}
function freeze(directory,output){
 const hashes=require('./bm_agent_runtime').verify(),plans=Object.fromEntries(FEATURES.map(f=>[f,JSON.parse(fs.readFileSync(path.join(directory,f+'.json')))]));
 const lock={kind:'agent-unexecuted-source-lock-v1',source_hashes:hashes,corpora:Object.fromEntries(FEATURES.map(f=>[f,sha(plans[f])])),executed:false,activation_ready:false};
 for(const feature of FEATURES)verify(plans[feature],lock,{feature,hashes});
 fs.writeFileSync(output,JSON.stringify(lock,null,2)+'\n');return lock;
}
if(require.main===module){const [directory,output]=process.argv.slice(2);if(!directory||!output)throw Error('Corpus directory and NEW source-lock output required');if(fs.existsSync(output))throw Error('Preserve existing source lock; choose a new output');freeze(directory,output);console.log('PASS prepared corpus coverage/source lock; zero provider calls, unexecuted, routes OFF');}
module.exports={verify,freeze};
