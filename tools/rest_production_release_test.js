const assert=require('node:assert/strict');
const {manifestBody}=require('./rest_production_release');
const {APP}=require('./appstore_production_publish');
const functions=Object.fromEntries([...APP,...Array.from({length:69},(_,i)=>'legacy-'+i)].map((n,i)=>[n,'digest-'+i]));
const files=Object.fromEntries(Array.from({length:17},(_,i)=>['static-'+i,'sha-'+i]));
const baseline={body:{functions,files,function_schedules:[]}};
const candidate={total_functions:77,statics:17,body:structuredClone(baseline.body)};
candidate.body.functions['assistant-app']='new-app-runtime';
const result=manifestBody(candidate,baseline);
assert.deepEqual(result.function_schedules,[{name:'bmb-tick',cron:'*/5 * * * *'}]);
assert.deepEqual(result.files,files);assert.equal(result.functions['assistant-app'],'new-app-runtime');
assert.equal(result.draft,false);assert.equal(candidate.body.function_schedules.length,0);
for(const mutate of [c=>c.body.functions['legacy-1']='replaced',c=>delete c.body.functions['legacy-1'],c=>c.body.files['static-1']='replaced',c=>c.total_functions=76,c=>c.statics=16]){
 const bad=structuredClone(candidate);mutate(bad);assert.throws(()=>manifestBody(bad,baseline));
}
console.log('Rest release preservation, explicit cron, immutable inputs and five invalid manifests rejected');
