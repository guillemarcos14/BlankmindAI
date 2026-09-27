"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { measureConversationCoverage } = require("./bm_conversation_coverage");

const ROOT = path.resolve(__dirname, "..");
const rawArgs = process.argv.slice(2);

function argValue(name, fallback) {
  const index = rawArgs.indexOf(name);
  return index >= 0 && rawArgs[index + 1] ? rawArgs[index + 1] : fallback;
}

function loadJson(relativePath) {
  if (!relativePath) return null;
  const filePath = path.resolve(ROOT, relativePath);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function verifiedFileHash(relativePath, expectedHash) {
  if (!relativePath || !isSha(expectedHash)) return false;
  const filePath = path.resolve(ROOT, relativePath);
  const relative = path.relative(ROOT, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(filePath)) return false;
  return sha256(fs.readFileSync(filePath)) === expectedHash;
}

function isSha(value, length = 64) {
  return new RegExp(`^[a-f0-9]{${length}}$`, "i").test(String(value || ""));
}

function currentCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", windowsHide: true }).trim();
}

const contractPath = argValue("--contract", "tools/bm_release_readiness_contract.json");
const evidencePath = argValue("--evidence", "tmp/bm-release/evidence.json");
const outPath = path.resolve(ROOT, argValue("--out", "tmp/bm-release/readiness.json"));
const contract = loadJson(contractPath);
if (!contract || contract.schema_version !== 1) throw new Error("invalid_release_readiness_contract");

