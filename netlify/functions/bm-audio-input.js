"use strict";

async function transcribe(body, fetchImpl = fetch) {
  const encoded = body.audio_base64;
  if (typeof encoded !== "string" || encoded.length > 2800000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    return { status: 400, error: "invalid_audio" };
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 32 || bytes.length > 2000000 || bytes.toString("ascii", 4, 8) !== "ftyp") {
    return { status: 400, error: "invalid_audio" };
  }
  if (!process.env.OPENAI_API_KEY) return { status: 503, error: "audio_unavailable" };
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "audio/mp4" }), "message.m4a");
  form.append("model", process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe");
  form.append("response_format", "json");
  const response = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form, signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) { response.body?.cancel().catch(() => {}); return { status: 503, error: "audio_unavailable" }; }
  const result = await response.json();
  const text = typeof result.text === "string" ? result.text.trim() : "";
  if (!text || text.length > 4000) return { status: 422, error: "audio_not_understood" };
  return { status: 200, text };
}

module.exports = { transcribe };
