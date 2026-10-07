"use strict";
// Only the existing private QA origins and synthetic accounts. No device, push,
// real user's conversation, public transport or native action is invoked.
const fs = require("node:fs"), crypto = require("node:crypto");
const { configuration, memoryIdentity } = require("./assistant_app_cloud_test");
async function run() {
  const c = configuration(), users = [], checks = [], cleanup = [];
  const service = { apikey: c.serviceKey, authorization: `Bearer ${c.serviceKey}` };
  const ensure = (value, code) => { if (!value) throw Error(code); };
  const request = async (origin, route, body, headers = {}, method = "POST") => {
    ensure([c.supabase, c.netlify].includes(origin) && route.startsWith("/") && !route.startsWith("//"), "target_rejected");
    return fetch(origin + route, { method, headers: { "content-type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120000) });
  };
  const db = (route, body, method = "POST") => request(c.supabase, "/rest/v1/" + route, body, service, method);
  const check = async (name, fn) => { await fn(); checks.push({ name, passed: true }); console.log("PASS " + name); };
  const voice = (user, turn, id = crypto.randomUUID(), extra = {}) => request(c.netlify, "/.netlify/functions/assistant-app-voice",
    { turn_id: turn, request_id: id, app_install_id: user.install, ...extra }, { ...c.extraHeaders, authorization: "Bearer " + user.token });
  let failure;
  try {
    for (let index = 0; index < 2; index++) {
      const id = crypto.randomUUID(), email = "voice-" + id + "@example.invalid", password = crypto.randomBytes(28).toString("base64url");
      const created = await request(c.supabase, "/auth/v1/admin/users", { email, password, email_confirm: true,
        app_metadata: { provider: "apple", providers: ["apple"], synthetic_staging_run: id } }, service);
      ensure(created.ok, "create_account_failed");
      const user = { id: (await created.json()).id, install: "voice-qa-" + id }; users.push(user);
      const login = await request(c.supabase, "/auth/v1/token?grant_type=password", { email, password }, { apikey: c.anonKey });
      ensure(login.ok, "login_failed"); user.token = (await login.json()).access_token;
      const activated = await request(c.netlify, "/.netlify/functions/assistant-app", { action: "activate", app_install_id: user.install },
        { ...c.extraHeaders, authorization: "Bearer " + user.token });
      ensure(activated.ok, "activate_failed"); user.connect = (await activated.json()).assistant_connect_code;
      const links = await db("blankmind_identity_links?auth_user_id=eq." + user.id + "&select=id,anonymous_user_id", undefined, "GET");
      ensure(links.ok, "identity_read_failed"); user.links = await links.json();
    }
    const a = users[0], b = users[1], turns = [];
    for (const [language, text] of [["en", "Your phone can rest now. Put it aside for a quiet evening."],
      ["es", "Tu móvil puede descansar ahora. Déjalo a un lado para disfrutar de una noche tranquila."]]) {
      const turn = crypto.randomUUID(); turns.push(turn);
      const inserted = await db("assistant_app_turns", { id: turn, auth_user_id: a.id, user_text: "Synthetic voice QA",
        assistant_text: text, status: "completed", completed_at: new Date().toISOString() });
      ensure(inserted.ok, "fixture_turn_failed");
      const id = crypto.randomUUID();
      await check("real_pcm_stream_" + language, async () => {
        const started = performance.now(), response = await voice(a, turn, id);
        ensure(response.ok && response.headers.get("X-Voice-Format") === "pcm-s16le-24000-mono", "voice_http_failed");
        ensure(response.headers.get("Cache-Control") === "no-store", "voice_cache_enabled");
        let buffered = "", bytes = 0, end = false, first = null;
        const decoder = new TextDecoder();
        for await (const chunk of response.body) {
          buffered += decoder.decode(chunk, { stream: true });
          let newline;
          while ((newline = buffered.indexOf("\n")) >= 0) {
            const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
            if (!line) continue;
            const frame = JSON.parse(line);
            ensure(frame.turn_id === turn && !end, "voice_frame_order");
            if (frame.type === "audio") {
              const audio = Buffer.from(frame.pcm, "base64"); ensure(audio.length > 0 && audio.length % 2 === 0, "invalid_pcm");
              bytes += audio.length; first ??= Math.round(performance.now() - started);
            } else { ensure(frame.type === "end", "voice_stream_failed"); end = true; }
          }
        }
        ensure(end && bytes > 0 && !buffered.trim(), "voice_truncated");
        checks.push({ name: "timing_" + language, passed: true, first_audio_ms: first,
          generation_ms: Math.round(performance.now() - started), audio_bytes: bytes });
      });
      await check("same_request_cannot_regenerate_" + language, async () => {
        const response = await voice(a, turn, id); ensure(response.status === 409, "voice_replay_regenerated");
      });
    }
    await check("other_account_cannot_speak_turn", async () => ensure((await voice(b, turns[0])).status === 404, "cross_account_voice"));
    await check("client_cannot_supply_text", async () => ensure((await voice(a, turns[0], undefined, { text: "arbitrary" })).status === 400, "arbitrary_voice_text"));
    await check("invalid_installation_cannot_speak", async () => ensure((await voice(a, turns[0], undefined,
      { app_install_id: "unverified" })).status === 403, "unverified_voice"));
    await check("cancelled_audio_remains_text", async () => {
      const response = await voice(a, turns[0]); ensure(response.ok, "cancel_voice_http");
      const reader = response.body.getReader(); ensure(!(await reader.read()).done, "cancel_voice_missing_audio"); await reader.cancel();
      const stored = await db("assistant_app_turns?id=eq." + turns[0] + "&select=status,assistant_text", undefined, "GET");
      ensure(stored.ok && (await stored.json())[0]?.status === "completed", "cancel_voice_changed_turn");
    });
    await check("durable_quota_stops_generation", async () => {
      let limited = false;
      for (let i = 0; i < 21; i++) {
        const reservation = await db("rpc/reserve_assistant_voice", { p_auth_user_id: a.id, p_turn_id: turns[0], p_request_id: crypto.randomUUID() });
        ensure(reservation.ok, "quota_reservation_failed"); const row = (await reservation.json())[0];
        if (!row.reserved) { ensure(row.reason === "rate_limited", "unexpected_quota_reason"); limited = true; break; }
      }
      ensure(limited && (await voice(a, turns[0])).status === 429, "voice_quota_bypassed");
    });
  } catch (error) { failure = /^[a-z0-9_]+$/i.test(error.message) ? error.message : "unexpected_cloud_error"; }
  finally {
    for (const user of users) {
      const namespaces = [memoryIdentity("app", user.id), "connect:" + user.connect, ...(user.links || []).map(row => row.anonymous_user_id)].filter(Boolean);
      for (const [name, action] of [
        ["identity", () => db("blankmind_identity_links?auth_user_id=eq." + user.id, undefined, "DELETE")],
        ...namespaces.map(id => ["events", () => db("digital_wellness_feature_payloads?anonymous_user_id=eq." + encodeURIComponent(id), undefined, "DELETE")]),
        ["semantic", () => db("assistant_semantic_conversations?anonymous_user_id=eq." + memoryIdentity("app", user.id), undefined, "DELETE")],
        ["account_turns_usage", () => request(c.supabase, "/auth/v1/admin/users/" + user.id, undefined, service, "DELETE")],
      ]) {
        try { cleanup.push({ name, passed: (await action()).ok }); } catch (_) { cleanup.push({ name, passed: false }); }
      }
    }
  }
  const result = { scope: "private QA endpoint and real TTS; synthetic turns; no physical device", checks, cleanup,
    passed: !failure && cleanup.every(x => x.passed), ...(failure ? { failure } : {}) };
  fs.mkdirSync("tmp/voice", { recursive: true }); fs.writeFileSync("tmp/voice/cloud-smoke.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: result.passed, checks: checks.length, cleanup_passed: cleanup.every(x => x.passed), failure }));
  if (!result.passed) process.exitCode = 1;
  return result;
}
if (require.main === module) {
  if (!process.argv.includes("--run")) { console.error("Use --run for the private QA synthetic smoke"); process.exitCode = 1; }
  else run().catch(() => { console.error("voice_cloud_unavailable"); process.exitCode = 1; });
}
module.exports = { run };
