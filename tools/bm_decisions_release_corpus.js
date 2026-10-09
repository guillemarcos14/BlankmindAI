"use strict";
// Gold slots/actions come from the documented contracts, before any live replay.
// 200 distinct inputs/expectations in five parameterized families, not 200 domains.
const fs=require('node:fs'),{validateDataset}=require('./bm_semantic_replay'),{digest}=require('./bm_semantic_oracle');
function build(){
 const conversations=[];
 const ready=()=>({intent:'block',apps:['Instagram'],app_category:null,moment:null,action_type:'strict_block',hard_mode:null,requested_capability:null,start:{type:'now'},end:null,duration_minutes:null,recurrence:{type:'once',weekdays:[]},schedule_horizon_days:null,confirmation:'confirmed',pending_slots:[],status:'ready',next_question:null});
 const baseContext={has_selected_apps:true,selected_app_names:['Instagram'],selection_count:1,screen_time_authorized:true,device_execution_ready:true,app_presence:{app_present:true,app_ready:true,last_seen_at:'__REPLAY_NOW__'},app_presence_recent:true,app_presence_state:'recently_seen'};
 for(const family of ['immediate','hard','recurrence_missing','permission_missing','selection_missing'])for(const language of ['es','en'])for(let index=0;index<20;index++){
  const duration=10+index*5,state=ready();state.duration_minutes=duration;
  const context={...baseContext,language};let text=language==='es'?`Bloquea Instagram ahora durante ${duration} minutos, solo esta vez.`:`Block Instagram now for ${duration} minutes, just once.`;
  let decision={type:'ready',slot:null},actions=[{type:'start_protection',minutes:duration,hard_mode:false}];
  if(family==='hard'){state.hard_mode=true;actions[0].hard_mode=true;text=language==='es'?`Activa un bloqueo duro de Instagram ahora por ${duration} minutos, solo una vez.`:`Start a hard block of Instagram now for ${duration} minutes, once only.`;}
  if(family==='recurrence_missing'){state.recurrence=null;state.status='collecting';state.pending_slots=['recurrence'];state.next_question='recurrence';decision={type:'ask',slot:'recurrence'};actions=[];text=language==='es'?`Bloquea Instagram ahora por ${duration} minutos.`:`Block Instagram now for ${duration} minutes.`;}
  if(family==='permission_missing'){context.screen_time_authorized=false;context.device_execution_ready=false;state.pending_slots=['permissions'];state.status='needs_setup';state.next_question='permissions';decision={type:'setup',slot:'permissions'};actions=[{type:'request_screen_time_permission'}];text=language==='es'?`Quiero bloquear Instagram solo una vez ahora, ${duration} minutos.`:`I want Instagram blocked just once now, for ${duration} minutes.`;}
  if(family==='selection_missing'){context.has_selected_apps=false;context.selection_count=0;context.selected_app_names=[];context.device_execution_ready=false;state.pending_slots=['app_selection'];state.status='needs_setup';state.next_question='app_selection';decision={type:'setup',slot:'app_selection'};actions=[{type:'open_app_picker',minutes:duration,hard_mode:false}];text=language==='es'?`Ahora bloquea Instagram ${duration} minutos, una sola vez.`:`Now block Instagram for ${duration} minutes, one time only.`;}
  conversations.push({id:`release-${family}-${language}-${index+1}`,channel:'ios',family,context,turns:[{input:text,expect:{state,decision,actions,language}}]});
 }
 const dataset={version:1,id:'decisions-release-200-2026-10-09',split:'development',provenance:'200 distinct normalized input/expectation sequences authored before replay. Five parameterized action/prerequisite families, ES/EN. Duration changes alter executable meaning; IDs, transport and incidental context do not add coverage. This is authored contract coverage, not 200 independent semantic domains, human review or physical execution. The separate factual broad comparison covers Decisions sources, provenance, units and followups.',conversations};
 validateDataset(dataset);const distinct=new Set(conversations.map(c=>digest(c.turns.map(t=>({input:t.input.normalize('NFC').replace(/\s+/gu,' ').trim().toLowerCase(),expected:t.expect})))));if(distinct.size!==200)throw Error('distinct_coverage_required');return dataset;
}
if(require.main===module){const file='tools/datasets/bm_decisions_release_200_2026-10-09.json';fs.writeFileSync(file,JSON.stringify(build(),null,2));console.log(file);}
module.exports={build};
