"use strict";
// Compile the production setup methods with only platform/network edges replaced.
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");
const source = fs.readFileSync(path.join(__dirname, "../ios/Blank/Blank/SetupView.swift"), "utf8").replace(/\r\n/g, "\n");
assert.doesNotMatch(source, /\.task\(id: canAutomaticallyComplete\)/, "Readiness changes must not cancel setup");
assert.match(source, /onboarding-continue-blankmind/, "A failed attempt must remain retryable");
function method(name) {
  const start = source.indexOf("    private func " + name + "(");
  assert(start >= 0, "Missing production method: " + name);
  const next = source.indexOf("\n    private ", start + 1);
  const actor = source.indexOf("\n    @MainActor", start + 1);
  const end = Math.min(...[next, actor].filter(x => x >= 0));
  return source.slice(start, end).replace("private func ", "func ");
}
const methods = ["startCompletion", "completeSetup", "syncAssistantContext", "postAssistantChannel"].map(method).join("\n");
const tests = fs.readFileSync(path.join(__dirname, "rest_setup_test.swift"), "utf8");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "blank-rest-setup-"));
try {
  const file = path.join(dir, "SetupTests.swift"), binary = path.join(dir, "setup-tests");
  fs.writeFileSync(file, tests.replace("// PRODUCTION_METHODS", methods));
  const build = spawnSync("swiftc", ["-swift-version", "5", "-parse-as-library", file, "-o", binary], { encoding: "utf8" });
  if (build.error) throw build.error;
  if (build.status !== 0) throw Error(build.stderr || build.stdout);
  const result = spawnSync(binary, [], { encoding: "utf8", timeout: 30000 });
  process.stdout.write(result.stdout || "");
  if (result.status !== 0) throw Error(result.stderr || "Native setup tests failed");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
