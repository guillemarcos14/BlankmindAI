"use strict";

// Explicitly authorized backend enablement for physical TestFlight evaluation.
// This is not a public-product release and does not change the release gate.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const ROOT = path.resolve(__dirname, "..");
const SITE = "59955668-9a9b-4979-a283-63fbf3115fe5";
const ORIGIN = "https://getblank.netlify.app";
const ENTRIES = ["account-data", "app-auth", "assistant-app", "assistant-channel"];
const sha = data => crypto.createHash("sha256").update(data).digest("hex");
const git = (...args) => {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) throw Error("git_failed");
  return r.stdout.trim();
};
function assertSource() {
  if (!/^codex\/backend-release-/.test(git("branch", "--show-current")) || git("status", "--porcelain")) throw Error("clean_release_branch_required");
  return git("rev-parse", "HEAD");
}
function manifest(snapshot, replacements) {
  if (snapshot.site.id !== SITE || snapshot.site.ssl_url !== ORIGIN || snapshot.deploy.site_id !== SITE
      || snapshot.site.published_deploy.id !== snapshot.deploy.id) throw Error("site_identity_mismatch");
  if (JSON.stringify(Object.keys(replacements).sort()) !== JSON.stringify([...ENTRIES].sort())) throw Error("app_function_allowlist_mismatch");
  const functions = Object.fromEntries(snapshot.fns.functions.map(f => [f.n, f.d]));
  const files = Object.fromEntries(snapshot.files.map(f => [f.path.replace(/^\//, ""), f.sha]));
  if (Object.keys(functions).length < 40 || Object.keys(files).length < 5) throw Error("incomplete_existing_deploy_snapshot");
  const functions_config = Object.fromEntries(snapshot.fns.functions.map(f => [f.n, { build_data: f.bd, priority: f.p,
    ...(f.dn ? { display_name: f.dn } : {}), ...(f.g ? { generator: f.g } : {}) }]));
  return { files, functions: { ...functions, ...replacements }, functions_config,
    function_schedules: snapshot.deploy.function_schedules || [], draft: true,
    title: "Authorized TestFlight app backend evaluation; preserve Early Access" };
}
function token() {
  const c = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, "netlify/Config/config.json")));
  const value = (c.users[c.userId] || Object.values(c.users)[0])?.auth?.token;
  if (!value) throw Error("netlify_login_required");
  return value;
}
async function main() {
  const args = process.argv.slice(2);
  const qaToken = token();
  const api = async (route, options = {}) => {
    const response = await fetch(`https://api.netlify.com/api/v1${route}`, { ...options,
      headers: { authorization: `Bearer ${qaToken}`, "content-type": "application/json", ...options.headers },
      signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw Error(`netlify_api_${response.status}`);
    return response.status === 204 ? null : response.json();
  };
  const at = args.indexOf("--report");
  const reportFile = path.resolve(ROOT, at >= 0 ? args[at + 1] : "tmp/physical-qa/backend-deploy.json");
  if (args.includes("--prepare")) {
    const commit = assertSource();
    const site = await api(`/sites/${SITE}`);
    const snapshot = { site, deploy: await api(`/deploys/${site.published_deploy.id}`),
      fns: await api(`/sites/${SITE}/functions`), files: await api(`/deploys/${site.published_deploy.id}/files`) };
    const directory = path.join(ROOT, "tmp/physical-qa", `package-${Date.now()}`);
    fs.mkdirSync(path.join(directory, "wrappers"), { recursive: true });
    for (const name of ENTRIES) fs.writeFileSync(path.join(directory, "wrappers", `${name}.js`),
      `exports.handler = require(${JSON.stringify(path.join(ROOT, "netlify/functions", `${name}.js`))}).handler;\n`);
    const cli = path.resolve(ROOT, "../../tmp/netlify-cli-runtime/node_modules/netlify-cli/bin/run.js");
    const loader = createRequire(cli);
    const { zipFunctions } = await import(pathToFileURL(loader.resolve("@netlify/zip-it-and-ship-it")).href);
    const packaged = await zipFunctions(path.join(directory, "wrappers"), path.join(directory, "functions"), {
      basePath: ROOT, config: { "*": { nodeBundler: "esbuild", nodeVersion: "24" } } });
    const replacements = Object.fromEntries(packaged.map(f => [f.name, sha(fs.readFileSync(f.path))]));
    const body = manifest(snapshot, replacements);
    const report = { purpose: "authorized_physical_app_evaluation", source_commit: commit, snapshot,
      functions: packaged.map(f => ({ name: f.name, path: f.path, sha256: replacements[f.name], runtime: f.runtimeVersion || "nodejs24.x" })),
      body, status: "prepared", physical_success_claimed: false, broad_release_authorized: false };
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, report: reportFile, source: commit, changed: ENTRIES,
      preserved_functions: Object.keys(body.functions).length - ENTRIES.filter(n => snapshot.fns.functions.some(f => f.n === n)).length,
      preserved_files: Object.keys(body.files).length }));
    return;
  }
  const report = JSON.parse(fs.readFileSync(reportFile));
  const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  if (args.includes("--publish")) {
    if (!args.includes("--confirm") || report.status !== "prepared" || assertSource() !== report.source_commit) throw Error("confirmed_unchanged_prepared_candidate_required");
    const gate = JSON.parse(fs.readFileSync(path.join(ROOT, "tmp/physical-qa/harness.json")));
    if (gate.status !== "passed" || gate.scope?.violations?.length) throw Error("scoped_harness_required");
    if ((await api(`/sites/${SITE}`)).published_deploy.id !== report.snapshot.deploy.id) throw Error("active_deploy_changed_reprepare_required");
    for (const f of report.functions) if (sha(fs.readFileSync(f.path)) !== f.sha256) throw Error("package_changed");
    const created = await api(`/sites/${SITE}/deploys`, { method: "POST", body: JSON.stringify(report.body) });
    report.deploy_id = created.id; report.status = "draft_created"; save();
    if (created.required?.length || created.required_functions?.some(d => !report.functions.some(f => f.sha256 === d))) throw Error("preserved_artifact_not_reused");
    for (const digest of created.required_functions || []) {
      const f = report.functions.find(item => item.sha256 === digest);
      await api(`/deploys/${created.id}/functions/${f.name}?runtime=${f.runtime}`, { method: "PUT",
        headers: { "content-type": "application/octet-stream" }, body: fs.readFileSync(f.path) });
    }
    report.status = "draft_uploaded"; save();
    // Draft polling is separate from publication so uncertain uploads are never repeated.
    console.log(JSON.stringify({ status: report.status, deploy_id: report.deploy_id, report: reportFile }));
    return;
  }
  if (args.includes("--activate")) {
    if (!args.includes("--confirm") || report.status !== "draft_uploaded" || assertSource() !== report.source_commit) throw Error("confirmed_uploaded_candidate_required");
    const draft = await api(`/deploys/${report.deploy_id}`);
    if (draft.state !== "ready") throw Error(`draft_not_ready_${draft.state}`);
    if ((await api(`/sites/${SITE}`)).published_deploy.id !== report.snapshot.deploy.id) throw Error("active_deploy_changed");
    await api(`/sites/${SITE}/deploys/${report.deploy_id}/restore`, { method: "POST" });
    report.status = "published_unverified"; save();
  }
  if (args.includes("--verify") || args.includes("--activate")) {
    const site = await api(`/sites/${SITE}`);
    const inventory = await api(`/sites/${SITE}/functions`);
    const files = await api(`/deploys/${report.deploy_id}/files`);
    if (site.published_deploy.id !== report.deploy_id || inventory.functions.length !== Object.keys(report.body.functions).length
      || inventory.functions.some(f => report.body.functions[f.n] !== f.d)
      || files.length !== report.snapshot.files.length || files.some(f => report.body.files[f.path.replace(/^\//, "")] !== f.sha)) throw Error("remote_artifact_mismatch");
    report.status = "published_verified"; report.verified_at = new Date().toISOString(); save();
    console.log(JSON.stringify({ status: report.status, deploy_id: report.deploy_id, all_function_hashes_verified: true,
      all_static_hashes_preserved: true, changed: ENTRIES }));
  }
}
module.exports = { manifest, ENTRIES };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
