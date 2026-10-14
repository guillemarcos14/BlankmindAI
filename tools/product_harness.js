"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const WORKSPACE_ROOT = path.resolve(REPO_ROOT, "..", "..");
const DEFAULT_BRAIN_ROOT = path.join(WORKSPACE_ROOT, "Blank Brain");
const DEFAULT_REPORT_DIR = path.join(REPO_ROOT, "tmp", "product-harness");
const BRAIN_FILES = [
  "01_ESTADO.md",
  "02_DECISIONES.md",
  "03_TAREAS.md",
  "04_APRENDIZAJES.md",
];
const MAX_OUTPUT = 6000;
const DEFAULT_TIMEOUT_MS = 120000;
const MAX_REPAIR_ATTEMPTS = 3;

const DANGEROUS_COMMAND = /(?:\bgit\s+(?:reset|checkout|restore|clean|push)|\b(?:rm|del|erase|remove-item)\b|\bdrop\s+(?:table|database)|\bsupabase\s+(?:db\s+push|functions\s+deploy)|\bnetlify\s+deploy|\bnpm\s+publish|\bxcodebuild\s+.*(?:archive|exportArchive)|\bnode(?:\.exe)?\s+(?:-e|--eval|-r|--require|--loader)\b)/i;
const SHELL_OPERATOR = /(?:&&|\|\||[|;&<>])/;
const SAFE_COMMAND = /^(?:node(?:\.exe)?\s|npm(?:\.cmd)?\s|npx(?:\.cmd)?\s|\.\\gradlew(?:\.bat)?(?:\s|$)|gradlew(?:\.bat)?(?:\s|$)|git\s+(?:diff\s+--check|status\s+--porcelain(?:=v1)?|rev-parse\s+--show-toplevel)|swiftlint(?:\s|$)|xcodebuild\s+-project\s+[^ ]+\s+-sdk\s+iphonesimulator\s+-configuration\s+debug\s+build(?:\s|$))/i;

function nowIso() {
  return new Date().toISOString();
}

function clean(value, maxLength = 240) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function hash(value) {
  return crypto.createHash("sha256").update(Buffer.isBuffer(value) ? value : String(value)).digest("hex").slice(0, 16);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function fingerprint(value) {
  return hash(JSON.stringify(stableValue(value)));
}

function parseArgs(argv) {
  const args = { mode: "validate", json: false, applyMemory: false, enforceScope: false, diffBase: null };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--json") args.json = true;
    else if (item === "--apply-memory") args.applyMemory = true;
    else if (item === "--enforce-scope") args.enforceScope = true;
    else if (item.startsWith("--")) {
      const key = item.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      args[key] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
    }
  }
  return args;
}

function fail(message) {
  const error = new Error(message);
  error.code = "product_harness_contract_error";
  throw error;
}

function resolveInside(base, candidate) {
  const resolved = path.resolve(base, candidate);
  const relative = path.relative(base, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    fail(`path_outside_workspace:${candidate}`);
  }
  return resolved;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`invalid_contract_json:${filePath}:${error.message}`);
  }
}

function loadContract(contractPath) {
  const resolved = resolveInside(REPO_ROOT, contractPath);
  if (!fs.existsSync(resolved)) fail(`missing_contract:${contractPath}`);
  const contract = readJson(resolved);
  validateContract(contract);
  return { contract, path: resolved };
}

function validateCommand(command, label) {
  const value = clean(command, 500);
  if (!value) fail(`empty_command:${label}`);
  if (SHELL_OPERATOR.test(value)) fail(`shell_operator_not_allowed:${label}`);
  if (DANGEROUS_COMMAND.test(value)) fail(`dangerous_command_not_allowed:${label}`);
  if (!SAFE_COMMAND.test(value)) fail(`command_not_allowlisted:${label}:${value}`);
  return value;
}

