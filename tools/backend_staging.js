"use strict";

// Private QA only. Production is intentionally not a configurable target.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const SITE_ID = "2ef5a74e-af70-4893-a5f6-63fb2537720d";
const SITE_URL = "https://blank-product-staging-20260926.netlify.app";
const SUPABASE_REF = "njqbovsmoowkhhsqmitn";
const ENTRIES = Object.freeze(["account-data", "app-auth", "assistant-app", "assistant-app-stream", "assistant-app-voice", "assistant-channel", "blanked-agent", "bmb-tick", "bmb-worker-background", "waitlist-auth"]);
const RELEASE_BRANCH = /^codex\/backend-release-[a-z0-9][a-z0-9-]*$/;
const DEFAULT_CLI = path.resolve(ROOT, "../../tmp/netlify-cli-runtime/node_modules/netlify-cli/bin/run.js");

function fail(message) { throw new Error(message); }
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function inside(parent, child) { const relative = path.relative(parent, child); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
function assertSite(site) { if (site !== SITE_ID) fail("Only the reserved private staging site is allowed"); }
function assertEntries(names) {
  if (JSON.stringify([...names].sort()) !== JSON.stringify(ENTRIES)) fail("Function allowlist must contain exactly the ten private staging entries");
}

function parseArgs(argv) {
  const args = { deploy: false, source: ROOT, cli: DEFAULT_CLI, site: SITE_ID };
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--deploy") args.deploy = true;
    else if (value === "--preserve-existing-experiments") args.preserveExistingExperiments = true;
    else if (value === "--dry-run") dryRun = true;
    else if (value === "--help") args.help = true;
    else if (["--source", "--netlify-cli", "--site-id", "--verify-report"].includes(value)) {
      const next = argv[++index];
      if (!next || next.startsWith("--")) fail(`${value} requires a value`);
      args[value === "--source" ? "source" : value === "--netlify-cli" ? "cli" : value === "--verify-report" ? "verifyReport" : "site"] = next;
    } else fail(`Unknown argument: ${value}`);
  }
  if (dryRun && args.deploy) fail("Choose --dry-run or --deploy");
  if (args.verifyReport && (dryRun || args.deploy)) fail("--verify-report cannot package or deploy");
  assertSite(args.site);
  args.source = path.resolve(args.source);
  args.cli = path.resolve(args.cli);
  if (args.verifyReport) args.verifyReport = path.resolve(args.verifyReport);
  return args;
}

function run(command, argv, cwd, options = {}) {
  const result = spawnSync(command, argv, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    timeout: 180_000, ...options });
  // Child output can contain provider credentials. Never echo raw CLI failures.
  if (result.error || result.status !== 0) fail(`${path.basename(command)} command failed; exit ${result.status ?? "unknown"}`);
  return String(result.stdout || "").trim();
}

function sourceState(source, execute = run) {
  const git = (args) => execute("git", args, source);
  const repository = fs.realpathSync(git(["rev-parse", "--show-toplevel"]));
  if (repository.toLowerCase() !== fs.realpathSync(source).toLowerCase()) fail("--source must be the worktree root");
  const commit = git(["rev-parse", "HEAD"]);
  if (!/^[a-f0-9]{40}$/.test(commit)) fail("Cannot identify source commit");
  const dirty = git(["status", "--porcelain=v1", "--untracked-files=all"]);
  const tracked = new Set(git(["ls-files", "-z"]).split("\0").filter(Boolean));
  return { commit, branch: git(["branch", "--show-current"]), clean: !dirty, tracked };
}

function requireDeployable(state) {
  if (!state.clean) fail("Staging deploy requires a clean source worktree; commit the candidate first");
  if (!RELEASE_BRANCH.test(state.branch)) fail("Staging deploy requires a codex/backend-release-* source branch");
}

