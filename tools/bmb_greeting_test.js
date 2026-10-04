"use strict";
const assert = require("node:assert/strict");
const { greeting } = require("../netlify/functions/bmb-greeting");
(async () => {
  let request;
  const model = async args => { request = args; return { body: { output_text: JSON.stringify({ text: "Hola, ¿cómo estás hoy?" }) } }; };
  assert.equal(await greeting("es", { model }), "Hola, ¿cómo estás hoy?");
  assert.equal(request.request.input[1].content, "Saluda en español.");
  assert.equal(request.timeoutMs, 6000);
  await greeting("en", { model });
  assert.equal(request.request.input[1].content, "Greet in English.");
  for (const text of ["", "a".repeat(181), "hi\nthere", 42]) {
    await assert.rejects(greeting("en", { model: async () => ({ body: { output_text: JSON.stringify({ text }) } }) }));
  }
  await assert.rejects(greeting("en", { model: async () => ({ body: { status: "incomplete" } }) }));
  console.log("PASS greeting: languages, bounded output, invalid and incomplete responses");
})().catch(error => { console.error(error); process.exitCode = 1; });
