"use strict";
// One release exception, explicitly ordered by Guillem on 2026-10-09.
// The normal backend_release/readiness gate remains unchanged.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const ROOT = path.resolve(__dirname, "..");
const SITE = "59955668-9a9b-4979-a283-63fbf3115fe5";
const REF = "vhiikgyyfisejjwqtxfc";
const SOURCE = "b9935d976bce6821ce23044505cfaac46041e352";
const FLAGS = Object.freeze({ BM_RETRIEVAL_STEP_ENABLED: "true", BM_DECISIONS_DATA_POLICY: "authenticated-account-records", BM_RETRIEVAL_STEP_QA_ENABLED: "false", BM_DECISIONS_QA_ENABLED: "false", BM_JEV_SHADOW_ENABLED: "false", BM_JEV_PREFETCH_EXPERIMENT: "false" });
const digest = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const fail = code => { throw new Error(code); };
function validateLiveKeys(vars, value) {
  // Historical production keys predate Netlify's is_secret metadata. Preserve
  // their scopes/values; verify identity rather than changing key protection.
  const service = vars.find(v => v.key === "SUPABASE_SERVICE_ROLE_KEY"), openai = vars.find(v => v.key === "OPENAI_API_KEY");
  if (!value(service) || !value(openai)) fail("live_keys_missing");
  if (!service.is_secret) {
    let claims; try { claims = JSON.parse(Buffer.from(value(service).split(".")[1], "base64url")); } catch (_) { fail("service_key_identity_unverifiable"); }
    if (claims.ref !== REF || claims.role !== "service_role") fail("service_key_identity_mismatch");
  }
  if (!openai.is_secret && !/^sk-/.test(value(openai))) fail("provider_key_format_invalid");
}
function validateAuthorization(a, packaged, budget) {
  if (a.id !== "guillem-decisions-global-on-2026-10-09-b993" || a.authorizer !== "Guillem"
      || a.instruction !== "Ponlo ON, implementa autónomo" || a.site_id !== SITE || a.source_commit !== SOURCE
      || a.global !== true || a.budget_ceiling_usd !== 24 || a.quality_certified !== false
      || a.human_pairs_reviewed !== 0 || a.physical_cases_executed !== 0 || a.pending_reviews !== 92
      || a.normal_release_gate_changed !== false || a.allow_migrations.join(",") !== "026,027,028") fail("invalid_one_time_authorization");
  if (packaged.source_commit !== SOURCE || packaged.source_tree_clean !== true || packaged.remote_function_hashes_verified !== true
      || packaged.functions.length !== 10 || packaged.status !== "private_deploy_verified") fail("invalid_exact_package");
  if (budget.limit_usd !== 24 || !Number.isFinite(budget.reserved_upper_usd) || !Number.isFinite(budget.known_usd)
      || budget.reserved_upper_usd > 24 || budget.known_usd > 24) fail("budget_limit_changed");
  return true;
}
function deploymentBody(snapshot, packaged) {
  const previous = snapshot.functions.functions;
  if (!Array.isArray(previous) || snapshot.functions.branch !== null) fail("unknown_production_inventory");
  const functions = Object.fromEntries(previous.map(f => [f.n, f.d]));
  const configs = Object.fromEntries(previous.map(f => [f.n, { build_data: f.bd || { runtimeAPIVersion: 1 }, priority: f.p || 10 }]));
  const manifest = JSON.parse(fs.readFileSync(path.join(packaged.package_directory, ".netlify/functions/manifest.json")));
  for (const f of packaged.functions) {
    const m = manifest.functions.find(x => x.name === f.name);
    if (!m) fail("manifest_entry_missing");
    functions[f.name] = f.sha256;
    configs[f.name] = { build_data: m.buildData, priority: m.priority || 10 };
  }
  const files = Object.fromEntries(snapshot.files.map(f => [f.path.replace(/^\//, ""), f.sha]));
  return { draft: true, files, functions, functions_config: configs,
    function_schedules: [...(snapshot.deploy.function_schedules || []).filter(f => f.name !== "bmb-tick"), { name: "bmb-tick", cron: "*/5 * * * *" }],
    title: "Decisions GLOBAL ON; explicit Guillem exception; runtime 5c / package b993" };
}
function validatePreservedArtifacts(snapshot, packaged, artifacts) {
  const missing = snapshot.functions.functions.filter(f => !packaged.functions.some(p => p.name === f.n)
    && (!artifacts[f.d] || !fs.existsSync(artifacts[f.d]) || digest(artifacts[f.d]) !== f.d));
  if (missing.length) fail("preserved_artifacts_missing_" + missing.length);
}
async function release(args) {
  const authorizationPath = path.resolve(args.authorization);
  const a = JSON.parse(fs.readFileSync(authorizationPath));
  const packagePath = path.resolve(a.package_report);
  const packaged = JSON.parse(fs.readFileSync(packagePath));
  const ledger = path.resolve(ROOT, "../Codigo-retrieval/tmp/retrieval-wide/budget.json");
  const budget = JSON.parse(fs.readFileSync(ledger));
  validateAuthorization(a, packaged, budget);
  if (digest(packagePath) !== a.package_report_sha256 || digest(ledger) !== a.budget_sha256) fail("authorization_snapshot_changed");
  if (digest(a.preflight_report) !== a.preflight_report_sha256 || digest(a.migration_receipt) !== a.migration_receipt_sha256) fail("infrastructure_snapshot_changed");
  const migration = JSON.parse(fs.readFileSync(a.migration_receipt));
  if (!migration.passed || migration.project !== REF || migration.applied.map(m => m.version).join(",") !== "026,027,028") fail("migration_not_verified");
  if (!a.preserved_artifact_map) fail("preserved_artifact_map_required_before_flags");
  const originalArtifacts = JSON.parse(fs.readFileSync(a.preserved_artifact_map));
  validatePreservedArtifacts(JSON.parse(fs.readFileSync(a.preflight_report)), packaged, originalArtifacts);
  for (const f of packaged.functions) if (digest(f.path) !== f.sha256) fail("artifact_changed");
  for (const input of packaged.source_inputs) if (digest(path.join(ROOT, input.file)) !== input.sha256) fail("runtime_input_changed");
  const state = spawnSync("git", ["status", "--porcelain=v1"], { cwd: ROOT, encoding: "utf8" });
  if (state.status || state.stdout.trim()) fail("source_not_clean");
  const conf = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, "netlify/Config/config.json")));
  const token = (conf.users[conf.userId] || Object.values(conf.users)[0]).auth.token;
  const reportFile = path.resolve(args.receipt);
  if (fs.existsSync(reportFile)) fail("receipt_already_exists_use_resume");
  const report = { authorization: a, authorization_sha256: digest(authorizationPath), package_report_sha256: digest(packagePath),
    candidate_commit: spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim(),
    runtime_parent_commit: "5c3134c8f880b86dd37dd7d6133029dbb405703e", package_commit: SOURCE,
    quality_certified: false, normal_gate_unchanged: true, generated_at: new Date().toISOString(), steps: [], status: "preflight" };
  const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n");
  const call = async (route, method = "GET", body, binary = false) => {
    const r = await fetch("https://api.netlify.com/api/v1" + route, { method, headers: { authorization: "Bearer " + token,
      "content-type": binary ? "application/zip" : "application/json" }, ...(body === undefined ? {} : { body: binary ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(60_000) });
    if (!r.ok) fail("netlify_" + method.toLowerCase() + "_" + r.status);
    return r.json();
  };
  try {
    const site = await call("/sites/" + SITE);
    if (site.ssl_url !== "https://getblank.netlify.app" || site.published_deploy.id !== a.previous_deploy_id) fail("production_deploy_changed");
    const envRoute = "/accounts/" + site.account_id + "/env?site_id=" + SITE;
    const vars = await call(envRoute);
    const value = v => v?.scopes?.includes("functions") ? v.values.find(x => x.context === "production")?.value ?? v.values.find(x => x.context === "all")?.value : "";
    if (value(vars.find(v => v.key === "SUPABASE_URL")) !== "https://" + REF + ".supabase.co") fail("production_database_mismatch");
    validateLiveKeys(vars, value);
    if (vars.some(v => /JEV|RETRIEVAL|DECISIONS/.test(v.key) && /^(true|1|on)$/i.test(value(v)))) fail("unexpected_initial_flags");
    if (vars.some(v => v.key === "BMB_PRIVATE_STAGE_COOKIE" && value(v))) fail("private_cookie_on_production");
    report.previous_deploy_id = site.published_deploy.id;
    report.original_flags = Object.fromEntries(Object.keys(FLAGS).map(k => [k, vars.find(v => v.key === k) || null]));
    // API gives masked values for secret keys; never persist secrets.
    const snapshot = JSON.parse(fs.readFileSync(a.preflight_report));
    const liveFunctions = await call("/sites/" + SITE + "/functions");
    if (JSON.stringify(liveFunctions.functions.map(f => [f.n, f.d])) !== JSON.stringify(snapshot.functions.functions.map(f => [f.n, f.d]))) fail("production_inventory_changed");
    report.body = deploymentBody(snapshot, packaged); save();
    for (const [key, val] of Object.entries(FLAGS)) {
      const existing = vars.find(v => v.key === key);
      const route = "/accounts/" + site.account_id + "/env";
      if (existing) {
        if (!existing.scopes.includes("functions")) fail("flag_scope_conflict");
        await call(route + "/" + key + "?site_id=" + SITE, "PATCH", { context: "production", value: val });
      } else await call(route + "?site_id=" + SITE, "POST", [{ key, scopes: ["functions"], is_secret: false, values: [{ context: "production", value: val }] }]);
      report.steps.push({ flag: key, value: val }); save();
    }
    const d = await call("/sites/" + SITE + "/deploys", "POST", report.body);
    if (d.site_id !== SITE || !/^[a-f0-9]{24}$/.test(d.id)) fail("unexpected_deploy_identity");
    report.deploy_id = d.id; report.status = "draft_created"; save();
    if (d.required?.length) fail("preserved_static_cache_missing");
    for (const hash of d.required_functions || []) {
      // A digest may be shared by multiple legacy names. Upload each name once.
      for (const [name, expected] of Object.entries(report.body.functions).filter(([name, expected]) => expected === hash
          && !report.steps.some(s => s.uploaded === name))) {
        const f = packaged.functions.find(f => f.name === name);
        const previous = snapshot.functions.functions.find(f => f.n === name);
        const file = f?.path || originalArtifacts[expected];
        if (!file || digest(file) !== expected) fail("function_artifact_changed");
        const m = f ? JSON.parse(fs.readFileSync(path.join(packaged.package_directory, ".netlify/functions/manifest.json"))).functions.find(x => x.name === name) : null;
        const query = new URLSearchParams({ runtime: m?.runtimeVersion || previous.r });
        const mode = m?.invocationMode || previous?.im;
        if (mode) query.set("invocation_mode", mode);
        await call("/deploys/" + d.id + "/functions/" + name + "?" + query, "PUT", fs.readFileSync(file), true);
        report.steps.push({ uploaded: name, sha256: expected }); save();
      }
    }
    let ready;
    for (let i = 0; i < 60; i++) {
      ready = await call("/deploys/" + d.id);
      if (ready.state === "ready") break;
      if (["error", "failed"].includes(ready.state)) fail("draft_deploy_failed");
      await new Promise(r => setTimeout(r, 1000));
    }
    if (ready.state !== "ready") fail("draft_ready_timeout");
    report.status = "draft_ready"; report.deploy_context = ready.context; save();
    console.log(JSON.stringify({ status: report.status, deploy_id: d.id, receipt: reportFile }));
  } catch (e) { report.failure = e.message; save(); throw e; }
}
if (require.main === module) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => i % 2 ? a : [...a, [v.replace(/^--/, ""), all[i + 1]]], []));
  release(args).catch(e => { console.error(e.message); process.exitCode = 1; });
}
module.exports = { validateAuthorization, deploymentBody, validateLiveKeys, validatePreservedArtifacts, FLAGS };
