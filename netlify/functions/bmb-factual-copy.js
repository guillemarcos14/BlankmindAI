"use strict";
// Rejection only: supplied records can disprove a duration, not prove a reply.
function durations(text) {
  const values=[];
  let rest=String(text||'');
  rest=rest.replace(/\b(\d+(?:[.,]\d+)?)\s*(?:hours?|horas?|h)\s*(?:and|y)?\s*(\d+(?:[.,]\d+)?)\s*(?:minutes?|minutos?|min)\b/gi,(_,h,m)=>{values.push(Number(h.replace(',','.'))*60+Number(m.replace(',','.')));return '';});
  for(const m of rest.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(hours?|horas?|h|minutes?|minutos?|min)\b/gi))values.push(Number(m[1].replace(',','.'))*(/^h/i.test(m[2])?60:1));
  return values;
}
function sleepCopyFacts(prompt,sources,result) {
  if(result.phase!=='final'||result.decision!=='respond'||result.action||result.memory
    ||!/(?:media|promedio|average|mean|cu[aá]nto.*(?:dorm|sue[nñ]o)|(?:how (?:long|much)|duration).*sleep|sleep.*(?:duration|average))/iu.test(prompt))return null;
  const groups=(sources||[]).map(s=>(s.rows||[]).filter(r=>r.metric==='sleep_duration'&&r.unit==='minutes'&&Number.isFinite(r.value_number)));
  const rows=[...new Map(groups.flat().map(r=>[r.id||JSON.stringify(r),r])).values()];
  // Native stage breakdowns and advice have different metrics. This boundary
  // concerns queried account sleep-duration observations only.
  if(!rows.length)return null;
  const values=rows.map(r=>r.value_number),allowed=[...values];
  for(const group of [...groups,rows])if(group.length){const sum=group.reduce((n,r)=>n+r.value_number,0);allowed.push(sum/group.length,sum);}
  return {rows:rows.map(r=>({id:r.id,measured_at:r.measured_at,minutes:r.value_number,hours:Math.floor(r.value_number/60),remaining_minutes:r.value_number%60})),allowed_minutes:[...new Set(allowed)]};
}
function unsupportedDurations(text,facts) {
  return facts?durations(text).filter(value=>!facts.allowed_minutes.some(n=>Math.abs(n-value)<=0.5)):[];
}
function preparedCopy(text) {
  return String(text||'')
    .replace(/\bI(?:['’]m| am) starting\b/gi,"I've prepared").replace(/\bHe iniciado\b/gi,'He preparado')
    .replace(/(^|[.!?]\s+)(?:Estoy )?Bloqueando\b/gi,'$1He preparado el bloqueo de')
    .replace(/(^|[.!?]\s+)(?:I(?:['’]m| am) )?Blocking\b/gi,"$1I've prepared the block for");
}
module.exports={durations,sleepCopyFacts,unsupportedDurations,preparedCopy};