function validateContract(contract) {
  if (!contract || typeof contract !== "object") fail("contract_must_be_object");
  if (contract.schema_version !== 1) fail("unsupported_contract_schema");
  if (!clean(contract.id, 100)) fail("missing_contract_id");
  if (!clean(contract.objective, 1000)) fail("missing_objective");
  if (!Array.isArray(contract.scope) || contract.scope.length === 0) fail("missing_scope");
  if (!Array.isArray(contract.acceptance) || contract.acceptance.length === 0) fail("missing_acceptance");
  if (!contract.context || typeof contract.context !== "object") fail("missing_context");
  if (!contract.validation || typeof contract.validation !== "object") fail("missing_validation");
  if (!Array.isArray(contract.validation.commands) || contract.validation.commands.length === 0) fail("missing_validation_commands");
  contract.validation.commands.forEach((command, index) => {
    if (!command || typeof command !== "object") fail(`invalid_validation_command:${index}`);
    validateCommand(command.run, `validation_${index}`);
  });
  const repairs = contract.validation.repair_commands || [];
  if (!Array.isArray(repairs)) fail("repair_commands_must_be_array");
  repairs.forEach((command, index) => validateCommand(command.run || command, `repair_${index}`));
  const maxRepairs = Number(contract.validation.max_repair_attempts ?? 0);
  if (!Number.isInteger(maxRepairs) || maxRepairs < 0 || maxRepairs > MAX_REPAIR_ATTEMPTS) fail("invalid_max_repair_attempts");
  if (contract.memory_updates != null && !Array.isArray(contract.memory_updates)) fail("memory_updates_must_be_array");
  for (const update of contract.memory_updates || []) {
    if (!update || typeof update !== "object" || !clean(update.file, 200) || !clean(update.text, 10000)) {
      fail("invalid_memory_update");
    }
    const isBrainPath = update.file.startsWith("Blank Brain\\") || update.file.startsWith("Blank Brain/");
    if (!BRAIN_FILES.includes(path.basename(update.file)) || !isBrainPath) {
      fail(`memory_file_not_allowed:${update.file}`);
    }
  }
  return true;
}

function fileInfo(filePath, displayPath) {
  if (!fs.existsSync(filePath)) return { path: displayPath, exists: false };
  const content = fs.readFileSync(filePath);
  return {
    path: displayPath,
    exists: true,
    bytes: content.length,
    lines: content.toString("utf8").split(/\r?\n/).length,
    sha256: hash(content),
  };
}

function buildContext(contract, brainRoot) {
  const files = [];
  for (const name of BRAIN_FILES) files.push(fileInfo(path.join(brainRoot, name), `Blank Brain/${name}`));
  const processPath = contract.context.process || "Blank Brain/PROCESOS/desarrollo.md";
  const processAbsolute = resolveInside(WORKSPACE_ROOT, processPath);
  files.push(fileInfo(processAbsolute, processPath.replace(/\\/g, "/")));
  for (const relative of contract.context.files || []) {
    const absolute = resolveInside(REPO_ROOT, relative);
    files.push(fileInfo(absolute, relative.replace(/\\/g, "/")));
  }
  return {
    brain_root: brainRoot,
    process: processPath,
    files,
    missing_files: files.filter((item) => !item.exists).map((item) => item.path),
    fingerprint: fingerprint(files),
  };
}

function gitStatusLines() {
  const result = spawnSync("git", ["status", "--porcelain=v1"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  return result.status === 0 ? String(result.stdout || "").split(/\r?\n/).filter(Boolean) : [];
}

function statusPath(line) {
  const raw = String(line || "").slice(3).trim();
  if (raw.includes(" -> ")) return raw.split(" -> ").pop();
  return raw;
}

function globToRegExp(pattern) {
  const normalized = pattern.replace(/\\/g, "/");
  let output = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === "*" && normalized[index + 1] === "*") {
      output += ".*";
      index += 1;
    } else if (char === "*") output += "[^/]*";
    else if (char === "?") output += ".";
    else output += /[.*+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
  }
  return new RegExp(`${output}$`, "i");
}

function diffStatusLines(diffBase) {
  if (!diffBase) return null;
  const base = clean(diffBase, 200);
  if (!base || SHELL_OPERATOR.test(base) || /[\r\n]/.test(base)) fail("invalid_diff_base");
  const result = spawnSync("git", ["diff", "--name-status", `${base}...HEAD`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status !== 0) fail(`diff_base_unavailable:${base}`);
  return String(result.stdout || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = /^\S+\s+(.*)$/.exec(line);
      return match ? ` M ${match[1]}` : line;
    });
}

function scopeReport(contract, baselineLines = null, diffBase = null) {
  const currentLines = gitStatusLines();
  const baseline = new Set(baselineLines || []);
  const changedSinceBaseline = baselineLines ? currentLines.filter((line) => !baseline.has(line)) : [];
  const diffLines = diffStatusLines(diffBase);
  const paths = (diffLines || (baselineLines ? changedSinceBaseline : currentLines)).map(statusPath).filter(Boolean);
  const patterns = contract.scope.map(globToRegExp);
  return {
    baseline_available: Array.isArray(baselineLines),
    diff_base: diffBase || null,
    changed_paths: paths,
    violations: paths.filter((item) => !patterns.some((pattern) => pattern.test(item))),
  };
}

function redact(value) {
  return String(value || "")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "sk-[REDACTED]")
    .replace(/(secret|token|password|api[_-]?key)\s*[:=]\s*[^\s,}]+/gi, "$1=[REDACTED]");
}

