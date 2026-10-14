"use strict";
// Consumes actual frozen benchmark receipts. Never calls providers, deploys,
// changes feature activation, raises a budget or edits failed measurements.
const fs=require("node:fs"),path=require("node:path");
const {assess}=require("../netlify/functions/bm-agent-evidence");
const {digests}=require("../netlify/functions/bm-agent-activation");
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error("Usage: node tools/bm_agent_acceptance.js <measured-pairs.json> <report.json>");
const rows=JSON.parse(fs.readFileSync(input,"utf8"));
if(!Array.isArray(rows))throw Error("Expected array of measured paired turns");
require("./bm_agent_runtime").verify();
const hashes=digests();
const report={version:1,created_at:new Date().toISOString(),features:Object.fromEntries(["tools","retrieval","labels"].map(feature=>[feature,assess(rows,{feature,sourceHashes:hashes,model:process.env.OPENAI_MODEL||"gpt-5.6-luna"})]))};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify(Object.fromEntries(Object.entries(report.features).map(([name,r])=>[name,{approved:r.approved,reasons:r.reasons,case_count:r.case_count}]))));
if(Object.values(report.features).some(f=>!f.approved))process.exitCode=1;
