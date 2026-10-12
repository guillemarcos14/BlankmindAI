"use strict";

function characterCues(text, alignment, duration) {
  const characters = alignment?.characters;
  const starts = alignment?.character_start_times_seconds;
  const ends = alignment?.character_end_times_seconds;
  if (!Array.isArray(characters) || !characters.length || characters.length > 4000
      || !characters.every(c => typeof c === "string" && c.length > 0)
      || characters.join("") !== text || !Array.isArray(starts) || !Array.isArray(ends)
      || starts.length !== characters.length || ends.length !== characters.length) throw new Error("invalid_alignment");
  const boundaries = new Set([...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)]
    .map(segment => segment.index + segment.segment.length));
  const cues = [];
  let offset = 0, previous = 0, onset = null;
  characters.forEach((character, i) => {
    if (!Number.isFinite(starts[i]) || !Number.isFinite(ends[i]) || starts[i] < previous
        || ends[i] < starts[i] || ends[i] > duration + 0.1 || starts[i] >= duration) throw new Error("invalid_alignment");
    previous = starts[i]; offset += character.length;
    onset ??= starts[i];
    if (boundaries.has(offset)) { cues.push({ start: onset, end: offset }); onset = null; }
  });
  return cues;
}

async function elevenSpeech(text, fetcher, signal, maxBytes, language) {
  const voice = language === "es"
    ? process.env.ELEVENLABS_VOICE_ID_ES || "dNjJKg63Fr5AXwIdkATa"
    : language === "en"
      ? process.env.ELEVENLABS_VOICE_ID_EN || "WtA85syCrJwasGeHGH2p"
      : process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
  if (!/^[A-Za-z0-9]{20}$/.test(voice)) throw new Error("invalid_voice");
  const response = await fetcher(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=pcm_24000`, {
    method: "POST", signal,
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true } }),
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel(); throw new Error("voice_unavailable");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > Math.ceil(maxBytes * 4 / 3) + 1000000) throw new Error("audio_limit");
      chunks.push(Buffer.from(next.value));
    }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof data.audio_base64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.audio_base64)) throw new Error("invalid_audio");
    const pcm = Buffer.from(data.audio_base64, "base64");
    if (!pcm.length || pcm.length % 2 || pcm.length > maxBytes) throw new Error("invalid_audio");
    return { pcm, cues: characterCues(text, data.alignment, pcm.length / 48000) };
  } finally { await reader.cancel().catch(() => {}); }
}

module.exports = { elevenSpeech, characterCues };
