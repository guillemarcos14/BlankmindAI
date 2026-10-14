"use strict";
const assert = require("node:assert/strict");
const { plainAssistantText } = require("../netlify/functions/_assistant_reply_text");
assert.equal(plainAssistantText("- **Protection** de **22:30 a 09:00**\n👋"), "- Protection de 22:30 a 09:00\n👋");
assert.equal(plainAssistantText("**Protec"), "Protec");
assert.equal(plainAssistantText("texto **"), "texto ");
assert.equal(plainAssistantText("2 ** 3; `**literal**`; \\**literal\\**"), "2 ** 3; `**literal**`; \\**literal\\**");
assert.equal(plainAssistantText("```**code**```\n**reply**"), "```**code**```\nreply");
const { draftText, readModelStream } = require("../netlify/functions/bm-response-stream");
const { schema } = require("../netlify/functions/bmb-brain");
const enc = new TextEncoder();
const sse = event => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`;
const value = { phase: "final", decision: "respond", action: null, response_text: 'Hola "Guillem"\nDescansa 👋' };
const json = JSON.stringify(value);
const fields = Object.keys(schema.properties);
assert(fields.indexOf("action") < fields.indexOf("response_text"));
assert(fields.indexOf("memory") < fields.indexOf("response_text"));
assert(fields.indexOf("response_text") < fields.indexOf("observations"));
assert.equal(draftText('{"phase":"final","decision":"respond","action":null,"response_text":"Hi","observations":['), "Hi");
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

  // Real Responses function-call SSE shape. Only gestionar's response_text
  // can be previewed, with arbitrary byte boundaries and no final execution.
  for(const name of ["gestionar","consultar_contexto","unknown"]){
    const seen=[],args=JSON.stringify({decision:"execute",action:{type:"start_protection",minutes:30},memory:null,response_text:"Lo intento 👋"});
    const events=[{type:"response.output_item.added",item:{type:"function_call",id:"fc-1",name}}];
    for(const delta of args)events.push({type:"response.function_call_arguments.delta",item_id:"fc-1",delta});
    const completed={status:"completed",output:[{type:"function_call",id:"fc-1",name,arguments:args}]};
    events.push({type:"response.completed",response:completed});
    const bytes=enc.encode(events.map(sse).join(""));
    const response=await readModelStream({request:{},timeoutMs:1000,errorPrefix:"agent",onDraft:text=>seen.push(text),
      fetchImpl:async()=>new Response(new ReadableStream({start(c){for(const byte of bytes)c.enqueue(Uint8Array.of(byte));c.close();}}))});
    assert.deepEqual(response.body,completed);
    if(name==="gestionar")assert.equal(seen.at(-1),"Lo intento 👋");
    else assert.deepEqual(seen,[],"Private/unknown tool leaked arguments");
  }
  await assert.rejects(()=>readModelStream({request:{},timeoutMs:1000,errorPrefix:"agent",onDraft(){},fetchImpl:async()=>new Response(
    sse({type:"response.output_item.added",item:{type:"function_call",id:"fc-1",name:"gestionar"}})
    +sse({type:"response.function_call_arguments.delta",item_id:"fc-1",delta:'{"response_text":"provisional'}))}),/stream_truncated/);

  // Use the production BMB generation and conformance repair path. Repair must
  // replace the provisional copy, while the validated plan owns final text.
  const brain = require("../netlify/functions/bmb-brain");
  const modelResult = text => ({ phase: "final", response_language: "en", message_kind: "statement",
    decision: "respond", evidence: "hello", accepted_proposal: null, pending_request: null,
    action: null, queries: [], memory: null, cited_sources: [], response_text: text });
  const candidates = [{...modelResult("Unrepaired: text"),evidence:'absent'}, modelResult("Corrected text.")];
  const realFetch = global.fetch, repairedDrafts = [];
  try {
    global.fetch = async (_url, options) => {
      assert.equal(JSON.parse(options.body).stream, true);
      const candidate = candidates.shift();
      assert(candidate, "Unexpected model pass");
      const text = JSON.stringify(candidate);
      return new Response(sse({ type: "response.output_text.delta", delta: text })
        + sse({ type: "response.completed", response: { status: "completed",
          output: [{ content: [{ type: "output_text", text }] }] } }));
    };
    const result = await brain.plan({ prompt: "hello", context: { language: "en", memory: { semantic_store_version: 0 } },
      userId: "synthetic", identity: {}, onDraft: text => repairedDrafts.push(text) },
    { memories: [], db: async () => [], recover: async () => null });
    assert.equal(result.plan.response_text, "Corrected text.");
    assert.deepEqual(result.plan.actions, []);
    assert.deepEqual(repairedDrafts, ["", "Unrepaired: text", "", "Corrected text."]);
    assert.equal(candidates.length, 0);
  } finally { global.fetch = realFetch; }

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
