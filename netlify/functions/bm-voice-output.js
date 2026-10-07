"use strict";

const { supabaseFetch } = require("./_membership");
const assistant = require("./assistant-app");
const { plainAssistantText } = require("./_assistant_reply_text");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AUDIO_BYTES = 12000000;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const failure = (status, error) => Response.json({ error }, { status, headers });

// This route renders a committed reply. It never invokes the planner, queues an
// action, accepts arbitrary client text, or retains a recording/audio file.
async function voice(request, deps = {}) {
  if (request.method !== "POST") return failure(405, "method_not_allowed");
  if (process.env.BM_VOICE_ENABLED !== "true") return failure(503, "voice_disabled");
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return failure(413, "invalid_voice_request");
    body = JSON.parse(raw);
  } catch (_) { return failure(400, "invalid_json"); }
  if (!body || Array.isArray(body) || typeof body !== "object"
      || Object.keys(body).some(key => !["turn_id", "request_id", "app_install_id"].includes(key))
      || !UUID.test(body.turn_id || "") || !UUID.test(body.request_id || "")) {
    return failure(400, "invalid_voice_request");
  }
  const abort = new AbortController();
  const started = performance.now();
  let firstAudio = null, audioBytes = 0, characters = 0, metered = false, cleaned = false;
  const disconnect = () => abort.abort();
  request.signal.addEventListener("abort", disconnect, { once: true });
  let timer;
  const cleanup = () => {
    clearTimeout(timer); request.signal.removeEventListener("abort", disconnect);
    if (!cleaned && metered) console.log("bm_voice_output_timing", JSON.stringify({
      elapsed_ms: Math.round(performance.now() - started), first_audio_ms: firstAudio,
      audio_bytes: audioBytes, characters,
    }));
    cleaned = true;
  };
  try {
    const auth = await (deps.authenticate || assistant.authenticatedIdentity)(
      { headers: Object.fromEntries(request.headers) }, body);
    if (auth.error) { cleanup(); return failure(auth.status, auth.error); }
    const readTurn = deps.readTurn || assistant.readTurn;
    const row = await readTurn(auth.user.id, body.turn_id);
    if (!row) { cleanup(); return failure(404, "turn_not_found"); }
    if (row.status !== "completed") { cleanup(); return failure(409, "voice_turn_not_ready"); }
    const text = plainAssistantText(row.assistant_text || "");
    if (!text.trim() || text.length > 4000) { cleanup(); return failure(422, "voice_text_unavailable"); }
    if (!process.env.OPENAI_API_KEY) { cleanup(); return failure(503, "voice_unavailable"); }
    const reserve = deps.reserve || (async args => supabaseFetch("rpc/reserve_assistant_voice", {
      method: "POST", body: JSON.stringify(args),
    }));
    const reservation = (await reserve({ p_auth_user_id: auth.user.id,
      p_turn_id: body.turn_id, p_request_id: body.request_id }))?.[0];
    if (!reservation?.reserved) {
      cleanup();
      return failure(reservation?.reason === "duplicate" || reservation?.reason === "unavailable" ? 409 : 429,
        reservation?.reason === "duplicate" ? "voice_request_used"
          : reservation?.reason === "unavailable" ? "voice_text_unavailable" : "voice_rate_limited");
    }
    metered = true; characters = text.length;
    // A deleted/changed turn must not be spoken after the quota reservation.
    const current = await readTurn(auth.user.id, body.turn_id);
    if (!current || current.status !== "completed" || current.assistant_text !== row.assistant_text) {
      cleanup(); return failure(409, "voice_text_unavailable");
    }
    timer = setTimeout(() => abort.abort(), 120000);
    if (request.signal.aborted) abort.abort();
    const upstream = await (deps.fetch || fetch)("https://api.openai.com/v1/audio/speech", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json" }, signal: abort.signal,
      body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "marin", input: text,
        response_format: "pcm", instructions: "Speak naturally, calmly and warmly, in the language of the text. Use a comfortable conversational pace. Read exactly the supplied text without adding or omitting information." }),
    });
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel().catch(() => {});
      cleanup(); return failure(503, "voice_unavailable");
    }
    const reader = upstream.body.getReader();
    const encoder = new TextEncoder();
    let total = 0;
    let pending = new Uint8Array(0);
    let done = false;
    const frame = data => encoder.encode(JSON.stringify(data) + "\n");
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          while (!done && pending.length < 8192) {
            const next = await reader.read();
            if (next.done) { done = true; break; }
            total += next.value.length;
            if (total > MAX_AUDIO_BYTES) throw new Error("audio_limit");
            const merged = new Uint8Array(pending.length + next.value.length);
            merged.set(pending); merged.set(next.value, pending.length); pending = merged;
          }
          const count = Math.min(8192, pending.length - pending.length % 2);
          if (count) {
            firstAudio ??= Math.round(performance.now() - started);
            audioBytes += count;
            controller.enqueue(frame({ type: "audio", turn_id: body.turn_id,
              pcm: Buffer.from(pending.subarray(0, count)).toString("base64") }));
            pending = pending.subarray(count);
          } else if (done) {
            if (!total || pending.length) throw new Error("invalid_audio");
            controller.enqueue(frame({ type: "end", turn_id: body.turn_id }));
            controller.close(); cleanup();
          }
        } catch (_) {
          controller.enqueue(frame({ type: "error", error: "voice_unavailable" }));
          controller.close(); abort.abort(); await reader.cancel().catch(() => {}); cleanup();
        }
      },
      async cancel() { abort.abort(); await reader.cancel().catch(() => {}); cleanup(); },
    });
    return new Response(stream, { headers: { ...headers,
      "Content-Type": "application/x-ndjson; charset=utf-8", "X-Voice-Format": "pcm-s16le-24000-mono" } });
  } catch (_) {
    abort.abort(); cleanup(); return failure(503, "voice_unavailable");
  }
}
module.exports = { voice, MAX_AUDIO_BYTES };
