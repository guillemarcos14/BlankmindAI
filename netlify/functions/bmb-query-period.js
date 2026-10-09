"use strict";
const {midnight,dayOffset}=require('./bm-brain-data');
// Bound a model-approved observation read to an explicit complete-day window.
// This does not select a source, classify a route or authorize any effect.
function previousDays(prompt,timezone,now=Date.now()){
 const text=String(prompt||'');
 if(/["“”«»`]/u.test(text)||!/(?:sueño|sleep)/iu.test(text)||/\b(?:ayer|yesterday|esta semana|this week)\b/iu.test(text))return null;
 const matches=[...text.matchAll(/(?:los\s+)?(siete|seven|\d{1,2})\s+(?:d[ií]as\s+anteriores\s+a\s+hoy|days\s+(?:before|preceding)\s+today)/giu)];
 if(matches.length!==1)return null;
 const days=/^(?:siete|seven)$/iu.test(matches[0][1])?7:Number(matches[0][1]);
 if(days<1||days>31)return null;
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 return {from:new Date(midnight(dayOffset(today,-days),timezone)).toISOString(),to:new Date(midnight(today,timezone)).toISOString(),timezone,end_exclusive:true,complete_days:days};
}
function boundQuery(query,period,result){
 return period&&result.message_kind==='question'&&query.source==='observations'?{...query,from:period.from,to:period.to,timezone:period.timezone}:query;
}
module.exports={previousDays,boundQuery};
