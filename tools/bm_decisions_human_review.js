"use strict";
// Blinded source-bound review artifact. Generating it is not human approval.
const fs=require('node:fs'),crypto=require('node:crypto');
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function main(){
 const input=process.argv.includes('--input')?process.argv[process.argv.indexOf('--input')+1]:'tmp/decisions-production/source-holdout.json',r=JSON.parse(fs.readFileSync(input));
 if(!r.complete)throw Error('complete_benchmark_required');
 const selected=['001','004','007','008','009','012','015','016','017','020','025','028','033','036','037','040','045','048','061','064','065','066','073','074'];
 const sections=[],mapping=[];
 const ids=r.case_manifest.cases.length===24?r.case_manifest.cases.map(c=>c.id):selected.map(s=>'source09-'+s);
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
 const output='docs/BM_DECISIONS_HUMAN_REVIEW_2026-10-09.md';fs.writeFileSync(output,header+sections.join('\n'));
 fs.writeFileSync('tmp/decisions-production/human-unblind.json',JSON.stringify({source_run_id:r.run_id,source_commits:r.source_commits,mapping,human_review_completed:false},null,2));
 console.log(JSON.stringify({output,pairs:sections.length,human_review_completed:false}));
}
if(require.main===module)main();
