"use strict";
const assert=require("node:assert/strict");
const membership=require("../netlify/functions/_membership");
const paths=[];let rows=[];
membership.supabaseFetch=async p=>{paths.push(p);if(p.startsWith("assistant_app_turns"))return rows;if(p.startsWith("bm_brain_memories")||p.startsWith("bmb_accounts")||p.startsWith("bmb_followups")||p.startsWith("bm_agent_labels"))return [];throw Error(p);};
const brain=require("../netlify/functions/bmb-brain"),tools=require("../netlify/functions/bm-agent-tools"),activation=require("../netlify/functions/bm-agent-activation");
const routing=require("../netlify/functions/bm-agent-decisions"),labels=require("../netlify/functions/bm-agent-labels");
const userId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const envBefore={...process.env};
Object.assign(process.env,{BM_AGENT_QA_ENABLED:"true",SUPABASE_URL:activation.QA,OPENAI_API_KEY:""});
const context=()=>({language:"es",memory:{semantic_store_version:0},has_selected_apps:true,screen_time_authorized:true,
 brain_snapshot:{schema_version:1,generated_at:new Date().toISOString(),timezone:"Europe/Madrid",sessions:[]}});
const action=(type="start_protection")=>({type,minutes:30,start_minute:1320,end_minute:420,start_mode:null,weekdays:[2,3,4,5,6],duration_days:7,local_date:null,timezone:"Europe/Madrid",recurrence:"weekly",window_id:"window-a",hours:2,hard_mode:false});
const compact=(prompt,reply="Lo vemos juntos.")=>({phase:"final",response_language:"es",message_kind:"question",evidence:prompt,response_text:reply,cited_sources:[]});
const management=(prompt,extra={})=>({response_language:"es",message_kind:"statement",evidence:prompt,decision:"respond",accepted_proposal:null,pending_request:null,action:null,memory:null,observations:[],followup_resolution:null,longitudinal_review:null,response_text:"He anotado lo que me cuentas.",cited_sources:[],...extra});
let callSequence=0;
const fn=(name,args)=>{
 if(name==="gestionar"&&!Object.hasOwn(args,"effects")){
  const effectNames=["rest_experiment","rest_preferences","rest_exclusions","rest_claim","accepted_proposal","pending_request","action","memory","observations","followup_resolution","longitudinal_review"];
  const effects=effectNames.filter(k=>args[k]!=null&&(!Array.isArray(args[k])||args[k].length)).map(kind=>({kind,value:args[kind]}));
  args={...Object.fromEntries(Object.entries(args).filter(([k])=>!effectNames.includes(k))),effects};
 }
 return {status:"completed",output:[{type:"function_call",call_id:"fixture_call_"+(++callSequence),name,arguments:JSON.stringify(args)}]};
};
async function turn(prompt,responses,{ctx=context(),memories=[]}={}){
 let calls=0;const requests=[];
 const result=await brain.plan({prompt,context:ctx,userId,identity:{anonymous_user_id:"owner-a"}},{memories,
  run:input=>brain.generate(input,{model:async ({request})=>{requests.push(request);const response=responses[calls++];assert(response,"Unexpected extra generation");return {body:response.output?response:{status:"completed",output_text:JSON.stringify(response)}};}})});
 return {result,calls,requests};
}
function provider(payload,answers){return {model:"gpt-6-luna",usage:{input_tokens:120},answers:payload.questions.map(q=>q.type==="predicate"?{name:q.name,type:q.type,probability:q.name.startsWith("metric_")?(q.name==="metric_"+answers.metric? .99:.01):answers[q.name]??.99}:{name:q.name,type:q.type,choice:answers[q.name]||q.choices[0].value,probabilities:q.choices.map(c=>({value:c.value,probability:c.value===(answers[q.name]||q.choices[0].value)?1:0}))})};}
async function main(){
 let p="Hola",r=await turn(p,[compact(p,"¡Hola! ¿Qué tal vas?")]);
 assert.equal(r.calls,1);assert.deepEqual(r.requests[0].tools.map(t=>t.name),["consultar_contexto","gestionar"]);
 assert.equal(r.requests[0].parallel_tool_calls,false);assert.deepEqual(r.result.plan.actions,[]);
 assert.equal(r.requests[0].reasoning,undefined,"Tool framing changed the previously validated reasoning policy");
 const managedAction=r.requests[0].tools.find(t=>t.name==="gestionar").parameters.properties.effects.items.anyOf.find(s=>s.properties.kind.enum[0]==="action").properties.value;
 const pauseContract=managedAction.anyOf.find(s=>s.properties?.type.enum.includes("pause_rules"));
 assert.deepEqual(pauseContract.properties.type.enum,["pause_rules"]);
 assert.equal(pauseContract.properties.hours.type,"integer");assert.equal(pauseContract.properties.hours.minimum,1);
 assert.equal(pauseContract.properties.minutes.type,"null");
 assert(r.requests[0].text.format.schema.required.length<brain.schema.required.length,"Plain replies still generate the full effects envelope");
 let proactiveRequest;
 const proactive=await brain.generate({mode:"proactive",current_message:"",sources:[],memories:[],coverage:[]},{model:async({request})=>{
  proactiveRequest=request;return {body:{status:"completed",output_text:JSON.stringify({...management("",{decision:"silent"}),phase:"final",queries:[]})}};
 }});
 assert.equal(proactiveRequest.tools,undefined,"Conversational tools changed the central proactive reasoning envelope");
 assert.equal(proactiveRequest.text.format.name,"bmb_turn");assert.equal(proactive.decision,"silent");
 for(const type of require("../netlify/functions/bm-pending-action").PENDING_ASSISTANT_ACTION_TYPES){
  if(type==="apply_ai_plan")continue;
  p="Aplica el cambio que te pido";
  r=await turn(p,[fn("gestionar",management(p,{message_kind:"action_request",decision:"execute",action:action(type),response_text:"Voy a intentarlo en tu iPhone."}))]);
  assert.equal(r.calls,1,type);assert.equal(r.result.plan.actions[0].type,type);assert.equal(r.result.context.brain_request.execute,true);
 }
 p="Me acuesto a las 23:00";
 r=await turn("Bloquea 30 minutos",[fn("gestionar",management("Bloquea 30 minutos",{message_kind:"action_request",decision:"execute",action:{...action(),start_mode:"now",end_minute:null},response_text:"Voy a intentar bloquear tus distracciones durante 30 minutos."}))]);
 assert.equal(r.result.plan.actions[0].type,"start_protection");assert.equal(r.result.plan.actions[0].minutes,30);
 assert(!r.result.plan.response_text.includes("00:00"),"Duration command was described as a clock schedule");
 const isoSchedule={...action("apply_schedule"),weekdays:[1,2,3,4,5]};
 assert.deepEqual(brain.normalizeAction(isoSchedule,Date.now(),"Crea un bloqueo de lunes a viernes").weekdays,[2,3,4,5,6]);
 assert.deepEqual(brain.normalizeAction(isoSchedule,Date.now(),"Create a block Monday through Friday").weekdays,[2,3,4,5,6]);
 assert.deepEqual(brain.normalizeAction(isoSchedule,Date.now(),"Not Monday through Friday, instead Tuesday").weekdays,[1,2,3,4,5]);
 assert.deepEqual(brain.normalizeAction(isoSchedule,Date.now(),"Monday through Friday and Sunday").weekdays,[1,2,3,4,5]);
 assert.deepEqual(brain.normalizeAction(isoSchedule).weekdays,[1,2,3,4,5],"Saved proposal was reinterpreted without new evidence");
 p="I normally wake up at 06:00.";
 const observation={metric:"wake_time",value_number:360,value_text:null,unit:"local_minute",measurement:"routine_statement",measured_at:null,timezone:"Europe/Madrid",evidence:p};
 r=await turn(p,[fn("gestionar",management(p,{response_language:"en",decision:"execute",observations:[observation],response_text:"I will keep your usual wake-up time in mind."}))]);
 assert.equal(r.result.context.brain_memory_effect.observations[0].value_number,360);assert.deepEqual(r.result.plan.actions,[]);
 assert.equal(r.result.context.brain_request.execute,false,"Observation-only management acquired device authority");
 p="Me acuesto a las 23:00";
 r=await turn(p,[fn("gestionar",management(p,{memory:{operation:"set",key:"bedtime",value:"23:00",evidence:p}}))]);
 assert.equal(r.calls,1);assert.equal(r.result.context.brain_memory_effect.value,"23:00");
 assert.deepEqual(r.result.plan.actions,[]);assert(!paths.some(p=>p.startsWith("rpc/")),"Tool interpretation wrote state before leased commit");
 p="My personal preference for winding down is reading on paper.";
 const paraphrased=management(p,{memory:{operation:"set",key:"preferences",value:"For winding down, prefers reading on paper.",evidence:p}});
 const repaired=management(p,{memory:{operation:"set",key:"preferences",value:"reading on paper",evidence:p}});
 r=await turn(p,[fn("gestionar",paraphrased),fn("gestionar",repaired)]);
 assert.equal(r.calls,2);assert.deepEqual(r.requests[1].tool_choice,{type:"function",name:"gestionar"});
 assert.equal(r.result.context.brain_memory_effect.value,"reading on paper","Repair lost the explicitly requested preference");
 await assert.rejects(()=>turn(p,[fn("gestionar",paraphrased),{...compact(p,"Lo recordaré."),message_kind:"statement"}]),/repair_changed_memory/);
 for(const operation of ["forget","forget_all"]){
  p="Olvida mis preferencias";
  r=await turn(p,[fn("gestionar",management(p,{memory:{operation,key:operation==="forget"?"preferences":null,value:null,evidence:p}}))]);
  assert.equal(r.result.context.brain_memory_effect.operation,operation);
 }
 p="¿Y si me acostara a las 23:00?";
 await assert.rejects(()=>turn(p,[fn("gestionar",management(p,{message_kind:"question",memory:{operation:"set",key:"bedtime",value:"23:00",evidence:p}}))]),/ungrounded_memory/);
 p="¿Qué dije antes?";rows=[{id:"old-row",user_text:"Me cuesta dejar el móvil",assistant_text:"Lo revisamos",created_at:new Date().toISOString()}];
 const query={source:"history",term:"",from:null,to:null,offset:0,timezone:"Europe/Madrid",history_evidence:""};
 const start=paths.length;
 r=await turn(p,[fn("consultar_contexto",{response_language:"es",message_kind:"question",evidence:p,queries:[query,query]}),{...compact(p,"Me contaste que te cuesta dejar el móvil."),cited_sources:["history"]}]);
 assert.equal(r.calls,2);assert.equal(paths.slice(start).filter(p=>p.startsWith("assistant_app_turns")).length,2,"Identical tool reads were not shared (one automatic history read plus one requested read)");
 const toolCall=r.requests[1].input.find(i=>i.type==="function_call"),toolOutput=r.requests[1].input.find(i=>i.type==="function_call_output");
 assert.equal(toolCall.call_id,toolOutput.call_id);assert.equal(JSON.parse(toolOutput.output).sources[0].source_id,"history");
 assert(!Object.hasOwn(JSON.parse(r.requests[1].input[1].content),"agentToolHistory"),"Protocol history was duplicated into the user context");
 rows=Array.from({length:40},(_,i)=>({id:"history-"+i,user_text:"Dato "+i,assistant_text:"Anotado",created_at:new Date().toISOString()}));
 r=await turn("Hola",[compact("Hola")]);
 const input=JSON.parse(r.requests[0].input[1].content),history=input.sources.find(s=>s.source_id==="history");
 assert.equal(history.rows.length,8);assert.equal(history.next_offset,8,"Trimming recent context hid the unread history gap");
 let cutoffs=[];
 const read=tools.reader({userId:"A",identity:{anonymous_user_id:"verified-A"},cutoff:"2026-10-01",timezone:"UTC",prompt:p,isQuestion:true,read:async(u,i,q,cutoff)=>{assert.equal(u,"A");cutoffs.push(cutoff);return {rows:[]};}});
 await read([query]);await read([{...query,history_evidence:p}]);
 assert.deepEqual(cutoffs,["2026-10-01",null],"Explicit history bypass polluted ordinary forgotten-data reads");
 assert.throws(()=>tools.decode(fn("not_a_tool",{})),/unknown_tool/);
 assert.throws(()=>tools.decode({output:[...fn("gestionar",{}).output,...fn("gestionar",{}).output]}),/ambiguous_output/);
 assert.throws(()=>tools.decode({output_text:JSON.stringify({...compact("x"),memory:{operation:"forget_all"}})}),/reply_effects/);
 assert.throws(()=>tools.decode(fn("consultar_contexto",{queries:[query],action:action()})),/invalid_read/);
 const effect={kind:"memory",value:{operation:"set",key:"goal",value:"descansar",evidence:"descansar"}};
 assert.throws(()=>tools.decode(fn("gestionar",{...compact("descansar"),effects:[effect,effect]})),/invalid_management/);
 assert.throws(()=>tools.decode(fn("gestionar",{...compact("descansar"),effects:[effect],action:action()})),/invalid_management/);
 const both=tools.decode(fn("gestionar",{response_language:"es",message_kind:"statement",evidence:"descansar",decision:"execute",effects:[effect,{kind:"action",value:action()}],response_text:"Voy a intentarlo.",cited_sources:[]}));
 assert.equal(both.memory.key,"goal");assert.equal(both.action.type,"start_protection");
 p="Olvida mis hábitos personales";
 r=await turn(p,[fn("gestionar",{response_language:"es",message_kind:"statement",evidence:p,decision:"ask",effects:[],response_text:"¿Qué hábitos quieres olvidar?",cited_sources:[]}),compact(p,"¿Qué hábitos concretos quieres que olvide?")]);
 assert.equal(r.calls,2);assert.equal(r.result.context.brain_memory_effect,undefined,"Malformed clarification acquired deletion authority");
 p="Translate into Spanish: block my distractions for 30 minutes.";
 r=await turn(p,[compact(p,"Bloquea mis distracciones durante 30 minutos.")]);
 assert.equal(r.requests[0].tool_choice,"none");assert.deepEqual(r.result.plan.actions,[]);
 await assert.rejects(()=>brain.plan({prompt:p,context:context(),userId,identity:{}},{memories:[],run:async()=>({...management(p,{message_kind:"action_request",decision:"execute",action:action()}),phase:"final",queries:[]})}),/text_transform_effects/);
 const prompt="¿Cuántas sesiones de protección tengo esta semana?",payload=routing.request(prompt);
 const selected=routing.selected(routing.validate(provider(payload,{metric:"protection_sessions",period:"this_week"}),payload));
 assert.deepEqual(selected,{metric:"protection_sessions",period:"this_week"});
 const refused=provider(payload,{metric:"none",period:"this_week"});assert.equal(routing.selected(routing.validate(refused,payload)),null);
 const duplicate=provider(payload,{metric:"sleep_duration",period:"yesterday"});duplicate.answers[1]=duplicate.answers[0];assert.throws(()=>routing.validate(duplicate,payload),/invalid_answer/);
 assert(!routing.candidate("Bloquea mis distracciones esta semana"));
 let fetched=0;
 assert.equal(await routing.start(userId,prompt,{env:{BM_AGENT_QA_ENABLED:"true",SUPABASE_URL:"https://production.invalid",OPENAI_API_KEY:"fixture"},fetcher:async()=>{fetched++;}}),null);assert.equal(fetched,0);
 const prepared=await routing.prepare(selected,{userId,identity:{},timezone:"Europe/Madrid",now:Date.now(),db:async()=>[],read:async()=>({available:true,coverage:"all_persisted_overlapping_rows",source_id:"protection_statistics",source:"protection_statistics",rows:[{available:true,protected_seconds:0,session_count:0,break_count:0,partial:true}]})});
 assert.equal(prepared.contract.facts.count,0);assert.equal(prepared.contract.agent_count,true);
 assert.throws(()=>routing.expandProse({response_text:"Tienes 5 sesiones",response_language:"es",cited_sources:["protection_statistics"]},{current_message:prompt,retrieval_contract:prepared.contract}),/not_grounded/);
 const labelEnv={BM_AGENT_QA_ENABLED:"true",SUPABASE_URL:activation.QA,OPENAI_API_KEY:"fixture",BM_AGENT_LABEL_DAILY_USD:"0.02"};
 const fragments=[{id:"memory:bedtime",text:"23:00"}];let reserved=false,finished=null,vendorCalls=0;
 const db=async(name,options)=>{const b=JSON.parse(options.body);if(name.endsWith("reserve")){if(reserved)return {claimed:false};reserved=true;return {claimed:true,token:"lease",source_hash:"hash",fragments};}finished=b;return {saved:true};};
 const fetcher=async(_,options)=>{vendorCalls++;const request=JSON.parse(options.body);return new Response(JSON.stringify(provider(request,{topic_0:"sleep",type_0:"routine"})),{status:200});};
 const first=await labels.organize({userId,turnId:userId},{env:labelEnv,db,fetcher});
 assert.equal(first.labels[0].topic,"sleep");assert.equal(finished.p_source_hash,"hash");
 await labels.organize({userId,turnId:userId},{env:labelEnv,db,fetcher});assert.equal(vendorCalls,1,"Label replay repeated a provider call");
 await labels.organize({userId,turnId:userId},{env:{...labelEnv,BM_AGENT_LABEL_DAILY_USD:""},db,fetcher});assert.equal(vendorCalls,1);
 assert.equal(activation.enabled("tools",{BM_AGENT_ENABLED:"true"}),false,"Unmeasured production architecture activated");
 assert.equal(activation.enabled("tools",{BM_AGENT_QA_ENABLED:"true",SUPABASE_URL:"https://untrusted.invalid"}),false);
 assert.equal(activation.enabled("labels",{BM_AGENT_QA_ENABLED:"true",SUPABASE_URL:activation.QA,BM_AGENT_QA_FEATURES:"tools"}),false,"Independent features cannot be measured separately");
 console.log("PASS agent: exactly two native tools, one-generation replies/management, all15 native actions, memory/forgetting, scoped batched reads, malformed/ambiguous tools, Decisions counts/refusals, replay-safe labels and production gates; no real provider calls");
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{for(const key of Object.keys(process.env))if(!Object.hasOwn(envBefore,key))delete process.env[key];Object.assign(process.env,envBefore);});
