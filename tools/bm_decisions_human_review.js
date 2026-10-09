"use strict";
// Blinded source-bound review artifact. Generating it is not human approval.
const fs=require('node:fs'),crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const arg=(key,fallback)=>process.argv.includes(key)?process.argv[process.argv.indexOf(key)+1]:fallback;
function main(){
 const input=process.argv.includes('--input')?process.argv[process.argv.indexOf('--input')+1]:'tmp/decisions-production/source-holdout.json',r=JSON.parse(fs.readFileSync(input));
 if(!r.complete)throw Error('complete_benchmark_required');
 const selected=['001','004','007','008','009','012','015','016','017','020','025','028','033','036','037','040','045','048','061','064','065','066','073','074'];
 const sections=[],mapping=[];
 const cases=r.case_manifest.cases;if(cases.length<24)throw Error('24_review_cases_required');
 // Preserve the existing 74-case stratum, independent of renamed case IDs.
 // Other complete corpora get 24 distinct positions across the whole manifest.
 const ids=cases.length===74?selected.map(s=>cases[Number(s)-1].id):Array.from({length:24},(_,i)=>cases[Math.round(i*(cases.length-1)/23)].id);
 for(const [i,id]of ids.entries()){
  const rows=r.records.filter(x=>x.case_id===id),last=Math.max(...rows.map(x=>x.step)),pair=rows.filter(x=>x.step===last);
  if(pair.length!==2)throw Error('missing_pair_'+id);
  const ordered=parseInt(sha({run:r.run_id,id}).slice(0,2),16)%2?pair.slice().reverse():pair;
  mapping.push({sample:i+1,case_id:id,step:last,A:ordered[0].variant,B:ordered[1].variant,response_sha256:ordered.map(x=>sha(x.synthetic_response))});
  const e=ordered[0].expected,facts={fecha_actual:r.fixture_clock,zona:'Europe/Madrid',registros_sueño:e.all_fixture_sleep,registros_proteccion:e.fixture_sessions,datos_nativos:e.current_sleep||null,olvido:e.forgotten||false,unidades_invalidas:e.invalid_units||false,criterio:e.criterion,ejecucion_fisica:false};
  let text=`## Pareja ${i+1}\n\nPregunta: ${ordered[0].synthetic_input}\n\nDatos ficticios disponibles:\n\n${JSON.stringify(facts)}\n\n`;
  for(const [j,row]of ordered.entries())text+=`**Respuesta ${j?'B':'A'}**\n\n${row.step?`Conversación previa: ${JSON.stringify(row.expected.history)}\n\n`:''}${row.synthetic_response||'[Error del servicio; no hay respuesta completa]'}\n\n`;
  sections.push(text+'Evaluación A: E / A / D __. Evaluación B: E / A / D __. Preferencia A / B / empate __. Defecto concreto __.\n');
 }
 const header='# Decisions: revisión humana pendiente\n\n24 parejas ciegas de la candidata congelada, con fuentes, fallos y contexto conservados. No se ha realizado revisión humana. Duración estimada: 24 minutos; pareja 1: 60 segundos. Conjunto: '+r.case_manifest.split+'. Fuente: '+r.source_commits.decisions+'. No certifica un holdout independiente.\n\nE = excelente, A = aceptable, D = deficiente. Verifica dato, fecha local, unidades solicitadas, procedencia declarada/medida/simulada, contexto y límites. No debe exponer etiquetas internas ni afirmar ejecución física. Aplica el periodo preguntado a las fechas de los registros; los datos nativos pueden tener noches de otros días. Usa el historial de cada respuesta en los seguimientos. No consultes la clave de variantes antes de cerrar las puntuaciones.\n\n';
 const output=arg('--output','docs/BM_DECISIONS_HUMAN_REVIEW_2026-10-09.md');fs.writeFileSync(output,header+sections.join('\n'));
 fs.writeFileSync(arg('--mapping-output','tmp/decisions-production/human-unblind.json'),JSON.stringify({source_run_id:r.run_id,source_commits:r.source_commits,mapping,human_review_completed:false},null,2));
 console.log(JSON.stringify({output,pairs:sections.length,human_review_completed:false}));
}
if(require.main===module)main();
