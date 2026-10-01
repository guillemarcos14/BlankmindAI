const assert = require("assert");
const fs = require("node:fs");
const path = require("node:path");
const { isFinalAppLinkedWhatsApp } = require("../netlify/functions/_bm_final_qa_access");

const phone = "+34658991584";
const code = "ABCDEFGH23";
const originalFlag = process.env.BM_FINAL_APP_LINKED_ROUTING_ENABLED;

async function main() {
  const app = fs.readFileSync(path.join(__dirname, "../ios/Blank/Blank/AssistantAppView.swift"), "utf8");
  const history = app.slice(app.indexOf("private struct AssistantAppHistoryView: View"));
  const apply = history.slice(history.indexOf("private func apply(_ turn:"), history.indexOf("private func loadEarlier()"));
  assert.match(app, /background: background, onApplyAction: \{ id in Task \{ await applyAction\(id\) \} \}\)/,
    "older actionable turns must reach the existing native application callback");
  const handoff = app.slice(app.indexOf("private func applyAction("), app.indexOf("private func openControls("));
  assert(handoff.indexOf("try await onApplyAction(actionID)") < handoff.indexOf("dismiss()"),
    "chat must validate the native inbox before navigating away");
  assert.match(handoff.slice(handoff.indexOf("} catch")), /handle\(error\)/,
    "failed application must stay visible in chat");
  assert.match(history, /hasFreshSnapshot = false/);
  assert.match(history, /\.task \{ await refresh\(\) \}/,
    "opening history must fetch current action outcomes before enabling buttons");
  assert.match(history, /if hasFreshSnapshot && error == nil && turn\.canApply/,
    "cached, failed and terminal history snapshots must not offer application");
  assert.match(apply, /guard validateOwner\(\), hasFreshSnapshot, !loading, error == nil, turn\.canApply/);
  assert.match(apply, /let current = try await AssistantAppClient\(\)\.status\(turnId: turn\.id\)/,
    "a previously pending action must be rechecked before applying from history");
  assert.match(apply, /guard validateOwner\(\), requestID == id else \{ return \}/);
  assert.match(apply, /guard let current, current\.canApply, current\.actionId == turn\.actionId else/,
    "cancelled, expired, superseded or replaced action IDs must never reach Home");
  assert(apply.indexOf("current.actionId == turn.actionId") < apply.indexOf("onApplyAction(current.actionId)"));
  assert.match(apply.slice(apply.indexOf("} catch")), /hasFreshSnapshot = false/,
    "failed status validation must disable all history actions until refreshed");
  assert.match(history, /#if DEBUG\s+return AssistantAppPreview\.scenario == "history"\s+#else\s+return false/,
    "history screenshots must use a fixture unavailable in release builds");
  assert.match(history, /private func refresh\(\) async \{\s+if preview \{[\s\S]*?hasFreshSnapshot = true[\s\S]*?return/,
    "history screenshots must not make authenticated network requests");
  assert.match(apply, /guard !preview else \{ return \}/,
    "the enabled-looking synthetic CTA must never invoke native actions");
  console.log("production app history: fresh snapshot, prior-turn CTA, exact action and owner gates passed");
  delete process.env.BM_FINAL_APP_LINKED_ROUTING_ENABLED;
  assert.strictEqual(await isFinalAppLinkedWhatsApp("whatsapp", phone, `CONNECT ${code}`), false);
  process.env.BM_FINAL_APP_LINKED_ROUTING_ENABLED = "true";
  assert.strictEqual(await isFinalAppLinkedWhatsApp("whatsapp", phone, `CONNECT ${code}`), false);
  assert.strictEqual(await isFinalAppLinkedWhatsApp("whatsapp", phone, "Hola"), false);
  console.log("production app routing: WhatsApp stays in waitlist, including with old flag enabled");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  if (originalFlag === undefined) delete process.env.BM_FINAL_APP_LINKED_ROUTING_ENABLED;
  else process.env.BM_FINAL_APP_LINKED_ROUTING_ENABLED = originalFlag;
});
