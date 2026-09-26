"use strict";

const { digest, validateExpectation } = require("./bm_semantic_oracle");

function measureConversationCoverage(modelReport) {
  const result = { unique_conversations: 0, unique_turns: 0, runs: 0, turns: 0, failures: [] };
  if (!Array.isArray(modelReport?.runs) || !modelReport.runs.length) {
    result.failures.push({ code: "model_runs_missing", detail: "Complete replay runs are required; summary counters are not evidence." });
    return result;
  }
  const sequences = new Map();
  const counts = { passed: 0, failed: 0, unverified: 0, active_model_turns: 0 };
  for (const [runIndex, run] of modelReport.runs.entries()) {
    result.runs += 1;
    if (!Array.isArray(run?.turns) || !run.turns.length) {
      result.failures.push({ code: "model_run_incomplete", detail: { run: runIndex + 1 } });
      continue;
    }
    const sequence = [];
    for (const [turnIndex, turn] of run.turns.entries()) {
      result.turns += 1;
      const input = typeof turn?.input === "string" ? turn.input.normalize("NFC").replace(/\s+/gu, " ").trim().toLowerCase() : "";
      try {
        if (!input || turn.turn !== turnIndex + 1 || !["passed", "failed", "unverified"].includes(turn.status)) throw new Error("missing_input_order_or_status");
        validateExpectation(turn.expected);
        sequence.push({ input, expected: turn.expected });
      } catch (error) {
        result.failures.push({ code: "model_turn_incomplete", detail: { run: runIndex + 1, turn: turnIndex + 1, reason: error.message } });
      }
      if (["passed", "failed", "unverified"].includes(turn?.status)) counts[turn.status] += 1;
      if (/^openai:/.test(turn?.source || "")) counts.active_model_turns += 1;
    }
    // IDs, channel, mode, repetition and incidental context do not add coverage.
    // A context difference counts only through its observable expected meaning.
    if (sequence.length === run.turns.length) sequences.set(digest(sequence), sequence.length);
  }
  for (const [key, measured] of Object.entries({ conversations: result.runs, turns: result.turns, ...counts })) {
    if (modelReport.summary?.[key] !== measured) result.failures.push({ code: "model_summary_run_count_mismatch", detail: { counter: key, declared: modelReport.summary?.[key] ?? null, measured } });
  }
  result.unique_conversations = sequences.size;
  result.unique_turns = [...sequences.values()].reduce((sum, count) => sum + count, 0);
  return result;
}

module.exports = { measureConversationCoverage };
