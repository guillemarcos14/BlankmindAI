"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DIR = path.join(ROOT, "tmp", "bm-release", "gate-test");
fs.mkdirSync(DIR, { recursive: true });

function write(name, value) {
  const filePath = path.join(DIR, name);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function writeEvidence(name, content) {
  const filePath = path.join(DIR, name);
  fs.writeFileSync(filePath, content, "utf8");
  return {
    path: path.relative(ROOT, filePath).replace(/\\/g, "/"),
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
  };
}

function run(evidence) {
  return spawnSync(process.execPath, [
    "tools/bm_release_readiness_gate.js",
    "--evidence", evidence,
    "--out", "tmp/bm-release/gate-test/result.json",
    "--head",
  ], { cwd: ROOT, encoding: "utf8", windowsHide: true });
}

const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true }).trim();
const integrityPath = write("integrity.json", { revision: commit, passed: true, incidents: 6, mutations_detected: 24, mutations_total: 24 });
const releasePath = write("release.json", { revision: commit, automated_checks_passed: true, active_model_checked: true, independent_quality_judge_checked: true });
const expectedState = {
  intent: "block", apps: ["selected_apps"], app_category: null, moment: null,
  action_type: "strict_block", hard_mode: null, requested_capability: null,
  start: { type: "now" }, end: null, duration_minutes: null, recurrence: null,
  schedule_horizon_days: null, confirmation: "confirmed", pending_slots: ["end_or_duration", "recurrence"],
  status: "collecting", next_question: "end_or_duration",
};
const runs = Array.from({ length: 200 }, (_, index) => ({
  id: `fixture-${index}`, channel: "ios", mode: "bm_final", repetition: 1, status: "passed",
  turns: [
    { turn: 1, input: "Block my selected distractions now.", status: "passed", source: "openai:test_fixture",
      expected: { state: structuredClone(expectedState), decision: { type: "ask", slot: "end_or_duration" }, actions: [], language: "en" } },
    { turn: 2, input: `For ${index + 1} minutes, just once.`, status: "passed", source: "openai:test_fixture",
      expected: { state: { ...structuredClone(expectedState), duration_minutes: index + 1, recurrence: { type: "once", weekdays: [] }, pending_slots: [], status: "ready", next_question: null },
        decision: { type: "ready", slot: null }, actions: [{ type: "start_protection", minutes: index + 1, hard_mode: false }], language: "en" } },
  ],
}));
const model = {
  revision: commit,
  source_dirty: false, source_changed_during_replay: false,
  source_capture: { version: 1, before_turns: true },
  source_snapshot: { "netlify/functions/bm-contextual-response.js": "e".repeat(64) },
  dataset: { id: "fresh-release-holdout", sha256: "d".repeat(64) },
  execution: { model_requested: true, repeats: 1 },
  release_eligible: true,
  summary: { conversations: 200, turns: 400, active_model_turns: 400, passed: 400, failed: 0, unverified: 0 },
  runs,
};
const modelPath = write("active-model.json", model);
const qualityPath = write("quality.json", {
  source_report: path.resolve(ROOT, modelPath),
  complete: true,
  summary: { judged: 400, excellent: 388, acceptable: 0, poor: 12, hard_failures: 0, approval_percent: 97, release_eligible: true },
});
const groups = {
  immediate_block: 4,
  schedule: 4,
  daily_limit: 3,
  app_state: 3,
  permissions_selection: 3,
  robustness: 3,
};
const physicalCases = [];
for (const [group, count] of Object.entries(groups)) {
  for (let index = 0; index < count; index += 1) {
    const physicalEvidence = writeEvidence(`${group}-${index + 1}.txt`, `verified ${group} ${index + 1}`);
    physicalCases.push({
      id: `${group}-${index + 1}`,
      group,
      result: "passed",
      candidate_commit: commit,
      backend_deploy_id: "a".repeat(24),
      ios_build: 73,
      trace_id: `trace-${group}-${index + 1}`,
      observed_device_state: "verified expected native state",
      evidence_path: physicalEvidence.path,
      evidence_sha256: physicalEvidence.sha256,
    });
  }
}
const artifact = writeEvidence("Blank-1.9-73.ipa", "signed-ios-artifact-fixture");
const valid = {
  schema_version: 1,
  candidate: {
    commit,
    backend_deploy_id: "a".repeat(24),
    ios_marketing_version: "1.9",
    ios_build: 73,
    ios_build_run_id: "35092552341",
    ios_artifact_path: artifact.path,
    ios_artifact_sha256: artifact.sha256,
  },
  evaluator: { integrity_report: integrityPath, release_report: releasePath, active_model_report: modelPath, quality_report: qualityPath },
  conversation_evidence: {
    dataset_id: "fresh-release-holdout",
    dataset_sha256: "d".repeat(64),
    unique_conversations: 200,
    unique_turns: 400,
    hard_failures: 0,
    unverified: 0,
    independent_quality_pass_rate: 0.97,
  },
  physical_cases: physicalCases,
};

const validPath = write("valid.json", valid);
const success = run(validPath);
assert.strictEqual(success.status, 0, `${success.stdout}\n${success.stderr}`);

const failedPhysical = JSON.parse(JSON.stringify(valid));
failedPhysical.physical_cases[0].result = "failed";
const failedPath = write("failed-physical.json", failedPhysical);
const failure = run(failedPath);
assert.notStrictEqual(failure.status, 0, "a failed physical case must block release");
assert.match(failure.stdout, /physical_case_failed/);

