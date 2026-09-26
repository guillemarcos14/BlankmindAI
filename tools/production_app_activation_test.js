const assert = require("assert");
const fs = require("node:fs");
const path = require("node:path");
const { isFinalAppLinkedWhatsApp } = require("../netlify/functions/_bm_final_qa_access");

const phone = "+34658991584";
const code = "ABCDEFGH23";
const originalFetch = global.fetch;
const originalFlag = process.env.BM_FINAL_APP_LINKED_ROUTING_ENABLED;
const originalUrl = process.env.SUPABASE_URL;
const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function main() {
  const app = fs.readFileSync(path.join(__dirname, "../ios/Blank/Blank/AssistantAppView.swift"), "utf8");
  const history = app.slice(app.indexOf("private struct AssistantAppHistoryView: View"));
  const apply = history.slice(history.indexOf("private func apply(_ turn:"), history.indexOf("private func loadEarlier()"));
  assert.match(app, /background: background, onApplyAction: applyAction\)/,
    "older actionable turns must reach the existing native application callback");
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
  let installed = true;
  let connected = false;
  let fetchCount = 0;
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  global.fetch = async (url) => {
    fetchCount += 1;
    const rows = String(url).includes("blankmind_identity_links")
      ? [{ phone_e164: phone, app_install_id: installed ? "installation-1" : null, assistant_connect_code: code }]
      : connected ? [{ payload: { properties: { channel: "whatsapp", channel_user: phone, connect_code: code } } }] : [];
    return { ok: true, status: 200, text: async () => JSON.stringify(rows), json: async () => rows };
  };

  delete process.env.BM_FINAL_APP_LINKED_ROUTING_ENABLED;
  assert.strictEqual(await isFinalAppLinkedWhatsApp("whatsapp", phone, `CONNECT ${code}`), false);
  assert.strictEqual(fetchCount, 0, "public routing stays disabled by default");

  process.env.BM_FINAL_APP_LINKED_ROUTING_ENABLED = "true";
  assert.strictEqual(await isFinalAppLinkedWhatsApp("sms", phone, `CONNECT ${code}`), false);
  assert.strictEqual(await isFinalAppLinkedWhatsApp("whatsapp", phone, "Hola"), false);
  assert.strictEqual(await isFinalAppLinkedWhatsApp("whatsapp", phone, "CONNECT WRONGCODE"), false);
  installed = false;
  assert.strictEqual(await isFinalAppLinkedWhatsApp("whatsapp", phone, `CONNECT ${code}`), false);
  installed = true;
  assert.strictEqual(await isFinalAppLinkedWhatsApp("whatsapp", phone, `CONNECT ${code}`), true);
  connected = true;
  assert.strictEqual(await isFinalAppLinkedWhatsApp("whatsapp", phone, "Hola"), true);
  console.log("production app activation routing: ok");
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  global.fetch = originalFetch;
  if (originalFlag === undefined) delete process.env.BM_FINAL_APP_LINKED_ROUTING_ENABLED;
  else process.env.BM_FINAL_APP_LINKED_ROUTING_ENABLED = originalFlag;
  if (originalUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
});
