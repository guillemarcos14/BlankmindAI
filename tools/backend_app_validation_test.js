"use strict";
const assert = require("node:assert/strict");
const { manifest, previewManifest, ENTRIES } = require("./backend_app_validation");
const site = { id: "59955668-9a9b-4979-a283-63fbf3115fe5", ssl_url: "https://getblank.netlify.app", published_deploy: { id: "old" } };
const snapshot = { site, deploy: { site_id: site.id, id: "old", function_schedules: [{ name: "old-cron", cron: "0 * * * *" }] },
  fns: { functions: [...ENTRIES.filter(n => n !== "assistant-app"), ...Array.from({ length: 42 }, (_, i) => `legacy-${i}`)].map(n => ({ n, d: `old-${n}`, bd: { runtimeAPIVersion: 1 }, p: 10 })) },
  files: Array.from({ length: 6 }, (_, i) => ({ path: `/file-${i}`, sha: `old-file-${i}` })) };
const replacements = Object.fromEntries(ENTRIES.map(n => [n, `new-${n}`]));
const result = manifest(snapshot, replacements);
for (const f of snapshot.fns.functions) assert.equal(result.functions[f.n], replacements[f.n] || f.d);
for (const f of snapshot.files) assert.equal(result.files[f.path.slice(1)], f.sha);
assert.deepEqual(result.function_schedules, snapshot.deploy.function_schedules);
assert.equal(result.draft, true);
const preview = previewManifest({ body: result, functions: ENTRIES.map(name => ({ name, sha256: replacements[name] })) });
assert.deepEqual(Object.keys(preview.functions).sort(), [...ENTRIES].sort());
assert.deepEqual(preview.function_schedules, []);
assert.deepEqual(preview.files, result.files);
assert.deepEqual(Object.keys(preview.functions_config).sort(), [...ENTRIES].sort());
assert.equal(Object.keys(result.functions).length, snapshot.fns.functions.length + 1);
assert.deepEqual(snapshot.fns.functions.find(f => f.n === "app-auth").d, "old-app-auth");
assert.throws(() => manifest(snapshot, { ...replacements, "whatsapp-agent": "changed" }), /allowlist/);
assert.throws(() => manifest({ ...snapshot, site: { ...site, id: "wrong" } }, replacements), /identity/);
assert.throws(() => manifest({ ...snapshot, files: [] }, replacements), /incomplete/);
assert.throws(() => manifest({ ...snapshot, deploy: { ...snapshot.deploy, id: "another" } }, replacements), /identity/);
console.log("PASS app-only manifest preservation, draft publication and scope rejection (no network)");
