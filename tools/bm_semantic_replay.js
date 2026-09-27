"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { DIMENSIONS, digest, evaluateTurn, validateExpectation, projectActions, visibleSurfaces } = require("./bm_semantic_oracle");

const ROOT = path.resolve(__dirname, "..");
const MODES = ["direct_model", "bm_full", "bm_raw", "bm_canonical", "bm_final"];
const SOURCE_ROOTS = ["netlify/functions", "tools"];
function captureSource({ root = ROOT, git = args => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }) } = {}) {
  const snapshot = {};
  function visit(relative) {
    const absolute = path.join(root, relative);
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = `${relative}/${entry.name}`;
      if (entry.isDirectory() && entry.name !== "node_modules") visit(file);
      else if (entry.isFile() && /\.(?:js|json)$/.test(entry.name)) snapshot[file] = digest(fs.readFileSync(path.join(root, file), "utf8"));
    }
  }
  const capturedAt = new Date().toISOString();
  let revision = "unavailable", dirty = null;
  try {
    revision = git(["rev-parse", "HEAD"]).trim();
    dirty = git(["status", "--porcelain=v1", "--untracked-files=all"]).trim().length > 0;
  } catch { /* Unknown provenance cannot qualify as clean release evidence. */ }
  for (const relative of SOURCE_ROOTS) visit(relative);
  for (const file of ["package.json", "package-lock.json"]) if (fs.existsSync(path.join(root, file))) snapshot[file] = digest(fs.readFileSync(path.join(root, file), "utf8"));
  return { revision, dirty, snapshot, capture: { version: 1, captured_at: capturedAt, roots: [...SOURCE_ROOTS], before_turns: true } };
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
function option(args, key, fallback) {
  const at = args.indexOf(key);
  return at < 0 ? fallback : args[at + 1];
}
function positiveInteger(value, name, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) throw new Error(`invalid_${name}:1..${max}`);
  return number;
}
function validateDataset(dataset) {
  if (dataset.version !== 1 || !dataset.id || !["development", "holdout", "anonymized"].includes(dataset.split)) throw new Error("invalid_dataset_metadata");
  if (!Array.isArray(dataset.conversations) || !dataset.conversations.length) throw new Error("empty_dataset");
  const ids = new Set();
  for (const conversation of dataset.conversations) {
    if (!conversation.id || ids.has(conversation.id)) throw new Error(`duplicate_or_missing_conversation:${conversation.id}`);
    ids.add(conversation.id);
    if (!["whatsapp", "sms", "web", "ios", "android"].includes(conversation.channel)) throw new Error(`invalid_channel:${conversation.id}`);
    if (!Array.isArray(conversation.turns) || !conversation.turns.length) throw new Error(`empty_conversation:${conversation.id}`);
    for (const turn of conversation.turns) {
      if (!turn.input || typeof turn.input !== "string") throw new Error(`missing_input:${conversation.id}`);
      validateExpectation(turn.expect);
    }
  }
  return dataset;
}
async function mapConcurrent(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }));
  return results;
}
function createAdapter(options) {
  if (options.adapter) {
    const adapter = require(path.resolve(options.adapter));
    if (typeof adapter.traceTurn !== "function") throw new Error("adapter_requires_traceTurn");
    return adapter.traceTurn;
  }
  if (options.url) {
    const endpoint = new URL(options.url);
    if (/whatsapp-agent|sms-agent|assistant-channel/i.test(endpoint.pathname)) throw new Error("replay_requires_planner_endpoint_not_message_transport");
    return async ({ prompt, context, mode }) => {
      if (mode !== "bm_final") throw new Error("remote_differential_requires_explicit_trace_adapter");
      const headers = { "content-type": "application/json" };
      if (options.tokenEnv && process.env[options.tokenEnv]) headers.authorization = `Bearer ${process.env[options.tokenEnv]}`;
      const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ prompt, context }), signal: AbortSignal.timeout(options.timeoutMs) });
      const text = await response.text();
      if (!response.ok) throw new Error(`endpoint_${response.status}:${text.slice(0, 240)}`);
      const body = JSON.parse(text);
      if (!body.ok || !body.plan) throw new Error("endpoint_invalid_plan_response");
      return body;
    };
  }
  if (!options.model) process.env.OPENAI_API_KEY = "";
  if (options.model && !process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY_required_for_model_replay");
  const agent = require("../netlify/functions/blanked-agent");
  return async request => {
    if (agent._evaluation?.traceTurn) return agent._evaluation.traceTurn(request);
    if (request.mode !== "bm_final") throw new Error("evaluation_trace_adapter_not_available");
    const response = await agent.handler({ httpMethod: "POST", body: JSON.stringify({ prompt: request.prompt, context: request.context }) });
    if (response.statusCode !== 200) throw new Error(`local_${response.statusCode}:${response.body.slice(0, 240)}`);
    return JSON.parse(response.body);
  };
}
function traceDiffs(trace = {}) {
  const stageKeys = ["raw_plan", "action_gate", "normalized_plan", "final_plan"];
  const result = [];
  let previous = null;
  for (const stage of stageKeys) {
    const candidate = trace[stage];
    const plan = Array.isArray(candidate) ? { actions: candidate } : candidate?.plan || candidate;
    if (!plan || typeof plan !== "object" || (!plan.actions && !plan.message_text && !plan.response_text)) continue;
    const projection = { intent: plan.intent ?? previous?.projection.intent, actions: projectActions(plan.actions), visible: Array.isArray(candidate) ? previous?.projection.visible : visibleSurfaces(plan) };
    if (previous && digest(previous.projection) !== digest(projection)) result.push({ from: previous.stage, to: stage, before: previous.projection, after: projection, same_model_response: true });
    previous = { stage, projection };
  }
  return result;
}
async function runConversation(conversation, repetition, mode, adapter, reviews) {
  const history = [];
  const inputs = [];
  const turns = [];
  let state = null;
  let pendingBlocking = null;
  let cumulativeContext = { ...(conversation.context || {}), channel: conversation.channel, assistant_channel: conversation.channel };
  const startedAt = new Date().toISOString();
  for (const [index, turn] of conversation.turns.entries()) {
    cumulativeContext = { ...cumulativeContext, ...(turn.context || {}) };
    const context = { ...cumulativeContext, recent_messages: mode === "direct_model" ? [...history] : history.slice(-8) };
    if (context.app_presence?.last_seen_at === "__REPLAY_NOW__") context.app_presence = { ...context.app_presence, last_seen_at: startedAt };
    if (state) context.semantic_state = state;
    if (pendingBlocking) context.pending_blocking = pendingBlocking;
    inputs.push(turn.input);
    const started = Date.now();
    try {
      const body = await adapter({ prompt: turn.input, context, mode });
      const evaluation = evaluateTurn({ expected: turn.expect, body, inputs, context, previousState: state, reviews, mode });
      const nextState = body.semantic_state || body.plan?.semantic_state || null;
      const visible = body.plan?.message_text || body.plan?.response_text || "";
      const evaluationContext = {
        has_selected_apps: typeof context.has_selected_apps === "boolean" ? context.has_selected_apps : null,
        selected_app_names: Array.isArray(context.selected_app_names) ? context.selected_app_names.slice(0, 20) : null,
        screen_time_authorized: typeof context.screen_time_authorized === "boolean" ? context.screen_time_authorized : null,
        device_execution_ready: typeof context.device_execution_ready === "boolean" ? context.device_execution_ready : null,
      };
      turns.push({ turn: index + 1, input: turn.input, latency_ms: Date.now() - started, source: body.source || null, ...evaluation, state: nextState, trace: body.trace || null, evaluation_context: evaluationContext, layer_changes: traceDiffs(body.trace) });
      state = nextState;
      pendingBlocking = body.plan?.pending_blocking || body.pending_blocking || null;
      history.push({ role: "user", content: turn.input }, { role: "assistant", content: visible });
    } catch (error) {
      turns.push({ turn: index + 1, input: turn.input, latency_ms: Date.now() - started, status: "failed", release_eligible: false,
        dimensions: Object.fromEntries(DIMENSIONS.map(key => [key, "unverified"])),
        expected: turn.expect, actual: null, issues: [{ dimension: "infrastructure", code: "adapter_error", actual: error.message }],
      });
      // Continue remaining turns: report their errors instead of aborting the batch.
      history.push({ role: "user", content: turn.input });
    }
  }
  return { id: conversation.id, channel: conversation.channel, repetition, mode, turns,
    status: turns.some(turn => turn.status === "failed") ? "failed" : turns.some(turn => turn.status === "unverified") ? "unverified" : "passed" };
}
function reportResults(dataset, runs, options, baseline) {
  const flat = runs.flatMap(run => run.turns.map(turn => ({ ...turn, conversation: run.id, channel: run.channel, repetition: run.repetition, mode: run.mode })));
  const dimensions = {};
  for (const dimension of DIMENSIONS) {
    const counts = { passed: 0, failed: 0, unverified: 0 };
    for (const turn of flat) counts[turn.dimensions?.[dimension] || "unverified"] += 1;
    dimensions[dimension] = { ...counts, pass_percent: Number((100 * counts.passed / Math.max(1, flat.length)).toFixed(2)) };
  }
  const clusters = new Map();
  for (const turn of flat) for (const issue of turn.issues || []) {
    const key = `${issue.dimension}:${issue.code}`;
    const entry = clusters.get(key) || { code: key, count: 0, occurrences: [] };
    entry.count += 1;
    entry.occurrences.push({ conversation: turn.conversation, turn: turn.turn, mode: turn.mode, repetition: turn.repetition });
    clusters.set(key, entry);
  }
  const byCase = new Map();
  for (const turn of flat) {
    const key = `${turn.conversation}:${turn.mode}:${turn.turn}`;
    const list = byCase.get(key) || [];
    list.push(turn);
    byCase.set(key, list);
  }
  const variability = [...byCase].map(([key, values]) => ({ key, repetitions: values.length,
    semantic_variants: new Set(values.map(value => digest({ state: value.actual?.state, actions: value.actual?.actions, decision: value.actual?.decision }))).size,
    visible_variants: new Set(values.map(value => digest(value.actual?.visible || null))).size,
    statuses: values.map(value => value.status),
  })).filter(value => value.repetitions > 1);
  const oldTurns = new Map((baseline?.runs || []).flatMap(run => run.turns.map(turn => [`${run.id}:${run.mode}:${run.repetition}:${turn.turn}`, turn])));
  const regressions = flat.filter(turn => {
    const old = oldTurns.get(`${turn.conversation}:${turn.mode}:${turn.repetition}:${turn.turn}`);
    return old && ((old.status === "passed" && turn.status !== "passed") || (old.status !== "failed" && turn.status === "failed"));
  }).map(turn => ({ conversation: turn.conversation, mode: turn.mode, repetition: turn.repetition, turn: turn.turn, issues: turn.issues }));
  return {
    evaluator: "bm-semantic-oracle-v1", generated_at: new Date().toISOString(), revision: options.sourceStart?.revision || "unavailable",
    dataset: { id: dataset.id, split: dataset.split, sha256: digest(dataset), hash_kind: "canonical_json_sha256", provenance: dataset.provenance || null },
    source_snapshot: options.sourceSnapshot || null,
    source_dirty: options.sourceStart?.dirty ?? null,
    source_capture: options.sourceStart?.capture || null,
    source_changed_during_replay: options.sourceChanged ?? null,
    execution: { endpoint: options.url || "local_handler", model_requested: !!options.model, modes: options.modes, repeats: options.repeats, concurrency: options.concurrency },
    release_eligible: options.sourceStart?.dirty === false && options.sourceChanged === false && flat.length > 0 && flat.every(turn => turn.status === "passed"),
    summary: { conversations: runs.length, turns: flat.length, active_model_turns: flat.filter(turn => /^openai:/.test(turn.source || "")).length, source_counts: flat.reduce((counts, turn) => { const key = turn.source || "missing"; counts[key] = (counts[key] || 0) + 1; return counts; }, {}), passed: flat.filter(turn => turn.status === "passed").length, failed: flat.filter(turn => turn.status === "failed").length, unverified: flat.filter(turn => turn.status === "unverified").length, dimensions },
    failures: flat.filter(turn => turn.status !== "passed").map(turn => ({ conversation: turn.conversation, turn: turn.turn, repetition: turn.repetition, mode: turn.mode, status: turn.status, expected: turn.expected, actual: turn.actual, probable_causes: turn.issues })),
    error_clusters: [...clusters.values()].sort((a, b) => b.count - a.count), regressions, variability, runs,
    limitations: ["Natural-language equivalence requires independently reviewed exact response and expectation hashes; lexical checks can reject contradictions but cannot prove meaning.", "Channel fixtures exercise shared backend context contracts; they do not replace transport or native-device execution tests.", "Different live calls vary. Only layer_changes within one trace compare transformations of the same model response.", "Soft measurements are descriptive, never used to average away hard failures."],
  };
}
async function replay(dataset, options, adapter, reviews = [], baseline = null, dependencies = {}) {
  const capture = dependencies.captureSource || captureSource;
  const sourceStart = capture();
  validateDataset(dataset);
  options = { ...options, sourceStart, sourceSnapshot: sourceStart.snapshot };
  if (!adapter) adapter = createAdapter(options);
  const jobs = [];
  for (let repetition = 1; repetition <= options.repeats; repetition++) for (const mode of options.modes) for (const conversation of dataset.conversations) jobs.push({ conversation, repetition, mode });
  const runs = await mapConcurrent(jobs, options.concurrency, job => runConversation(job.conversation, job.repetition, job.mode, adapter, reviews));
  const sourceEnd = capture();
  options.sourceChanged = sourceStart.revision !== sourceEnd.revision || sourceEnd.dirty !== sourceStart.dirty
    || digest(sourceStart.snapshot) !== digest(sourceEnd.snapshot);
  return reportResults(dataset, runs, options, baseline);
}
async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--verbose")) {
    const info = console.info.bind(console);
    console.info = (...values) => { if (values[0] !== "bm_harness") info(...values); };
  }
  if (args.includes("--help")) {
    console.log("node tools/bm_semantic_replay.js --dataset PATH [--model | --url PLANNER_URL] [--differential | --mode bm_final] [--repeats 3] [--concurrency 8] [--reviews PATH] [--baseline REPORT] [--out REPORT] [--adapter MODULE] [--token-env ENV_NAME]");
    return;
  }
  const datasetPath = option(args, "--dataset", path.join(__dirname, "datasets", "bm_semantic_development_v2.json"));
  const options = {
    model: args.includes("--model"), url: option(args, "--url", null), adapter: option(args, "--adapter", null),
    tokenEnv: option(args, "--token-env", null), timeoutMs: positiveInteger(option(args, "--timeout-ms", 60000), "timeout", 300000),
    modes: args.includes("--differential") ? MODES : [option(args, "--mode", "bm_final")],
    repeats: positiveInteger(option(args, "--repeats", 1), "repeats", 1000), concurrency: positiveInteger(option(args, "--concurrency", 8), "concurrency", 64),
  };
  if (options.modes.some(mode => !MODES.includes(mode))) throw new Error("invalid_mode");
  if (!options.model && !options.adapter && options.modes.some(mode => ["direct_model", "bm_full", "bm_raw"].includes(mode))) throw new Error("differential_model_modes_require_--model");
  const reviewsPath = option(args, "--reviews", null);
  const baselinePath = option(args, "--baseline", null);
  const report = await replay(readJson(datasetPath), options, null, reviewsPath ? readJson(reviewsPath) : [], baselinePath ? readJson(baselinePath) : null);
  const out = path.resolve(option(args, "--out", "tmp/bm-semantic/replay.json"));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ report: out, release_eligible: report.release_eligible, summary: report.summary }, null, 2));
  process.exitCode = report.release_eligible ? 0 : 1;
}

module.exports = { captureSource, createAdapter, mapConcurrent, replay, reportResults, runConversation, traceDiffs, validateDataset };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 2; });