function runCommand(command, label, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const safeCommand = validateCommand(command, label);
  const started = Date.now();
  const result = spawnSync(safeCommand, {
    cwd: REPO_ROOT,
    shell: true,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env },
  });
  const output = redact(`${result.stdout || ""}${result.stderr || ""}`).slice(-MAX_OUTPUT);
  const timedOut = result.error && result.error.code === "ETIMEDOUT";
  return {
    label,
    command: safeCommand,
    status: timedOut ? "timeout" : result.status === 0 ? "passed" : "failed",
    exit_code: result.status == null ? null : result.status,
    duration_ms: Date.now() - started,
    output,
  };
}

function runValidation(contract) {
  const maxRepairs = Number(contract.validation.max_repair_attempts ?? 0);
  const repairs = contract.validation.repair_commands || [];
  const attempts = [];
  let finalCommands = [];
  let passed = false;
  for (let attempt = 0; attempt <= maxRepairs; attempt += 1) {
    finalCommands = contract.validation.commands.map((command, index) => runCommand(
      command.run,
      command.name || `validation_${index + 1}`,
      Number(command.timeout_ms || DEFAULT_TIMEOUT_MS),
    ));
    const validationPassed = finalCommands.every((item) => item.status === "passed");
    const attemptRecord = { attempt, commands: finalCommands, passed: validationPassed };
    if (validationPassed) {
      attempts.push(attemptRecord);
      passed = true;
      break;
    }
    if (attempt >= maxRepairs || repairs.length === 0) {
      attempts.push(attemptRecord);
      break;
    }
    attemptRecord.repairs = repairs.map((command, index) => runCommand(
      command.run || command,
      command.name || `repair_${index + 1}`,
      Number(command.timeout_ms || DEFAULT_TIMEOUT_MS),
    ));
    attempts.push(attemptRecord);
    if (attemptRecord.repairs.some((item) => item.status !== "passed")) break;
  }
  return { passed, attempts, repairs_used: Math.max(0, attempts.length - 1) };
}

