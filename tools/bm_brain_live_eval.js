"use strict";
// Synthetic semantic holdout. No user data, memory writes or native actions.
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const { extractRequest }=require("../netlify/functions/bm-brain");
const cases=[
  ["¿Cuánto tiempo he estado bloqueado esta semana?","statistics",false,"this_week"],
  ["Compare my protection this week with the previous week","statistics",false,"this_week"],
  ["¿Qué horarios de bloqueo tengo configurados?","configuration",false],
  ["Bloquea mis distracciones ahora durante 30 minutos","control",true],
  ["Would blocking for 30 minutes be a good idea?","conversation",false],
  ["Recuerda que trabajo de noche","memory",false,null,{operation:"set",key:"work_routine"}],
  ["Corrige mi objetivo: concentrarme por las mañanas","memory",false,null,{operation:"set",key:"goal"}],
  ["Olvida mi objetivo","memory",false,null,{operation:"forget",key:"goal"}],
  ["Forget all your personal memories about me","memory",false,null,{operation:"forget_all"}],
  ["¿Qué recuerdas de mí?","memory",false],
  ["Busca lo que te dije sobre estudiar en agosto","history",false],
  ["Do I currently have premium access?","account",false],
  ["Quiero cancelar mi suscripción","account",false],
  ["Desbloquéame ahora","account",false],
  ["Desactiva el filtro de contenido adulto","control",true],
  ["Bloquea 30 minutos y dime mis estadísticas de ayer","control",true],
  ["Revisa los bloqueos entre el 1 y el 15 de septiembre de 2026","statistics",false,"custom"],
  ["Hola","conversation",false],
  ["My friend said 'block me for an hour'. What do you think?","conversation",false],
  ["¿Cuánto usé Instagram ayer?","conversation",false],
];
async function main(){
  if(!process.argv.includes("--run") || !process.env.OPENAI_API_KEY) throw Error("explicit_live_run_and_model_key_required");
  const records=[];
  const context={brain_snapshot:{local_date:"2026-10-02",timezone:"Europe/Madrid"},recent_messages:[]};
  // First request is a bounded provider preflight; do not start a battery if it fails.
  for(let i=0;i<cases.length;i++){
    const [prompt,route,execute,period,memory]=cases[i];const start=Date.now();
    try{
      const result=await extractRequest(prompt,context);
      const passed=result.route===route && result.execute===execute && (!period||result.period===period)
        && (!memory||Object.entries(memory).every(([key,value])=>result.memory?.[key]===value));
      records.push({prompt,result,passed,elapsed_ms:Date.now()-start});
      console.log(`${passed?"PASS":"FAIL"} semantic_case_${i+1} route=${result.route}`);
    }catch(error){
      records.push({prompt,passed:false,error:error.message,elapsed_ms:Date.now()-start});
      console.log(`FAIL semantic_case_${i+1} ${error.message}`);
      if(i===0)break;
    }
  }
  const report={generated_at:new Date().toISOString(),script_sha256:crypto.createHash("sha256").update(fs.readFileSync(__filename)).digest("hex"),
    scope:"synthetic_read_router_only_no_actions_or_memory_writes",records,passed:records.length===cases.length&&records.every(r=>r.passed)};
  const output="tmp/brain/live-router.json";fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));
  console.log(JSON.stringify({report:output,passed:report.passed,cases:records.length}));process.exitCode=report.passed?0:1;
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
