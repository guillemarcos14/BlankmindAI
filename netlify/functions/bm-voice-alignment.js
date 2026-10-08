"use strict";

const normalize = value => String(value).normalize("NFD").replace(/\p{M}/gu, "")
  .toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

// Offsets refer to the committed text (UTF-16, shared with NSString). Never
// display the recognizer's text: it can change facts, numbers or spelling.
function alignWords(text, words, duration) {
  if (!Array.isArray(words) || !words.length || words.length > 8000) throw new Error("missing_alignment");
  let previous = 0;
  for (const word of words) {
    if (typeof word.word !== "string" || !Number.isFinite(word.start)
        || !Number.isFinite(word.end) || word.start < previous || word.end < word.start
        || word.end > duration + 0.1) throw new Error("invalid_alignment");
    previous = word.start;
  }
  const tokens = [...text.matchAll(/[\p{L}\p{N}]+(?:[.,:'’/-][\p{L}\p{N}]+)*/gu)];
  const spoken = words.filter(word => normalize(word.word));
  const cues = [];
  let cursor = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const initialCursor = cursor;
    const start = spoken[cursor]?.start;
    if (start == null) throw new Error("incomplete_alignment");
    let combined = "";
    while (cursor < spoken.length && combined.length < normalize(token[0]).length) {
      combined += normalize(spoken[cursor++].word);
      if (combined === normalize(token[0])) break;
    }
    if (combined !== normalize(token[0])) {
      // A printed numeral represents several spoken words (e.g. 7:30).
      // Anchor its onset, then require the next lexical word to match exactly.
      if (!/\d/u.test(token[0])) throw new Error("alignment_text_mismatch");
      const next = tokens[index + 1];
      if (next && /\d/u.test(next[0])) throw new Error("ambiguous_numeric_alignment");
      cursor = initialCursor + 1;
      while (cursor < spoken.length && next && normalize(spoken[cursor].word) !== normalize(next[0])) cursor++;
      if (!next) cursor = spoken.length;
    }
    const end = index + 1 < tokens.length ? tokens[index + 1].index : text.length;
    cues.push({ start, end });
  }
  if (!cues.length || cursor !== spoken.length) throw new Error("alignment_text_mismatch");
  return cues;
}

function wav(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(pcm.length + 36, 4);
  header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function timingForAudio(pcm, text, fetcher, signal) {
  const form = new FormData();
  form.append("file", new Blob([wav(pcm)], { type: "audio/wav" }), "reply.wav");
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("prompt", text);
  const response = await fetcher("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form, signal,
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error("alignment_unavailable"); }
  const result = await response.json();
  return alignWords(text, result.words, pcm.length / 48000);
}

module.exports = { alignWords, wav, timingForAudio };
