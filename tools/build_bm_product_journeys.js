"use strict";

// Authored acceptance examples, not snapshots of runtime/model output. This
// generator imports no planner, parser, reducer, renderer, oracle, or judge.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const copy = (v) => structuredClone(v);
const once = { type: "once", weekdays: [] };
const daily = { type: "daily", weekdays: [1, 2, 3, 4, 5, 6, 7] };
const weekdays = { type: "weekly", weekdays: [1, 2, 3, 4, 5] };
const weekends = { type: "weekly", weekdays: [6, 7] };
const now = { type: "now" };
const at = (minute) => ({ type: "time", minute });
const empty = () => ({ intent: "general", apps: null, app_category: null, moment: null,
  action_type: null, hard_mode: null, requested_capability: null, start: null,
  end: null, duration_minutes: null, recurrence: null, schedule_horizon_days: null,
  confirmation: null });
const readyContext = { has_selected_apps: true, selection_count: 4,
  protection_target: "selected_distractions", screen_time_authorized: true,
  app_presence: { app_present: true, app_ready: true, last_seen_at: "__REPLAY_NOW__" },
  app_presence_state: "recently_seen", app_presence_recent: true, language: "en" };
const bases = [];

function action(f) {
  if (f.action_type === "daily_limit") return { type: "set_daily_limit", minutes: f.duration_minutes };
  if (f.start.type === "now") return { type: "start_protection", minutes: f.duration_minutes, hard_mode: f.hard_mode ?? false };
  return { type: "apply_schedule", start_minute: f.start.minute, end_minute: f.end,
    weekdays: f.recurrence.weekdays.map((d) => d === 7 ? 1 : d + 1).sort((a, b) => a - b), duration_days: f.schedule_horizon_days };
}

// Facts and missing fields are explicit author inputs. Clock arithmetic is
// mathematical normalization of those facts, not extraction from the prompt.
function buildBase(id, purpose, build, initialContext = {}) {
  let facts = empty();
  const turns = [];
  const context = { ...copy(readyContext), ...copy(initialContext) };
  function block(input, delta = {}, pending = [], options = {}) {
    if (facts.intent !== "block" || options.reset) facts = { ...empty(), intent: "block", action_type: "strict_block", apps: ["selected_apps"] };
    facts = { ...facts, ...copy(delta), confirmation: options.unconfirmed ? null : "confirmed" };
    if (Object.hasOwn(delta, "duration_minutes") && !Object.hasOwn(delta, "end")) {
      facts.end = facts.start?.type === "time" && facts.duration_minutes != null ? (facts.start.minute + facts.duration_minutes) % 1440 : null;
    } else if (Object.hasOwn(delta, "end") && !Object.hasOwn(delta, "duration_minutes") && facts.start?.type === "time" && facts.end != null) {
      facts.duration_minutes = (facts.end - facts.start.minute + 1440) % 1440;
    }
    const status = options.setup ? "needs_setup" : pending.length ? "collecting" : "ready";
    let actions = pending.length || options.noAction ? [] : [action(facts)];
    if (options.setup === "permissions") actions = [{ type: "request_screen_time_permission" }];
    if (options.setup === "app_selection") actions = [{ ...action(facts), type: "open_app_picker" }];
    if (options.setup === "app_presence" && !options.noAction) actions = [action(facts)];
    turns.push({ input, ...(options.context ? { context: copy(options.context) } : {}), expect: {
      state: { ...copy(facts), pending_slots: pending, status, next_question: pending[0] || null },
      decision: { type: options.setup ? "setup" : pending.length ? "ask" : "ready", slot: pending[0] || null },
      actions, language: "en", ...(options.corrections ? { correction_slots: options.corrections } : {}) } });
  }
  function cancelled(input = "Cancel this request.") {
    facts = { ...empty(), intent: "cancelled" };
    turns.push({ input, expect: { state: { ...copy(facts), pending_slots: [], status: "cancelled", next_question: null },
      decision: { type: "cancelled", slot: null }, actions: [], language: "en" } });
  }
  function capability(input, requested, apps = null) {
    facts = { ...empty(), intent: "advice", requested_capability: requested, apps };
    turns.push({ input, expect: { state: { ...copy(facts), pending_slots: [], status: "idle", next_question: null },
      decision: { type: "none", slot: null }, actions: [], language: "en" } });
  }
  function idle(input) {
    facts = empty();
    turns.push({ input, expect: { state: { ...facts, pending_slots: [], status: "idle", next_question: null }, decision: { type: "none", slot: null }, actions: [], language: "en" } });
  }
  function advice(input, delta, pending) {
    if (facts.intent !== "advice") facts = { ...empty(), intent: "advice" };
    facts = { ...facts, ...copy(delta) };
    if (facts.start?.type === "time" && facts.duration_minutes != null && facts.end == null) facts.end = (facts.start.minute + facts.duration_minutes) % 1440;
    turns.push({ input, expect: { state: { ...copy(facts), pending_slots: pending, status: pending.length ? "collecting" : "idle", next_question: pending[0] || null },
      decision: { type: pending.length ? "ask" : "none", slot: pending[0] || null }, actions: [], language: "en" } });
  }
  build({ block, cancelled, capability, idle, advice });
  if (turns.at(-1).expect.state.status !== "ready") throw new Error(`base must finish with authorized ready request: ${id}`);
  bases.push({ id, purpose, context, turns });
}

