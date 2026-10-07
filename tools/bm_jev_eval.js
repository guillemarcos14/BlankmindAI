"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const { performance } = require("node:perf_hooks");
const jev = require("../netlify/functions/bm-jev");
const dataset = require("./datasets/bm_jev_v1.json");
const LABELS = Object.keys(jev.taxonomy.topics);
const RULES = { sleep: /\b(sleep|slept|bedtime|bed|night|nap|dorm\w*|sueño|noches?|acost\w*|despert\w*)\b/i,
  rest: /\b(rest\w*|tired|fatigue|energy|energetic|exhausted|break|relax\w*|descans\w*|cansad\w*|agotad\w*|energía|pausa)\b/i,
  habits: /\b(habit\w*|routine|rutina|goal|objetivo|coffee|caffeine|café|exercise|entreno|usually|suelo|cada|every)\b/i,
  distractions: /\b(distractions?|distracciones|distract\w*|focus|concentr\w*|protection|protección|bloque\w*|block\w*|límite|limit|móvil|phone|app usage)\b/i,
  support: /\b(blankmind|app|permission|permiso|onboarding|error|falla|support|soporte|sign in|sesión|login|suscrip\w*|subscription|code|código|crash\w*)\b/i };
function baseline(c) {
  const text = c.current_message;
  const topics = Object.entries(RULES).filter(([, re]) => re.test(text)).map(([key]) => key);
  if (!topics.length) topics.push("other");
  return { topics, sources: [], intent: null, abstained: false };
}
const ratio = (a,b) => b ? a/b : 0;
function score(cases, predictions) {
  const byLabel = Object.fromEntries(LABELS.map(k => [k, { tp:0, fp:0, fn:0 }]));
  let accepted = 0, intentCorrect = 0, intentCount = 0, badAbstentions = 0, sourceTp = 0, sourceFp = 0, sourceFn = 0;
  const failures = [], pending = [];
  for (const c of cases) {
    const p = predictions[c.id] || { topics: [], sources: [], abstained:true };
    const actual = p.abstained ? [] : p.topics;
    if (!p.abstained && actual.length) accepted++;
    if (c.expected.abstain && !p.abstained) badAbstentions++;
    for (const k of LABELS) {
      if (actual.includes(k)) byLabel[k][c.expected.topics.includes(k) && !c.expected.abstain ? "tp" : "fp"]++;
      else if (c.expected.topics.includes(k) && !c.expected.abstain) byLabel[k].fn++;
    }
    for (const k of Object.keys(jev.taxonomy.sources)) {
      if ((p.sources || []).includes(k)) c.expected.sources.includes(k) ? sourceTp++ : sourceFp++;
      else if (c.expected.sources.includes(k)) sourceFn++;
    }
    if (p.intent) { intentCount++; if (p.intent === c.expected.intent) intentCorrect++; }
    const mismatch = c.expected.abstain ? !p.abstained : actual.slice().sort().join() !== c.expected.topics.slice().sort().join();
    if (mismatch || (p.intent && p.intent !== c.expected.intent)) failures.push({ id:c.id, challenge:c.challenge, expected:c.expected, predicted:p });
    if (p.abstained) pending.push(c.id);
  }
  for (const v of Object.values(byLabel)) { v.precision=ratio(v.tp,v.tp+v.fp);v.recall=ratio(v.tp,v.tp+v.fn);v.f1=ratio(2*v.tp,2*v.tp+v.fp+v.fn); }
  const values = Object.values(byLabel), tp=values.reduce((s,v)=>s+v.tp,0), fp=values.reduce((s,v)=>s+v.fp,0);
  return { samples:cases.length, accepted, precision:ratio(tp,tp+fp), coverage:ratio(accepted,cases.length), macro_f1:values.reduce((s,v)=>s+v.f1,0)/values.length,
    per_label:byLabel, intent_precision:ratio(intentCorrect,intentCount), intent_coverage:ratio(intentCount,cases.length), ambiguous_incorrectly_accepted:badAbstentions,
    sources:{ precision:ratio(sourceTp,sourceTp+sourceFp), recall:ratio(sourceTp,sourceTp+sourceFn), tp:sourceTp,fp:sourceFp,fn:sourceFn }, failures, pending_review:pending };
}
function predict(records, thresholds) {
  return Object.fromEntries(records.map(r => [r.id,r.body ? jev.select(r.body, thresholds) : { topics:[],sources:[],intent:null,abstained:true }]));
}
function calibrate(cases, records) {
  let best = null;
  for (const topic of [.5,.6,.7,.8,.85,.9,.95,.97,.99]) for (const ambiguity of [.05,.1,.2,.3,.5,.7,.9]) {
    const thresholds={topic,source:.95,intent:.95,ambiguity}, report=score(cases,predict(records,thresholds));
    if (report.precision>=.95 && !report.ambiguous_incorrectly_accepted && (!best || report.coverage>best.report.coverage || report.coverage===best.report.coverage && report.macro_f1>best.report.macro_f1)) best={ thresholds,report };
  }
  return best;
}
function evaluate(records) {
  const byLanguage={};
  for(const language of ["es","en"]) {
    const tuning=dataset.cases.filter(c=>c.split==="tuning"&&c.language===language), heldout=dataset.cases.filter(c=>c.split==="heldout"&&c.language===language);
    const fit=calibrate(tuning,records.filter(r=>tuning.some(c=>c.id===r.id)));
    byLanguage[language]={thresholds:fit?.thresholds||null,tuning:fit?.report||null,heldout:score(heldout,predict(records.filter(r=>heldout.some(c=>c.id===r.id)),fit?.thresholds)),
      rule_baseline:score(heldout,Object.fromEntries(heldout.map(c=>[c.id,baseline(c)])))};
  }
  return byLanguage;
}
async function main() {
  const args=process.argv.slice(2), get=(k,d)=>args.includes(k)?args[args.indexOf(k)+1]:d,live=args.includes("--run"), file=path.resolve(get("--output","tmp/jev/evaluation.json"));
  const cases=dataset.cases.filter(c=>get("--split","all")==="all"||c.split===get("--split","all"));
  fs.mkdirSync(path.dirname(file),{recursive:true});
  if (!live) {
    const report={provider_real:false,model:jev.taxonomy.model,taxonomy:jev.taxonomy.version,independent_human_review:false,
      corpus:dataset.cases.length,baseline:Object.fromEntries(["es","en"].map(l=>[l,score(dataset.cases.filter(c=>c.language===l),Object.fromEntries(dataset.cases.map(c=>[c.id,baseline(c)])))])),
      gates_passed:false,blockers:["TYPESAFE_API_KEY required for live evaluation","independent human corpus review pending"]};
    fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify({report:file,provider_real:false,corpus:report.corpus,gates_passed:false}));return;
  }
  if (!process.env.TYPESAFE_API_KEY) throw Error("jev_key_required");
  const records=[],start=performance.now();let reserved=0;
  const report={provider_real:true,model:jev.taxonomy.model,taxonomy:jev.taxonomy.version,independent_human_review:false,
    dataset_sha256:crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname,"datasets/bm_jev_v1.json"),"utf8").replace(/\r\n/g,"\n")).digest("hex"), records,
    completed:false,gates_passed:false,physical_device_tested:false};
  for(const c of cases) {
    if (reserved+.001>1) throw Error("jev_budget_exhausted"); reserved+=.001;
    const payload=jev.request(c),body=JSON.stringify(payload),begin=performance.now();
    if(Buffer.byteLength(body)>16000)throw Error("jev_context_limit");
    const row={id:c.id,language:c.language,split:c.split,request_sha256:crypto.createHash("sha256").update(body).digest("hex")};
    try {
      const r=await fetch(jev.ENDPOINT,{method:"POST",headers:{authorization:"Bearer "+process.env.TYPESAFE_API_KEY,"content-type":"application/json"},body,redirect:"error",signal:AbortSignal.timeout(5000)});
      if(!r.ok)throw Error("jev_http_"+r.status);
      const text=await r.text();if(text.length>50000)throw Error("jev_response_limit");
      row.received=JSON.parse(text);row.body=jev.validate(row.received,payload);row.cost_usd=row.body.usage.input_tokens*.042/1000000;
    }catch(e){row.error=/^jev_[a-z0-9_]+$/.test(e.message)?e.message:"jev_dependency_error";row.unknown_cost_upper_usd=.001;}
    row.elapsed_ms=Math.round(performance.now()-begin);records.push(row);
    report.reserved_upper_usd=reserved;report.elapsed_ms=Math.round(performance.now()-start);
    fs.writeFileSync(file,JSON.stringify(report,null,2));
    if(records.length%25===0)console.log(JSON.stringify({completed:records.length,errors:records.filter(r=>r.error).length,cost_usd:records.reduce((s,r)=>s+(r.cost_usd||0),0)}));
    // A bad key is a blocker, not 300 identical failures.
    if(["jev_http_401","jev_http_403"].includes(row.error))break;
  }
  let tuningRecords=[];
  if(get("--tuning",null)) {
    const tuningFile=fs.readFileSync(get("--tuning",null)),tuning=JSON.parse(tuningFile);
    if(!tuning.provider_real||tuning.evaluated_split!=="tuning")throw Error("jev_invalid_tuning_reference");
    tuningRecords=tuning.records.map(r=>{
      const c=dataset.cases.find(c=>c.id===r.id&&c.split==="tuning");if(!c)throw Error("jev_tuning_leakage");
      const payload=jev.request(c),hash=crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
      if(hash!==r.request_sha256)throw Error("jev_tuning_questions_changed");
      const copy={...r};try{copy.body=jev.validate(r.received||r.body,payload);delete copy.error;}catch(_){copy.body=null;}return copy;
    });
    report.tuning_reference={file:path.basename(get("--tuning",null)),sha256:crypto.createHash("sha256").update(tuningFile).digest("hex"),samples:tuningRecords.length};
  }
  report.completed=records.length===cases.length;report.evaluated_split=get("--split","all");report.by_language=evaluate([...tuningRecords,...records]);
  report.measured_tag_targets=report.completed&&Object.values(report.by_language).every(v=>v.heldout.precision>=.95&&v.heldout.coverage>=.8&&!v.heldout.ambiguous_incorrectly_accepted);
  report.cost_usd=records.reduce((s,r)=>s+(r.cost_usd||0),0);report.errors=records.filter(r=>r.error).length;
  report.blockers=["Independent human review pending","Paired workflow benchmark and physical iPhone validation pending"];
  // Synthetic results cannot certify deployment or independent review.
  report.gates_passed=false;
  fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify({report:file,completed:report.completed,errors:report.errors,cost_usd:report.cost_usd,
    by_language:Object.fromEntries(Object.entries(report.by_language).map(([l,v])=>[l,{precision:v.heldout.precision,coverage:v.heldout.coverage,macro_f1:v.heldout.macro_f1}])),gates_passed:false}));
}
if(require.main===module)main().catch(e=>{console.error(/^jev_[a-z_]+$/.test(e.message)?e.message:"jev_eval_failed");process.exitCode=1;});
module.exports={baseline,score,calibrate,evaluate,predict};
