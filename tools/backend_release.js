"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const REPORT_DIR = path.join(ROOT, "tmp", "backend-release");
const DEFAULT_BASE = "main";
const RELEASE_BRANCH_PATTERN = /^codex\/backend-release-[a-z0-9][a-z0-9-]*$/;
const FEATURE_BRANCH_PATTERN = /^(origin\/)?codex\/.+/;
const OPERATIONAL_PATHS = ["tmp/", "supabase/.temp/"];
const BACKEND_PATHS = [
  "netlify/functions/",
  "supabase/functions/",
  "supabase/migrations/",
  "tools/",
  "docs/",
  "PRODUCTION_CHECKLIST.md",
  ".github/",
];

function parseArgs(argv) {
  const result = { mode: "plan", branches: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--branch") {
      const value = argv[++index];
      if (!value) fail("--branch requires a branch name");
      result.branches.push(value);
    } else if (item === "--netlify" || item === "--supabase" || item === "--confirm" || item === "--full") {
      result[item.slice(2)] = true;
    } else if (item.startsWith("--")) {
      const key = item.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`${item} requires a value`);
      result[key] = value;
      index += 1;
    } else {
      fail(`unknown argument: ${item}`);
    }
  }
  return result;
}

function fail(message, code = 1) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
}

function run(command, args, options = {}) {
  const useWindowsNpxShell = process.platform === "win32" && command === "npx";
  const executable = command;
  const result = spawnSync(executable, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    stdio: options.inherit ? "inherit" : "pipe",
    ...(useWindowsNpxShell ? { shell: true } : {}),
  });
  if (result.error) fail(`${executable} ${args.join(" ")}: ${result.error.message}`);
  if (result.status !== 0 && !options.allowFailure) {
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    fail(`${command} ${args.join(" ")} failed (${result.status})${output ? `\n${output}` : ""}`);
  }
  return result;
}

function git(args, options = {}) {
  return run("git", args, options);
}

function stdout(result) {
  return String(result.stdout || "").trim();
}

function rawStdout(result) {
  return String(result.stdout || "");
}

function currentBranch() {
  return stdout(git(["branch", "--show-current"]));
}

function statusLines() {
  return rawStdout(git(["status", "--porcelain=v1"])).trimEnd().split(/\r?\n/).filter(Boolean);
}

function statusPath(line) {
  const raw = String(line).slice(3).trim();
  return raw.includes(" -> ") ? raw.split(" -> ").pop() : raw;
}

function isOperationalPath(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  return OPERATIONAL_PATHS.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix));
}

function dirtySourcePaths() {
  return statusLines().map(statusPath).filter((filePath) => !isOperationalPath(filePath));
}

function refExists(ref) {
  return git(["rev-parse", "--verify", `${ref}^{commit}`], { allowFailure: true }).status === 0;
}

function commitFor(ref) {
  if (!refExists(ref)) fail(`ref not found: ${ref}`);
  return stdout(git(["rev-parse", `${ref}^{commit}`]));
}

function changedFiles(base, ref) {
  const result = git(["diff", "--name-only", `${base}...${ref}`]);
  return stdout(result).split(/\r?\n/).filter(Boolean);
}

function classify(files) {
  return {
    backend: files.filter((file) => BACKEND_PATHS.some((prefix) => file === prefix || file.startsWith(prefix))),
    outside_backend: files.filter((file) => !BACKEND_PATHS.some((prefix) => file === prefix || file.startsWith(prefix))),
  };
}

function branchInfo(base, branch) {
  const files = changedFiles(base, branch);
  const classified = classify(files);
  const commits = stdout(git(["log", "--format=%h %s", "--no-merges", `${base}..${branch}`]))
    .split(/\r?\n/).filter(Boolean);
  return {
    branch,
    commit: commitFor(branch),
    commits,
    changed_files: files,
    backend_files: classified.backend,
    outside_backend_files: classified.outside_backend,
    warning: classified.outside_backend.length > 0
      ? "La rama contiene cambios fuera del alcance backend; revisarlos antes de fusionar."
      : null,
  };
}

function writeReport(name, report) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const filePath = path.join(REPORT_DIR, name);
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function ensureFeatureBranches(branches) {
  for (const branch of branches) {
    if (!FEATURE_BRANCH_PATTERN.test(branch)) fail(`feature branch must start with codex/: ${branch}`);
    if (!refExists(branch)) fail(`ref not found: ${branch}`);
  }
}

function plan(args) {
  const base = args.base || DEFAULT_BASE;
  if (!refExists(base)) fail(`base ref not found: ${base}`);
  const branches = args.branches.length ? args.branches : [currentBranch() || "HEAD"];
  ensureFeatureBranches(branches.filter((branch) => branch !== "HEAD"));
  const report = {
    workflow: "backend-release",
    mode: "plan",
    generated_at: new Date().toISOString(),
    base: { ref: base, commit: commitFor(base) },
    current_branch: currentBranch() || "DETACHED",
    source_status: statusLines(),
    source_dirty_paths: dirtySourcePaths(),
    branches: branches.map((branch) => branch === "HEAD"
      ? branchInfo(base, "HEAD")
      : branchInfo(base, branch)),
    next: [
      "Crear una rama codex/backend-release-* desde la base elegida.",
      "Ejecutar el product harness baseline en esa rama antes de validar.",
      "Fusionar las ramas solo cuando la validación pase.",
    ],
  };
  const reportPath = writeReport("plan.json", report);
  console.log(JSON.stringify({
    workflow: report.workflow,
    mode: report.mode,
    base: report.base,
    current_branch: report.current_branch,
    source_dirty_paths: report.source_dirty_paths.length,
    branches: report.branches.map((item) => ({
      branch: item.branch,
      commit: item.commit,
      commits: item.commits.length,
      backend_files: item.backend_files.length,
      outside_backend_files: item.outside_backend_files.length,
      warning: item.warning,
    })),
    report: reportPath,
  }, null, 2));
}

