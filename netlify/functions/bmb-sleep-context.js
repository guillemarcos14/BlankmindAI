"use strict";
const {freshness}=require("./bm-brain-data");

// Current authenticated iPhone snapshot, shared by measured and QA sleep.
// Never convert this source into durable user declarations or wearable records.
function sleepContext(context) {
  const profile=context.personal_profile||{};
  const source=profile.sleep_source;
  const synthetic=source==="synthetic_qa";
  const validSource=["synthetic_qa","apple_health"].includes(source)
    && profile.sleep_is_synthetic===synthetic;
  const current=freshness(context.brain_snapshot);
  const rows=[];
  const seen=new Set();
  if(validSource&&current&&context.sleep_data_available===true) {
    for(const night of (Array.isArray(profile.sleep_nights)?profile.sleep_nights:[]).slice(-14)) {
      if(!night||night.source!==source||!/^\d{4}-\d{2}-\d{2}$/.test(night.date||"")
        ||!Number.isFinite(Date.parse(night.date))||seen.has(night.date)
        ||!Number.isInteger(night.sleep_minutes)||night.sleep_minutes<=0||night.sleep_minutes>1440)continue;
      if(context.brain_snapshot.local_date&&night.date>context.brain_snapshot.local_date)continue;
      const row={id:`current_sleep:${night.date}`,date:night.date,source,sleep_minutes:night.sleep_minutes};
      for(const key of ["deep_minutes","rem_minutes","core_minutes","awake_minutes","in_bed_minutes","bedtime_minute","wake_minute"]) {
        const value=night[key],maximum=key.endsWith("_minute")?1439:1440;
        if(Number.isInteger(value)&&value>=0&&value<=maximum)row[key]=value;
      }
      seen.add(night.date);rows.push(row);
    }
  }
  rows.sort((a,b)=>a.date.localeCompare(b.date));
  return {source_id:"current_sleep",source:validSource?source:null,is_synthetic:validSource&&synthetic,
    available:rows.length>0,reason:rows.length?null:!current?"stale_device_snapshot":"no_current_sleep_nights",
    observed_at:context.brain_snapshot?.generated_at||null,timezone:context.brain_snapshot?.timezone||"UTC",
    measurement:synthetic?"synthetic_qa_fixture":"native_health_daily_summary",
    provenance:synthetic?"Simulated sleep for this QA experience, not measured health evidence. Other account data remains real."
      :"Daily sleep summaries from Apple Health, not user declarations or clinical evidence.",rows};
}
module.exports={sleepContext};
