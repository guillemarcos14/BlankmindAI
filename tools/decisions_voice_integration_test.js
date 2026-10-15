"use strict";
// Exercise the merged planner -> committed reply -> consented timed voice contract.
// Providers are hermetic fixtures: no network, paid inference or native action.
const assert = require("node:assert/strict");
const retrieval = require("../netlify/functions/bm-retrieval-step");
const { plan } = require("../netlify/functions/bmb-brain");
const { voice } = require("../netlify/functions/bm-voice-output");
const owner = "11111111-1111-4111-8111-111111111111";
const turn = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
async function main() {
  const before = { ...process.env }, fetchBefore = global.fetch, infoBefore = console.info;
  Object.assign(process.env, { SUPABASE_URL: "https://njqbovsmoowkhhsqmitn.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "fixture", OPENAI_API_KEY: "fixture",
    BM_RETRIEVAL_STEP_ENABLED: "true", BM_DECISIONS_DATA_POLICY: "authenticated-account-records",
    BM_RETRIEVAL_STEP_QA_ENABLED: "false", BM_DECISIONS_QA_ENABLED: "false",
    BM_VOICE_ENABLED: "true", BM_VOICE_PROVIDER: "elevenlabs", ELEVENLABS_API_KEY: "fixture" });
  console.info = () => {};
  try {
    for (const language of ["es", "en"]) {
      let classifiers = 0, generations = 0, speeches = 0, reservations = 0;
      global.fetch = async (url, options) => {
        assert.equal(url, "https://api.openai.com/v1/decisions"); classifiers++;
        const input = JSON.parse(options.body);
        return { ok: true, json: async () => ({ model: "gpt-6-luna", usage: { input_tokens: 1, output_tokens: 0 },
          answers: input.questions.map(q => ({ name: q.name, type: "predicate",
            probability: ["eligible", "sleep", "yesterday"].includes(q.name) ? 1 : 0 })) }) };
      };
      const prompt = language === "es" ? "Consulta cuánto dormí ayer en minutos." : "How much sleep did I record yesterday in minutes?";
      const text = language === "es" ? "Registraste 543 minutos de sueño ayer." : "You recorded 543 minutes of sleep yesterday.";
      const result = await plan({ prompt, userId: owner, identity: {}, context: { language,
        brain_snapshot: { timezone: "Europe/Madrid" } } }, { memories: Promise.resolve([]),
        db: async route => route.startsWith("bmb_observations?")
          ? [{ id: "sleep-id", metric: "sleep_duration", value_number: 543, unit: "minutes", measurement: "measured" }] : [],
        run: async input => {
          generations++; assert(input.retrieval_contract); assert.equal(input.tool_budget_remaining, 0);
          assert.equal(input.retrieval_contract.facts.minutes, 543);
          return retrieval.expandProse({ response_text: text, response_language: language,
            cited_sources: ["sleep-id"] }, input);
        } });
      assert.equal(classifiers, 1); assert.equal(generations, 1);
      assert.deepEqual(result.plan.actions, []); assert.equal(result.context.brain_memory_effect, undefined);
      const row = { status: "completed", assistant_text: result.plan.message_text, response_language: result.plan.response_language };
      const request = consent => new Request("https://fixture.invalid/voice", { method: "POST",
        body: JSON.stringify({ turn_id: turn, request_id: requestId, synchronized: true, elevenlabs_consent: consent }) });
      const deps = { access: async () => ({premium:true}), authenticate: async () => ({ user: { id: owner }, identity: {} }),
        readTurn: async (user, id) => { assert.equal(user, owner); assert.equal(id, turn); return row; },
        reserve: async () => { reservations++; return [{ reserved: true }]; },
        fetch: async (url, options) => {
          speeches++; const payload = JSON.parse(options.body); assert.equal(payload.text, row.assistant_text);
          assert(url.includes(language === "es" ? "dNjJKg63Fr5AXwIdkATa" : "WtA85syCrJwasGeHGH2p"));
          assert(url.endsWith("with-timestamps?output_format=pcm_24000"));
          const characters = [...payload.text];
          return Response.json({ audio_base64: Buffer.alloc(48000).toString("base64"), alignment: { characters,
            character_start_times_seconds: characters.map((_, i) => i * 0.01),
            character_end_times_seconds: characters.map((_, i) => (i + 1) * 0.01) } });
        } };
      assert.equal((await voice(request(false), deps)).status, 403);
      assert.equal(reservations, 0); assert.equal(speeches, 0);
      const response = await voice(request(true), deps); assert.equal(response.status, 200);
      const frames = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
      assert.equal(frames.at(-1).type, "end"); assert(frames.some(f => f.type === "audio"));
      assert.equal(frames.filter(f => f.type === "cue").at(-1).end, row.assistant_text.length);
      assert.equal(reservations, 1); assert.equal(speeches, 1);
      delete row.response_language;
      assert.equal((await voice(request(true), deps)).status, 503);
      assert.equal(reservations, 1); assert.equal(speeches, 1);
    }
    console.log("PASS Decisions factual reply -> ES/EN ElevenLabs cues, consent and legacy fallback");
  } finally {
    global.fetch = fetchBefore; console.info = infoBefore;
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