function integrate(args) {
  const base = args.base || DEFAULT_BASE;
  const name = args.name;
  if (!name || !RELEASE_BRANCH_PATTERN.test(name)) {
    fail("--name must match codex/backend-release-<slug>");
  }
  if (!args.branches.length) fail("integrate requires at least one --branch");
  if (dirtySourcePaths().length) {
    fail(`working tree has source changes; commit or move them before integration:\n${dirtySourcePaths().join("\n")}`);
  }
  if (!refExists(base)) fail(`base ref not found: ${base}`);
  ensureFeatureBranches(args.branches);
  if (refExists(name)) fail(`release branch already exists: ${name}`);

  git(["switch", "--create", name, base], { inherit: true });
  const merged = [];
  try {
    for (const branch of args.branches) {
      console.log(`\n== merge ${branch} ==`);
      git(["merge", "--no-ff", "--no-edit", branch], { inherit: true });
      merged.push(branch);
    }
  } catch (error) {
    console.error("Integration stopped. Resolve the merge conflict, then run git merge --continue or abort it manually.");
    error.exitCode = error.exitCode || 2;
    throw error;
  }
  const reportPath = writeReport("integration.json", {
    workflow: "backend-release",
    mode: "integrate",
    generated_at: new Date().toISOString(),
    base,
    release_branch: name,
    merged,
    commit: stdout(git(["rev-parse", "HEAD"])),
  });
  console.log(`Integration branch ready: ${name}`);
  console.log(`Report: ${reportPath}`);
  console.log("Next: create the product harness baseline on this branch before validation.");
}

function validate(args) {
  const baseline = args.baseline || "tmp/product-harness/baseline.json";
  if (!fs.existsSync(path.join(ROOT, baseline))) {
    fail(`baseline not found: ${baseline}. Run product_harness in plan mode first.`);
  }
  run(process.execPath, [
    "tools/product_harness.js",
    "--contract", "tools/product_harness_contract.json",
    "--mode", "validate",
    "--baseline", baseline,
    "--enforce-scope",
    "--report", "tmp/backend-release/product-harness.json",
  ], { inherit: true });
  run("git", ["diff", "--check"], { inherit: true });
  if (args.full) {
    run(process.execPath, ["tools/bai_release_gate.js", "--save", "--count", "125"], { inherit: true });
  }
  const reportPath = writeReport("validation.json", {
    workflow: "backend-release",
    mode: "validate",
    generated_at: new Date().toISOString(),
    branch: currentBranch() || "DETACHED",
    baseline,
    full_gate: Boolean(args.full),
    status: "passed",
  });
  console.log(`Backend validation passed. Report: ${reportPath}`);
}

function deploy(args) {
  if (!args.confirm) fail("deploy requires --confirm");
  const branch = currentBranch();
  if (!RELEASE_BRANCH_PATTERN.test(branch)) {
    fail(`deploy must run from a release branch codex/backend-release-*; current: ${branch || "DETACHED"}`);
  }
  const dirty = dirtySourcePaths();
  if (dirty.length) fail(`source tree is not clean:\n${dirty.join("\n")}`);
  if (!args.netlify && !args.supabase) {
    console.log("No deploy target selected. Add --netlify and/or --supabase after validation.");
    return;
  }
  if (!args.releaseEvidence) {
    fail("production deploy requires --release-evidence <path> with the exact candidate's physical release evidence");
  }
  // Fail before validation or any remote mutation. Automated checks alone do
  // not establish a distributed, physically verified iPhone candidate.
  run(process.execPath, [
    "tools/bm_release_readiness_gate.js",
    "--head",
    "--evidence", args.releaseEvidence,
  ], { inherit: true });
  validate(args);
  const actions = [];
  if (args.supabase) {
    run("npx", ["supabase", "db", "push", "--yes"], { inherit: true });
    actions.push("supabase migrations");
    run("npx", ["supabase", "functions", "deploy", "digital-wellness-features"], { inherit: true });
    actions.push("supabase digital-wellness-features");
  }
  if (args.netlify) {
    const siteId = args.siteId || "59955668-9a9b-4979-a283-63fbf3115fe5";
    run("npx", [
      "netlify", "deploy", "--prod", "--no-build",
      "--dir", "web/landing", "--functions", "netlify/functions",
      "--site", siteId, "--skip-functions-cache",
    ], { inherit: true });
    actions.push("netlify getblank");
  }
  const reportPath = writeReport("deploy.json", {
    workflow: "backend-release",
    mode: "deploy",
    generated_at: new Date().toISOString(),
    branch,
    commit: stdout(git(["rev-parse", "HEAD"])),
    actions,
    status: "passed",
  });
  console.log(`Backend deploy completed. Report: ${reportPath}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!["plan", "integrate", "validate", "deploy"].includes(args.mode)) {
    fail(`unsupported mode: ${args.mode}`);
  }
  if (args.mode === "plan") plan(args);
  else if (args.mode === "integrate") integrate(args);
  else if (args.mode === "validate") validate(args);
  else deploy(args);
}

try {
  main();
} catch (error) {
  console.error(`backend_release: ${error.message}`);
  process.exitCode = error.exitCode || 1;
}