async function loadBundler(cli) {
  if (!fs.existsSync(cli)) fail("Netlify CLI is unavailable; supply --netlify-cli with its run.js path");
  const requireFromCli = createRequire(cli);
  const entry = requireFromCli.resolve("@netlify/zip-it-and-ship-it");
  const packageFile = path.resolve(path.dirname(entry), "../package.json");
  const { zipFunctions } = await import(pathToFileURL(entry).href);
  return { zipFunctions, version: JSON.parse(fs.readFileSync(packageFile, "utf8")).version };
}

async function packageCandidate(args, state, bundler) {
  // Outside any worktree: CLI must not discover another netlify.toml, cron,
  // functions-internal, plugin output or cached function manifest in a parent.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "blank-private-staging-"));
  const wrappers = path.join(directory, "wrappers");
  const archives = path.join(directory, "functions");
  const publicDir = path.join(directory, "public");
  fs.mkdirSync(wrappers);
  fs.mkdirSync(publicDir);
  for (const name of ENTRIES) {
    const extension = ["assistant-app-stream", "assistant-app-voice"].includes(name) ? "mjs" : "js";
    const entry = path.join(args.source, "netlify", "functions", `${name}.${extension}`);
    if (!state.tracked.has(`netlify/functions/${name}.${extension}`) || !fs.existsSync(entry)) fail(`Missing tracked entry: ${name}`);
    // Literal absolute require is traversed by esbuild; only handler is exposed.
    fs.writeFileSync(path.join(wrappers, `${name}.${extension}`), extension === "mjs"
      ? `export { default } from ${JSON.stringify(entry.replace(/\\/g, "/"))};\n`
      : `exports.handler = require(${JSON.stringify(entry)}).handler;\n`);
  }
  fs.writeFileSync(path.join(publicDir, "index.html"), "<!doctype html><meta charset=utf-8><meta name=robots content=noindex><title>Blank private staging</title><p>Blank private staging</p>\n");
  fs.writeFileSync(path.join(directory, "netlify.toml"), '[build]\npublish = "public"\nfunctions = "functions"\n[functions]\nnode_bundler = "esbuild"\n');
  const bundles = await bundler.zipFunctions(wrappers, archives, {
    basePath: args.source, config: { "*": { nodeBundler: "esbuild", nodeVersion: "22" } },
  });
  assertEntries(bundles.map((bundle) => bundle.name));
  const archiveFiles = fs.readdirSync(archives);
  if (archiveFiles.some((file) => !file.endsWith(".zip") && file !== "manifest.json")) fail("Unexpected file in staging function archives");
  assertEntries(archiveFiles.filter((file) => file.endsWith(".zip")).map((file) => file.replace(/\.zip$/, "")));
  const inputs = new Map();
  const functions = bundles.map((bundle) => {
    if (bundle.schedule || (bundle.invocationMode === "background" && bundle.name !== "bmb-worker-background") || bundle.routes?.length) fail("Scheduled, background and custom routed functions are forbidden in staging");
    const streaming = ["assistant-app-stream", "assistant-app-voice"].includes(bundle.name);
    if ((bundle.bundler !== "esbuild" && !(streaming && bundle.bundler === "nft")) || path.extname(bundle.path) !== ".zip") fail("Expected an approved ZIP artifact");
    for (const input of bundle.inputs || []) {
      if (inside(wrappers, input)) continue;
      const relative = path.relative(args.source, input).replace(/\\/g, "/");
      if (!inside(args.source, input) || !state.tracked.has(relative)) fail("Bundle includes an untracked or external source dependency");
      inputs.set(relative, sha256(input));
    }
    if (!(bundle.inputs || []).some((input) => path.resolve(input) === path.join(args.source, "netlify", "functions", `${bundle.name}.${["assistant-app-stream", "assistant-app-voice"].includes(bundle.name) ? "mjs" : "js"}`))) {
      fail(`Source handler was not bundled: ${bundle.name}`);
    }
    return { name: bundle.name, path: bundle.path, sha256: sha256(bundle.path), bytes: fs.statSync(bundle.path).size,
      compilation_target: bundle.runtimeVersion, schedule: null };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { directory, archives, publicDir, functions,
    inputs: [...inputs].sort(([a], [b]) => a.localeCompare(b)).map(([file, digest]) => ({ file, sha256: digest })),
    static_sha256: sha256(path.join(publicDir, "index.html")) };
}

function netlifyToken() {
  if (process.env.NETLIFY_AUTH_TOKEN) return process.env.NETLIFY_AUTH_TOKEN;
  const configFile = path.join(process.env.APPDATA || path.join(os.homedir(), ".config"), "netlify", "Config", "config.json");
  if (!fs.existsSync(configFile)) fail("Netlify login unavailable; set NETLIFY_AUTH_TOKEN in the process environment");
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  const user = config.users?.[config.userId] || Object.values(config.users || {})[0];
  if (!user?.auth?.token) fail("Netlify login unavailable");
  return user.auth.token;
}

async function apiGet(resource, token, fetcher = fetch) {
  const response = await fetcher(`https://api.netlify.com/api/v1${resource}`, {
    headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) fail(`Netlify read-only preflight failed (${response.status})`);
  return response.json();
}

function preservingManifest(report, current, files) {
  assertEntries(current.map(fn => fn.n || fn.name));
  const config=Object.fromEntries(current.map(fn => [fn.n || fn.name, {
    build_data:fn.bd || null, priority:fn.p || 0,
    ...(fn.dn ? {display_name:fn.dn} : {}), ...(fn.g ? {generator:fn.g} : {}),
  }]));
  for(const name of ["assistant-app-stream","assistant-app-voice"])
    if(config[name]?.build_data?.runtimeAPIVersion !== 2) fail("Existing streaming runtime metadata must be API v2");
  return {draft:true,files:Object.fromEntries(files.map(file => [file.path.replace(/^\//,""),file.sha])),
    functions:Object.fromEntries(report.functions.map(fn => [fn.name,fn.sha256])),functions_config:config,
    function_schedules:[],title:"Blankmind schedule recovery " + report.source_commit.slice(0,12)};
}

async function deployPreservingRuntime(report, packaged, current, site, token, fetcher, save) {
  const request=async(resource,method,body,type="application/json")=>{
    const response=await fetcher(`https://api.netlify.com/api/v1${resource}`,{method,
      headers:{authorization:`Bearer ${token}`,"content-type":type},body:type==="application/json"?JSON.stringify(body):body,
      signal:AbortSignal.timeout(30000)});
    if(!response.ok)fail(`Preserving deployment request failed (${response.status})`);
    return response.json();
  };
  const files=await apiGet(`/deploys/${site.published_deploy.id}/files`,token,fetcher);
  const manifest=preservingManifest(report,current,files);
  const deployment=await request(`/sites/${SITE_ID}/deploys`,"POST",manifest);
  report.deploy_id=deployment.id;report.previous_deploy_id=site.published_deploy.id;report.status="draft_uploading";save();
  for(const fn of report.functions) {
    // Always upload: a cached ZIP can have been registered as buffered even
    // though its bytes contain the API v2 streaming bootstrap.
    const existing=current.find(item => (item.n || item.name)===fn.name);
    const runtime=existing.r || existing.runtime;
    if(runtime!==fn.compilation_target)fail("Function compilation target differs from existing runtime");
    const invocation=existing.bd?.runtimeAPIVersion===2?"stream":fn.name.endsWith("-background")?"background":"buffer";
    await request(`/deploys/${deployment.id}/functions/${encodeURIComponent(fn.name)}?runtime=${encodeURIComponent(runtime)}&invocation_mode=${invocation}`,
      "PUT",fs.readFileSync(fn.path),"application/octet-stream");
  }
  for(const file of files) {
    if(!(deployment.required || []).includes(file.sha))continue;
    const artifact=path.join(packaged.publicDir,file.path.replace(/^\//,""));
    if(!inside(packaged.publicDir,artifact)||!fs.existsSync(artifact)
      ||crypto.createHash("sha1").update(fs.readFileSync(artifact)).digest("hex")!==file.sha)fail("Preserved static artifact unavailable");
    await request(`/deploys/${deployment.id}/files/${file.path.replace(/^\//,"")}`,"PUT",fs.readFileSync(artifact),"application/octet-stream");
  }
  let ready=false;
  for(let attempt=0;attempt<30;attempt++) {
    const draft=await apiGet(`/deploys/${deployment.id}`,token,fetcher);
    if(draft.state==="ready"){ready=true;break;}
    if(draft.state==="error")fail("Preserving draft failed");
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(!ready)fail("Preserving draft not ready");
  // Exercise the Lambda transport before publishing. No JWT means no account
  // lookup or model call; a valid stream carries the expected auth rejection.
  const headers=require("./assistant_app_cloud_test").protectionHeaders(process.env.BM_CLOUD_TEST_EXTRA_HEADERS_JSON);
  const origin=deployment.deploy_ssl_url;
  if(!origin || new URL(origin).hostname!==`${deployment.id}--blank-product-staging-20260926.netlify.app`)fail("Private draft URL mismatch");
  const probe=await fetcher(`${origin}/.netlify/functions/assistant-app-stream`,{method:"POST",
    headers:{"content-type":"application/json",...headers},body:JSON.stringify({action:"send",turn_id:"runtime-preflight"}),
    signal:AbortSignal.timeout(15000)});
  if(probe.status!==200 || !probe.headers.get("content-type")?.startsWith("application/x-ndjson"))fail("Draft streaming transport failed before publication");
  const frames=(await probe.text()).trim().split("\n").map(line=>JSON.parse(line));
  if(!frames.some(frame=>frame.type==="result"&&frame.status===401&&frame.body?.error==="authentication_required"))fail("Draft streaming authentication probe failed");
  report.streaming_preflight={status:200,authentication_status:401,model_calls:0};save();
  const before=await apiGet(`/sites/${SITE_ID}`,token,fetcher);
  if(before.published_deploy.id!==site.published_deploy.id)fail("Existing QA deploy changed before publication");
  report.status="publication_requested";save();
  await request(`/sites/${SITE_ID}/deploys/${deployment.id}/restore`,"POST",{});
  return deployment;
}

function productionValue(variable) {
  if (!variable?.scopes?.includes("functions")) return "";
  return variable.values?.find((value) => value.context === "production")?.value
    ?? variable.values?.find((value) => value.context === "all")?.value ?? "";
}

function validateEnvironment(variables, { preserveExistingExperiments = false } = {}) {
  const byName = new Map(variables.map((variable) => [variable.key, variable]));
  if (String(productionValue(byName.get("SUPABASE_URL"))).replace(/\/$/, "") !== `https://${SUPABASE_REF}.supabase.co`) fail("Staging must use its isolated Supabase URL");
  const serviceKey = productionValue(byName.get("SUPABASE_SERVICE_ROLE_KEY"));
  let claims;
  try { claims = JSON.parse(Buffer.from(String(serviceKey).split(".")[1], "base64url").toString("utf8")); } catch (_) { /* Fail closed below. */ }
  if (!serviceKey || (claims && (claims.ref !== SUPABASE_REF || claims.role !== "service_role"))) fail("Staging service-key identity is missing or points outside staging");
  if (!claims && !byName.get("SUPABASE_SERVICE_ROLE_KEY")?.is_secret) fail("Unverifiable unprotected staging service key");
  if (variables.some((variable) => /^(?:TWILIO_|WHATSAPP_)/.test(variable.key) && productionValue(variable))) fail("Transport credentials are forbidden in private API staging");
  // Full iPhone QA already uses APNs. Preserve its existing configuration;
  // staging publication does not create or write credentials.
  if (variables.some(variable => /^APNS_/.test(variable.key) && productionValue(variable))
      && (!byName.get("APNS_AUTH_KEY")?.is_secret
        || productionValue(byName.get("APNS_TOPIC")) !== "com.blanknfc.app.ios"
        || !/^[A-Z0-9]{10}$/.test(productionValue(byName.get("APNS_KEY_ID")))
        || !/^[A-Z0-9]{10}$/.test(productionValue(byName.get("APNS_TEAM_ID"))))) fail("Transport APNs configuration must match the existing iPhone app and protected key");
  if (/^(?:true|1|yes|on)$/i.test(productionValue(byName.get("BM_FINAL_APP_LINKED_ROUTING_ENABLED")))) fail("Public linked routing must remain disabled in staging");
  const experiments=variables.filter(variable => /RETRIEVAL|JEV|DECISIONS/.test(variable.key));
  if (!preserveExistingExperiments && experiments.some(variable => /^(?:true|1|yes|on)$/i.test(productionValue(variable)))) fail("Retrieval acceleration must remain disabled in private QA");
  // The provider masks secret values. Host isolation is verified here; actual
  // hidden key validity is established by the authenticated cloud smoke.
  return { database_host_verified: true, service_key_ref_visible_and_verified: Boolean(claims),
    ...(preserveExistingExperiments ? { experimental_flags_digest: crypto.createHash("sha256").update(JSON.stringify(
      experiments.map(variable => [variable.key, productionValue(variable)]).sort(([a],[b]) => a.localeCompare(b)))).digest("hex") } : {}) };
}

async function requirePrivateSite(fetcher = fetch) {
  for (const suffix of ["/", "/.netlify/functions/assistant-app"]) {
    const response = await fetcher(`${SITE_URL}${suffix}`, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    if (response.status !== 401) fail("Staging is not password-protected for anonymous page and function requests");
    await response.body?.cancel();
  }
}

function deployCommand(args, packaged) {
  assertSite(args.site);
  return [args.cli, "deploy", "--site", SITE_ID, "--prod", "--no-build",
    "--dir", packaged.publicDir, "--functions", packaged.archives, "--skip-functions-cache", "--json"];
}

function productionFunctions(payload) {
  // Netlify currently returns one group object. Older API responses were
  // arrays of groups; accept both, but never infer success from an unknown shape.
  const groups = Array.isArray(payload) ? payload : [payload];
  if (!groups.length || groups.some((group) => !group || typeof group !== "object"
      || !Object.hasOwn(group, "branch") || !Array.isArray(group.functions))) fail("Unknown Netlify function inventory shape");
  const production = groups.filter((group) => group.branch === null);
  if (production.length !== 1) fail("Expected one production function group for private staging");
  const functions = production[0].functions;
  if (functions.some((fn) => !fn || typeof fn !== "object"
      || (fn.n && fn.name && fn.n !== fn.name) || (fn.d && fn.sha && fn.d !== fn.sha))) fail("Invalid Netlify function metadata");
  assertEntries(functions.map((fn) => fn.n || fn.name));
  return functions;
}

function validateReportArtifacts(report) {
  assertSite(report.site_id);
  if (report.site_url !== SITE_URL || report.supabase_ref !== SUPABASE_REF
      || !/^[a-f0-9]{24}$/.test(report.deploy_id || "") || !/^[a-f0-9]{40}$/.test(report.source_commit || "")
      || report.source_tree_clean !== true || !RELEASE_BRANCH.test(report.source_branch || "")
      || !["deployed_unverified", "private_deploy_verified"].includes(report.status)) fail("Invalid deployed staging report identity or source snapshot");
  if (!Array.isArray(report.functions) || typeof report.package_directory !== "string") fail("Missing staging artifact snapshot");
  assertEntries(report.functions.map((fn) => fn?.name));
  for (const fn of report.functions) {
    const expected = path.join(report.package_directory, "functions", `${fn.name}.zip`);
    if (typeof fn.path !== "string" || path.resolve(fn.path) !== path.resolve(expected)
        || !/^[a-f0-9]{64}$/.test(fn.sha256 || "") || fn.schedule
        || !fs.existsSync(fn.path) || sha256(fn.path) !== fn.sha256
        || fs.statSync(fn.path).size !== fn.bytes) fail("Original function artifact is missing or changed");
  }
}

async function verifyDeployment(report, token, fetcher) {
  const site = await apiGet(`/sites/${SITE_ID}`, token, fetcher);
  if (site.id !== SITE_ID || site.ssl_url !== SITE_URL || site.published_deploy?.id !== report.deploy_id) fail("The active staging deploy identity changed during verification");
  report.environment_verification = validateEnvironment(await apiGet(`/accounts/${site.account_id}/env?site_id=${SITE_ID}`, token, fetcher),
    { preserveExistingExperiments: report.preserve_existing_experiments === true });
  if (report.preserve_existing_experiments && report.environment_verification.experimental_flags_digest !== report.environment_preflight?.experimental_flags_digest) fail("Existing experiment flags changed during deployment");
  const deployment = await apiGet(`/deploys/${report.deploy_id}`, token, fetcher);
  if (deployment.site_id !== SITE_ID || deployment.state !== "ready" || deployment.function_schedules?.length) fail("Staging deploy is not ready or contains scheduled functions");
  const remote = productionFunctions(await apiGet(`/sites/${SITE_ID}/functions`, token, fetcher));
  if (remote.some((fn) => fn.schedule || (fn.d || fn.sha) !== report.functions.find((item) => item.name === (fn.n || fn.name))?.sha256)) fail("Remote function digests differ from the ten packaged ZIPs");
  if(report.preserve_existing_experiments && remote.some(fn => (fn.r || fn.runtime)!=="nodejs22.x"
    || (["assistant-app-stream","assistant-app-voice"].includes(fn.n || fn.name) && fn.bd?.runtimeAPIVersion!==2))) fail("Existing streaming runtime metadata was not preserved");
  await requirePrivateSite(fetcher);
  const finalSite = await apiGet(`/sites/${SITE_ID}`, token, fetcher);
  if (finalSite.id !== SITE_ID || finalSite.published_deploy?.id !== report.deploy_id) fail("The active staging deploy changed during verification");
  report.remote_functions = remote.map((fn) => ({ name: fn.n || fn.name, sha256: fn.d || fn.sha, runtime: fn.r || fn.runtime || null }));
  report.remote_function_hashes_verified = true;
  report.verified_at = new Date().toISOString();
  report.status = "private_deploy_verified";
}

async function verifyReport(reportFile, dependencies = {}) {
  const original = fs.readFileSync(reportFile, "utf8");
  const report = JSON.parse(original);
  validateReportArtifacts(report);
  // Preserve the original package/deploy evidence byte-for-byte. A separate
  // receipt binds this read-only attempt to its original report and artifacts.
  const reportPath = `${reportFile.replace(/\.json$/i, "")}.verification-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.json`;
  report.verification_mode = "read-only";
  report.original_report = path.resolve(reportFile);
  report.original_report_sha256 = crypto.createHash("sha256").update(original).digest("hex");
  report.remote_function_hashes_verified = false;
  report.status = "deployed_unverified";
  delete report.remote_functions;
  delete report.verified_at;
  const save = () => fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  try {
    await verifyDeployment(report, dependencies.token || netlifyToken(), dependencies.fetcher || fetch);
    save();
    return { report, reportPath };
  } catch (error) {
    save();
    fail(`${error.message}. Verification report: ${reportPath}`);
  }
}

async function main(args, dependencies = {}) {
  const execute = dependencies.execute || run;
  const fetcher = dependencies.fetcher || fetch;
  assertSite(args.site);
  if (args.verifyReport) {
    if (args.deploy) fail("--verify-report cannot package or deploy");
    return verifyReport(args.verifyReport, dependencies);
  }
  const state = sourceState(args.source, execute);
  if (args.deploy) requireDeployable(state);
  const bundler = dependencies.bundler || await loadBundler(args.cli);
  const packaged = await packageCandidate(args, state, bundler);
  const reportDir = path.join(ROOT, "tmp", "cloud-stage");
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `package-${state.commit.slice(0, 12)}-${Date.now()}.json`);
  const report = { mode: args.deploy ? "deploy" : "dry-run", site_id: SITE_ID, site_url: SITE_URL, supabase_ref: SUPABASE_REF,
    source_commit: state.commit, source_branch: state.branch, source_tree_clean: state.clean,
    deployable: state.clean && RELEASE_BRANCH.test(state.branch), bundler_version: bundler.version,
    functions: packaged.functions, source_inputs: packaged.inputs, static_sha256: packaged.static_sha256,
    package_directory: packaged.directory, deploy_id: null, remote_function_hashes_verified: false, status: "packaged",
    preserve_existing_experiments: args.preserveExistingExperiments === true };
  const save = () => fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  save();
  if (!args.deploy) return { report, reportPath };
  try {
    const token = dependencies.token || netlifyToken();
    const site = await apiGet(`/sites/${SITE_ID}`, token, fetcher);
    if (site.id !== SITE_ID || site.ssl_url !== SITE_URL) fail("Staging site identity does not match the reserved environment");
    await requirePrivateSite(fetcher);
    report.environment_preflight = validateEnvironment(await apiGet(`/accounts/${site.account_id}/env?site_id=${SITE_ID}`, token, fetcher),
      { preserveExistingExperiments: args.preserveExistingExperiments === true });
    const existingFunctions=productionFunctions(await apiGet(`/sites/${SITE_ID}/functions`, token, fetcher));
    const current = sourceState(args.source, execute);
    requireDeployable(current);
    if (current.commit !== state.commit || packaged.inputs.some((input) => sha256(path.join(args.source, input.file)) !== input.sha256)) fail("Source changed after packaging");
    if (packaged.functions.some((fn) => sha256(fn.path) !== fn.sha256)) fail("Function artifact changed after packaging");
    report.status = "deploy_requested";
    save();
    let deployed;
    if(args.preserveExistingExperiments)deployed=await deployPreservingRuntime(report,packaged,existingFunctions,site,token,fetcher,save);
    else {
    const output = execute(process.execPath, deployCommand(args, packaged), packaged.directory, {
      env: { ...process.env, NETLIFY_AUTH_TOKEN: token },
    });
    try { deployed = JSON.parse(output); } catch (_) { fail("CLI did not return a valid deploy receipt"); }
    }
    if(deployed.id&&!deployed.deploy_id)deployed={...deployed,deploy_id:deployed.id};
    if (deployed.site_id !== SITE_ID || !/^[a-f0-9]{24}$/.test(deployed.deploy_id || "")) fail("CLI returned an unexpected staging deploy identity");
    report.deploy_id = deployed.deploy_id;
    report.status = "deployed_unverified";
    save();
    await verifyDeployment(report, token, fetcher);
    save();
    return { report, reportPath };
  } catch (error) {
    report.status = report.deploy_id ? "deployed_unverified" : report.status === "deploy_requested" ? "deploy_outcome_unknown" : "preflight_failed";
    save();
    fail(`${error.message}. Report: ${reportPath}`);
  }
}

if (require.main === module) {
  (async () => {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) { console.log("node tools/backend_staging.js [--dry-run | --deploy] [--source <worktree-root>] [--netlify-cli <run.js>] OR --verify-report <package-report.json>"); return; }
    const { report, reportPath } = await main(args);
    console.log(JSON.stringify({ status: report.status, mode: report.mode, source_commit: report.source_commit,
      source_tree_clean: report.source_tree_clean, deployable: report.deployable, site_id: SITE_ID,
      functions: report.functions.map(({ name, sha256: digest }) => ({ name, sha256: digest })),
      deploy_id: report.deploy_id, remote_function_hashes_verified: report.remote_function_hashes_verified, report: reportPath }, null, 2));
  })().catch((error) => { console.error(`backend_staging: ${error.message}`); process.exitCode = 1; });
}
module.exports = { SITE_ID, SITE_URL, SUPABASE_REF, ENTRIES, parseArgs, assertSite, assertEntries, requireDeployable,
  validateEnvironment, requirePrivateSite, deployCommand, packageCandidate, productionFunctions, preservingManifest, verifyReport, main };