function applyMemoryUpdates(contract, workspaceRoot) {
  const applied = [];
  for (const update of contract.memory_updates || []) {
    const absolute = resolveInside(workspaceRoot, update.file);
    const current = fs.readFileSync(absolute, "utf8");
    if (current.includes(update.text)) {
      applied.push({ file: update.file, status: "already_present" });
      continue;
    }
    const separator = current.endsWith("\n") ? "" : "\n";
    fs.writeFileSync(absolute, `${current}${separator}\n${update.text.trim()}\n`, "utf8");
    applied.push({ file: update.file, status: "appended" });
  }
  return applied;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeBaseline(filePath) {
  writeJson(filePath, {
    harness_version: "product-harness-v1",
    created_at: nowIso(),
    status_lines: gitStatusLines(),
  });
}

function createRunId() {
  return `ph_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
}

function execute(args) {
  const contractPath = args.contract || "tools/product_harness_contract.json";
  const { contract, path: resolvedContractPath } = loadContract(contractPath);
  const brainRoot = args.brainRoot ? resolveInside(WORKSPACE_ROOT, args.brainRoot) : DEFAULT_BRAIN_ROOT;
  const context = buildContext(contract, brainRoot);
  const baselineLines = args.baseline
    ? readJson(resolveInside(REPO_ROOT, args.baseline)).status_lines
    : null;
  const run = {
    harness_version: "product-harness-v1",
    run_id: createRunId(),
    mode: args.mode,
    contract: {
      id: contract.id,
      path: path.relative(REPO_ROOT, resolvedContractPath).replace(/\\/g, "/"),
      objective: clean(contract.objective, 1000),
      contract_hash: fingerprint(contract),
      scope: contract.scope,
      acceptance: contract.acceptance,
    },
    started_at: nowIso(),
    started_ms: Date.now(),
    context,
    scope: scopeReport(contract, baselineLines, args.diffBase),
    validation: null,
    memory: { requested: args.applyMemory, updates: [] },
  };

  // Blank Brain lives outside the Git repository. CI checks code and scope;
  // the mandatory local baseline still requires all external context files.
  const externalContextOnly = context.missing_files.every((file) => file.startsWith("Blank Brain/"));
  const externalContextSkipped = args.allowMissingExternalContext === true
    && process.env.CI === "true" && externalContextOnly;
  if (context.missing_files.length > 0 && !externalContextSkipped) {
    run.status = "blocked";
    run.blocker = `missing_context_files:${context.missing_files.join(",")}`;
  } else if (args.mode === "plan") {
    run.status = "planned";
  } else {
    run.validation = runValidation(contract);
    run.status = run.validation.passed ? "passed" : "failed";
    if (args.enforceScope && run.scope.violations.length > 0) {
      run.status = "blocked";
      run.blocker = `scope_violations:${run.scope.violations.join(",")}`;
    }
    if (run.status === "passed" && args.applyMemory) {
      run.memory.updates = applyMemoryUpdates(contract, WORKSPACE_ROOT);
    }
  }
  run.finished_at = nowIso();
  run.duration_ms = Date.now() - run.started_ms;
  return run;
}

function printRun(run, jsonOutput) {
  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
    return;
  }
  const checks = run.validation ? run.validation.attempts.flatMap((attempt) => attempt.commands) : [];
  const failed = checks.filter((item) => item.status !== "passed");
  process.stdout.write(`product_harness ${run.status} ${run.run_id}\n`);
  process.stdout.write(`objective: ${run.contract.objective}\n`);
  process.stdout.write(`context: ${run.context.files.length} files, ${run.context.fingerprint}\n`);
  if (run.validation) process.stdout.write(`validation: ${checks.length - failed.length}/${checks.length} commands passed, repairs=${run.validation.repairs_used}\n`);
  if (run.scope.violations.length > 0) process.stdout.write(`scope_violations: ${run.scope.violations.join(", ")}\n`);
  if (run.blocker) process.stdout.write(`blocker: ${run.blocker}\n`);
  if (run.memory.updates.length > 0) process.stdout.write(`memory: ${run.memory.updates.map((item) => `${item.file}:${item.status}`).join(", ")}\n`);
  if (failed.length > 0) process.stdout.write(`failed: ${failed.map((item) => item.label).join(", ")}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.contract && args.help) {
    process.stdout.write("Usage: node tools/product_harness.js --contract tools/product_harness_contract.json [--mode plan|validate|close] [--report path] [--write-baseline path] [--baseline path] [--diff-base ref] [--enforce-scope] [--allow-missing-external-context (CI only)] [--apply-memory] [--json]\n");
    return;
  }
  if (args.writeBaseline) {
    const baselinePath = resolveInside(REPO_ROOT, args.writeBaseline);
    writeBaseline(baselinePath);
    process.stdout.write(`product_harness baseline written ${path.relative(REPO_ROOT, baselinePath).replace(/\\/g, "/")}\n`);
  }
  let run;
  try {
    run = execute(args);
  } catch (error) {
    const payload = { harness_version: "product-harness-v1", status: "invalid", error: error.message, code: error.code || "product_harness_failed" };
    if (args.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    else process.stderr.write(`product_harness invalid: ${error.message}\n`);
    process.exitCode = 2;
    return;
  }
  const reportPath = args.report
    ? resolveInside(REPO_ROOT, args.report)
    : path.join(DEFAULT_REPORT_DIR, `${run.run_id}.json`);
  writeJson(reportPath, run);
  printRun(run, args.json);
  process.exitCode = ["planned", "passed"].includes(run.status) ? 0 : 1;
}

if (require.main === module) main();

module.exports = {
  REPO_ROOT,
  WORKSPACE_ROOT,
  validateContract,
  validateCommand,
  buildContext,
  globToRegExp,
  diffStatusLines,
  scopeReport,
  runCommand,
  runValidation,
  applyMemoryUpdates,
  writeBaseline,
  execute,
};