const missingEvidence = run("tmp/bm-release/gate-test/does-not-exist.json");
assert.notStrictEqual(missingEvidence.status, 0, "missing evidence must block release");
assert.match(missingEvidence.stdout, /evidence_missing/);

const inflatedCoverage = JSON.parse(JSON.stringify(valid));
inflatedCoverage.conversation_evidence.unique_conversations = 201;
const inflatedPath = write("inflated-coverage.json", inflatedCoverage);
const inflatedFailure = run(inflatedPath);
assert.notStrictEqual(inflatedFailure.status, 0, "declared conversation coverage must match the measured report");
assert.match(inflatedFailure.stdout, /conversation_count_mismatch/);

const inflatedTurns = structuredClone(valid);
inflatedTurns.conversation_evidence.unique_turns = 401;
assert.match(run(write("inflated-turns.json", inflatedTurns)).stdout, /turn_count_mismatch/);

function checkModel(name, modified, expectedCode, conversationEvidence = {}) {
  const reportPath = write(`${name}-model.json`, modified);
  const evidence = structuredClone(valid);
  evidence.evaluator.active_model_report = reportPath;
  evidence.evaluator.quality_report = write(`${name}-quality.json`, {
    source_report: path.resolve(ROOT, reportPath), complete: true,
    summary: { judged: modified.summary.turns, hard_failures: 0, approval_percent: 97, release_eligible: true },
  });
  Object.assign(evidence.conversation_evidence, conversationEvidence);
  const result = run(write(`${name}-evidence.json`, evidence));
  if (expectedCode) {
    assert.notStrictEqual(result.status, 0, `${name} must block release`);
    const report = JSON.parse(fs.readFileSync(path.join(DIR, "result.json"), "utf8"));
    assert.ok(report.failures.some(failure => failure.code === expectedCode), `${name}: expected ${expectedCode}; ${result.stdout}\n${result.stderr}`);
  } else assert.strictEqual(result.status, 0, `${name}: ${result.stdout}\n${result.stderr}`);
  return JSON.parse(fs.readFileSync(path.join(DIR, "result.json"), "utf8"));
}

const duplicatedIDs = structuredClone(model);
checkModel("dirty-replay", { ...structuredClone(model), source_dirty: true }, "model_source_not_clean");
checkModel("source-changed-mid-replay", { ...structuredClone(model), source_changed_during_replay: true }, "model_source_changed_during_replay");
const legacySource = structuredClone(model);
delete legacySource.source_dirty; delete legacySource.source_capture;
checkModel("legacy-source-unknown", legacySource, "model_source_capture_missing");
duplicatedIDs.runs = duplicatedIDs.runs.map((run, index) => ({ ...run, id: `new-id-${index}`, channel: index % 2 ? "sms" : "ios", turns: structuredClone(model.runs[0].turns) }));
const duplicateReport = checkModel("duplicate-scripts-new-ids", duplicatedIDs, "conversation_coverage", { unique_conversations: 1, unique_turns: 2 });
assert.strictEqual(duplicateReport.coverage.unique_conversations, 1);

const repeatedModes = structuredClone(model);
repeatedModes.execution = { model_requested: true, repeats: 2, modes: ["bm_final", "bm_canonical"] };
repeatedModes.runs = [1, 2].flatMap(repetition => repeatedModes.execution.modes.flatMap(mode => model.runs.map(run => ({ ...structuredClone(run), repetition, mode }))));
Object.assign(repeatedModes.summary, { conversations: 800, turns: 1600, active_model_turns: 1600, passed: 1600 });
const repeatedReport = checkModel("repeat-mode-dedup", repeatedModes, null);
assert.strictEqual(repeatedReport.coverage.unique_conversations, 200);
assert.strictEqual(repeatedReport.coverage.unique_turns, 400);
checkModel("repeat-mode-inflation", repeatedModes, "conversation_count_mismatch", { unique_conversations: 800, unique_turns: 1600 });

const superficialContext = structuredClone(duplicatedIDs);
superficialContext.runs.forEach((run, index) => {
  run.context = { fixture_number: index };
  run.turns[0].input = index % 2 ? "  BLOCK MY SELECTED   DISTRACTIONS NOW. " : run.turns[0].input;
});
checkModel("input-normalization-context-dedup", superficialContext, "conversation_coverage", { unique_conversations: 1, unique_turns: 2 });

const changedGold = structuredClone(duplicatedIDs);
changedGold.runs[1].turns[1].expected.state.duration_minutes = 99;
changedGold.runs[1].turns[1].expected.actions[0].minutes = 99;
const changedGoldReport = checkModel("changed-expected-meaning", changedGold, "conversation_coverage", { unique_conversations: 2, unique_turns: 4 });
assert.strictEqual(changedGoldReport.coverage.unique_conversations, 2, "changed gold remains a distinct textual/expected trajectory; its correctness needs semantic review");

const missingRuns = structuredClone(model);
delete missingRuns.runs;
checkModel("summary-only", missingRuns, "model_runs_missing");
const incompleteRun = structuredClone(model);
delete incompleteRun.runs[0].turns[0].expected;
checkModel("incomplete-run", incompleteRun, "model_turn_incomplete");
const truncatedRuns = structuredClone(model);
truncatedRuns.runs.pop();
checkModel("truncated-runs", truncatedRuns, "model_summary_run_count_mismatch");

console.log("bm_release_readiness_gate_test passed: complete distinct fixtures accepted; IDs, channel, mode, repeat and summary inflation rejected; semantic diversity remains a separate audit");