if (rawArgs.includes("--init")) {
  const template = loadJson("tools/datasets/bm_release_evidence_template_v1.json");
  template.candidate.commit = currentCommit();
  const target = path.resolve(ROOT, evidencePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(template, null, 2)}\n`, "utf8");
  console.log(`release evidence template written: ${path.relative(ROOT, target)}`);
  process.exit(0);
}

const evidence = loadJson(evidencePath);
const failures = [];
let conversationCoverage = null;
const physicalCases = Array.isArray(evidence?.physical_cases) ? evidence.physical_cases : [];
function requireCondition(condition, code, detail) {
  if (!condition) failures.push({ code, detail });
}

requireCondition(Boolean(evidence), "evidence_missing", evidencePath);
if (evidence) {
  requireCondition(evidence.schema_version === 1, "evidence_schema", evidence.schema_version);
  const candidate = evidence.candidate || {};
  requireCondition(isSha(candidate.commit, 40), "candidate_commit_missing", candidate.commit);
  if (rawArgs.includes("--head") && isSha(candidate.commit, 40)) {
    requireCondition(candidate.commit === currentCommit(), "candidate_commit_not_head", { expected: currentCommit(), actual: candidate.commit });
  }
  requireCondition(/^[a-f0-9]{24}$/i.test(String(candidate.backend_deploy_id || "")), "backend_deploy_missing", candidate.backend_deploy_id);
  requireCondition(Number.isInteger(candidate.ios_build) && candidate.ios_build > 0, "ios_build_missing", candidate.ios_build);
  requireCondition(Boolean(String(candidate.ios_build_run_id || "").trim()), "ios_build_run_missing", candidate.ios_build_run_id);
  requireCondition(Boolean(String(candidate.ios_artifact_path || "").trim()), "ios_artifact_path_missing", candidate.ios_artifact_path);
  requireCondition(isSha(candidate.ios_artifact_sha256), "ios_artifact_hash_missing", candidate.ios_artifact_sha256);
  requireCondition(verifiedFileHash(candidate.ios_artifact_path, candidate.ios_artifact_sha256), "ios_artifact_hash_mismatch", candidate.ios_artifact_path);

  const integrity = loadJson(evidence.evaluator?.integrity_report);
  requireCondition(Boolean(integrity), "integrity_report_missing", evidence.evaluator?.integrity_report);
  if (integrity) {
    requireCondition(integrity.revision === candidate.commit, "integrity_commit_mismatch", integrity.revision);
    requireCondition(integrity.passed === true, "integrity_gate_failed", integrity.passed);
    requireCondition(integrity.incidents >= contract.minimums.historical_incidents, "historical_incident_coverage", integrity.incidents);
    const rate = integrity.mutations_total ? integrity.mutations_detected / integrity.mutations_total : 0;
    requireCondition(rate >= contract.minimums.historical_mutation_detection_rate, "historical_false_negative_rate", 1 - rate);
  }

  const release = loadJson(evidence.evaluator?.release_report);
  requireCondition(Boolean(release), "automated_release_report_missing", evidence.evaluator?.release_report);
  if (release) {
    requireCondition(release.revision === candidate.commit, "release_commit_mismatch", release.revision);
    requireCondition(release.automated_checks_passed === true, "automated_checks_failed", release.automated_checks_passed);
    requireCondition(release.active_model_checked === true, "active_model_not_checked", release.active_model_checked);
    requireCondition(release.independent_quality_judge_checked === true, "independent_judge_not_checked", release.independent_quality_judge_checked);
  }

  const conversations = evidence.conversation_evidence || {};
  const modelReport = loadJson(evidence.evaluator?.active_model_report);
  const qualityReport = loadJson(evidence.evaluator?.quality_report);
  requireCondition(Boolean(modelReport), "active_model_report_missing", evidence.evaluator?.active_model_report);
  requireCondition(Boolean(qualityReport), "quality_report_missing", evidence.evaluator?.quality_report);
  conversationCoverage = measureConversationCoverage(modelReport);
  failures.push(...conversationCoverage.failures);
  const measuredUniqueConversations = conversationCoverage.unique_conversations;
  const measuredUniqueTurns = conversationCoverage.unique_turns;
  if (modelReport) {
    requireCondition(modelReport.revision === candidate.commit, "model_report_commit_mismatch", modelReport.revision);
    requireCondition(modelReport.source_capture?.version === 1 && modelReport.source_capture?.before_turns === true
      && isSha(modelReport.source_snapshot?.["netlify/functions/bm-contextual-response.js"]), "model_source_capture_missing", modelReport.source_capture);
    requireCondition(modelReport.source_dirty === false, "model_source_not_clean", modelReport.source_dirty);
    requireCondition(modelReport.source_changed_during_replay === false, "model_source_changed_during_replay", modelReport.source_changed_during_replay);
    requireCondition(modelReport.execution?.model_requested === true, "model_not_requested", modelReport.execution?.model_requested);
    requireCondition(modelReport.release_eligible === true, "model_report_not_release_eligible", modelReport.release_eligible);
    requireCondition(modelReport.summary?.failed === 0, "model_hard_failures", modelReport.summary?.failed);
    requireCondition(modelReport.summary?.unverified === 0, "model_unverified", modelReport.summary?.unverified);
    requireCondition(modelReport.summary?.active_model_turns === modelReport.summary?.turns, "model_fallback_detected", modelReport.summary?.active_model_turns);
  }
  if (qualityReport) {
    const declaredModelPath = path.resolve(ROOT, evidence.evaluator?.active_model_report || "");
    const judgedModelPath = qualityReport.source_report ? path.resolve(String(qualityReport.source_report)) : "";
    requireCondition(judgedModelPath === declaredModelPath, "quality_source_mismatch", qualityReport.source_report);
    requireCondition(qualityReport.complete === true, "quality_report_incomplete", qualityReport.complete);
    requireCondition(qualityReport.summary?.release_eligible === true, "quality_report_not_release_eligible", qualityReport.summary?.release_eligible);
    requireCondition(qualityReport.summary?.hard_failures === 0, "quality_hard_failures", qualityReport.summary?.hard_failures);
    requireCondition(qualityReport.summary?.judged === modelReport?.summary?.turns, "quality_coverage", {
      judged: qualityReport.summary?.judged || 0,
      model_turns: modelReport?.summary?.turns || 0,
    });
  }
  requireCondition(Boolean(conversations.dataset_id), "conversation_dataset_missing", conversations.dataset_id);
  requireCondition(isSha(conversations.dataset_sha256), "conversation_dataset_hash_missing", conversations.dataset_sha256);
  requireCondition(conversations.dataset_id === modelReport?.dataset?.id, "conversation_dataset_id_mismatch", conversations.dataset_id);
  requireCondition(conversations.dataset_sha256 === modelReport?.dataset?.sha256, "conversation_dataset_hash_mismatch", conversations.dataset_sha256);
  requireCondition(conversations.unique_conversations === measuredUniqueConversations, "conversation_count_mismatch", { declared: conversations.unique_conversations, measured: measuredUniqueConversations });
  requireCondition(conversations.unique_turns === measuredUniqueTurns, "turn_count_mismatch", { declared: conversations.unique_turns, measured: measuredUniqueTurns });
  requireCondition(measuredUniqueConversations >= contract.minimums.unique_conversations, "conversation_coverage", measuredUniqueConversations);
  requireCondition(conversations.hard_failures === modelReport?.summary?.failed, "conversation_hard_failures_mismatch", conversations.hard_failures);
  requireCondition(conversations.unverified === modelReport?.summary?.unverified, "conversation_unverified_mismatch", conversations.unverified);
  const measuredQualityRate = Number(qualityReport?.summary?.approval_percent || 0) / 100;
  requireCondition(conversations.independent_quality_pass_rate === measuredQualityRate, "conversation_quality_rate_mismatch", { declared: conversations.independent_quality_pass_rate, measured: measuredQualityRate });
  requireCondition(measuredQualityRate >= 0.95, "conversation_quality_rate", measuredQualityRate);

  requireCondition(physicalCases.length >= contract.minimums.physical_cases, "physical_case_coverage", physicalCases.length);
  const ids = new Set();
  const groupCounts = {};
  for (const item of physicalCases) {
    requireCondition(Boolean(item.id) && !ids.has(item.id), "physical_case_id", item.id);
    ids.add(item.id);
    groupCounts[item.group] = (groupCounts[item.group] || 0) + 1;
    requireCondition(item.result === "passed", "physical_case_failed", item.id);
    requireCondition(item.candidate_commit === candidate.commit, "physical_commit_mismatch", item.id);
    requireCondition(item.backend_deploy_id === candidate.backend_deploy_id, "physical_deploy_mismatch", item.id);
    requireCondition(item.ios_build === candidate.ios_build, "physical_build_mismatch", item.id);
    requireCondition(Boolean(String(item.trace_id || "").trim()), "physical_trace_missing", item.id);
    requireCondition(Boolean(String(item.observed_device_state || "").trim()), "physical_device_state_missing", item.id);
    requireCondition(Boolean(String(item.evidence_path || "").trim()), "physical_evidence_path_missing", item.id);
    requireCondition(isSha(item.evidence_sha256), "physical_evidence_hash_missing", item.id);
    requireCondition(verifiedFileHash(item.evidence_path, item.evidence_sha256), "physical_evidence_hash_mismatch", item.id);
  }
  for (const [group, minimum] of Object.entries(contract.minimums.physical_groups)) {
    requireCondition((groupCounts[group] || 0) >= minimum, "physical_group_coverage", { group, actual: groupCounts[group] || 0, minimum });
  }
}

const report = {
  gate: "bm-release-readiness-v1",
  generated_at: new Date().toISOString(),
  contract_sha256: sha256(JSON.stringify(contract)),
  evidence_path: evidencePath,
  ready: failures.length === 0,
  coverage: {
    conversation_count_kind: "normalized_input_and_expected_trajectories",
    unique_conversations: conversationCoverage?.unique_conversations ?? 0,
    unique_turns: conversationCoverage?.unique_turns ?? 0,
    semantic_diversity_requires_independent_audit: true,
    physical_cases_passed: physicalCases.filter((item) => item?.result === "passed").length,
    physical_cases_total: physicalCases.length,
    physical_cases_required: contract.minimums.physical_cases,
  },
  failures,
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`bm_release_readiness ${report.ready ? "passed" : "blocked"}: ${failures.length} blocking conditions`);
for (const failure of failures.slice(0, 12)) console.log(`- ${failure.code}: ${JSON.stringify(failure.detail)}`);
console.log(`report: ${path.relative(ROOT, outPath)}`);
if (!report.ready) process.exitCode = 1;
