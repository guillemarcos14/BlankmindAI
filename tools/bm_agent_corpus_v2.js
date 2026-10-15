"use strict";
// New authored plans. Historical corpora/measurements remain immutable.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const GROUPS=['chat','query','action','memory'],FEATURES=['tools','retrieval','labels'];
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const scenario=c=>({language:c.language,group:c.group,text:c.text,profile:c.profile,context:c.context,expected_action:c.expected_action,expected_observations:c.expected_observations,expected_fact:c.expected_fact,expected_forgetting:c.expected_forgetting,initial_memories:c.initial_memories,forbid_effects:c.forbid_effects,expected_retrieval:c.expected_retrieval,observation_date_policy:c.observation_date_policy});
function actions(language){
 const es=language==='es',out=[],add=(id,text,expected_action,extra={})=>out.push({id,text,expected_action,...extra});
 for(const minutes of [5,15,30,60,90,120,240])add('block-'+minutes,es?`Bloquea mis distracciones durante ${minutes} minutos.`:`Block my distractions for ${minutes} minutes.`,{type:'start_protection',minutes});
 for(const days of [7,14])add('weekly-'+days,es?`Crea una ventana de bloqueo de lunes a viernes de 22:00 a 07:00 durante ${days} días.`:`Create a blocking window Monday through Friday from 22:00 to 07:00 for ${days} days.`,{type:'apply_schedule',start_minute:1320,end_minute:420,weekdays:[2,3,4,5,6],recurrence:'weekly',duration_days:days});
 add('continuous',es?'Crea una ventana todos los días de 23:00 a 07:00, sin fecha de fin, hasta que la cambie.':'Create a window every day from 23:00 to 07:00, with no end date, until I change it.',{type:'apply_schedule',start_minute:1380,end_minute:420,weekdays:[1,2,3,4,5,6,7],recurrence:'continuous',duration_days:null});
 const context={schedule:{windows:[{id:'qa-window',name:'Night',start_minute:1260,end_minute:420,weekdays:[2,3,4,5,6],recurrence:'weekly',duration_days:7}]}};
 add('update',es?'Modifica mi única ventana Night a 22:00–07:00 de lunes a viernes durante 7 días.':'Change my only Night window to 22:00–07:00 Monday through Friday for 7 days.',{type:'update_schedule',window_id:'qa-window',start_minute:1320,end_minute:420,weekdays:[2,3,4,5,6],recurrence:'weekly',duration_days:7},{context});
 add('delete',es?'Elimina mi única ventana Night.':'Delete my only Night window.',{type:'delete_schedule',window_id:'qa-window'},{context});
 add('delete-all',es?'Elimina todas mis ventanas de bloqueo.':'Delete all my blocking windows.',{type:'delete_all_schedules'},{context});
 for(const hours of [1,2,168])add('pause-'+hours,es?`Pausa mis reglas durante ${hours} horas.`:`Pause my rules for ${hours} hours.`,{type:'pause_rules',hours,minutes:null});
 for(const [type,esText,enText] of [
  ['disable_pause','Reanuda mis reglas de bloqueo.','Resume my blocking rules.'],
  ['set_daily_limit','Pon un límite diario de 15 minutos para mis distracciones.','Set a daily limit of 15 minutes for my distractions.'],
  ['disable_daily_limit','Desactiva mi límite diario de distracciones.','Disable my daily distraction limit.'],
  ['enable_allow_only','Activa permitir solo las apps de mi selección.','Enable allow-only for the apps in my selection.'],
  ['disable_allow_only','Desactiva permitir solo las apps seleccionadas.','Disable allow-only for the selected apps.'],
  ['enable_adult_filter','Activa el filtro de contenido adulto.','Enable the adult content filter.'],
  ['disable_adult_filter','Desactiva el filtro de contenido adulto.','Disable the adult content filter.'],
  ['open_app_picker','Abre el selector para que elija mis distracciones.','Open the picker so I can select my distractions.'],
  ['request_screen_time_permission','Abre la solicitud de permiso de Tiempo de uso.','Open the Screen Time permission request.']])add(type,es?esText:enText,{type,...(type==='set_daily_limit'?{minutes:15}:{})},type==='request_screen_time_permission'?{context:{screen_time_authorized:false}}:{});
 return out;
}
function memories(language){
 const es=language==='es',out=[];
 for(const [metric,unit,values] of [['bedtime','local_minute',[1320,1380]],['wake_time','local_minute',[360,420]],['sleep_duration','minutes',[420,480]],['caffeine','servings',[1,2]],['alcohol','servings',[0,1]]])for(const measurement of ['routine_statement','declared'])for(const value of values){
  const time=String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
  const routine=measurement==='routine_statement';let statement;
  if(metric==='bedtime')statement=es?`${routine?'normalmente me acuesto':'ayer me acosté'} a las ${time}`:`${routine?'I usually go to bed':'yesterday I went to bed'} at ${time}`;
  if(metric==='wake_time')statement=es?`${routine?'normalmente me levanto':'ayer me levanté'} a las ${time}`:`${routine?'I usually wake up':'yesterday I woke up'} at ${time}`;
  if(metric==='sleep_duration')statement=es?`${routine?'normalmente duermo':'ayer dormí'} ${value/60} horas`:`${routine?'I usually sleep':'yesterday I slept'} ${value/60} hours`;
  if(metric==='caffeine')statement=es?`${routine?'normalmente tomo':'ayer tomé'} ${value} cafés`:`${routine?'I usually drink':'yesterday I drank'} ${value} coffees`;
  if(metric==='alcohol')statement=es?`${routine?'normalmente tomo':'ayer tomé'} ${value} bebidas con alcohol`:`${routine?'I usually drink':'yesterday I drank'} ${value} alcoholic drinks`;
  const text=(es?'Registra esta observación: ':'Record this observation: ')+statement+'.';
  out.push({id:[metric,measurement,value].join('-'),text,expected_observations:[{metric,measurement,value_number:value,value_text:null,unit,evidence:text}],observation_date_policy:routine?'statement_time_not_daily_measurement':'previous_local_day',expected_decision:'respond'});
 }
 const text=es?'Registra esta observación: normalmente me acuesto a las 23:00 y me levanto a las 07:00.':'Record this observation: I usually go to bed at 23:00 and wake at 07:00.';
 out.push({id:'two-routines',text,expected_observations:[['bedtime',1380],['wake_time',420]].map(([metric,value_number])=>({metric,value_number,value_text:null,unit:'local_minute',measurement:'routine_statement',evidence:text})),observation_date_policy:'statement_time_not_daily_measurement',expected_decision:'respond'});
 const correction=es?'Registra mi corrección: normalmente me acuesto a las 22:30, no a las 23:00.':'Record my correction: I usually go to bed at 22:30, not 23:00.';
 out.push({id:'correction',text:correction,expected_observations:[{metric:'bedtime',value_number:1350,value_text:null,unit:'local_minute',measurement:'routine_statement',evidence:correction}],expected_decision:'respond',observation_date_policy:'statement_time_not_daily_measurement'});
 const value=es?'leer en papel':'reading on paper';out.push({id:'preference',text:es?`Mi preferencia para descansar es ${value}.`:`My preference for winding down is ${value}.`,expected_fact:{key:'preferences',literal:value}});
 const initial_memories=[{key:'bedtime',value:'23:00'},{key:'preferences',value}];
 out.push({id:'forget-all',text:es?'Olvida todo lo que sabes sobre mí.':'Forget everything you know about me.',initial_memories,expected_forgetting:{operation:'forget_all',key:null},expected_decision:'respond'});
 out.push({id:'forget-ambiguous',text:es?'Olvida mis hábitos personales.':'Forget my personal habits.',initial_memories,forbid_effects:true,expectation:'Ask an open scope clarification without a closed category menu. Preserve every seeded memory and observation; no deletion or action.'});
 return out;
}
function queries(language){
 const es=language==='es',out=[];
 for(const profile of ['standard','declared','missing','zero','sparse'])for(const [i,metric] of ['sleep_duration','sleep_average','protection_duration','protection_sessions','protection_breaks'].entries()){
  const texts=es?['¿Cuánto dormí ayer?','Dime mi media de sueño registrada esta semana.','¿Cuánto tiempo de protección registré ayer?','¿Cuántas sesiones de protección constan esta semana?','¿Cuántas interrupciones de protección registré ayer?']:['How much sleep did I record yesterday?','Tell me my recorded sleep average this calendar week.','Show my protected time yesterday.','How many protection sessions are recorded this week?','How many protection breaks did I record yesterday?'];
  const period=i===1||i===3?'this_week':'yesterday',actualMetric=metric==='sleep_average'?'sleep_duration':metric;
  out.push({id:metric+'-'+profile,text:texts[i],profile,route:(i<2?'sleep':'protection')+'_'+(period==='this_week'?'week':'yesterday'),expected_retrieval:{metric:actualMetric,period},forbid_effects:true});
 }
 return out;
}
function build(feature){
 if(!FEATURES.includes(feature))throw Error('unknown_feature');
 const old=require('./bm_agent_corpus').build(),cases=[];
 for(const language of ['es','en']){
  const sections={chat:old.cases.filter(c=>c.language===language&&c.group==='chat').map(c=>({...c,forbid_effects:true})),query:queries(language),action:actions(language),memory:memories(language)};
  for(const group of GROUPS){if(sections[group].length!==25)throw Error('cell_count_'+group+'_'+sections[group].length);
   sections[group].forEach((source,index)=>{
    const c={...source,id:`v2-${feature}-${language}-${group}-${source.id}`,feature,language,group,route:source.route||'sleep_yesterday',profile:source.profile||'standard',audio_requested:index<8,
     expectation:source.expectation||(group==='action'?'Queue exactly the authored native command and parameters, as an attempt only. No unrequested memory or measured sleep benefit.':group==='memory'?'Persist only authored values, classification, units and literal evidence in this turn. Usual statements are not dated occurrences; explicit yesterday occurrences retain their local date. No native action or Watch efficacy claim.':'Answer the exact recorded metric/period with dates, units and coverage; missing is unknown, recorded zero is known. No action, new memory, phone-use or sleep-efficacy claims.')};
    delete c.expected_memory;delete c.forbid_memory;
    if(group==='action')c.forbid_memory_changes=true;
    c.expected_classifier_work=feature==='labels'?(c.expected_observations?'new_observations':c.expected_fact?'conditional_new_observations':'none'):feature==='retrieval'?(c.expected_retrieval?'prepare_query':'direct'):'not_applicable';
    c.scenario_sha256=sha({language,group,text:c.text,profile:c.profile,context:c.context,expected_action:c.expected_action,expected_observations:c.expected_observations,expected_forgetting:c.expected_forgetting,initial_memories:c.initial_memories});cases.push(c);
   });
  }
 }
 // Evidence may be any nonempty exact current-message substring. Do not
 // penalize a valid extraction for omitting the user's recording preamble.
 for(const c of cases){if(c.expected_observations){c.expected_observations.forEach(o=>delete o.evidence);c.evidence_policy='literal_current_message_preserved_in_committed_and_canonical_rows';}c.scenario_sha256=sha(scenario(c));}
 return {version:2,kind:'agent-certification-plan-v2',feature,authored_before_run:true,provider_real:false,executed:false,certified:false,
  provenance:'Pre-authored synthetic scenarios and state expectations. Planned coverage only, not measured pairs, review, audio or latency. Historical v1 corpus remains unchanged.',cases};
}
function coverage(plan){
 const reasons=[],ids=new Set(),scenarios=new Set(),counts={};
 if(plan.kind!=='agent-certification-plan-v2'||plan.provider_real!==false||plan.executed!==false||plan.certified!==false||!FEATURES.includes(plan.feature))reasons.push('invalid_plan');
 for(const c of plan.cases){if(ids.has(c.id))reasons.push('duplicate_id');ids.add(c.id);if(scenarios.has(c.scenario_sha256))reasons.push('duplicate_scenario');scenarios.add(c.scenario_sha256);
  if(c.scenario_sha256!==sha(scenario(c))||c.feature!==plan.feature)reasons.push('scenario_hash_mismatch');
  if(!c.text||!c.expectation||!FEATURES.includes(c.feature)||!GROUPS.includes(c.group)||!['es','en'].includes(c.language)||typeof c.audio_requested!=='boolean')reasons.push('invalid_case');
  if(c.group==='memory'&&!c.expected_observations&&!c.expected_fact&&!c.expected_forgetting&&!c.forbid_effects)reasons.push('missing_memory_gold');
  if(c.group==='action'&&!c.expected_action)reasons.push('missing_action_gold');
  if(c.group==='query'&&!c.expected_retrieval)reasons.push('missing_retrieval_gold');
 }
 for(const [name,subset] of [['all',plan.cases],...['es','en'].map(l=>[l,plan.cases.filter(c=>c.language===l)]),...GROUPS.map(g=>[g,plan.cases.filter(c=>c.group===g)])]){
  counts[name]={cases:subset.length,planned_audio:subset.filter(c=>c.audio_requested).length};
  if(subset.length<(name==='all'?200:['es','en'].includes(name)?50:20)||counts[name].planned_audio<(name==='all'?50:1))reasons.push('coverage_'+name);
 }
 return {planned_only:true,executed_pairs:0,approved:false,coverage_prepared:reasons.length===0,counts,reasons:[...new Set(reasons)]};
}
if(require.main===module){const dir=process.argv[2];if(!dir)throw Error('Output directory required');fs.mkdirSync(dir,{recursive:true});for(const feature of FEATURES){const plan=build(feature);fs.writeFileSync(path.join(dir,feature+'.json'),JSON.stringify(plan,null,2)+'\n');fs.writeFileSync(path.join(dir,feature+'-coverage.json'),JSON.stringify(coverage(plan),null,2)+'\n');}}
module.exports={build,coverage,FEATURES,GROUPS,sha};
