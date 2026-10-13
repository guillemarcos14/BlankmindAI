"use strict";
// Offline only. Bind original production preservation to the clean unified package.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");
const ROOT = path.resolve(__dirname, "..");
const APP = Object.freeze(["account-data", "app-auth", "assistant-app", "assistant-app-stream", "assistant-app-voice", "assistant-channel", "bmb-tick", "bmb-worker-background"]);
const digest = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function json(file) { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
function git(args) {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, "git_preflight_failed"); return r.stdout.trim();
}
function staticFiles(file) {
  const b = fs.readFileSync(file), files = new Map(); let end = b.length - 22;
  while (end >= Math.max(0, b.length - 65558) && b.readUInt32LE(end) !== 0x06054b50) end--;
  assert(end >= 0, "invalid_static_zip"); let p = b.readUInt32LE(end + 16);
  for (let i = 0; i < b.readUInt16LE(end + 10); i++) {
    assert.equal(b.readUInt32LE(p), 0x02014b50);
    const length = b.readUInt16LE(p + 28), name = b.subarray(p + 46, p + 46 + length).toString();
    assert(!name.includes("..") && !path.isAbsolute(name) && !files.has(name), "unsafe_static_path");
    const off = b.readUInt32LE(p + 42), start = off + 30 + b.readUInt16LE(off + 26) + b.readUInt16LE(off + 28);
    const raw = b.subarray(start, start + b.readUInt32LE(p + 20)), method = b.readUInt16LE(p + 10);
    assert([0, 8].includes(method));
    if (!name.endsWith("/")) files.set(name, method === 8 ? zlib.inflateRawSync(raw) : raw);
    p += 46 + length + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
  }
  return files;
}
function main() {
  assert.equal(process.argv.length, 4, "Use package-report.json preservation-worktree-root");
  const packagePath = path.resolve(process.argv[2]), preservationRoot = path.resolve(process.argv[3]);
  const bundle = path.join(preservationRoot, "tmp/elevenlabs-recovery/bundle");
  const packaged = json(packagePath), old = json(path.join(bundle, "evidence/production-preserving-manifest.json"));
  const legacy = json(path.join(bundle, "evidence/legacy-runtime-validation.json"));
  assert.equal(git(["status", "--porcelain"]), "", "source_dirty");
  assert(/^codex\/backend-release-/.test(git(["branch", "--show-current"])));
  assert.equal(git(["diff", packaged.source_commit, "HEAD", "--", "netlify/functions", "supabase/migrations", "ios"]), "", "package_runtime_not_current_candidate");
  assert.equal(packaged.source_tree_clean, true);
  assert.equal(packaged.site_id, "2ef5a74e-af70-4893-a5f6-63fb2537720d");
  assert(legacy.pass && legacy.real_messages === 0 && legacy.paid_calls === 0);
  assert.equal(old.published_deploy, "6abe94a92bf201769389c075");
  const body = structuredClone(old.body), selected = packaged.functions.filter(f => APP.includes(f.name));
  assert.equal(selected.length, APP.length);
  const artifacts = Object.fromEntries(Object.entries(old.artifacts).map(([sha, file]) => [sha, path.resolve(preservationRoot, file)]));
  const changes = [];
  // The preservation body already contains the earlier candidate replacements.
  // Reconstruct the actual published baseline from its explicit change log.
  const expectedProduction = { ...old.body.functions };
  for (const change of old.changes) {
    if (change.before) expectedProduction[change.name] = change.before;
    else delete expectedProduction[change.name];
  }
  assert.equal(Object.keys(expectedProduction).length, 73, "published_baseline_incomplete");
  for (const fn of selected) {
    assert.equal(digest(fn.path), fn.sha256, "candidate_archive_changed");
    assert.equal(fn.compilation_target, "nodejs22.x", "uncertified_runtime");
    if (["assistant-app-stream", "assistant-app-voice"].includes(fn.name)) {
      assert.equal(fn.runtime_api_version, 2, "stream_api_version_missing");
      assert.equal(fn.invocation_mode, "stream", "stream_invocation_mode_missing");
    }
    changes.push({ name: fn.name, before: expectedProduction[fn.name] || null, after: fn.sha256 });
    body.functions[fn.name] = fn.sha256;
    artifacts[fn.sha256] = path.resolve(fn.path);
    if (!body.functions_config[fn.name]) body.functions_config[fn.name] = {
      build_data: { runtimeAPIVersion: ["assistant-app-stream", "assistant-app-voice"].includes(fn.name) ? 2 : 1 }, priority: 10 };
    body.functions_config[fn.name].build_data = { ...(body.functions_config[fn.name].build_data || {}),
      ...(fn.runtime_api_version !== undefined ? {runtimeAPIVersion:fn.runtime_api_version} : {}),
      ...(fn.bootstrap_version !== undefined ? {bootstrapVersion:fn.bootstrap_version} : {}) };
  }
  body.title = "Unified Decisions / ElevenLabs / native App Store candidate";
  // Preserve production schedules exactly. New proactive work needs separate evidence/budget.
  assert.equal(body.function_schedules.length, 0);
  const needed = new Set(Object.values(body.functions));
  for (const sha of needed) assert(artifacts[sha] && digest(artifacts[sha]) === sha, "missing_or_changed_preservation_archive");
  const originalFiles = Object.keys(old.body.functions).filter(name => !APP.includes(name));
  for (const name of originalFiles) assert.equal(body.functions[name], old.body.functions[name], "unrelated_endpoint_changed");
  assert.deepEqual(body.files, old.body.files); assert.deepEqual(body.function_schedules, old.body.function_schedules);
  const destination = path.join(ROOT, "tmp/appstore-final/production-bundle");
  fs.mkdirSync(path.join(destination, "functions"), { recursive: true });
  const stable = {};
  for (const sha of needed) {
    const file = path.join(destination, "functions", sha + ".zip");
    fs.copyFileSync(artifacts[sha], file); assert.equal(digest(file), sha); stable[sha] = file;
  }
  const sourceBundle = json(path.join(bundle, "manifest.json"));
  const staticArchive = path.resolve(preservationRoot, sourceBundle.staticBackup.path);
  assert.equal(digest(staticArchive), sourceBundle.staticBackup.sha256);
  fs.copyFileSync(staticArchive, path.join(destination, "original-static.zip"));
  const statics = staticFiles(staticArchive), staticRoot = path.join(destination, "static");
  assert.equal(statics.size, Object.keys(body.files).length);
  for (const [name, bytes] of statics) {
    assert.equal(crypto.createHash("sha1").update(bytes).digest("hex"), old.body.files[name], "original_static_changed");
    const target = path.resolve(staticRoot, name);
    assert(target.startsWith(staticRoot + path.sep));
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
  }
  const privacy = fs.readFileSync(path.join(ROOT, "web/landing/privacy.html"));
  assert(privacy.toString().includes('url=https://blankmind.ai/privacy'), "legacy_privacy_redirect_missing");
  assert(statics.has("privacy.html"));
  fs.writeFileSync(path.join(staticRoot, "privacy.html"), privacy);
  body.files["privacy.html"] = crypto.createHash("sha1").update(privacy).digest("hex");
  for (const [name, expected] of Object.entries(body.files)) assert.equal(crypto.createHash("sha1").update(fs.readFileSync(path.join(staticRoot, name))).digest("hex"), expected);
  const manifest = { generated_at: new Date().toISOString(), source_commit: packaged.source_commit,
    operator_commit: git(["rev-parse", "HEAD"]), expected_production_functions: expectedProduction,
    source_package_sha256: digest(packagePath), expected_production_deploy: old.published_deploy,
    body, artifacts: stable, changes, total_functions: Object.keys(body.functions).length,
    unrelated_functions_preserved: originalFiles.length, statics: Object.keys(body.files).length,
    original_exact_functions: sourceBundle.preserved.filter(f => body.functions[f.name] === f.sha256).length,
    reconstructed_endpoints: 5, schedules_unchanged: true, ready_to_publish: false, production_mutations: 0,
    static_directory: staticRoot, original_static_files_preserved: statics.size - 1,
    static_changes: [{path:"privacy.html",before:old.body.files["privacy.html"],after:body.files["privacy.html"],reason:"Redirect the old Netlify policy to the updated public policy"}],
    force_upload_app_entries: APP,
    upload_metadata: Object.fromEntries(selected.map(fn => [fn.name,{runtime:fn.compilation_target,invocation_mode:fn.invocation_mode || "buffered"}])),
    rollback: old.rollback, pending: ["signed/distributed exact candidate", "20 physical cases",
      "active model and independent review of combined candidate", "real protected ElevenLabs PCM/timestamps"],
    preservation_evidence_sha256: digest(path.join(bundle, "evidence/legacy-runtime-validation.json")) };
  fs.writeFileSync(path.join(destination, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ source_commit: manifest.source_commit, functions: manifest.total_functions,
    preserved_unrelated: manifest.unrelated_functions_preserved, statics: manifest.statics,
    schedules_unchanged: true, ready_to_publish: false, directory: destination }));
}
if (require.main === module) try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
