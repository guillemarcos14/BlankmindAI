"use strict";
const assert = require("node:assert/strict");
const { alignWords, wav } = require("../netlify/functions/bm-voice-alignment");
const { voice } = require("../netlify/functions/bm-voice-output");
const words = values => values.map((word, i) => ({ word, start: i * 0.3, end: i * 0.3 + 0.2 }));
assert.deepEqual(alignWords("Hola, ¿cómo estás? 👋", words(["Hola", "cómo", "estás"]), 1),
  [{ start: 0, end: 7 }, { start: 0.3, end: 12 }, { start: 0.6, end: 21 }]);
assert.deepEqual(alignWords("Sleep 7 hours tonight.", words(["Sleep", "seven", "hours", "tonight"]), 2)
  .map(c => c.start), [0, 0.3, 0.6, 0.8999999999999999]);
assert.deepEqual(alignWords("A las 7:30 descansa.", words(["A", "las", "siete", "y", "media", "descansa"]), 2)
  .map(c => c.start), [0, 0.3, 0.6, 1.5]);
assert.throws(() => alignWords("Sleep more", words(["Sleep", "less"]), 1), /mismatch/);
assert.throws(() => alignWords("Hello", [{ word: "Hello", start: -1, end: 0 }], 1), /invalid/);
assert.throws(() => alignWords("Hello", [{ word: "Hello", start: 0, end: 10 }], 1), /invalid/);
assert.throws(() => alignWords("7 8 hours", words(["seven", "eight", "hours"]), 1), /ambiguous/);
const pcm = Buffer.alloc(48000);
const wave = wav(pcm);
assert.equal(wave.toString("ascii", 0, 4), "RIFF");
assert.equal(wave.readUInt32LE(24), 24000);
assert.equal(wave.readUInt32LE(40), pcm.length);
assert.equal(wave.length, pcm.length + 44);

async function run() {
  process.env.BM_VOICE_ENABLED = "true"; process.env.OPENAI_API_KEY = "fixture";
  const turn = "22222222-2222-4222-8222-222222222222";
  const request = () => new Request("https://blank.test/voice", { method: "POST", body: JSON.stringify({
    turn_id: turn, request_id: "33333333-3333-4333-8333-333333333333", synchronized: true,
  }) });
  let deleted = false, mismatch = false, reads = 0, calls = [];
  const deps = {
    authenticate: async () => ({ user: { id: "fixture-owner" } }),
    readTurn: async () => { reads++; return deleted && reads === 3 ? null : { status: "completed", assistant_text: "Hola mundo." }; },
    reserve: async () => [{ reserved: true }],
    fetch: async (url, options) => {
      calls.push(url);
      if (url.endsWith("/speech")) return new Response(pcm);
      assert.equal(options.body.get("model"), "whisper-1");
      assert.equal(options.body.get("timestamp_granularities[]"), "word");
      assert.equal(options.body.get("file").size, pcm.length + 44);
      return Response.json({ words: words(mismatch ? ["Hola", "otro"] : ["Hola", "mundo"]) });
    },
  };
  const response = await voice(request(), deps);
  assert.equal(response.status, 200);
  const frames = (await response.text()).trim().split("\n").map(JSON.parse);
  assert.deepEqual(frames.slice(0, 2), [
    { turn_id: turn, type: "cue", start: 0, end: 5 },
    { turn_id: turn, type: "cue", start: 0.3, end: 11 },
  ]);
  assert.equal(frames.at(-1).type, "end");
  assert.equal(Buffer.concat(frames.filter(f => f.type === "audio").map(f => Buffer.from(f.pcm, "base64"))).length, pcm.length);
  assert.ok(frames.filter(f => f.type === "audio").every(f => Buffer.from(f.pcm, "base64").length <= 8192));
  assert.equal(calls.length, 2);
  deleted = true; reads = 0;
  assert.equal((await voice(request(), deps)).status, 503, "Deletion during alignment must reject playback");
  deleted = false; mismatch = true;
  const failure = await voice(request(), deps);
  assert.equal(failure.status, 503);
  assert.deepEqual(await failure.json(), { error: "voice_unavailable" });
  console.log("Voice alignment PASS: ES/EN, numbers, canonical UTF-16, WAV, cue ordering, deletion and mismatch fallback");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
