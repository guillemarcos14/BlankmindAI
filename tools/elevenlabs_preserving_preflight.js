"use strict";
// Read-only remote preflight. Builds a complete manifest; cannot publish or set flags.
const fs = require("fs"), path = require("path"), crypto = require("crypto"), assert = require("assert");
const ROOT = path.resolve(__dirname, ".."), SITE = "59955668-9a9b-4979-a283-63fbf3115fe5";
const dir = path.join(ROOT, "tmp/elevenlabs-recovery/bundle");
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
const json = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
async function main() {
  assert.equal(process.argv.length, 2, "read-only command takes no mutation arguments");
  const baseline = json(path.join(dir, "manifest.json")), validation = json(path.join(dir, "evidence/legacy-runtime-validation.json"));
  const receipt = json(path.join(dir, "legacy-alternative/receipt.json"));
  assert(validation.pass && validation.real_messages === 0 && validation.paid_calls === 0);
  for (const pkg of receipt.packages) assert(validation.provenance.some(p => p.name === pkg.name && p.sha256 === pkg.sha256));
  const c = json(path.join(process.env.APPDATA, "netlify/Config/config.json"));
  const token = (c.users[c.userId] || Object.values(c.users)[0]).auth.token;
  async function get(route) {
    const r = await fetch("https://api.netlify.com/api/v1" + route, { headers: { authorization: "Bearer " + token }, signal: AbortSignal.timeout(30000) });
    assert(r.ok, "netlify_read_" + r.status); return r.json();
  }
  const site = await get("/sites/" + SITE); assert.equal(site.ssl_url, "https://getblank.netlify.app");
  assert.equal(site.published_deploy.id, baseline.published_deploy, "production changed; rebase preserving manifest");
  const [deploy, fns, files, vars] = await Promise.all([
    get("/deploys/" + site.published_deploy.id), get("/sites/" + SITE + "/functions"),
    get("/deploys/" + site.published_deploy.id + "/files"), get("/accounts/" + site.account_id + "/env?site_id=" + SITE),
  ]);
  assert.equal(deploy.site_id, SITE); assert.equal(deploy.state, "ready");
  const functions = Object.fromEntries(fns.functions.map(f => [f.n, f.d]));
  assert.equal(Object.keys(functions).length, 73); assert.equal(files.length, 17);
  const sourceMap = {}, changes = [], originals = [...baseline.preserved, ...baseline.missing_originals];
  for (const original of originals) assert.equal(functions[original.name], original.sha256, "production function changed: " + original.name);
  function artifact(f) { assert.equal(hash(fs.readFileSync(path.join(ROOT, f.path))), f.sha256); sourceMap[f.sha256] = f.path; }
  for (const f of baseline.preserved) artifact(f);
  for (const pkg of receipt.packages) {
    artifact(pkg);
    const names = pkg.name === "waitlist-agent" ? ["waitlist-agent", "whatsapp-agent", "_bm_final_qa_dispatch"] : [pkg.name];
    for (const name of names) { changes.push({ name, before: functions[name], after: pkg.sha256, reason: "Authorized historical reconstruction; hermetic archive fixtures PASS" }); functions[name] = pkg.sha256; }
  }
  // Only these three app entries are needed: persisted language writer, native
  // text stream using that writer, and ElevenLabs voice. Preserve all other QA entries.
  for (const name of ["assistant-app", "assistant-app-stream", "assistant-app-voice"]) {
    const f = baseline.proposed.find(f => f.name === name); assert(f); artifact(f);
    changes.push({ name, before: functions[name] || null, after: f.sha256, reason: name === "assistant-app" ? "Persist reply language for selected voice; embedded account-scoped BMB transaction" : name === "assistant-app-stream" ? "Native streaming endpoint uses the same persisted reply and language writer" : "Consented ElevenLabs PCM24k/timestamp endpoint" });
    functions[name] = f.sha256;
  }
  assert.equal(Object.keys(functions).length, 75);
  const config = Object.fromEntries(fns.functions.map(f => [f.n, { build_data: f.bd, priority: f.p, ...(f.dn ? { display_name: f.dn } : {}), ...(f.g ? { generator: f.g } : {}) }]));
  for (const name of ["assistant-app-stream", "assistant-app-voice"]) config[name] = { build_data: { runtimeAPIVersion: 2 }, priority: 10 };
  const body = { draft: true, files: Object.fromEntries(files.map(f => [f.path.replace(/^\//, ""), f.sha])), functions, functions_config: config,
    function_schedules: deploy.function_schedules || [], title: "ElevenLabs ES Cristina / EN Ember; preserve existing production" };
  const value = v => v?.scopes?.some(s => ["functions", "runtime"].includes(s)) ? v.values.find(x => x.context === "production")?.value ?? v.values.find(x => x.context === "all")?.value : undefined;
  const flags = vars.filter(v => /^BM_.*(?:VOICE|RETRIEVAL|DECISIONS|JEV)/.test(v.key)).map(v => ({ key: v.key, value: value(v) ?? null }));
  assert(!flags.some(f => /(?:RETRIEVAL.*ENABLED|DECISIONS.*ENABLED|JEV.*(?:ENABLED|EXPERIMENT))/.test(f.key) && f.value === "true"), "unexpected active model feature");
  assert(!flags.some(f => f.key === "BM_VOICE_ENABLED" && f.value === "true"), "voice already enabled");
  for (const [key, expected] of [["ELEVENLABS_VOICE_ID_ES", "dNjJKg63Fr5AXwIdkATa"], ["ELEVENLABS_VOICE_ID_EN", "WtA85syCrJwasGeHGH2p"]]) assert.equal(value(vars.find(v => v.key === key)), expected);
  assert(Boolean(value(vars.find(v => v.key === "ELEVENLABS_API_KEY"))), "production provider key missing");
  // Record metadata only. Never interpret a Secrets Controller mask as a key.
  const credentialMetadata = vars.filter(v => /KEY|TOKEN|SECRET|PASSWORD/.test(v.key)).map(v => ({ key: v.key, is_secret: Boolean(v.is_secret), scopes: v.scopes, contexts: v.values.map(x => ({ context: x.context, present: Boolean(x.value) })) }));
  const report = { schema_version: 1, generated_at: new Date().toISOString(), site_id: SITE, runtime_commit: baseline.candidate_commit,
    published_deploy: deploy.id, read_only: true, production_mutations: 0, complete: true, preserved_exact: 67,
    reconstructed_endpoints: 5, replaced_app_entries: 1, added_app_entries: 2, total_functions: 75, static_count: 17,
    changes, body, artifacts: sourceMap, flags, credential_metadata: credentialMetadata,
    rollback: { previous_deploy: deploy.id, previous_deploy_ready: true, operation: "POST /sites/" + SITE + "/deploys/" + deploy.id + "/restore", trigger: "Any post-publication digest/authentication/voice regression", requires_prior_voice_flags: true, additive_sql_retained: true, offline_original_primary_archives_available: false },
    publication_blocked_by: ["exact signed/distributed iOS consent-v2 build", "20 exact-candidate physical cases", "active-model candidate evaluation and independent review", "real production-provider PCM/timestamp integration verification"],
    required_before_publication: ["unchanged release readiness gate PASS", "guarded migrations 031-034 only", "draft upload and hash verification", "permitted real provider QA without credential extraction", "renewed consent client distribution"],
    ready_to_publish: false, replaced_all_ten_qa_functions: false };
  fs.writeFileSync(path.join(dir, "evidence/production-preserving-manifest.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ complete: true, preserved_exact: 67, reconstructed: 5, total_functions: 75, statics: 17, rollback_deploy: deploy.id, production_mutations: 0, ready_to_publish: false }));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
