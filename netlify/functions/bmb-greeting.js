"use strict";
const { readModelJson } = require("./bm-model-request");

// Presentation only: opening chat never creates a turn, memory or action.
async function greeting(language, { model = readModelJson } = {}) {
  const { body } = await model({
    request: {
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      max_output_tokens: 160,
      input: [
        { role: "system", content: "Write a fresh, warm, natural greeting for someone opening a personal wellbeing chat. One short sentence, at most 20 words. Be conversational. No brand names, advice, action promises, assumptions about their life, or references to earlier conversations. Vary the wording naturally." },
        { role: "user", content: language === "es" ? "Saluda en español." : "Greet in English." }
      ],
      text: { format: { type: "json_schema", name: "chat_greeting", strict: true,
        schema: { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string" } } } } }
    },
    timeoutMs: 6000,
    errorPrefix: "bmb_greeting"
  });
  if (body.status === "incomplete") throw Error("bmb_greeting_incomplete");
  const output = body.output_text || (body.output || []).flatMap(o => o.content || []).filter(o => o.type === "output_text").map(o => o.text).join("");
  const text = JSON.parse(output).text;
  if (typeof text !== "string" || !text.trim() || text.length > 180 || /[\r\n\x00-\x1f]/.test(text)) throw Error("bmb_greeting_invalid");
  return text.trim();
}
module.exports = { greeting };