buildBase("instant_regular", "A complete one-off request queues once; acknowledgement is not new authorization.", ({ block: b }) => {
  b("Block my selected apps now for 25 minutes, just once.", { start: now, duration_minutes: 25, recurrence: once });
  b("Yes, do it.", {}, [], { noAction: true });
});
buildBase("instant_hard", "Explicit strictness survives preparation and duplicate confirmation.", ({ block: b }) => {
  b("Start a strict block for selected apps now for 40 minutes once.", { start: now, duration_minutes: 40, recurrence: once, hard_mode: true });
  b("Confirmed.", {}, [], { noAction: true });
});
buildBase("missing_start", "A complete duration and recurrence do not invent a start.", ({ block: b }) => {
  b("Block selected apps for 35 minutes, once.", { duration_minutes: 35, recurrence: once }, ["start"]);
  b("Start now.", { start: now });
});
buildBase("missing_duration", "Immediate intent and one-off recurrence still require duration.", ({ block: b }) => {
  b("Block selected apps now, just once.", { start: now, recurrence: once }, ["end_or_duration"]);
  b("Half an hour.", { duration_minutes: 30 });
});
buildBase("missing_recurrence", "A yes cannot invent whether protection repeats.", ({ block: b }) => {
  b("Block selected apps now for 45 minutes.", { start: now, duration_minutes: 45 }, ["recurrence"]);
  b("Yes.", {}, ["recurrence"]);
  b("Just once.", { recurrence: once });
});
buildBase("all_operational_missing", "Collect start, duration and recurrence separately without asking for another app list.", ({ block: b }) => {
  b("Block my selected apps.", {}, ["start", "end_or_duration", "recurrence"]);
  b("Now.", { start: now }, ["end_or_duration", "recurrence"]);
  b("One hour.", { duration_minutes: 60 }, ["recurrence"]);
  b("One time.", { recurrence: once });
});
buildBase("duration_before_start", "Duration answered before start is retained while start remains missing.", ({ block: b }) => {
  b("Block selected apps once.", { recurrence: once }, ["start", "end_or_duration"]);
  b("For twenty minutes.", { duration_minutes: 20 }, ["start"]);
  b("Immediately.", { start: now });
});
buildBase("recurrence_before_duration", "A recurrence answer out of question order must not fabricate duration.", ({ block: b }) => {
  b("Block selected apps now.", { start: now }, ["end_or_duration", "recurrence"]);
  b("Just this time.", { recurrence: once }, ["end_or_duration"]);
  b("A quarter of an hour.", { duration_minutes: 15 });
});
buildBase("minimum_duration", "A subminimum immediate duration is rejected rather than silently clamped.", ({ block: b }) => {
  b("Block selected apps now for 2 minutes once.", { start: now, duration_minutes: 2, recurrence: once }, ["duration_minutes"]);
  b("Make that 5 minutes.", { duration_minutes: 5 }, [], { corrections: ["duration_minutes"] });
});
buildBase("maximum_duration", "An above-maximum immediate duration needs a correction before action.", ({ block: b }) => {
  b("Block selected apps now for 300 minutes once.", { start: now, duration_minutes: 300, recurrence: once }, ["duration_minutes"]);
  b("Actually four hours.", { duration_minutes: 240 }, [], { corrections: ["duration_minutes"] });
});
buildBase("daily_needs_clock", "Now is not a recurring local clock; daily protection requires a time and horizon.", ({ block: b }) => {
  b("Block selected apps now for 30 minutes every day.", { start: now, duration_minutes: 30, recurrence: daily }, ["start"]);
  b("Start at 09:00.", { start: at(540), end: 570 }, ["schedule_horizon_days"]);
  b("For seven days.", { schedule_horizon_days: 7 });
});
buildBase("weekends_need_clock", "Weekend recurrence preserves Saturday/Sunday while replacing invalid now.", ({ block: b }) => {
  b("Block selected apps now for 50 minutes on weekends.", { start: now, duration_minutes: 50, recurrence: weekends }, ["start"]);
  b("From 08:30 for 50 minutes, for 14 days.", { start: at(510), end: 560, schedule_horizon_days: 14 });
});
buildBase("schedule_hard_unsupported", "Scheduled hard mode stays unsupported until the user explicitly chooses normal protection.", ({ block: b }) => {
  b("Start a strict block for selected apps from 10am to 11am every day for 7 days.", { start: at(600), end: 660, recurrence: daily, schedule_horizon_days: 7, hard_mode: true }, ["hard_mode"]);
  b("Use a normal block.", { hard_mode: false }, [], { corrections: ["hard_mode"] });
});
buildBase("limit_hard_unsupported", "A hard daily limit cannot silently lose the requested strictness.", ({ block: b }) => {
  b("Set a 30-minute daily limit for selected apps now with hard mode.", { action_type: "daily_limit", start: now, duration_minutes: 30, recurrence: daily, hard_mode: true }, ["hard_mode"]);
  b("Use a regular limit.", { hard_mode: false }, [], { corrections: ["hard_mode"] });
});
buildBase("limit_duration_missing", "Daily limit starts now by capability contract but needs an explicit allowance.", ({ block: b }) => {
  b("Set a daily limit for selected apps.", { action_type: "daily_limit", start: now, recurrence: daily }, ["end_or_duration"]);
  b("45 minutes.", { duration_minutes: 45 });
});
buildBase("limit_scheduled_rejected", "A daily allowance cannot discard a requested future start or expiry; each unsupported constraint needs explicit adjustment.", ({ block: b }) => {
  b("Set a 60-minute daily limit for selected apps starting at 09:00 for 7 days.", { action_type: "daily_limit", start: at(540), duration_minutes: 60, recurrence: daily, schedule_horizon_days: 7 }, ["start", "schedule_horizon_days"]);
  b("Start now.", { start: now, end: null }, ["schedule_horizon_days"]);
  b("Keep it until I remove it.", { schedule_horizon_days: null }, [], { corrections: ["schedule_horizon_days"] });
});
buildBase("horizon_missing", "A recurring window must not inherit an implicit seven-day expiry.", ({ block: b }) => {
  b("Block selected apps from 10am to 11am every day.", { start: at(600), end: 660, recurrence: daily }, ["schedule_horizon_days"]);
  b("9 days.", { schedule_horizon_days: 9 });
});
buildBase("horizon_out_of_range", "An unsupported horizon is corrected explicitly rather than truncated.", ({ block: b }) => {
  b("Block selected apps from 10am to 11am weekdays for 40 days.", { start: at(600), end: 660, recurrence: weekdays, schedule_horizon_days: null }, ["schedule_horizon_days"], { unconfirmed: true });
  b("For 14 days.", { schedule_horizon_days: 14 });
});
buildBase("overnight_weekend", "An overnight interval keeps its next-day end and native weekday mapping.", ({ block: b }) => {
  b("Block selected apps from 23:00 to 07:00 on weekends.", { start: at(1380), end: 420, recurrence: weekends }, ["schedule_horizon_days"]);
  b("For two weeks.", { schedule_horizon_days: 14 });
});
buildBase("separated_weekdays", "Nonadjacent weekly days remain a set rather than a contiguous interval.", ({ block: b }) => {
  b("Block selected apps from 09:15 for 75 minutes on Mondays and Wednesdays.", { start: at(555), duration_minutes: 75, recurrence: { type: "weekly", weekdays: [1, 3] } }, ["schedule_horizon_days"]);
  b("For 6 days.", { schedule_horizon_days: 6 });
});
buildBase("time_duration_conflict", "An explicit end and incompatible duration are not averaged or guessed.", ({ block: b }) => {
  b("Block selected apps from 10am to 11am for 90 minutes every day for 7 days.", { start: at(600), end: 660, duration_minutes: 90, recurrence: daily, schedule_horizon_days: 7 }, ["time_consistency"], { unconfirmed: true });
  b("Until 11am.", { end: 660 });
});
buildBase("oneoff_date_unsupported", "A one-off future time cannot become an immediate or repeating block without consent.", ({ block: b }) => {
  b("Block selected apps from 10am to 11am once.", { start: at(600), end: 660, recurrence: once }, ["calendar_date"]);
  b("Repeat every day for 3 days instead.", { recurrence: daily, schedule_horizon_days: 3 });
});
buildBase("tomorrow_not_now", "Tomorrow is preserved until an explicit correction makes the immediate request actionable.", ({ block: b }) => {
  b("Block selected apps now for 30 minutes tomorrow.", { start: now, duration_minutes: 30, recurrence: { ...once, relative_date: "tomorrow" } }, ["calendar_date"]);
  b("Just once, now instead.", { recurrence: once });
});
buildBase("presence_not_claim", "Saying the app is open does not substitute for a trusted device heartbeat.", ({ block: b }) => {
  b("Block selected apps now for 35 minutes once.", { start: now, duration_minutes: 35, recurrence: once }, ["app_presence"], { setup: "app_presence" });
  b("I have it open.", {}, ["app_presence"], { setup: "app_presence" });
  b("Ready.", {}, [], { context: { app_presence_recent: true, app_presence_state: "recently_seen", app_presence: copy(readyContext.app_presence) } });
}, { app_presence_recent: false, app_presence_state: "not_seen", app_presence: { app_present: false, app_ready: false, last_seen_at: "2000-01-01T00:00:00Z" } });
buildBase("permission_denied", "The same authorized facts survive denied permission and a later real grant.", ({ block: b }) => {
  b("Block selected apps now for 30 minutes once.", { start: now, duration_minutes: 30, recurrence: once }, ["permissions"], { setup: "permissions" });
  b("I said yes.", {}, ["permissions"], { setup: "permissions" });
  b("Ready.", {}, [], { context: { screen_time_authorized: true } });
}, { screen_time_authorized: false });
buildBase("selection_not_conversation", "Describing apps does not create a native Screen Time selection.", ({ block: b }) => {
  b("Block selected apps now for 30 minutes once.", { start: now, duration_minutes: 30, recurrence: once }, ["app_selection"], { setup: "app_selection" });
  b("Yes.", {}, ["app_selection"], { setup: "app_selection" });
  b("Done.", {}, [], { context: { has_selected_apps: true, selection_count: 4 } });
}, { has_selected_apps: false, selection_count: 0 });
buildBase("permission_then_selection", "Permission and native selection are independent prerequisites with ordered recovery.", ({ block: b }) => {
  b("Set a 25-minute daily limit for selected apps.", { action_type: "daily_limit", start: now, duration_minutes: 25, recurrence: daily }, ["permissions"], { setup: "permissions" });
  b("Ready.", {}, ["app_selection"], { setup: "app_selection", context: { screen_time_authorized: true } });
  b("Done.", {}, [], { context: { has_selected_apps: true, selection_count: 3 } });
}, { screen_time_authorized: false, has_selected_apps: false, selection_count: 0 });
buildBase("all_native_gaps", "Presence, permission and selection arrive separately while a recurring plan remains intact.", ({ block: b }) => {
  b("Block selected apps from 18:00 to 19:00 every day for 5 days.", { start: at(1080), end: 1140, recurrence: daily, schedule_horizon_days: 5 }, ["app_presence"], { setup: "app_presence" });
  b("Ready.", {}, ["permissions"], { setup: "permissions", context: { app_presence_recent: true, app_presence_state: "recently_seen", app_presence: copy(readyContext.app_presence) } });
  b("Ready.", {}, ["app_selection"], { setup: "app_selection", context: { screen_time_authorized: true } });
  b("Done.", {}, [], { context: { has_selected_apps: true, selection_count: 2 } });
}, { screen_time_authorized: false, has_selected_apps: false, selection_count: 0, app_presence_recent: false, app_presence_state: "not_seen", app_presence: { app_present: false, app_ready: false, last_seen_at: "2000-01-01T00:00:00Z" } });
buildBase("correct_while_collecting", "A duration correction cannot fill an unrelated missing recurrence slot.", ({ block: b }) => {
  b("Block selected apps now for 30 minutes.", { start: now, duration_minutes: 30 }, ["recurrence"]);
  b("Actually 45 minutes.", { duration_minutes: 45 }, ["recurrence"]);
  b("Once.", { recurrence: once });
});
buildBase("end_crosses_midnight", "An end correction across midnight recalculates duration from the explicit start.", ({ block: b }) => {
  b("Block selected apps from 23:40 to 00:20 every day for 4 days.", { start: at(1420), end: 20, recurrence: daily, schedule_horizon_days: 4 });
  b("Make the end 00:35.", { end: 35 });
});
buildBase("start_keeps_explicit_end", "Moving the start preserves an explicitly requested end and changes duration.", ({ block: b }) => {
  b("Block selected apps from 08:00 to 10:00 every day for 7 days.", { start: at(480), end: 600, recurrence: daily, schedule_horizon_days: 7 });
  b("Move the start to 08:20 and keep the same end.", { start: at(500), end: 600 });
});
buildBase("start_keeps_duration", "Moving a start preserves a user-supplied duration and recomputes its derived end.", ({ block: b }) => {
  b("Block selected apps at 10am for one hour every day for 7 days.", { start: at(600), duration_minutes: 60, recurrence: daily, schedule_horizon_days: 7 });
  b("Actually start at 11am.", { start: at(660), end: 720, duration_minutes: 60 });
});
buildBase("reject_recurrence", "Rejecting daily recurrence also withdraws its horizon until the replacement is specified.", ({ block: b }) => {
  b("Block selected apps from 10am to 11am every day for 7 days.", { start: at(600), end: 660, recurrence: daily, schedule_horizon_days: 7 });
  b("Not daily.", { recurrence: null, schedule_horizon_days: null }, ["recurrence"], { corrections: ["recurrence", "schedule_horizon_days"] });
  b("On weekdays for 5 days.", { recurrence: weekdays, schedule_horizon_days: 5 });
});
buildBase("reject_duration", "Rejecting a duration removes it; a confirmation cannot restore the rejected quantity.", ({ block: b }) => {
  b("Block selected apps now for 30 minutes once.", { start: now, duration_minutes: 30, recurrence: once });
  b("Not 30 minutes.", { duration_minutes: null, end: null }, ["end_or_duration"], { corrections: ["duration_minutes"] });
  b("Yes.", {}, ["end_or_duration"]);
  b("45 minutes.", { duration_minutes: 45 });
});
buildBase("reject_start", "Rejecting the start removes a derived end, while duration and recurrence survive.", ({ block: b }) => {
  b("Block selected apps from 10am for one hour every day for 7 days.", { start: at(600), duration_minutes: 60, recurrence: daily, schedule_horizon_days: 7 });
  b("Not at 10am.", { start: null, end: null }, ["start"], { corrections: ["start"] });
  b("Start at 11am.", { start: at(660), end: 720 });
});
buildBase("advice_needs_optin", "A stated goal and complete facts remain advice until an explicit opt-in.", ({ advice: a, block: b }) => {
  a("I want to scroll less in the morning.", { moment: "morning" }, ["start", "apps", "end_or_duration", "recurrence", "action_type"]);
  a("Selected apps at 10am.", { apps: ["selected_apps"], start: at(600) }, ["end_or_duration", "recurrence", "action_type"]);
  a("One hour, every day for 7 days.", { end: 660, duration_minutes: 60, recurrence: daily, schedule_horizon_days: 7 }, ["action_type"]);
  b("Yes.", { moment: "morning", start: at(600), end: 660, recurrence: daily, schedule_horizon_days: 7 });
});
buildBase("privacy_does_not_authorize", "A privacy question is conversational; only a later explicit selected-app request acts.", ({ idle: i, block: b }) => {
  i("Can you read the contents of my private messages?");
  b("Block selected apps now for 30 minutes, once.", { start: now, duration_minutes: 30, recurrence: once });
});
buildBase("unsupported_to_supported", "An unsupported exception-list request cannot masquerade as broad blocking.", ({ capability: c, block: b }) => {
  c("Only allow essential apps.", "allow_only");
  c("Yes.", "allow_only");
  b("Block selected apps now for 20 minutes once instead.", { start: now, duration_minutes: 20, recurrence: once });
});
buildBase("retrospective_to_new", "A previous failed block is an observation, distinct from a new authorized instruction.", ({ capability: c, block: b }) => {
  c("I broke the block yesterday after 15 minutes.", "past_block_review");
  c("Yes.", "past_block_review");
  b("Block selected apps now for 30 minutes once.", { start: now, duration_minutes: 30, recurrence: once });
});
buildBase("cancel_then_new", "A cancellation closes old authorization; a fresh request starts with its own missing fields.", ({ block: b, cancelled: c }) => {
  b("Block selected apps now for 30 minutes once.", { start: now, duration_minutes: 30, recurrence: once });
  c();
  c("Confirmed.");
  b("Block selected apps now for 20 minutes.", { start: now, duration_minutes: 20 }, ["recurrence"]);
  b("Just once.", { recurrence: once });
});

