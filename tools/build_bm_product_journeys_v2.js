"use strict";

// A versioned correction to authored acceptance criteria, never derived from
// candidate outputs. Preserve v1 byte-for-byte as the historical benchmark.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const source = path.join(__dirname, "datasets/bm_product_journeys_v1.json");
const bytes = fs.readFileSync(source);
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const expectedSource = "a649f2bb67b21762e71b181846e069aa2d07b0fb1a90cfeebdd1ba572a3e3167";
if (hash(bytes) !== expectedSource) throw new Error("historical_v1_changed");
const dataset = JSON.parse(bytes);
dataset.id = "bm-product-journeys-v2-2026-09-26";
dataset.provenance += " V2 corrects duplicate-action expectations discovered by independent review: repeating setup cannot enqueue a new request; a transported review action and a picker carrying a confirmed plan already own that proposal. Device readiness is not new authorization. Inputs, state expectations and all original v1 reports remain unchanged. This is development regression coverage, not a fresh holdout.";
const changes = [];
const prefixes = {
  presence_not_claim: { 2: "Repeated presence setup reuses the existing transported request.", 3: "A heartbeat cannot enqueue the same transported protection again." },
  permission_denied: { 2: "Repeated confirmation cannot enqueue the same permission setup again." },
  selection_not_conversation: { 2: "Repeated confirmation reuses the existing picker.", 3: "Accepting the picker already applies its attached protection; readiness cannot enqueue another." },
  permission_then_selection: { 3: "Accepting the picker already applies its attached daily limit." },
  all_native_gaps: {
    2: "The first review request already owns the full plan. Native preflight handles permission; a new permission action would supersede that request and race its execution.",
    3: "Native preflight opens selection for the original review request. Do not replace its action ID after it may already have been applied.",
    4: "The original review request already owns execution; a ready heartbeat cannot enqueue the same schedule again.",
  },
};
for (const conversation of dataset.conversations) {
  const replacements = { ...(prefixes[conversation.base_journey] || {}) };
  if (conversation.continuation === "amend_while_selection_removed") {
    replacements[conversation.turns.length] = "The amended plan was attached to the picker on the preceding turn; accepting it must not enqueue a second protection.";
  }
  for (const [number, reason] of Object.entries(replacements)) {
    const turn = conversation.turns[Number(number) - 1];
    if (!turn?.expect?.actions?.length) throw new Error(`expected_action_missing:${conversation.id}:${number}`);
    changes.push({ conversation: conversation.id, turn: Number(number), input: turn.input,
      previous_actions: turn.expect.actions, actions: [], reason });
    turn.expect.actions = [];
  }
}
if (changes.length !== 85) throw new Error(`unexpected_correction_count:${changes.length}`);
const output = path.join(__dirname, "datasets/bm_product_journeys_v2.json");
const content = JSON.stringify(dataset, null, 2) + "\n";
const manifest = {
  dataset: "tools/datasets/bm_product_journeys_v2.json", sha256_bytes: hash(content),
  predecessor: "tools/datasets/bm_product_journeys_v1.json", predecessor_sha256_bytes: expectedSource,
  authored_at: "2026-09-26", split: "development", independent_holdout: false,
  base_journeys: 40, continuations_per_base: 5, conversations: dataset.conversations.length,
  turns: dataset.conversations.reduce((n, c) => n + c.turns.length, 0),
  changed_expected_actions: changes.length, unchanged_user_inputs: true, unchanged_expected_states: true,
  changes,
};
fs.writeFileSync(output, content);
fs.writeFileSync(output.replace(/\.json$/, ".manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ output, turns: manifest.turns, changed_expected_actions: changes.length, sha256_bytes: manifest.sha256_bytes }));
