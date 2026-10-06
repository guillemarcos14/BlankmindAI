"use strict";
const assert = require("node:assert/strict");
const { draftText, readModelStream } = require("../netlify/functions/bm-response-stream");
const { schema } = require("../netlify/functions/bmb-brain");
const enc = new TextEncoder();
const sse = event => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`;
const value = { phase: "final", decision: "respond", action: null, response_text: 'Hola "Guillem"\nDescansa 👋' };
const json = JSON.stringify(value);
assert.equal(Object.keys(schema.properties).at(-1), "response_text");
assert.equal(draftText('{"phase":"read","response_text":"private query'), null);
assert.equal(draftText('{"response_text":"early, no metadata'), null);
assert.equal(draftText('{"phase":"final","response_text":"Hola\\uD83D'), "Hola");
assert.equal(draftText('{"phase":"final","response_text":"Hola\\uD83D\\uDC4B'), "Hola👋");
assert.equal(draftText(json), value.response_text);

async function main() {
  let upstream;
  const transport = async (_url, options) => {
    assert.equal(JSON.parse(options.body).stream, true);
    return new Response(new ReadableStream({ start(c) { upstream = c; } }), { headers: { "Content-Type": "text/event-stream" } });
  };
  const drafts = [];
  let settled = false;
  const result = readModelStream({ request: {}, timeoutMs: 1000, errorPrefix: "bmb", fetchImpl: transport,
    onDraft: text => drafts.push(text) }).then(value => { settled = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  const opening = sse({ type: "response.output_text.delta", delta: '{"phase":"final","decision":"respond","action":null,"response_text":"Hola' });
  // Split every byte, including CRLF, escapes and multibyte UTF-8.
  for (const byte of enc.encode(opening)) upstream.enqueue(Uint8Array.of(byte));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(drafts, ["Hola"]);
  assert.equal(settled, false, "Draft must arrive before model completion");
  const tail = sse({ type: "response.output_text.delta", delta: ' 👋"}' });
  for (const byte of enc.encode(tail)) upstream.enqueue(Uint8Array.of(byte));
  upstream.enqueue(enc.encode(sse({ type: "response.completed", response: { status: "completed", output_text: '{"phase":"final","response_text":"Hola 👋"}' } })));
  upstream.close();
  assert.equal((await result).body.status, "completed");
  assert.deepEqual(drafts, ["Hola", "Hola 👋"]);
  for (const end of ["", sse({ type: "response.incomplete" }), sse({ type: "response.failed" })]) {
    await assert.rejects(() => readModelStream({ request: {}, timeoutMs: 1000, errorPrefix: "bmb", onDraft() {},
      fetchImpl: async () => new Response(opening + end) }), /stream_(truncated|failed)/);
  }
  let leaked = false;
  await readModelStream({ request: {}, timeoutMs: 1000, errorPrefix: "bmb", onDraft() { leaked = true; },
    fetchImpl: async () => new Response(sse({ type: "response.output_text.delta", delta: '{"phase":"read","response_text":"private"}' })
      + sse({ type: "response.completed", response: { status: "completed" } })) });
  assert.equal(leaked, false, "Tool reads cannot become visible text");

  const app = require("../netlify/functions/assistant-app");
  let finish;
  app.handler = async (_event, _context, { onDraft }) => {
    onDraft("Hola");
    await new Promise(resolve => { finish = resolve; });
    return { statusCode: 200, body: JSON.stringify({ ok: true, turn: { id: "T", status: "completed" } }) };
  };
  const endpoint = (await import("../netlify/functions/assistant-app-stream.mjs")).default;
  let transaction;
  const request = () => new Request("https://blank.test/assistant-app-stream", { method: "POST", body: JSON.stringify({ action: "send", turn_id: "T" }) });
  const response = await endpoint(request(), { waitUntil(promise) { transaction = promise; } });
  const reader = response.body.getReader();
  assert.equal(JSON.parse(new TextDecoder().decode((await reader.read()).value)).type, "start");
  assert.deepEqual(JSON.parse(new TextDecoder().decode((await reader.read()).value)), { type: "draft", turn_id: "T", text: "Hola" });
  finish();
  assert.equal(JSON.parse(new TextDecoder().decode((await reader.read()).value)).type, "result");
  await transaction;
  assert.equal((await reader.read()).done, true);
  const disconnect = await endpoint(request(), { waitUntil(promise) { transaction = promise; } });
  await disconnect.body.cancel();
  finish(); await transaction;
  assert.equal((await endpoint(new Request("https://blank.test", { method: "GET" }))).status, 405);
  console.log("response streaming: first text before completion, byte fragmentation/Unicode/CRLF, private read phases, failures/EOF, native-free drafts and durable disconnect passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