if (bases.length !== 40) throw new Error(`expected 40 explicit bases, got ${bases.length}`);
const continuations = ["withdraw_authorization", "amend_authorized_quantity", "change_to_unsupported_capability", "amend_while_permission_revoked", "amend_while_selection_removed"];
const conversations = [];
for (const base of bases) {
  for (const continuation of continuations) {
    const turns = copy(base.turns);
    const original = copy(turns.at(-1).expect.state);
    const nextDuration = original.duration_minutes >= 235 ? 230 : original.duration_minutes + 5;
    const revised = { ...original, duration_minutes: nextDuration,
      end: original.start.type === "time" ? (original.start.minute + nextDuration) % 1440 : null,
      confirmation: "confirmed", pending_slots: [], status: "ready", next_question: null };
    function append(input, state, decision, actions = [], context) {
      turns.push({ input, ...(context ? { context } : {}), expect: { state: copy(state), decision, actions, language: "en" } });
    }
    if (continuation === "withdraw_authorization") {
      const state = { ...empty(), intent: "cancelled", pending_slots: [], status: "cancelled", next_question: null };
      append("Please withdraw my instruction.", state, { type: "cancelled", slot: null });
      append("Yes.", state, { type: "cancelled", slot: null });
    } else if (continuation === "change_to_unsupported_capability") {
      const state = { ...empty(), intent: "advice", requested_capability: "adult_filter", pending_slots: [], status: "idle", next_question: null };
      append("Help me block adult websites instead.", state, { type: "none", slot: null });
      append("Confirmed.", state, { type: "none", slot: null });
    } else if (continuation === "amend_authorized_quantity") {
      append(`Actually ${nextDuration} minutes.`, revised, { type: "ready", slot: null }, [action(revised)]);
      turns.at(-1).expect.correction_slots = ["duration_minutes"];
      append("Yes, do it.", revised, { type: "ready", slot: null });
    } else {
      const permission = continuation === "amend_while_permission_revoked";
      const gap = permission ? "permissions" : "app_selection";
      const setup = { ...revised, pending_slots: [gap], status: "needs_setup", next_question: gap };
      const setupAction = permission ? { type: "request_screen_time_permission" } : { ...action(revised), type: "open_app_picker" };
      append(`Actually ${nextDuration} minutes.`, setup, { type: "setup", slot: gap }, [setupAction],
        permission ? { screen_time_authorized: false } : { has_selected_apps: false, selection_count: 0 });
      turns.at(-1).expect.correction_slots = ["duration_minutes"];
      append("Ready.", revised, { type: "ready", slot: null }, [action(revised)],
        permission ? { screen_time_authorized: true } : { has_selected_apps: true, selection_count: 4 });
    }
    conversations.push({ id: `${base.id}__${continuation}`, channel: "whatsapp", base_journey: base.id,
      continuation, purpose: `${base.purpose} Follow-up: ${continuation}.`, context: copy(base.context), turns });
  }
}

