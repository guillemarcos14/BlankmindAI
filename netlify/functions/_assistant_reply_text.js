"use strict";

// Native chat uses plain text. Preserve spacing, code, escaped literals and
// multiplication operators while hiding emphasis, including unfinished drafts.
function plainAssistantText(text) {
  return String(text || "").split(/(```[\s\S]*?(?:```|$)|`[^`]*(?:`|$))/g)
    .map((part, index) => index % 2 ? part : part.replace(/(?<!\\)\*\*(?=\S|$)|(?<=\S)(?<!\\)\*\*/g, ""))
    .join("");
}
module.exports = { plainAssistantText };
