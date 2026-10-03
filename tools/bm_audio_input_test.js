"use strict";
const assert = require("node:assert/strict");
const { transcribe } = require("../netlify/functions/bm-audio-input");
async function main() {
  const old = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "synthetic-test-key";
  let calls = 0;
  const file = Buffer.alloc(64); file.write("ftyp", 4);
  const audio = file.toString("base64");
  const mock = async (url, options) => {
    calls++;
    assert.equal(url, "https://api.openai.com/v1/audio/transcriptions");
    assert.equal(options.body.get("file").type, "audio/mp4");
    assert.equal(options.body.get("model"), process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe");
    assert(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => ({ text: " Bloquea 20 minutos. " }) };
  };
  try {
    for (const value of [undefined, "!", "a".repeat(2800001), Buffer.alloc(64).toString("base64")]) {
      assert.equal((await transcribe({ audio_base64: value }, mock)).status, 400);
    }
    assert.equal(calls, 0);
    assert.deepEqual(await transcribe({ audio_base64: audio }, mock), { status: 200, text: "Bloquea 20 minutos." });
    assert.equal(calls, 1);
    assert.equal((await transcribe({ audio_base64: audio }, async () => ({ ok: true, json: async () => ({ text: "" }) }))).status, 422);
    assert.equal((await transcribe({ audio_base64: audio }, async () => ({ ok: false }))).status, 503);
    delete process.env.OPENAI_API_KEY;
    assert.equal((await transcribe({ audio_base64: audio }, mock)).status, 503);
    console.log("Audio: bounded format, missing credentials, multipart transcription, silence and provider failure PASS (mock)");
  } finally { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = old; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