const dataset = { version: 1, id: "bm-product-journeys-v1-2026-09-26", split: "development",
  provenance: "Synthetic acceptance corpus authored from the current product contract; 40 explicitly authored base journeys crossed with 5 stateful continuations. Not 200 independent base scenarios, not user transcripts, not a heldout. No tested runtime output is imported or used to generate gold. Historical datasets remain unchanged. English WhatsApp planner context exercises shared intelligence, not provider delivery or iPhone execution.",
  conversations };
const textKey = (c) => JSON.stringify(c.turns.map((t) => t.input));
const semanticKey = (c) => JSON.stringify([c.context, c.turns.map((t) => [t.context || null, t.expect])]);
const hash = (x) => crypto.createHash("sha256").update(x).digest("hex");
const output = path.join(__dirname, "datasets", "bm_product_journeys_v1.json");
const content = JSON.stringify(dataset, null, 2) + "\n";
const manifest = { dataset: "tools/datasets/bm_product_journeys_v1.json", sha256_bytes: hash(content),
  authored_at: "2026-09-26", split: "development", independent_holdout: false,
  base_journeys: bases.length, continuations_per_base: continuations.length, conversations: conversations.length,
  turns: conversations.reduce((n, c) => n + c.turns.length, 0),
  distinct_text_sequences: new Set(conversations.map(textKey)).size,
  distinct_expected_sequences: new Set(conversations.map(semanticKey)).size,
  distinct_input_gold_pairs: new Set(conversations.flatMap(c => c.turns.map(t => JSON.stringify([t.input,t.expect])))).size,
  turns_asserting_correction_history: conversations.reduce((n,c) => n + c.turns.filter(t => t.expect.correction_slots?.length).length, 0),
  variation_policy: "No expansion by channel, language, identity, app name or numeric substitution. Combinatorial prefixes are reported explicitly. Each continuation starts from inherited state and changes authorization, intent, quantity, permission, or selection.",
  limitations: ["Not 200 independent base scenarios.", "English only; does not establish Spanish parity.", "Synthetic planner contexts do not establish native or transport behavior.", "Visible equivalence needs independent judge hashes; no reviews are generated here."],
  bases: bases.map((b) => ({ id: b.id, purpose: b.purpose, prefix_turns: b.turns.length })), continuations };
fs.writeFileSync(output, content);
fs.writeFileSync(output.replace(/\.json$/, ".manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ output, ...Object.fromEntries(Object.entries(manifest).filter(([key]) => ["base_journeys", "conversations", "turns", "distinct_text_sequences", "distinct_expected_sequences", "sha256_bytes"].includes(key))) }, null, 2));
