"use strict";
const runtime = require("./bm-agent-runtime.json");
const manifest = require("./bm-agent-activation.json");
const QA = "https://njqbovsmoowkhhsqmitn.supabase.co";
// Bind approval to the entire validation/read/execution runtime.
const FILES = Object.keys(runtime.source_hashes);
function digests() {
  return {...runtime.source_hashes};
}
let runtimeHashes;
function approved(feature, evidence = manifest, actual) {
  const item = evidence?.features?.[feature];
  if (evidence?.version !== 1 || item?.approved !== true || item.provider_measured !== true || item.quality_reviewed !== true
      || !Number.isSafeInteger(item.case_count) || item.case_count<200 || !item.model || !item.source_hashes
      || item.reasons?.length || item.coverage_passed !== true) return false;
  const check=require("./bm-agent-evidence").compare(item.metrics?.baseline,item.metrics?.candidate);
  if(!check.no_regression||!check.improved)return false;
  try { const hashes = actual || (runtimeHashes ||= digests()); return FILES.every(name => /^[a-f0-9]{64}$/.test(item.source_hashes[name]||"") && hashes[name] === item.source_hashes[name]); }
  catch (_) { return false; }
}
function enabled(feature, env = process.env) {
  if (!["tools", "retrieval", "labels"].includes(feature)) return false;
  // QA opt-in cannot be used on a production or arbitrary database.
  if (env.BM_AGENT_QA_ENABLED === "true" && env.SUPABASE_URL === QA) {
    const features=(env.BM_AGENT_QA_FEATURES||"tools,retrieval,labels").split(",");
    return features.every(f=>["tools","retrieval","labels"].includes(f))&&features.includes(feature);
  }
  return env.BM_AGENT_ENABLED === "true" && manifest.features[feature]?.model === (env.OPENAI_MODEL||"gpt-5.6-luna") && approved(feature);
}
module.exports = { QA, FILES, digests, approved, enabled };
