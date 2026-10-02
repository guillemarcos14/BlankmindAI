"use strict";
const { createHmac, randomBytes, timingSafeEqual } = require("node:crypto");
// A provider cannot mark its own prose as validated. This proof stays inside
// one invocation's backend modules and is never returned in the app envelope.
const key = randomBytes(32);
function proseColon(text) { return /(^|[^\d]):(?!\/\/)|\d:(?!\d)/u.test(text); }
function copyIssues(text) {
  const issues = [];
  if (proseColon(text)) issues.push("prose_colon");
  if (/[;]|(?:^|\n)\s*(?:#{1,6}\s|[-*]\s|\d+[.)]\s)/u.test(text)) issues.push("structured_copy");
  if (/\b(?:canonical|schema|backend|fingerprint|telemetry|execution|verification|canónico|esquema|telemetría|ejecución|verificación)\b/iu.test(text)) issues.push("technical_copy");
  return issues;
}
function chatText(text) {
  return String(text || "").replace(/\b(?:Got it|Entendido):\s*/giu, match=>match.startsWith("Got") ? "Got it, " : "Vale, ")
    .replace(/(^|[^\d]):(?!\/\/)|\d:(?!\d)/gu, match=>match.replace(":", ". "))
    .replace(/;/g, ",").replace(/[ \t]+/g," ").trim();
}
function signCopy(text, actions) {
  return createHmac("sha256", key).update(JSON.stringify([text, actions || []])).digest("hex");
}
function hasValidatedCopy(plan) {
  const text = plan.message_text || plan.response_text;
  const proof = plan.validated_copy;
  if (typeof proof !== "string" || !/^[a-f0-9]{64}$/.test(proof)) return false;
  return timingSafeEqual(Buffer.from(proof,"hex"), Buffer.from(signCopy(text,plan.actions),"hex"));
}
module.exports = { chatText, copyIssues, signCopy, hasValidatedCopy };
