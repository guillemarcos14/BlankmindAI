"use strict";
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const domain = read("ios/Blank/Blank/BlankDomainModels.swift");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "blank-rest-"));
try {
    const source = path.join(directory, "main.swift"), binary = path.join(directory, "rest-tests");
    // Compile the actual models and analytics; UI and HealthKit are exercised by the simulator build.
    fs.writeFileSync(source, "import Foundation\nenum BlankSharedState { static let defaults = UserDefaults.standard }\n" +
        domain.slice(0, domain.indexOf("struct DigitalWellnessPlanItem")) + "\n" +
        read("ios/Blank/Blank/BlankBrainMetrics.swift") + "\n" + read("ios/Blank/Blank/RestProgress.swift") + "\n" +
        read("tools/rest_progress_test.swift"));
    const compile = spawnSync("swiftc", ["-swift-version", "5", source, "-o", binary], { encoding: "utf8" });
    if (compile.error || compile.status !== 0) throw new Error(compile.stderr || compile.error?.message || "Swift failed");
    const run = spawnSync(binary, [], { encoding: "utf8" });
    process.stdout.write(run.stdout || "");
    if (run.status !== 0) throw new Error(run.stderr || "Rest tests failed");
    // Changes to the atmospheric header/theme must stay outside this implementation.
    assert.match(read("ios/Blank/Blank/ReportView.swift"), /RestProgressContent/);
    assert.match(read("ios/Blank/Blank/HealthKitStore.swift"), /types\.union\(RestHealthCatalog.readTypes\)/);
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
