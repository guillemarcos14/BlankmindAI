"use strict";
const assert = require("node:assert/strict");
const membership = require("../netlify/functions/_membership");
const identity = require("../netlify/functions/_identity");
const userID = "11111111-1111-4111-8111-111111111111";
const turnID = "22222222-2222-4222-8222-222222222222";
const requestID = "33333333-3333-4333-8333-333333333333";
membership.getSupabaseUser = async event => event.headers.authorization === "Bearer fixture"
  ? { id: userID, app_metadata: { provider: "apple" } } : null;
identity.identityForAuthUser = async () => ({ auth_user_id: userID, app_install_id: "verified",
  assistant_connect_code: "FIXTURE" });
const { voice, MAX_AUDIO_BYTES } = require("../netlify/functions/bm-voice-output");
const body = { turn_id: turnID, request_id: requestID, app_install_id: "verified" };
const request = (override = {}, token = "fixture") => new Request("https://blank.test/voice", {
  method: "POST", headers: { authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ ...body, ...override }),
});
let reserved = 0, generated = 0, reads = 0;
let row = { status: "completed", assistant_text: "Tu respuesta final, con sueño y descanso." };
let readOverride, reserveOverride, fetchOverride;
let input, aborted = false;
const deps = {
  readTurn: async (owner, id) => {
    assert.equal(owner, userID); assert.equal(id, turnID); reads++;
    return readOverride ? readOverride(reads) : row;
  },
  reserve: async args => {
    assert.deepEqual(args, { p_auth_user_id: userID, p_turn_id: turnID, p_request_id: requestID });
    reserved++;
    return reserveOverride ? reserveOverride() : [{ reserved: true }];
  },
  fetch: async (url, options) => {
    generated++; assert.equal(url, "https://api.openai.com/v1/audio/speech");
    input = JSON.parse(options.body);
    options.signal.addEventListener("abort", () => { aborted = true; });
    return fetchOverride ? fetchOverride() : new Response(new Uint8Array([0, 0, 255, 127, 0, 128]));
  },
};
async function error(status, code, response) {
  assert.equal(response.status, status); assert.equal((await response.json()).error, code);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
}
async function run() {
  process.env.BM_VOICE_ENABLED = "true"; process.env.OPENAI_API_KEY = "fixture-key";
  await error(401, "authentication_required", await voice(request({}, "invalid"), deps));
  await error(403, "installation_not_verified", await voice(request({ app_install_id: "other" }), deps));
  await error(400, "invalid_voice_request", await voice(request({ text: "speak arbitrary text" }), deps));
  await error(400, "invalid_voice_request", await voice(request({ turn_id: "invalid" }), deps));
  assert.equal(reserved, 0); assert.equal(generated, 0);
  row = null;
  await error(404, "turn_not_found", await voice(request(), deps));
  row = { status: "processing", assistant_text: "draft" };
  await error(409, "voice_turn_not_ready", await voice(request(), deps));
  row = { status: "completed", assistant_text: "" };
  await error(422, "voice_text_unavailable", await voice(request(), deps));
  row.assistant_text = "**Tu respuesta** final 👋";
  const response = await voice(request(), deps);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Voice-Format"), "pcm-s16le-24000-mono");
  const frames = (await response.text()).trim().split("\n").map(JSON.parse);
  assert.deepEqual(frames.map(f => f.type), ["audio", "end"]);
  assert.deepEqual([...Buffer.from(frames[0].pcm, "base64")], [0, 0, 255, 127, 0, 128]);
  assert.ok(frames.every(f => f.turn_id === turnID));
  assert.equal(input.input, "Tu respuesta final 👋");
  assert.equal(input.voice, "marin"); assert.equal(input.response_format, "pcm");
  const count = generated;
  reserveOverride = () => [{ reserved: false, reason: "duplicate" }];
  await error(409, "voice_request_used", await voice(request(), deps));
  reserveOverride = () => [{ reserved: false, reason: "rate_limited" }];
  await error(429, "voice_rate_limited", await voice(request(), deps));
  assert.equal(generated, count); reserveOverride = null;
  reads = 0; readOverride = n => n === 1 ? row : null;
  await error(409, "voice_text_unavailable", await voice(request(), deps));
  assert.equal(generated, count); readOverride = null;
  fetchOverride = () => new Response("private provider detail", { status: 429 });
  await error(503, "voice_unavailable", await voice(request(), deps));
  fetchOverride = () => new Response(new Uint8Array([1]));
  assert.equal(JSON.parse((await (await voice(request(), deps)).text()).trim()).type, "error");
  fetchOverride = () => new Response(new Uint8Array());
  assert.equal(JSON.parse((await (await voice(request(), deps)).text()).trim()).type, "error");
  fetchOverride = () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array([0, 0])); controller.error(new Error("private provider failure"));
  } }));
  const broken = await (await voice(request(), deps)).text();
  assert.ok(broken.includes('"type":"error"')); assert.ok(!broken.includes("private"));
  fetchOverride = () => new Response(new Uint8Array(MAX_AUDIO_BYTES + 2));
  assert.equal(JSON.parse((await (await voice(request(), deps)).text()).trim()).type, "error");
  fetchOverride = null; aborted = false;
  const cancelled = await voice(request(), deps);
  await cancelled.body.cancel(); assert.equal(aborted, true);
  process.env.BM_VOICE_ENABLED = "false";
  await error(503, "voice_disabled", await voice(request(), deps));
  console.log("Voice backend: auth/install isolation, final text, quotas/dedup, deletion, PCM, errors, cancellation and kill switch PASS");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
