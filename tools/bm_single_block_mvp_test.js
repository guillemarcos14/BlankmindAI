"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { advanceSemanticState } = require("../netlify/functions/bm-semantic-state");
const { buildAgentContext } = require("../netlify/functions/bm-context");
const { resolveBlockingContract } = require("../netlify/functions/bm-blocking-contract");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const readyContext = {
  channel: "app",
  single_distraction_block: true,
  has_selected_apps: true,
  screen_time_authorized: true,
  device_execution_ready: true,
};

const normalizedContext = buildAgentContext({ ...readyContext, protection_target:"selected_distractions" });
assert.equal(normalizedContext.single_distraction_block, true);
assert.equal(normalizedContext.protection_target, "selected_distractions");
const canonicalContract = resolveBlockingContract("Block Instagram now for 30 minutes just once", normalizedContext);
assert.equal(canonicalContract.app_source, "device_selection");
assert.deepEqual(canonicalContract.data.apps, ["selected_apps"]);

const activate = (prompt, context = readyContext) => advanceSemanticState({ prompt, context, language:"en" });

const immediate = activate("Block Instagram now for 30 minutes just once");
assert.equal(immediate.decision.type, "ready");
assert.match(immediate.responseText, /your selected distractions/i);
assert.deepEqual(immediate.actions, [{ type:"start_protection", minutes:30, hard_mode:false }]);
assert.equal(immediate.blockingContract.app_source, "canonical_distraction_selection");
assert.deepEqual(immediate.blockingContract.data.apps, ["selected_apps"]);

const legacyModeLanguage = activate("Start Work mode now for 45 minutes just once");
assert.deepEqual(legacyModeLanguage.actions, [{ type:"start_protection", minutes:45, hard_mode:false }]);

const schedule = activate("Block TikTok from 10 pm to 7 am every day for 7 days");
assert.equal(schedule.actions[0].type, "apply_schedule");
assert.equal(schedule.actions[0].name, "Protection");
assert.equal(schedule.actions[0].copy_mode, undefined);
assert.equal(schedule.actions[0].source_mode_name, undefined);

const missingContext = { ...readyContext, has_selected_apps:false };
const setup = activate("Block Instagram now for 30 minutes just once", missingContext);
assert.equal(setup.decision.slot, "app_selection");
assert.equal(setup.actions[0].type, "open_app_picker");
assert.equal(setup.actions[0].name, "Distractions");
assert.match(setup.responseText, /selected distractions.*30 minutes.*just once/i);
assert.match(setup.responseText, /notification.*choose.*confirm the selection/i);
assert.match(setup.responseText, /device verifies/i);

const missingApp = activate("Block distractions now for 30 minutes just once", {
  ...readyContext,
  channel:"whatsapp",
  device_execution_ready:false,
  app_presence_recent:false,
});
assert.equal(missingApp.decision.slot, "app_presence");
assert.equal(missingApp.reviewOnlyAppPresence, true);
assert.deepEqual(missingApp.actions, [{ type:"start_protection", minutes:30, hard_mode:false }]);

const sessionStore = read("ios/Blank/Blank/SessionStore.swift");
const setupView = read("ios/Blank/Blank/SetupView.swift");
const homeView = read("ios/Blank/Blank/HomeView.swift");
const contentView = read("ios/Blank/Blank/ContentView.swift");
const blankApp = read("ios/Blank/Blank/BlankApp.swift");
const agent = read("netlify/functions/blanked-agent.js");

assert.match(sessionStore, /canonicalProtectionName = BlankSharedState\.canonicalProtectionName/);
assert.doesNotMatch(sessionStore, /@Published private\(set\) var focusModes/);
assert.doesNotMatch(sessionStore, /func duplicateMode\(/);
assert.doesNotMatch(sessionStore, /func createMode\(/);
assert.match(setupView, /one reusable protection list/i);
assert.match(homeView, /"single_distraction_block": true/);
assert.doesNotMatch(homeView, /ManualModeEditorScreen/);
assert.doesNotMatch(blankApp, /duplicateMode\(named:/);
assert.match(agent, /Never create, name, copy, activate or switch modes/);

console.log("BM single-block MVP contract passed");
