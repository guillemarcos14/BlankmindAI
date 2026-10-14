"use strict";
const assert=require("node:assert/strict"),R=require("../netlify/functions/bmb-rest"),P=require("../netlify/functions/bmb-policy");
const now=Date.parse("2026-10-20T12:00:00Z"),window="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function night(start,sleep=440,awake=40,extra={}){
 const a=Date.parse(start),end=a+480*60000;
 return {id:new Date(end).toISOString().slice(0,10),date:new Date(end).toISOString().slice(0,10),start_at:new Date(a).toISOString(),end_at:new Date(end).toISOString(),
   timezone:"UTC",source:"apple_watch",source_bundle:"com.apple.health.Watch",manual:false,complete:true,sleep_minutes:sleep,awake_minutes:awake,...extra};
}
const baseline=Array.from({length:28},(_,i)=>night(new Date(Date.parse("2026-09-03T23:00:00Z")+i*86400000).toISOString()));
const after=Array.from({length:14},(_,i)=>night(new Date(Date.parse("2026-10-02T23:00:00Z")+i*86400000).toISOString(),460,20));
const protection=after.map(n=>({id:"execution:"+n.date,window_id:window,source:"native_schedule_shield",started_at:new Date(Date.parse(n.start_at)-30*60000).toISOString(),ended_at:n.end_at,
 plan:{start_minute:1350,end_minute:420,weekdays:[1,2,3,4,5,6,7],timezone:"UTC"}}));
const experiment={id:"experiment",action_id:"app_"+window,status:"active",metric:"sleep_continuity",review_after_days:14,
 verified_at:"2026-10-02T20:00:00Z",baseline,action:{start_minute:1350,end_minute:420,weekdays:[1,2,3,4,5,6,7],timezone:"UTC"},excluded_dates:[]};
const result=R.evaluate(experiment,after,{now,protection});
assert.equal(result.status,"improved");assert.equal(result.measured_improvement,true);assert.equal(result.causal,false);
assert(Math.abs(result.delta-100*20/480)<1e-9,"Independent continuity oracle disagrees");
assert.equal(result.intervention_count,14);assert(result.evidence_ids.includes(protection[0].id));
for(const [name,records] of [["synthetic",after.map(n=>({...n,source:"synthetic"}))],["manual",after.map(n=>({...n,manual:true}))],
 ["other Health",after.map(n=>({...n,source:"apple_health"}))],["incomplete",after.map(n=>({...n,complete:false}))]]){
 assert.equal(R.evaluate(experiment,records,{now,protection}).measured_improvement,false,name+" certified efficacy");
}
assert.equal(R.evaluate(experiment,after,{now}).status,"inconclusive","Registration alone credited nightly execution");
assert.equal(R.evaluate(experiment,after,{now,protection:protection.map(p=>({...p,window_id:"other"}))}).measured_improvement,false,"Another window credited");
assert.equal(R.evaluate(experiment,after,{now,protection:protection.map(p=>({...p,plan:{...p.plan,start_minute:1300}}))}).measured_improvement,false,"Another plan version credited");
assert.equal(R.evaluate(experiment,after,{now,protection:protection.map(p=>({...p,uncertain:true}))}).measured_improvement,false,"Revoked or uncertain shield coverage credited");
assert.equal(R.evaluate({...experiment,status:"awaiting_execution"},after,{now,protection}).status,"awaiting");
assert.equal(R.evaluate(experiment,after.slice(0,6),{now,protection}).status,"inconclusive");
assert.equal(R.evaluate(experiment,after,{now:Date.parse("2026-10-06"),protection}).status,"awaiting");
assert.equal(R.evaluate({...experiment,excluded_dates:after.map(n=>n.date)},after,{now,protection}).measured_improvement,false);
assert.equal(R.evaluate(experiment,after.map(n=>({...n,source_bundle:"another Watch algorithm"})),{now,protection}).measured_improvement,false);
assert.equal(R.evaluate(experiment,after.map(n=>({...n,awake_minutes:null})),{now,protection}).measured_improvement,false,"Missing awake became zero");
assert.equal(R.metricValue({...after[0],sleep_minutes:440,awake_minutes:0},"sleep_continuity"),100*440/480,"Unobserved gaps rewarded as improved continuity");
assert.equal(R.evaluate(experiment,after.map(n=>({...n,sleep_minutes:390,awake_minutes:10})),{now,protection}).status,"worse","Better continuity masked lost sleep duration");
assert.equal(R.metricValue(after[0],"sleep_duration_target",null),null,"Invented duration target");
assert.equal(R.metricValue({...after[0],sleep_minutes:600},"sleep_duration_target",480),-120,"More sleep always rewarded");
assert.equal(R.metricValue(after[0],"sleep_regularity",null,null),null,"Invented desired bedtime");
const snapshot={schema_version:1,observed_at:new Date(now).toISOString(),timezone:"UTC",nights:[after[0]],checkins:[{date:after[0].date,score:5}],digital:{available:false,reason:"unsupported_region"}};
assert.equal(R.normalizeSnapshot(snapshot,now).checkins[0].role,"acceptability_context_only");
assert.equal(R.normalizeSnapshot(snapshot,now).digital.available,false);
for(const bad of [{...snapshot,nights:[after[0],after[0]]},{...snapshot,nights:[{...after[0],rem_minutes:900}]},
 {...snapshot,nights:[{...after[0],date:"2026-10-04"}]},{...snapshot,observed_at:"2020-01-01T00:00:00Z"}])assert.throws(()=>R.normalizeSnapshot(bad,now));
assert.throws(()=>R.normalizeHypothesis({hypothesis:"Test",metric:"restfulness",review_after_days:14,evidence_ids:["A"]}));
const activePolicy=P.settings({timezone:"UTC",grant:{active:true,action_types:["update_schedule"],start_minute:0,end_minute:0,expires_at:"2099-01-01"},
 rest:{adjustments_enabled:true,weekdays:[2,3,4,5,6],start_minute:1260,end_minute:480,max_shift_minutes:15}});
const current={has_selected_apps:true,screen_time_authorized:true,schedule:{windows:[{id:window,enabled:true,start_minute:1350,end_minute:420,weekdays:[2,3,4,5],timezone:"UTC",recurrence:"continuous"}]}};
const action={type:"update_schedule",window_id:window,start_minute:1335,end_minute:420,weekdays:[2,3,4,5],timezone:"UTC",recurrence:"continuous",hard_mode:false};
assert.equal(P.actionGate(action,activePolicy,current,now).allowed,true);
for(const change of [{start_minute:1300},{end_minute:480},{weekdays:[1,2,3,4,5,6,7]},{window_id:"foreign"},{hard_mode:true}])assert.equal(P.actionGate({...action,...change},activePolicy,current,now).allowed,false);
assert.equal(P.actionGate(action,{...activePolicy,rest:{...activePolicy.rest,adjustments_enabled:false}},current,now).allowed,false);
assert.equal(P.actionGate(action,{...activePolicy,grant:{...activePolicy.grant,active:false}},current,now).allowed,false);
assert.equal(P.actionGate({type:"enable_adult_filter"},{...activePolicy,grant:{...activePolicy.grant,action_types:["enable_adult_filter"]}},current,now).allowed,false,"Legacy autonomy survived");
assert.equal(R.adjustment({...experiment,evaluation:{status:"improved"}},activePolicy,current),null,"Improvement caused unnecessary change");
console.log("Measured rest: Watch-only efficacy, independent metric oracle, matched weekdays, baseline/source isolation, exclusions, nightly execution, duration guard and bounded/revocable autonomy passed");
