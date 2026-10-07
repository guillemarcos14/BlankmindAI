"use strict";

// Preview only response_text after its complete authority prefix. Secondary
// tracking may follow the text, but cannot affect execution before final commit.
// Read phases stay private; incomplete escapes/surrogates are held.
function draftText(json) {
  const match = /"response_text"\s*:\s*"/.exec(json);
  if (!match) return null;
  let metadata;
  try { metadata = JSON.parse(json.slice(0, match.index) + '"response_text":""}'); }
  catch (_) { return null; }
  if (metadata.phase !== "final") return null;
  const raw = json.slice(match.index + match[0].length);
  let text = "";
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '"') break;
    if (raw[i] !== "\\") { text += raw[i]; continue; }
    if (++i >= raw.length) break;
    const escapes = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
    if (raw[i] === "u") {
      const hex = raw.slice(i + 1, i + 5);
      if (!/^[0-9a-f]{4}$/i.test(hex)) break;
      text += String.fromCharCode(parseInt(hex, 16)); i += 4;
    } else if (Object.hasOwn(escapes, raw[i])) text += escapes[raw[i]];
    else return null;
  }
  if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  return text;
}

async function readModelStream({ request, timeoutMs, errorPrefix, onDraft, fetchImpl = fetch }) {
  const started = Date.now();
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ ...request, stream: true }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    try { await response.body?.cancel(); } catch (_) {}
    throw Error(`${errorPrefix}_http_${response.status}`);
  }
  if (!response.body) throw Error(`${errorPrefix}_stream_missing`);
  const headersMs = Date.now() - started;
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", output = "", lastDraft = "", completed = null, firstTextMs = null;
  const consume = frame => {
    const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data);
    if (event.type === "response.output_text.delta") {
      output += event.delta;
      if (output.length > 128000) throw Error(`${errorPrefix}_stream_oversized`);
      const text = draftText(output);
      if (text != null && text !== lastDraft) {
        if (firstTextMs == null && text) firstTextMs = Date.now() - started;
        lastDraft = text; onDraft(text);
      }
    } else if (event.type === "response.completed") completed = event.response;
    else if (["error", "response.failed", "response.incomplete"].includes(event.type)) throw Error(`${errorPrefix}_stream_failed`);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer = (buffer + decoder.decode(value, { stream: !done })).replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        consume(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2);
      }
      if (buffer.length > 256000) throw Error(`${errorPrefix}_stream_oversized`);
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
    if (!completed || completed.status !== "completed") throw Error(`${errorPrefix}_stream_truncated`);
    if (fetchImpl === fetch) console.info(JSON.stringify({ event: "bm_stream_timing", stage: errorPrefix,
      model: request.model, headers_ms: headersMs, first_text_ms: firstTextMs, elapsed_ms: Date.now() - started,
      usage: require("./bm-model-request").usageCounts(completed.usage) }));
    return { body: completed };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

module.exports = { draftText, readModelStream };
