"use strict";
// Execute reconstructed archive bytes, never the current checkout's runtime.
const fs = require("fs"), path = require("path"), vm = require("vm");
const crypto = require("crypto"), zlib = require("zlib"), assert = require("assert");
const { execFileSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..");
const bundle = path.resolve(ROOT, process.argv[2] || "tmp/elevenlabs-recovery/bundle");
const digest = b => crypto.createHash("sha256").update(b).digest("hex");
function zip(file) {
  const b = fs.readFileSync(file); let end = b.length - 22;
  while (end >= Math.max(0, b.length - 65558) && b.readUInt32LE(end) !== 0x06054b50) end--;
  assert(end >= 0, "invalid ZIP"); const files = new Map(); let p = b.readUInt32LE(end + 16);
  for (let i = 0; i < b.readUInt16LE(end + 10); i++) {
    assert.equal(b.readUInt32LE(p), 0x02014b50);
    const length = b.readUInt16LE(p + 28), name = b.subarray(p + 46, p + 46 + length).toString();
    assert(!name.includes("..") && !path.isAbsolute(name) && !files.has(name));
    const off = b.readUInt32LE(p + 42), start = off + 30 + b.readUInt16LE(off + 26) + b.readUInt16LE(off + 28);
    const raw = b.subarray(start, start + b.readUInt32LE(p + 20)), method = b.readUInt16LE(p + 10);
    assert([0, 8].includes(method));
    if (!name.endsWith("/")) files.set(name, method === 8 ? zlib.inflateRawSync(raw) : raw);
    p += 46 + length + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
  }
  return files;
}
const envDefaults = { CONTEXT: "production", NODE_ENV: "production", TWILIO_AUTH_TOKEN: "fixture-token", WHATSAPP_APP_SECRET: "fixture-meta", WHATSAPP_VERIFY_TOKEN: "fixture-verify", TWILIO_VALIDATE_WEBHOOK_SIGNATURE: "false", WAITLIST_TWILIO_WEBHOOK_URL: "https://fixture.test/.netlify/functions/waitlist-agent", TWILIO_WEBHOOK_URL: "https://fixture.test/.netlify/functions/sms-agent", BM_FINAL_QA_WHATSAPP_PHONE: "+34600000001" };
let deniedNetwork = 0;
function sandbox(files, stubs = {}, overrides = {}, fetchMock) {
  const cache = new Map(), env = { ...envDefaults, ...overrides };
  const context = vm.createContext({ Buffer, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, FormData, Blob,
    process: { env }, console: { log() {}, warn() {}, error() {} }, setTimeout: fn => { fn(); return 0; }, clearTimeout() {},
    fetch: fetchMock || (() => { deniedNetwork++; throw Error("unexpected_network_blocked"); }) });
  function load(name) {
    if (Object.hasOwn(stubs, name)) return stubs[name];
    if (cache.has(name)) return cache.get(name).exports;
    assert(files.has(name), "missing dependency: " + name);
    if (name.endsWith(".json")) return JSON.parse(files.get(name));
    const mod = { exports: {} }; cache.set(name, mod);
    const req = spec => {
      if (["crypto", "node:crypto"].includes(spec)) return crypto;
      if (spec === "http2") return { connect() { deniedNetwork++; throw Error("unexpected_http2_blocked"); } };
      assert(spec.startsWith("."), "nonlocal dependency: " + spec);
      let target = path.posix.normalize(path.posix.join(path.posix.dirname(name), spec));
      if (!path.posix.extname(target)) target += ".js";
      return load(target);
    };
    const fn = new vm.Script("(function(require,module,exports){\n" + files.get(name).toString() + "\n})", { filename: name }).runInContext(context);
    fn(req, mod, mod.exports); return mod.exports;
  }
  return { load, env };
}
const results = [];
async function test(name, fn) {
  try { await fn(); results.push({ name, pass: true }); }
  catch (e) { results.push({ name, pass: false, error: e.message }); }
}
function signedTwilio(endpoint, fields = {}, env = envDefaults) {
  const params = new URLSearchParams({ From: "whatsapp:+34600000002", Body: "Hello", MessageSid: "SM-fixture", ...fields });
  const url = endpoint === "sms-agent" ? env.TWILIO_WEBHOOK_URL : env.WAITLIST_TWILIO_WEBHOOK_URL;
  const canonical = [...params.entries()].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv)).map(([k, v]) => k + v).join("");
  return { httpMethod: "POST", path: new URL(url).pathname, headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": crypto.createHmac("sha1", env.TWILIO_AUTH_TOKEN).update(url + canonical).digest("base64") }, body: params.toString() };
}
function signedMeta(messages = [], env = envDefaults) {
  const body = JSON.stringify({ entry: [{ changes: [{ value: { messages } }] }] });
  return { httpMethod: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=" + crypto.createHmac("sha256", env.WHATSAPP_APP_SECRET).update(body).digest("hex") }, body };
}
function signedBackground(message, env = envDefaults) {
  const body = JSON.stringify({ message });
  return { httpMethod: "POST", headers: { "x-waitlist-background-signature": "sha256=" + crypto.createHmac("sha256", env.TWILIO_AUTH_TOKEN).update(body).digest("hex") }, body };
}
const message = { provider: "twilio", channel: "whatsapp", phone: "+34600000002", providerMessageId: "SM-fixture", text: "Hello" };
function storeFixture(options = {}) {
  const calls = [], claims = new Set();
  const user = { id: "fixture-account", status: "active", data_consent: true, whatsapp_consent: true, first_reply_at: "2026-10-01", whatsapp_availability_notice_at: "2026-10-01", ...options.user };
  const record = name => async (...args) => { calls.push({ name, args }); return null; };
  const store = { phoneForStorage: s => String(s || "").replace(/^whatsapp:/i, ""),
    claimInbound: async (provider, id) => { const key = provider + id; calls.push({ name: "claim", args: [provider, id] }); if (claims.has(key)) return { claimed: false }; claims.add(key); return { claimed: true }; },
    userByPhone: async phone => { calls.push({ name: "lookup", args: [phone] }); return options.missing ? null : user; },
    completeInbound: record("complete"), releaseInbound: record("release"), recordEvent: record("event"), patchUser: record("patch"),
    recordMessage: async row => { calls.push({ name: "message", args: [row] }); return { id: "fixture-message" }; },
    recentMessages: async () => [], currentFacts: async () => ({ profile: {} }), markFirstReply: async () => user,
    persistFacts: async () => [], withdrawConsent: record("withdraw"), deleteUserData: record("delete") };
  return { store, calls, user };
}
async function main() {
  const receipt = JSON.parse(fs.readFileSync(path.join(bundle, "legacy-alternative/receipt.json")));
  const originalManifest = JSON.parse(fs.readFileSync(path.join(bundle, "manifest.json")));
  const verifiedEntries = new Set();
  for (const f of originalManifest.preserved) {
    const file = path.join(ROOT, f.path); assert.equal(digest(fs.readFileSync(file)), f.sha256);
    for (const [name, bytes] of zip(file)) verifiedEntries.add(name + ":" + digest(bytes));
  }
  const packages = new Map(); const provenance = [];
  for (const pkg of receipt.packages) {
    const file = path.join(ROOT, pkg.path), bytes = fs.readFileSync(file), files = zip(file); packages.set(pkg.name, files);
    await test(pkg.name + ": archive digest and complete provenance", () => {
      assert.equal(digest(bytes), pkg.sha256); assert.equal(files.size, pkg.evidence.length);
      for (const e of pkg.evidence) { assert.equal(digest(files.get(e.name)), e.sha256); }
    });
    await test(pkg.name + ": helpers match original archives; primaries match declared Git", () => {
      for (const e of pkg.evidence) {
        if (e.source === "verified original ZIP") assert(verifiedEntries.has(e.name + ":" + e.sha256));
        else {
          assert.equal(e.commit, receipt.historical_source);
          const bytes = execFileSync("git", ["show", e.commit + ":netlify/functions/" + e.name], { cwd: ROOT, windowsHide: true });
          const normalized = bytes.toString().replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
          assert.equal(digest(Buffer.from(normalized)), e.sha256);
        }
      }
    });
    const graph = {};
    await test(pkg.name + ": all static and lazy imports resolve inside ZIP", () => {
      for (const [name, data] of files) if (name.endsWith(".js")) {
        graph[name] = [];
        for (const m of data.toString().matchAll(/require\(["']([^"']+)["']\)/g)) {
          if (["crypto", "node:crypto", "http2"].includes(m[1])) continue;
          assert(m[1].startsWith("."), name + ": unsupported " + m[1]);
          let target = path.posix.normalize(path.posix.join(path.posix.dirname(name), m[1]));
          if (!path.posix.extname(target)) target += ".js";
          assert(files.has(target), name + " missing " + target); graph[name].push(target);
        }
      }
    });
    await test(pkg.name + ": actual eager import cycle loads", () => {
      const runtime = sandbox(files); assert.equal(typeof runtime.load(pkg.name + ".js").handler, "function");
      assert.equal(typeof runtime.load("whatsapp-agent.js").handler, "function");
      assert.equal(typeof runtime.load("_bm_final_qa_dispatch.js").processFinalTwilioMessage, "function");
      assert.equal(runtime.load("_bm_final_qa_dispatch.js").handler, undefined);
    });
    provenance.push({ name: pkg.name, sha256: pkg.sha256, entries: files.size, imports: graph });
  }
  const files = packages.get("waitlist-agent");
  for (const endpoint of ["waitlist-agent", "whatsapp-agent", "sms-agent"]) {
    const set = endpoint === "sms-agent" ? packages.get("sms-agent") : files;
    await test(endpoint + ": production rejects unsigned Twilio before side effects", async () => {
      const s = sandbox(set); const e = signedTwilio(endpoint); e.headers["x-twilio-signature"] = "bad";
      assert.equal((await s.load(endpoint + ".js").handler(e)).statusCode, 403);
    });
    await test(endpoint + ": signed queue and empty TwiML acknowledgement", async () => {
      const calls = []; const s = sandbox(set, {}, {}, async (url, options) => { calls.push({ url, options }); return { ok: true, status: 202, text: async () => "" }; });
      const r = await s.load(endpoint + ".js").handler(signedTwilio(endpoint));
      assert.equal(r.statusCode, 200); assert(r.body.includes("<Response>")); assert(!r.body.includes("<Message>")); assert.equal(calls.length, 1);
      assert.equal(calls[0].url, "https://getblank.netlify.app/.netlify/functions/waitlist-agent-background");
      const queued = JSON.parse(calls[0].options.body).message; assert.equal(queued.phone, message.phone); assert.equal(queued.providerMessageId, message.providerMessageId);
      assert.equal(s.load("_waitlist_whatsapp.js").verifyBackgroundSignature({ body: calls[0].options.body, headers: calls[0].options.headers }), true);
    });
    await test(endpoint + ": altered signed body rejected", async () => {
      const e = signedTwilio(endpoint); e.body += "&Body=tampered";
      assert.equal((await sandbox(set).load(endpoint + ".js").handler(e)).statusCode, 403);
    });
    await test(endpoint + ": self-sender ignored", async () => {
      const s = sandbox(set, {}, { TWILIO_WHATSAPP_FROM_NUMBER: "whatsapp:" + message.phone });
      assert.equal((await s.load(endpoint + ".js").handler(signedTwilio(endpoint))).statusCode, 200);
    });
    await test(endpoint + ": queue unavailable does not acknowledge successful delivery", async () => {
      const s = sandbox(set, {}, {}, async () => ({ ok: false, status: 503, text: async () => "fixture unavailable" }));
      const fn = () => s.load(endpoint + ".js").handler(signedTwilio(endpoint));
      if (endpoint === "sms-agent") await assert.rejects(fn, /waitlist_twilio_background_enqueue_503/);
      else assert.equal((await fn()).statusCode, 503);
    });
    await test(endpoint + ": inline fixture preserves XML escaping and consent fallback", async () => {
      const fixture = storeFixture({ missing: true }); const s = sandbox(set, { "_waitlist_store.js": fixture.store }, { WAITLIST_TWILIO_ASYNC: "false" });
      const r = await s.load(endpoint + ".js").handler(signedTwilio(endpoint)); assert.equal(r.statusCode, 200); assert(r.body.includes("<Message>")); assert(fixture.calls.some(c => c.name === "complete"));
    });
  }
  for (const endpoint of ["waitlist-agent", "whatsapp-agent"]) {
    await test(endpoint + ": signed Meta empty payload accepted", async () => assert.equal((await sandbox(files).load(endpoint + ".js").handler(signedMeta())).statusCode, 200));
    await test(endpoint + ": Meta body tampering rejected", async () => { const e = signedMeta(); e.body += " "; assert.equal((await sandbox(files).load(endpoint + ".js").handler(e)).statusCode, 403); });
    await test(endpoint + ": verification challenge and invalid token", async () => {
      const handler = sandbox(files).load(endpoint + ".js").handler;
      const e = { httpMethod: "GET", queryStringParameters: { "hub.mode": "subscribe", "hub.verify_token": "fixture-verify", "hub.challenge": "fixture-challenge" } };
      assert.equal((await handler(e)).body, "fixture-challenge"); e.queryStringParameters["hub.verify_token"] = "bad"; assert.equal((await handler(e)).statusCode, 403);
    });
  }
  for (const options of [{ missing: true }, { user: { data_consent: false } }, { user: { whatsapp_consent: false } }, { user: { status: "deleted" } }]) {
    await test("waitlist: consent/account gate " + JSON.stringify(options), async () => {
      const fixture = storeFixture(options), s = sandbox(files, { "_waitlist_store.js": fixture.store });
      const result = await s.load("waitlist-agent.js").processMessage(message);
      assert.equal(result.kind, "privacy"); assert.equal(result.user, null); assert(fixture.calls.some(c => c.name === "complete")); assert(!fixture.calls.some(c => c.name === "message"));
    });
  }
  await test("waitlist: completed duplicate never runs generation or delivery", async () => {
    const fixture = storeFixture({ missing: true }), s = sandbox(files, { "_waitlist_store.js": fixture.store }); const agent = s.load("waitlist-agent.js");
    await agent.processMessage(message); const result = await agent.processMessage(message); assert.equal(result.reason, "duplicate_inbound"); assert.equal(fixture.calls.filter(c => c.name === "lookup").length, 1);
  });
  await test("waitlist: active account fixture and persisted account identity", async () => {
    const fixture = storeFixture(), modelCalls = [];
    const ai = { extractFacts: async () => [], canonicalizeConversation: async v => v, generateReply: async v => { modelCalls.push(v); return { reply: "Fixture reply", focus: "natural_followup" }; } };
    const s = sandbox(files, { "_waitlist_store.js": fixture.store, "_waitlist_ai.js": ai }); const r = await s.load("waitlist-agent.js").processMessage(message);
    assert.equal(r.reply, "Fixture reply"); assert.equal(modelCalls.length, 1); assert(fixture.calls.filter(c => c.name === "message").every(c => c.args[0].userId === fixture.user.id)); assert(fixture.calls.some(c => c.name === "complete"));
  });
  await test("waitlist: persistence failure releases inbound claim", async () => {
    const fixture = storeFixture(); fixture.store.recentMessages = async () => { throw Error("fixture-database-down"); };
    await assert.rejects(() => sandbox(files, { "_waitlist_store.js": fixture.store }).load("waitlist-agent.js").processMessage(message), /fixture-database-down/);
    assert(fixture.calls.some(c => c.name === "release"));
  });
  for (const spec of [{ channel: "sms", phone: envDefaults.BM_FINAL_QA_WHATSAPP_PHONE }, { channel: "whatsapp", phone: message.phone }, { channel: "whatsapp", phone: envDefaults.BM_FINAL_QA_WHATSAPP_PHONE, providerMessageId: "" }]) {
    await test("dispatch: deny wrong channel/account/missing ID " + JSON.stringify(spec), async () => {
      const result = await sandbox(files).load("_bm_final_qa_dispatch.js").processFinalTwilioMessage({ ...message, ...spec }); assert.equal(result.skipped, true);
    });
  }
  await test("dispatch: audio combines canonical text, exact identity and message ID", async () => {
    const received = []; const s = sandbox(files, { "whatsapp-agent.js": { processTrustedQaMessage: async m => { received.push(m); return { sent: true }; } }, "_waitlist_whatsapp.js": { transcribeAudio: async () => "Transcript" } });
    const r = await s.load("_bm_final_qa_dispatch.js").processFinalTwilioMessage({ ...message, phone: envDefaults.BM_FINAL_QA_WHATSAPP_PHONE, audio: { url: "fixture" } });
    assert.equal(r.sent, true); assert.equal(received[0].text, "Hello\nTranscript"); assert.equal(received[0].from, envDefaults.BM_FINAL_QA_WHATSAPP_PHONE); assert.equal(received[0].id, message.providerMessageId);
  });
  await test("dispatch: transcription failure keeps original text and identity", async () => {
    const received = []; const s = sandbox(files, { "whatsapp-agent.js": { processTrustedQaMessage: async m => { received.push(m); return { sent: true }; } }, "_waitlist_whatsapp.js": { transcribeAudio: async () => { throw Error("fixture-audio-error"); } } });
    await s.load("_bm_final_qa_dispatch.js").processFinalTwilioMessage({ ...message, phone: envDefaults.BM_FINAL_QA_WHATSAPP_PHONE, audio: {} }); assert.equal(received[0].text, message.text);
  });
  await test("WhatsApp: trusted caller cannot bypass sender or message ID", async () => {
    const agent = sandbox(files).load("whatsapp-agent.js");
    assert.equal((await agent.processTrustedQaMessage({ from: message.phone, id: "fixture" })).reason, "bm_final_qa_not_allowed");
    assert.equal((await agent.processTrustedQaMessage({ from: envDefaults.BM_FINAL_QA_WHATSAPP_PHONE })).reason, "bm_final_qa_message_id_required");
  });
  await test("WhatsApp: duplicate claim bypasses paid model and send", async () => {
    const s = sandbox(files, { "_assistant_channel.js": { claimAssistantInboundMessage: async () => ({ claimed: false }) } });
    assert.equal((await s.load("whatsapp-agent.js").processTrustedQaMessage({ from: envDefaults.BM_FINAL_QA_WHATSAPP_PHONE, id: "fixture" })).reason, "duplicate_inbound");
  });
  await test("Meta: signed QA account routes only to trusted dispatch", async () => {
    const received = [], s = sandbox(files, { "whatsapp-agent.js": { processTrustedQaMessage: async m => { received.push(m); return { sent: true }; } } });
    const e = signedMeta([{ from: envDefaults.BM_FINAL_QA_WHATSAPP_PHONE.slice(1), id: "wamid-fixture", type: "text", text: { body: "Fixture" } }]);
    assert.equal((await s.load("waitlist-agent.js").handler(e)).statusCode, 200); assert.equal(received.length, 1); assert.equal(received[0].from, envDefaults.BM_FINAL_QA_WHATSAPP_PHONE); assert.equal(received[0].id, "wamid-fixture");
  });
  await test("Meta: ordinary account gets consent reply through mocked transport", async () => {
    const fixture = storeFixture({ missing: true }), sends = [];
    const actual = sandbox(files).load("_waitlist_whatsapp.js");
    const s = sandbox(files, { "_waitlist_store.js": fixture.store, "_waitlist_whatsapp.js": { ...actual, sendMetaText: async (phone, text) => { sends.push({ phone, text }); return { id: "fixture-out" }; } } });
    const r = await s.load("waitlist-agent.js").handler(signedMeta([{ from: message.phone.slice(1), id: "wamid-normal", type: "text", text: { body: "Hello" } }]));
    assert.equal(r.statusCode, 200); assert.equal(sends.length, 1); assert.equal(sends[0].phone, message.phone); assert(!fixture.calls.some(c => c.name === "message"));
  });
  const bgFiles = packages.get("waitlist-agent-background");
  await test("background: rejects unsigned, tampered, invalid and wrong method", async () => {
    const handler = sandbox(bgFiles).load("waitlist-agent-background.js").handler;
    assert.equal((await handler({ httpMethod: "GET" })).statusCode, 405);
    assert.equal((await handler({ httpMethod: "POST", body: "{}", headers: {} })).statusCode, 403);
    const e = signedBackground(message); e.body += " "; assert.equal((await handler(e)).statusCode, 403);
    assert.equal((await handler(signedBackground({ ...message, providerMessageId: "" }))).statusCode, 400);
  });
  await test("background: signed exact QA account bypasses public waitlist delivery", async () => {
    const calls = [], s = sandbox(bgFiles, { "_bm_final_qa_dispatch.js": { processFinalTwilioMessage: async m => { calls.push(m); return { sent: true }; } } });
    const r = await s.load("waitlist-agent-background.js").handler(signedBackground({ ...message, phone: envDefaults.BM_FINAL_QA_WHATSAPP_PHONE }));
    assert.equal(r.statusCode, 200); assert.equal(JSON.parse(r.body).route, "bm_final_qa"); assert.equal(calls.length, 1);
  });
  async function backgroundCase(label, processResult, send, expectedStatus, expectedComplete, expectedRelease) {
    await test("background: " + label, async () => {
      const calls = [], fixture = storeFixture(); fixture.store.completeInbound = async () => calls.push("complete"); fixture.store.releaseInbound = async () => calls.push("release");
      const realTransport = sandbox(bgFiles).load("_waitlist_whatsapp.js");
      const s = sandbox(bgFiles, { "_waitlist_store.js": fixture.store, "waitlist-agent.js": { processMessage: async (m, o) => { assert.equal(o.deferDelivery, true); calls.push("process"); return processResult; }, saveOutbound: async () => calls.push("save") }, "_waitlist_whatsapp.js": { ...realTransport, sendTwilioText: async (...args) => { calls.push("send"); return send(...args); } } });
      const r = await s.load("waitlist-agent-background.js").handler(signedBackground(message));
      assert.equal(r.statusCode, expectedStatus); assert.equal(calls.includes("complete"), expectedComplete); assert.equal(calls.includes("release"), expectedRelease);
      if (expectedStatus === 200 && !processResult.skipped) { assert(calls.indexOf("send") < calls.indexOf("complete")); if (processResult.user) assert(calls.indexOf("save") < calls.indexOf("complete")); }
    });
  }
  await backgroundCase("ordered delivery/persistence/completion", { reply: "Fixture", user: { id: "fixture" } }, async () => ({ id: "SM-out", status: "queued" }), 200, true, false);
  await backgroundCase("duplicate skips send", { skipped: true, reason: "duplicate_inbound" }, async () => { throw Error("must not send"); }, 200, false, false);
  await backgroundCase("permanent send failure releases claim", { reply: "Fixture" }, async () => { throw Error("waitlist_twilio_text_send_400:fixture"); }, 500, false, true);
  let retries = 0;
  await backgroundCase("retryable send then success", { reply: "Fixture" }, async () => { if (++retries < 3) throw Error("waitlist_twilio_text_send_503:fixture"); return { id: "SM-out" }; }, 200, true, false);
  assert.equal(retries, 3);
  await test("background: post-delivery persistence failure completes instead of resending", async () => {
    const fixture = storeFixture(), transport = sandbox(bgFiles).load("_waitlist_whatsapp.js");
    const s = sandbox(bgFiles, { "_waitlist_store.js": fixture.store, "waitlist-agent.js": { processMessage: async () => ({ reply: "Fixture", user: fixture.user }), saveOutbound: async () => { throw Error("fixture-persistence-failed"); } }, "_waitlist_whatsapp.js": { ...transport, sendTwilioText: async () => ({ id: "SM-sent" }) } });
    assert.equal((await s.load("waitlist-agent-background.js").handler(signedBackground(message))).statusCode, 500);
    assert(fixture.calls.some(c => c.name === "complete")); assert(!fixture.calls.some(c => c.name === "release"));
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(bundle, "manifest.json")));
  await test("preservation: all 67 original digests and 17 static objects unchanged", () => {
    assert.equal(manifest.preserved.length, 67);
    for (const f of manifest.preserved) assert.equal(digest(fs.readFileSync(path.join(ROOT, f.path))), f.sha256);
    const backup = manifest.static_backup || manifest.staticBackup;
    assert(backup); assert.equal(digest(fs.readFileSync(path.join(ROOT, backup.path))), backup.sha256);
    assert.equal([...zip(path.join(ROOT, backup.path)).values()].length, 17);
  });
  const report = { schema_version: 1, generated_at: new Date().toISOString(), scope: "Archive runtime compatibility against representative hermetic fixtures; original missing primary bytes are unavailable, so byte equivalence is not claimed.", paid_calls: 0, real_messages: 0, denied_unexpected_network: deniedNetwork, provenance, tests: results, pass: results.every(r => r.pass) && deniedNetwork === 0, limitation: "_bm_final_qa_dispatch exports an internal dispatch function, not a public handler, matching the historical source. Physical delivery and real-provider integration are not certified." };
  const out = path.join(bundle, "evidence/legacy-runtime-validation.json"); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ pass: report.pass, tests: results.length, failures: results.filter(r => !r.pass), deniedNetwork, out }));
  if (!report.pass) process.exitCode = 1;
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
