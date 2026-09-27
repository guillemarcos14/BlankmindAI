"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const scriptPath = path.join(__dirname, "backend_release.js");
const source = fs.readFileSync(scriptPath, "utf8");

function execute(args, { readinessStatus = 0, readinessMessage = "", branch = "codex/backend-release-test", dirty = "" } = {}) {
  const commands = [];
  const errors = [];
  const sandboxProcess = { argv: ["node", scriptPath, ...args], execPath: "node", platform: "linux", exitCode: 0 };
  const fakeFs = { existsSync: () => true, mkdirSync: () => {}, writeFileSync: () => {} };
  const fakeSpawn = (command, argv) => {
    commands.push({ command, args: argv });
    if (command === "git") {
      const output = argv[0] === "branch" ? branch : argv[0] === "status" ? dirty : argv[0] === "rev-parse" ? "a".repeat(40) : "";
      return { status: 0, stdout: output, stderr: "" };
    }
    if (argv[0] === "tools/bm_release_readiness_gate.js") {
      return { status: readinessStatus, stdout: readinessMessage, stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  vm.runInNewContext(source, {
    __dirname,
    process: sandboxProcess,
    console: { log: () => {}, error: (value) => errors.push(String(value)) },
    require: (name) => {
      if (name === "fs") return fakeFs;
      if (name === "path") return path;
      if (name === "child_process") return { spawnSync: fakeSpawn };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  }, { filename: scriptPath });
  return { commands, errors, exitCode: sandboxProcess.exitCode };
}

const deploy = ["--mode", "deploy", "--confirm", "--supabase", "--netlify"];
const remoteCalls = (result) => result.commands.filter(({ command }) => command === "npx");
const validationCalls = (result) => result.commands.filter(({ args }) => args[0] === "tools/product_harness.js");
const readinessCalls = (result) => result.commands.filter(({ args }) => args[0] === "tools/bm_release_readiness_gate.js");

const missing = execute(deploy);
assert.equal(missing.exitCode, 1);
assert.match(missing.errors.join("\n"), /requires --release-evidence/);
assert.equal(remoteCalls(missing).length, 0);
assert.equal(validationCalls(missing).length, 0, "missing evidence fails before lengthy validation");

for (const failure of ["candidate_commit_not_head", "physical_case_coverage", "evidence_missing"]) {
  const result = execute([...deploy, "--release-evidence", "tmp/bm-release/evidence.json"], { readinessStatus: 1, readinessMessage: failure });
  assert.equal(result.exitCode, 1, failure);
  assert.equal(remoteCalls(result).length, 0, `${failure} must block every remote mutation`);
  assert.equal(validationCalls(result).length, 0, `${failure} must fail before lengthy validation`);
  const call = readinessCalls(result)[0];
  assert.ok(call.args.includes("--head"), "evidence must target the current commit");
  assert.equal(call.args[call.args.indexOf("--evidence") + 1], "tmp/bm-release/evidence.json");
}

const success = execute([...deploy, "--release-evidence", "tmp/bm-release/evidence.json"]);
assert.equal(success.exitCode, 0);
assert.equal(remoteCalls(success).length, 3, "stubbed migration, edge function and Netlify mutations remain behind the gate");
const gateIndex = success.commands.findIndex(({ args }) => args[0] === "tools/bm_release_readiness_gate.js");
const validationIndex = success.commands.findIndex(({ args }) => args[0] === "tools/product_harness.js");
assert.ok(gateIndex >= 0 && gateIndex < validationIndex);
assert.ok(success.commands.every(({ command }, index) => command !== "npx" || index > validationIndex));

const validateOnly = execute(["--mode", "validate"]);
assert.equal(validateOnly.exitCode, 0);
assert.equal(readinessCalls(validateOnly).length, 0, "candidate validation stays usable before physical testing");
assert.equal(validationCalls(validateOnly).length, 1);
assert.equal(remoteCalls(validateOnly).length, 0);

for (const options of [{ branch: "codex/feature-test" }, { dirty: " M netlify/functions/assistant-channel.js\n" }]) {
  const result = execute([...deploy, "--release-evidence", "tmp/bm-release/evidence.json"], options);
  assert.equal(result.exitCode, 1);
  assert.equal(remoteCalls(result).length, 0);
}
const unconfirmed = execute(deploy.filter((arg) => arg !== "--confirm"));
assert.equal(unconfirmed.exitCode, 1);
assert.equal(remoteCalls(unconfirmed).length, 0);
console.log("backend release preflight: exact-candidate physical evidence precedes validation and every remote mutation; no bypass");
