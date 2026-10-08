"use strict";
const crypto=require('crypto');
const {midnight,dayOffset}=require('../netlify/functions/bm-brain-data');
async function seed(spec,{request,user,now}){
 const tz='Europe/Madrid',today=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(now),yesterday=dayOffset(today,-1),week=dayOffset(today,-((new Date(today+'T12:00:00Z').getUTCDay()+6)%7));
 const iso=x=>new Date(x).toISOString(),route=spec.fixture_route||spec.route,profile=spec.profile;
 const days=[dayOffset(today,-3),dayOffset(today,-2),yesterday],values=profile==='zero'?[0,0,0]:spec.sleep_minutes||[390,440,470];
 const observations=days.map((day,i)=>({auth_user_id:user,source_key:'wide:'+day,metric:'sleep_duration',value_number:values[i],unit:profile==='invalid'?'hours':'minutes',measured_at:iso(midnight(day,tz)+(profile==='boundary'?0:10*3600000)),timezone:tz,source:profile==='declared'?'user_statement':'native_health',measurement:profile==='declared'?'declared':'measured',evidence:'Synthetic fixture, no personal data',created_at:iso(midnight(day,tz)+11*3600000)}));
 if(profile==='duplicate')observations.push({...observations[2],source_key:'wide:duplicate',value_number:123});
 if(profile==='sparse')observations.splice(0,2);
 if(profile==='missing')observations.length=0;
 if(observations.length)await request('/rest/v1/bmb_observations',observations);
 if(profile==='forgotten')await request('/rest/v1/bm_brain_memories',[{auth_user_id:user,key:'goal',value:null,source_text:'Forget everything about me.',source_at:iso(midnight(today,tz))}]);
 let sessions=[];
 const minutes=spec.protection_minutes||79,base=midnight(yesterday,tz)+(profile==='boundary'?23*3600000+50*60000:14*3600000);
 if(!['missing','zero','forgotten'].includes(profile))sessions=[{id:crypto.randomUUID(),auth_user_id:user,started_at:iso(base),ended_at:iso(base+minutes*60000),observed_at:iso(base+minutes*60000),entry_mode:'manual',ended_reason:'timer'}, {id:crypto.randomUUID(),auth_user_id:user,started_at:iso(base+Math.floor(minutes/3)*60000),ended_at:iso(base+Math.floor(minutes*2/3)*60000),observed_at:iso(base+Math.floor(minutes*2/3)*60000),entry_mode:'manual',ended_reason:'timer'}, {id:crypto.randomUUID(),auth_user_id:user,started_at:iso(base-14*86400000),ended_at:iso(base-14*86400000+120*60000),observed_at:iso(base-14*86400000+120*60000),entry_mode:'manual',ended_reason:'timer'}];
 if(sessions.length)await request('/rest/v1/bmb_sessions',sessions);
 const from=midnight(route.endsWith('yesterday')?yesterday:week,tz),to=route.endsWith('yesterday')?midnight(today,tz):now;
 const eligible=profile==='forgotten'?[]:observations.filter(r=>Date.parse(r.measured_at)>=from&&Date.parse(r.measured_at)<to);
 const protectedMinutes=sessions.filter(s=>Date.parse(s.started_at)>from-86400000&&Date.parse(s.started_at)<to).reduce((acc,s,i)=>i===0?Math.max(0,Math.min(to,Date.parse(s.ended_at))-Math.max(from,Date.parse(s.started_at)))/60000:acc,0);
 return {route:spec.route,fixture_route:route,profile,minutes:route.startsWith('sleep')?(eligible.length?eligible.reduce((sum,r)=>sum+r.value_number,0)/eligible.length:null):protectedMinutes,available_records:eligible.map(r=>({time:r.measured_at,minutes:r.value_number,unit:r.unit,measurement:r.measurement})),fixture_sessions:sessions.map(s=>({started_at:s.started_at,ended_at:s.ended_at})),all_fixture_sleep:observations.map(r=>({time:r.measured_at,value:r.value_number,unit:r.unit,measurement:r.measurement})),from:iso(from),to:iso(to),interpretation:spec.expectation||'Exact recorded fact with requested units and period; weekly sleep is mean of available measurements, not absent days.',invalid_units:profile==='invalid',forgotten:profile==='forgotten',physical_execution:false};
}
module.exports={seed};
