"use strict";

// This module owns action facts. Free-form model output is never an action source.
// Each turn is reduced independently; old user prose is not concatenated into a parser.
const { createHash } = require("node:crypto");
const { normalizeSemanticDelivery, applySemanticDelivery, renderSuppressedDelivery } = require("./bm-semantic-delivery");
const VERSION = 1;
const TTL_MS = 2 * 60 * 60 * 1000;
const SLOT_NAMES = ["apps", "app_category", "moment", "action_type", "hard_mode", "requested_capability", "start", "end", "duration_minutes", "recurrence", "schedule_horizon_days", "confirmation"];
const STATUSES = ["idle", "collecting", "awaiting_confirmation", "needs_setup", "ready", "cancelled"];
const APPS = [
  ["youtube shorts", "YouTube Shorts"], ["tik tok", "TikTok"], ["tiktok", "TikTok"],
  ["instagram", "Instagram"], ["insta", "Instagram"], ["youtube", "YouTube"],
  ["reddit", "Reddit"], ["twitter", "Twitter"], ["facebook", "Facebook"],
  ["snapchat", "Snapchat"], ["whatsapp", "WhatsApp"], ["slack", "Slack"],
  ["duolingo", "Duolingo"], ["twitch", "Twitch"], ["discord", "Discord"],
  ["bereal", "BeReal"], ["pinterest", "Pinterest"], ["telegram", "Telegram"],
  ["google maps", "Google Maps"], ["maps", "Maps"],
];
const DAYS = [["monday", "lunes"], ["tuesday", "martes"], ["wednesday", "miercoles"], ["thursday", "jueves"], ["friday", "viernes"], ["saturday", "sabado"], ["sunday", "domingo"]];
const NUMBER_WORDS = { a:1, an:1, one:1, un:1, una:1, uno:1, two:2, dos:2, three:3, tres:3, four:4, cuatro:4, five:5, cinco:5, six:6, seis:6, seven:7, siete:7, eight:8, ocho:8, nine:9, nueve:9, ten:10, diez:10, fifteen:15, quince:15, twenty:20, veinte:20, thirty:30, treinta:30, forty:40, cuarenta:40, fortyfive:45, sixty:60, sesenta:60 };
const clean = (v, max = 1200) => typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "";
const fold = (v) => clean(v).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const clone = (v) => JSON.parse(JSON.stringify(v));
const escaped = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const contains = (text, term) => new RegExp(`\\b${escaped(fold(term))}\\b`).test(text);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const value = (state, name) => state.slots[name]?.value ?? null;
const minute = (n) => Number.isInteger(n) && n >= 0 && n < 1440;
const usesSingleDistractionBlock = () => true;

function emptyState(language = "en", now = Date.now()) {
  return { version:VERSION, revision:0, turn:0, updated_at:new Date(now).toISOString(), language:language === "es" ? "es" : "en", intent:"general", slots:Object.fromEntries(SLOT_NAMES.map(k => [k, null])), corrections:[], pending_slots:[], status:"idle", next_question:null, errors:[], last_action_fingerprint:null, delivery:null };
}

function validValue(key, v) {
  if (key === "apps") return Array.isArray(v) && v.length > 0 && v.length <= 12 && v.every(a => typeof a === "string" && a.length > 0 && a.length <= 80);
  if (key === "app_category" || key === "moment") return typeof v === "string" && v.length > 0 && v.length < 180;
  if (key === "action_type") return ["strict_block", "daily_limit"].includes(v);
  if (key === "hard_mode") return typeof v === "boolean";
  if (key === "requested_capability") return ["allow_only","adult_filter","work_use_constraint","weekly_review","past_block_review"].includes(v);
  if (key === "start") return v && (v.type === "now" || (v.type === "time" && minute(v.minute)));
  if (key === "end") return minute(v);
  if (key === "duration_minutes") return Number.isInteger(v) && v > 0 && v <= 1440;
  if (key === "schedule_horizon_days") return Number.isInteger(v) && v >= 1 && v <= 14;
  if (key === "recurrence") return v && ["once", "daily", "weekly"].includes(v.type) && Array.isArray(v.weekdays) && (v.type === "once" ? v.weekdays.length === 0 : v.weekdays.length > 0 && v.weekdays.length <= 7 && v.weekdays.every(d => Number.isInteger(d) && d >= 1 && d <= 7)) && (!v.date || /^\d{4}-\d{2}-\d{2}$/.test(v.date)) && (!v.relative_date || ["today", "tomorrow"].includes(v.relative_date));
  if (key === "confirmation") return v && v.status === "confirmed" && /^[a-f0-9]{24}$/.test(v.fingerprint);
  return false;
}

function normalizeSemanticState(input, now = Date.now()) {
  if (!input || input.version !== VERSION || !input.slots || !Number.isFinite(Date.parse(input.updated_at))) return null;
  const age = now - Date.parse(input.updated_at);
  if (age < -300000 || age > TTL_MS) return null;
  const state = emptyState(input.language, now);
  state.updated_at = input.updated_at;
  state.turn = Number.isInteger(input.turn) && input.turn >= 0 ? Math.min(input.turn, 100000) : 0;
  state.revision = Number.isInteger(input.revision) && input.revision >= 0 ? Math.min(input.revision, 100000) : 0;
  state.intent = ["general", "advice", "block", "cancelled"].includes(input.intent) ? input.intent : "general";
  state.status = STATUSES.includes(input.status) ? input.status : "idle";
  for (const key of SLOT_NAMES) {
    const slot = input.slots[key];
    if (!slot || !validValue(key, slot.value) || !slot.source || !["user", "derived", "device"].includes(slot.source.kind)) continue;
    if (!Number.isInteger(slot.source.turn) || slot.source.turn < 0 || slot.source.turn > state.turn) continue;
    if (slot.source.kind === "user" && !clean(slot.source.text)) continue;
    state.slots[key] = { value:clone(slot.value), source:{ kind:slot.source.kind, turn:slot.source.turn, text:clean(slot.source.text), ...(Array.isArray(slot.source.depends_on) ? { depends_on:slot.source.depends_on.filter(k => SLOT_NAMES.includes(k)) } : {}) }, confidence:typeof slot.confidence === "number" && slot.confidence >= 0 && slot.confidence <= 1 ? slot.confidence : 0 };
  }
  state.corrections = Array.isArray(input.corrections) ? input.corrections.slice(-20).filter(c => c && SLOT_NAMES.includes(c.slot)).map(c => ({ slot:c.slot, previous:clone(c.previous ?? null), replacement:clone(c.replacement ?? null), turn:Number(c.turn) || 0, text:clean(c.text) })) : [];
  state.pending_slots = Array.isArray(input.pending_slots) ? input.pending_slots.filter(k => SLOT_NAMES.includes(k) || ["end_or_duration", "calendar_date", "time_consistency", "app_presence", "permissions", "app_selection"].includes(k)) : [];
  state.next_question = state.pending_slots.includes(input.next_question) ? input.next_question : null;
  state.errors = Array.isArray(input.errors) ? input.errors.slice(0, 12).filter(e => e && typeof e.code === "string").map(e => ({ code:clean(e.code, 64), slot:clean(e.slot, 64), text:clean(e.text, 160) })) : [];
  state.last_action_fingerprint = /^[a-f0-9]{24}$/.test(input.last_action_fingerprint || "") ? input.last_action_fingerprint : null;
  // A stale or edited proposal can never retain its previous confirmation.
  if (value(state, "confirmation")?.fingerprint !== proposalFingerprint(state)) state.slots.confirmation = null;
  state.delivery = state.slots.confirmation ? normalizeSemanticDelivery(input.delivery, proposalFingerprint(state)) : null;
  return state;
}

function proposalFingerprint(state) {
  // App names remain conversational/intelligence context, but they no longer
  // select the activation target. The executable target is always the single
  // canonical distraction block, so app wording cannot alter its fingerprint.
  const facts = Object.fromEntries(SLOT_NAMES.filter(k => !["confirmation", "apps", "moment", "app_category"].includes(k)).map(k => [k, value(state, k)]));
  return createHash("sha256").update(JSON.stringify({ intent:state.intent, ...facts })).digest("hex").slice(0, 24);
}

function currentCorrection(text) {
  // Reject the negated alternative before looking for facts; do not union old and new apps/times.
  let result = text;
  const prefix = result.match(/^(?:no[, ]+)?(?:not|no)\s+.+?\s+(?:but|sino)\s+(.+)$/i);
  if (prefix) result = prefix[1];
  const instead = result.match(/^(.+?)\s+(?:instead of|en vez de|en lugar de)\s+.+$/i);
  if (instead) result = instead[1];
  result = result.replace(/\b(?:not|no)\s+[^,;.]+[,;.]\s*/gi, "");
  result = result.replace(/[,;]\s*(?:not|no)\s+.+$/i, "");
  return result.replace(/^(?:no|actually|sorry|perdon|perdona|mejor|en realidad)[,;:]?\s+/i, "");
}

function parseDuration(text) {
  const wordPattern = Object.keys(NUMBER_WORDS).join("|");
  const pattern = new RegExp(`\\b(\\d+(?:[.,]\\d+)?|${wordPattern})\\s*[-–]?\\s*(hours?|hrs?|horas?|h|minutes?|mins?|minutos?|m)\\b`, "g");
  // Word amounts require a separator: "a minute" is a duration, "am" and the
  // Spanish word "ahora" are not "a" + "m/hora". Digits may use compact 30m.
  const matches = [...text.matchAll(pattern)].filter(m => /^\d/.test(m[1]) || /^\s+/.test(m[0].slice(m[1].length)));
  // A sign belongs to its quantity; stripping it would authorize a different
  // duration. Reject negative numeric/word amounts before summing units.
  if (matches.some(m => /[-−]\s*$|\b(?:minus|menos)\s*$/.test(text.slice(0, m.index)))) return { error:"unsupported_duration" };
  const half = /\b(?:half an? hour|half hour|media hora)\b/.test(text);
  const quarter = /\b(?:quarter of an hour|quarter hour|cuarto de hora)\b/.test(text);
  const hourHalf = /\b(?:an? hour and a half|one hour and a half|una hora y media)\b/.test(text);
  if (hourHalf) return { minutes:90, spans:[text.match(/(?:an? hour and a half|one hour and a half|una hora y media)/)[0]] };
  if (half || quarter) return { minutes:half ? 30 : 15, spans:[half ? "half hour" : "quarter hour"] };
  if (!matches.length) return null;
  if (/\b(?:or|o|between|entre|about|around|aproximadamente)\b/.test(text) && matches.length > 1) return { error:"ambiguous_duration" };
  const units = matches.map(m => /^(?:h|hour|hr|hora)/.test(m[2]) ? 60 : 1);
  if (units.length > 2 || new Set(units).size !== units.length) return { error:"multiple_durations" };
  const minutes = matches.reduce((sum, m, i) => sum + (NUMBER_WORDS[m[1]] ?? Number(m[1].replace(",", "."))) * units[i], 0);
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 1440) return { error:"unsupported_duration" };
  return { minutes, spans:matches.map(m => m[0]) };
}

const CLOCK = "(?:\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?|de la manana|de la tarde|de la noche)?|noon|midnight|mediodia|medianoche)";
function clockValue(text, sharedMarker = "") {
  const raw = fold(text).replace(/\./g, "").trim();
  if (["noon", "mediodia"].includes(raw)) return 720;
  if (["midnight", "medianoche"].includes(raw)) return 0;
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|de la manana|de la tarde|de la noche)?$/);
  if (!match) return null;
  const h = Number(match[1]), m = Number(match[2] || 0), mark = match[3] || sharedMarker;
  if (m > 59 || h > 23) return null;
  if (mark) {
    if (h < 1 || h > 12) return null;
    return (h % 12 + (/pm|tarde|noche/.test(mark) ? 12 : 0)) * 60 + m;
  }
  if (h === 0 || h > 12 || match[2] != null || /^0\d/.test(match[1])) return h * 60 + m;
  return null; // A bare 1..12 does not specify AM/PM.
}

function extractApps(text, context) {
  let rest = text;
  const apps = [];
  const catalog = [...APPS];
  for (const app of [...(context.selected_app_names || []), ...(context.available_app_names || [])]) {
    if (typeof app === "string" && app.length < 81) catalog.push([app, app]);
  }
  catalog.sort((a, b) => b[0].length - a[0].length);
  for (const [alias, name] of catalog) {
    const regex = new RegExp(`\\b${escaped(fold(alias))}\\b`, "g");
    if (regex.test(rest)) { apps.push(name); rest = rest.replace(regex, " "); }
  }
  for (const match of text.matchAll(/["“]([^"”]{1,60})["”]/g)) apps.push(match[1]);
  if (/\b(?:my selected apps|selected apps|my distractions|selected distractions|current selection|apps seleccionadas|aplicaciones seleccionadas|mis distracciones|distracciones seleccionadas|seleccion actual)\b/.test(text)) return ["selected_apps"];
  return [...new Set(apps)].sort();
}

function parseRecurrence(text, pendingQuestion) {
  const tomorrow = /\b(?:tomorrow|manana)\b/.test(text.replace(/de la manana/g, ""));
  const today = /\b(?:today|tonight|hoy|esta noche)\b/.test(text);
  const explicitDate = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (/\b(?:every day|each day|per day|daily|cada dia|al dia|por dia|todos los dias|diariamente|every night|cada noche)\b/.test(text)) return { type:"daily", weekdays:[1,2,3,4,5,6,7] };
  if (/\b(?:weekdays|monday (?:to|through) friday|entre semana|lunes a viernes)\b/.test(text)) return { type:"weekly", weekdays:[1,2,3,4,5] };
  if (/\b(?:weekends|fines? de semana)\b/.test(text)) return { type:"weekly", weekdays:[6,7] };
  const days = DAYS.flatMap((names, i) => names.some(n => contains(text, n)) || contains(text,names[0]+"s") ? [i+1] : []);
  if (days.length && (pendingQuestion === "recurrence" || /\b(?:every|each|cada|todos los|los lunes|los martes|los miercoles|los jueves|los viernes|los sabados|los domingos)\b/.test(text) || DAYS.some(names => contains(text, names[0] + "s")))) return { type:"weekly", weekdays:days };
  if (/\b(?:once|one time|one off|just this time|solo esta vez|una vez|sin repetir|no repeat)\b/.test(text) || tomorrow || today || explicitDate) return { type:"once", weekdays:[], ...(tomorrow || today ? { relative_date:tomorrow ? "tomorrow" : "today" } : {}), ...(explicitDate ? { date:explicitDate[1] } : {}) };
  return null;
}

function isLimitInstruction(clause) {
  return /^(?:please\s+|por favor\s+)?(?:set|apply|enable|put|pon|establece|fija|activa|aplica)\s+(?:(?:a|an|the|that|this|un|el|ese|este)\s+)?(?:(?:daily|usage|screen time)\s+)?(?:limit|limite)\b/.test(clause)
    || /^(?:i want|i need|quiero|necesito)\s+(?:(?:a|an|un|el)\s+)?(?:(?:daily|usage)\s+)?(?:limit|limite)\b/.test(clause);
}

function extractSemanticPatch({ prompt, state = emptyState(), context = {} }) {
  const original = clean(prompt);
  const text = fold(currentCorrection(original));
  const full = fold(original);
  const patch = { intent:null, set:{}, clear:[], evidence:original, errors:[], confirmation:false, cancelled:false, meaningful:false };
  const put = (key, v) => { patch.set[key] = v; patch.meaningful = true; };
  const error = (slot, code) => { patch.errors.push({ slot, code, text:original }); patch.clear.push(slot); patch.meaningful = true; };
  // Withdrawal is a speech act on a clause, not a whole-message exact phrase.
  // Keep its target scoped to this instruction; explanations and thanks may
  // follow it, while negated cancellation or unrelated objects are not consent.
  const originalClauses = original.split(/[;.!?]|\b(?:but|pero|sino)\b/i);
  const clauses = originalClauses.map(part => fold(part).replace(/^no,\s*/, "").replace(/,\s*(please|por favor)$/, " $1"));
  const cancelClause = /^(?:(?:please\s+)?(?:cancel|discard|withdraw|drop)(?:\s+(?:it|this|that)|\s+(?:the|this|that|my|our)\s+(?:(?:pending|current)\s+)?(?:request|proposal|plan|block|schedule|instruction))?(?:\s+please)?|never mind|nevermind|forget (?:it|that|(?:the|this|that) (?:plan|request|proposal))|stop(?: it| that)?|(?:por favor\s+)?(?:cancela(?:lo)?|descarta|retira|anula)(?:\s+(?:el|la|este|esta|ese|esa|mi)\s+(?:plan|bloqueo|solicitud|peticion|propuesta|programacion|instruccion|orden)(?:\s+(?:pendiente|actual))?)?(?:\s+por favor)?|olvida(?:lo| el plan)|dejalo)$/;
  let lastWithdrawal = -1;
  clauses.forEach((clause, index) => {
    // A reason explains this withdrawal; it is never a second instruction.
    // "For now" withdraws the current request, without promising future resume.
    const withdrawalTarget = clause.split(/\s+(?:because|porque)\b/)[0].trim()
      .replace(/,\s*$/, "").replace(/(?:,\s*|\s+)(?:for now|por ahora)$/, "");
    const negatedAction = /\b(?:do not|don't|dont|no quiero|no)\s+(?:block|bloquear|bloquees|schedule|programar)\b/.test(withdrawalTarget)
      || /^(?:(?:please|por favor)\s+)?(?:i\s+)?(?:do not|don't|dont|no quiero|no)\s+(?:apply|execute|send|aplicar|apliques|aplicarla|aplicarlo|ejecutar|ejecutes|ejecutarla|ejecutarlo|enviar|envies)(?:\s+(?:it|this|that|the (?:request|proposal)|(?:esta|esa|la) (?:solicitud|peticion|propuesta)))?$/.test(withdrawalTarget);
    const withoutNegation = withdrawalTarget.replace(/^(?:(?:please|por favor)\s+)?(?:do not|don't|dont|no)\s+/, "");
    const negatedLimit = withoutNegation !== withdrawalTarget && isLimitInstruction(withoutNegation);
    if (cancelClause.test(withdrawalTarget) || negatedAction || negatedLimit) lastWithdrawal = index;
  });
  // Only instructions after the last withdrawal can replace it. Preserve the
  // remaining clauses so later constraints cannot disappear during replacement.
  const following = clauses.slice(lastWithdrawal + 1);
  const hasReplacement = following.some(clause => /^(?:(?:please|por favor)\s+)?(?:block|bloquea|protect|protege|schedule|programa)\b/.test(clause) || isLimitInstruction(clause));
  const replacement = lastWithdrawal >= 0 && hasReplacement && originalClauses.slice(lastWithdrawal + 1).join("; ");
  if (replacement) return { ...extractSemanticPatch({ prompt:replacement, state, context }), evidence:original };
  if (lastWithdrawal >= 0) return { ...patch, intent:"cancelled", cancelled:true, meaningful:true };
  // Route capabilities and reflection before generic block vocabulary. A past
  // block, a web filter, and apps that must remain available are different intents.
  const explicitNewBlock = /\b(?:block (?:it |them |again )?now|start (?:a )?(?:new )?block|bloquea ahora|inicia (?:un )?(?:nuevo )?bloqueo)\b/.test(full);
  const pastBlock = /\b(?:broke|finished|completed|ended|stopped|failed|rompi|termine|complete|fallo)\b[^.!?]{0,45}\b(?:block|protection|bloqueo|proteccion)\b/.test(full) || /\b(?:last block|yesterday.s block|bloqueo de ayer)\b/.test(full);
  const requestedCapability = !explicitNewBlock && pastBlock ? "past_block_review"
    : /\b(?:review my week|weekly review|review this week|revisa mi semana|revision semanal|resumen de (?:mi|la) semana)\b/.test(full) ? "weekly_review"
    : /\b(?:adult (?:websites?|content)|porn|porno|contenido adulto|paginas? (?:web )?adultas?)\b/.test(full) ? "adult_filter"
    : /\b(?:only (?:let me use|allow)|allow only|everything except|solo (?:dejame usar|permitir)|todo excepto|solo esenciales)\b/.test(full) ? "allow_only"
    : /\b(?:but|pero)\b[^.!?]{0,60}\b(?:need|necesito)\b[^.!?]{0,80}\b(?:work|study|trabajar|estudiar)\b/.test(full) ? "work_use_constraint" : null;
  if (requestedCapability) {
    patch.intent="advice"; put("requested_capability",requestedCapability);
    const named = extractApps(text,context); if (named.length) put("apps",named);
    // Retrospective quantities are observations, not requested future durations.
    return patch;
  }
  // A rejected fact with no replacement becomes missing; it must not be re-read as
  // an affirmative fact and cannot leave an old value available to confirmation.
  if (/^(?:not|no)\s+[^,;.]+[.!]?$/i.test(full) && !/\b(?:thanks|gracias)\b/.test(full)) {
    const rejectedApps = extractApps(full,context);
    if (rejectedApps.length) patch.clear.push("apps");
    const rejectedDuration = parseDuration(full);
    if (rejectedDuration) patch.clear.push("duration_minutes","end");
    if (parseRecurrence(full,state.next_question)) patch.clear.push("recurrence","schedule_horizon_days");
    // A duration number is not also a rejected clock. "Not 30 minutes"
    // withdraws only the quantity, preserving an independently authorized start.
    if (/\b(?:at|from|until|start|end|a las|desde|hasta)\b/.test(full) || (!rejectedDuration && new RegExp(CLOCK,"i").test(full.replace(/^not\s+/i,"")))) {
      if (/\b(?:end|until|hasta|fin)\b/.test(full)) patch.clear.push("end","duration_minutes");
      else patch.clear.push("start");
    }
    if (patch.clear.length) { patch.meaningful=true; return patch; }
  }
  const questionAdvice = /^(?:how (?:can|do|should)|why|what (?:should|can)|can you explain|como (?:puedo|hago)|por que|que (?:puedo|deberia)|explica)/.test(full);
  const modeActivationRequest = usesSingleDistractionBlock(context) && /\b(?:start|activate|use|switch to|inicia|activa|usa|cambia a)\b[^.!?]{0,80}\b(?:mode|modo|profile|perfil)\b/.test(full);
  // Recognize an explicit limit instruction independently of the nouns used
  // for its allowance. A question about limits remains advice below.
  const limitRequest = clauses.some(isLimitInstruction);
  const actionRequest = (/\b(?:block|bloquea|bloquear|protect|proteger|protege|schedule|programa|programar|set (?:a |an )?(?:daily |\d+[ -])?limit|limita|limitar|daily limit|limite diario|start protection|start focus|focus now|strict block|inicia un bloqueo|inicia foco|activa foco)\b/.test(full) || modeActivationRequest || limitRequest) && !questionAdvice;
  const digitalBehavior = /\b(?:(?:doom)?scroll\w*|phone|screen\w*|apps?|social media|m[oó]vil|pantallas?|redes sociales|distra\w*)\b/.test(full) || extractApps(full,context).length > 0;
  const behaviorGoal = /\b(?:i want|i need|i wish|i keep|i usually|i often|i struggle|i.m trying|i am trying|i can.t stop|too much|less|reduce|stop checking|quiero|necesito|me gustaria|suelo|me cuesta|no puedo parar|demasiado|menos)\b/.test(full);
  const advice = questionAdvice || (!actionRequest && digitalBehavior && behaviorGoal);
  if (advice) { patch.intent = "advice"; patch.meaningful = true; }
  if (actionRequest) { patch.intent = "block"; put("action_type", /\b(?:daily limit|limite(?: diario| de uso)?|per day|al dia|por dia|limit|limita|limitar)\b/.test(text) ? "daily_limit" : "strict_block"); }
  if (actionRequest || advice) patch.clear.push("requested_capability");
  // Daily limits have no native expiry field. Only explicit removal of that
  // constraint may clear it; a generic yes or changing the start cannot do so.
  if (value(state,"action_type") === "daily_limit" && value(state,"schedule_horizon_days") != null
    && /^(?:keep (?:it|the limit) until i remove it|remove the end date|quita la fecha de fin|mantenlo hasta que lo quite)[.!]?$/i.test(full)) {
    patch.clear.push("schedule_horizon_days"); patch.meaningful = true;
  }
  const greeting = /^(?:hi|hello|hey|hola|buenas|thanks|thank you|gracias|good morning|buenos dias)[.!]?$/i.test(full);
  if (greeting) return patch;
  if (!actionRequest && !advice && state.intent !== "block" && state.intent !== "advice") return patch;
  if (/\b(?:not (?:hard|strict)|normal (?:mode|block|limit)|regular (?:mode|block|limit)|soft (?:mode|block|limit)|sin modo estricto|bloqueo normal|limite normal)\b/.test(text)) put("hard_mode",false);
  else if (/\b(?:hard (?:mode|block)|strict (?:mode|block)|modo (?:duro|estricto)|bloqueo estricto)\b/.test(text)) put("hard_mode",true);
  const apps = extractApps(text, context);
  if (apps.length) {
    if (/\b(?:also|add|include|tambien|anade|incluye)\b/.test(text) && value(state,"apps")) put("apps", [...new Set([...value(state,"apps"), ...apps])].sort());
    else if (/\b(?:remove|except|exclude|quita|excepto|excluye)\b/.test(text)) {
      // App edits are clause-scoped. "Keep A; remove B" cannot remove A simply
      // because its name occurred somewhere in the same turn.
      const clauses = text.split(/[;.!?]|\b(?:and|y)\s+(?=(?:keep|remove|retain|exclude|conserva|quita|excluye)\b)/);
      const removed = clauses.filter(c => /\b(?:remove|except|exclude|quita|excepto|excluye)\b/.test(c)).flatMap(c => extractApps(c.split(/\b(?:remove|except|exclude|quita|excepto|excluye)\b/)[1] || "",context));
      const kept = clauses.filter(c => /\b(?:keep|retain|conserva|manten)\b/.test(c) && !/\b(?:remove|except|exclude|quita|excepto|excluye)\b/.test(c)).flatMap(c => extractApps(c,context));
      const positivePrefix = extractApps(text.split(/\b(?:remove|except|exclude|quita|excepto|excluye)\b/)[0],context);
      const remaining = [...new Set([...(value(state,"apps") || positivePrefix),...kept])].filter(a => !removed.includes(a)).sort();
      if (remaining.length) put("apps", remaining); else patch.clear.push("apps");
    } else put("apps", apps);
    patch.clear.push("app_category");
  } else if (/\b(?:social media|social apps|social networks|redes sociales)\b/.test(text)) { put("app_category", "social_apps"); patch.clear.push("apps"); }
  const moment = text.match(/\b(?:after breakfast|after lunch|after dinner|after work|when (?:i finish work|work ends)|before bed|at nights?|in the (?:mornings?|afternoons?|evenings?)|(?:por|en) las? (?:mananas?|noches?|tardes?)|despues de (?:desayunar|comer|cenar|trabajar)|al terminar de trabajar|antes de dormir)\b/);
  const momentValue = moment ? (/morning|manana/.test(moment[0]) ? "morning" : /afternoon|tarde/.test(moment[0]) ? "afternoon" : /evening/.test(moment[0]) ? "evening" : moment[0].replace(/at nights$/, "at night")) : null;
  if (momentValue) put("moment", momentValue);
  const recurrence = parseRecurrence(text, state.next_question);
  if (recurrence) put("recurrence", recurrence);
  const horizon = text.match(new RegExp(`\\b(?:for|during|durante|por)\\s+(?:(?:the\\s+)?(?:next|following)\\s+|(?:los|las)\\s+(?:proximos|proximas|siguientes)\\s+)?(\\d+|${Object.keys(NUMBER_WORDS).join("|")})\\s+(days?|dias?|weeks?|semanas?)\\b`));
  const shortHorizon = state.next_question === "schedule_horizon_days" ? text.match(/^(\d+)\s*(days?|dias?)?[.!]?$/) : null;
  if (horizon || shortHorizon) {
    const matched = horizon || shortHorizon;
    const count = (NUMBER_WORDS[matched[1]] ?? Number(matched[1])) * (/week|semana/.test(matched[2]) ? 7 : 1);
    if (validValue("schedule_horizon_days",count)) put("schedule_horizon_days",count); else error("schedule_horizon_days","unsupported_schedule_horizon");
  }
  const duration = parseDuration(text);
  if (duration?.error) error("duration_minutes", duration.error);
  else if (duration) put("duration_minutes", duration.minutes);
  let clocksText = text;
  if (horizon) clocksText = clocksText.replace(horizon[0]," ");
  if (shortHorizon) clocksText = "";
  for (const span of duration?.spans || []) clocksText = clocksText.replace(span, " ");
  // A reply may answer several pending facts: "11am Instagram".
  for (const [alias, app] of APPS) if (apps.includes(app)) clocksText = clocksText.replace(new RegExp(`\\b${escaped(alias)}\\b`, "g"), " ");
  clocksText = clocksText.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ");
  const window = clocksText.match(new RegExp(`(?:\\b(?:from|between|de|desde|entre)\\s+)?(${CLOCK})\\s*(?:-|–|to|until|hasta|a|and|y)\\s*(${CLOCK})(?!\\d)`, "i"));
  if (window) {
    const trailingMarker = window[2].match(/(am|pm|de la manana|de la tarde|de la noche)\s*$/)?.[1] || "";
    const startMinute = clockValue(window[1], trailingMarker);
    const endMinute = clockValue(window[2]);
    if (startMinute == null) error("start", "ambiguous_start"); else put("start", { type:"time", minute:startMinute });
    if (endMinute == null) error("end", "ambiguous_end"); else put("end", endMinute);
  } else {
    if (/\b(?:right now|now|immediately|ahora|ya)\b/.test(clocksText)) put("start", { type:"now" });
    const assignment = "(?:\\s+(?:to|at|is|be|a|a las|sea|sera)|\\s*[=:])?";
    const endRole = "(?:end(?:ing)?(?: time)?|finish(?:ing)?(?: time)?|hora de fin|finalizacion|fin)";
    const startRole = "(?:start(?:ing)?(?: time)?|begin(?:ning)?(?: time)?|hora de inicio|inicio)";
    const endMatch = clocksText.match(new RegExp(`\\b(?:${endRole}${assignment}|until|till|ends? at|finish(?:es)? at|hasta(?: las)?|termina a las)\\s+(${CLOCK})`, "i"));
    const startMatch = clocksText.match(new RegExp(`\\b(?:${startRole}${assignment}|starts? (?:at|to)|from|at|a partir de(?: las)?|a las|desde(?: las)?)\\s+(${CLOCK})`, "i"));
    const endWords = /\b(?:end|finish|until|fin|termina|hasta)\b/.test(clocksText);
    if (endMatch) { const v = clockValue(endMatch[1]); v == null ? error("end", "ambiguous_end") : put("end", v); }
    else if (startMatch) {
      const explicitStart = /\b(?:start|from|starting|inicio|desde|empieza)\b/.test(clocksText);
      const target = !explicitStart && (endWords || state.next_question === "end_or_duration") ? "end" : "start";
      const v = clockValue(startMatch[1]);
      v == null ? error(target, `ambiguous_${target}`) : put(target, target === "start" ? {type:"time",minute:v} : v);
    } else if (!duration && !patch.set.start) {
      const loose = clocksText.match(new RegExp(`^\\s*(${CLOCK})[.!]?\\s*$`, "i"));
      if (loose) {
        const target = state.next_question === "end_or_duration" || state.next_question === "end" ? "end" : "start";
        const v = clockValue(loose[1]);
        v == null ? error(target, `ambiguous_${target}`) : put(target, target === "start" ? {type:"time",minute:v} : v);
      }
    }
    // A recognized correction with an unresolved value withdraws that old fact.
    // It cannot silently keep the old schedule and accept a later "confirmed".
    const correctionVerb = "(?:change|move|make|set|update|adjust|cambia|pon|establece|ajusta)";
    if (!endMatch && new RegExp(`\\b${correctionVerb}\\s+(?:(?:the|el|la)\\s+)?${endRole}\\b`).test(clocksText)) error("end","unresolved_end_correction");
    if (!startMatch && new RegExp(`\\b${correctionVerb}\\s+(?:(?:the|el|la)\\s+)?${startRole}\\b`).test(clocksText)) error("start","unresolved_start_correction");
  }
  if (modeActivationRequest && !patch.set.start) put("start", { type:"now" });
  if (/\b(?:indefinite|indefinitely|forever|para siempre|sin limite|indefinido|indefinidamente)\b/.test(text)) error("duration_minutes", "unbounded_duration");
  if (momentValue && !patch.set.start && state.slots.moment?.value !== momentValue) patch.clear.push("start");
  if (/^(?:yes|yeah|yea|yep|yes please|confirm|confirmed|do it|go ahead|apply it|si|si por favor|confirmo|confirmar|hazlo|adelante|aplicalo)[.!]?$/i.test(full)) {
    if (state.intent === "advice" && state.next_question === "action_type") { patch.intent = "block"; put("action_type","strict_block"); }
    else patch.confirmation = true;
  }
  if (/^(?:no|no thanks|no gracias)[.!]?$/i.test(full) && state.next_question === "confirmation") { patch.cancelled = true; patch.intent = "cancelled"; patch.meaningful = true; }
  return patch;
}

// Model extraction is advisory. A candidate must match independently grounded facts.
// An evidence quote alone is insufficient: it could say "do not block Instagram".
function validateSemanticPatch(candidate, args) {
  const grounded = extractSemanticPatch(args);
  const accepted = { ...grounded, set:{}, clear:[] };
  const rejected = [];
  const text = clean(args.prompt);
  const corrected = fold(currentCorrection(text));
  const state = args.state || emptyState();
  const fields = Array.isArray(candidate?.fields) ? candidate.fields : [];
  function atomSupports(key, proposed) {
    // Narrow evidence such as "5 minutes" cannot restore a rejected "-5 minutes".
    if (grounded.clear.includes(key) || grounded.errors.some(error => error.slot === key)) return false;
    // A real quote can still describe an observation rather than an instruction.
    // Capability/review turns deliberately supply no operational slots. Never
    // supplement that grounded boundary with model-proposed times or durations.
    if (grounded.set.requested_capability
      || (!grounded.intent && value(state,"requested_capability"))) return false;
    const field = fields.find(f => f?.slot === key && same(f.value,proposed));
    const quote = clean(field?.evidence || candidate?.evidence?.[key]);
    // Evidence is a current-turn span, not a model-supplied explanation or old quote.
    if (!quote || !text.includes(quote) || !corrected.includes(fold(quote)) || grounded.cancelled) return false;
    const index = fold(text).indexOf(fold(quote));
    const before = fold(text).slice(Math.max(0,index-90),index);
    const after = fold(text).slice(index+quote.length,index+quote.length+50);
    const clause = before.split(/[,;.!?]|\bbut\b|\bpero\b/).pop();
    if (/\b(?:not|except|excluding|instead of|en vez de|no|excepto|quizas|maybe|perhaps|about|around|aproximadamente)\b/.test(clause) || /^\s*(?:or|o)\b/.test(after)) return false;
    if (key === "duration_minutes") return parseDuration(fold(quote))?.minutes === proposed;
    if (key === "start" && proposed.type === "time") {
      if (!(state.next_question === "start" || /\b(?:start|begin|from|inicio|empieza|desde|a partir)\b/.test(clause))) return false;
      return clockValue(quote) === proposed.minute;
    }
    if (key === "end") {
      if (!(["end","end_or_duration"].includes(state.next_question) || /\b(?:end|finish|until|fin|termina|hasta)\b/.test(clause))) return false;
      return clockValue(quote) === proposed;
    }
    if (key === "apps") {
      if (!proposed.every(app => contains(fold(quote),app))) return false;
      // These are requested names, never an implied platform selection. The action
      // gate separately requires exact trusted device app names or a verified mode.
      return state.next_question === "apps" || grounded.intent === "block" || state.intent === "block";
    }
    return false;
  }
  for (const [key, proposed] of Object.entries(candidate?.set || {})) {
    if (SLOT_NAMES.includes(key) && key !== "confirmation" && validValue(key, proposed) && (same(proposed, grounded.set[key]) || (!Object.hasOwn(grounded.set,key) && atomSupports(key,proposed)))) accepted.set[key] = clone(proposed);
    else rejected.push({ slot:key, code:"ungrounded_model_fact" });
  }
  return { accepted, rejected, grounded };
}

function reduceSemanticState(previous, patch, { language, now = Date.now() } = {}) {
  const state = previous ? clone(previous) : emptyState(language, now);
  const oldFingerprint = proposalFingerprint(state);
  state.turn += 1;
  state.revision += 1;
  state.updated_at = new Date(now).toISOString();
  if (language) state.language = language === "es" ? "es" : "en";
  // Answering the offered protection-style choice edits the same proposal.
  // The word "block" in "Use a normal block" must not discard its schedule.
  const styleOnlyAmendment = state.intent === "block"
    && Object.hasOwn(patch.set, "hard_mode")
    && patch.set.action_type === value(state, "action_type")
    && Object.keys(patch.set).every(key => ["action_type", "hard_mode"].includes(key));
  const startsNewBlockAfterConfirmation = patch.intent === "block"
    && Object.hasOwn(patch.set, "action_type")
    && value(state, "confirmation")?.status === "confirmed"
    && !styleOnlyAmendment;
  if (startsNewBlockAfterConfirmation) {
    // Repeating the same request is a new proposal, not permission to reuse the
    // previous conversational confirmation or facts omitted from this turn.
    state.slots = Object.fromEntries(SLOT_NAMES.map(k => [k, null]));
    state.last_action_fingerprint = null;
    state.delivery = null;
    state.errors = [];
  }
  if (patch.intent && patch.intent !== state.intent) {
    // A new intention closes the previous action, including every authorization.
    if (patch.intent !== "block" || state.intent !== "advice") {
      state.slots = Object.fromEntries(SLOT_NAMES.map(k => [k,null]));
    } else { state.slots.action_type = null; state.slots.confirmation = null; }
    state.intent = patch.intent;
    state.last_action_fingerprint = null;
    state.delivery = null;
  }
  if (patch.set.requested_capability) {
    // Unsupported capability/review turns close any actionable proposal. Preserve
    // only current-turn context; a later yes cannot resurrect its confirmation.
    state.slots = Object.fromEntries(SLOT_NAMES.map(k=>[k,null])); state.last_action_fingerprint=null; state.delivery=null;
  }
  if (patch.cancelled) { state.intent = "cancelled"; state.status = "cancelled"; state.slots = Object.fromEntries(SLOT_NAMES.map(k => [k,null])); state.pending_slots = []; state.next_question = null; state.errors = []; state.last_action_fingerprint = null; state.delivery = null; state.revision += 1; return state; }
  const update = (key, replacement, sourceKind = "user", dependsOn) => {
    const prior = value(state,key);
    if (same(prior, replacement)) return;
    if (prior !== null && sourceKind !== "derived") state.corrections.push({ slot:key, previous:clone(prior), replacement:clone(replacement), turn:state.turn, text:patch.evidence });
    state.slots[key] = replacement === null ? null : { value:clone(replacement), source:{ kind:sourceKind, turn:state.turn, text:patch.evidence, ...(dependsOn ? { depends_on:dependsOn } : {}) }, confidence:1 };
  };
  const touched = new Set([...Object.keys(patch.set), ...patch.clear]);
  state.errors = state.errors.filter(e => !touched.has(e.slot) && !(touched.has("start") || touched.has("end") || touched.has("duration_minutes")));
  for (const key of new Set(patch.clear)) if (SLOT_NAMES.includes(key)) update(key,null);
  // Duration and end are alternative user specifications, not cumulative stale facts.
  if (Object.hasOwn(patch.set,"duration_minutes") && !Object.hasOwn(patch.set,"end")) update("end",null);
  if (Object.hasOwn(patch.set,"end") && !Object.hasOwn(patch.set,"duration_minutes")) update("duration_minutes",null);
  if (Object.hasOwn(patch.set,"start") || patch.clear.includes("start")) {
    if (state.slots.end?.source.kind === "derived") update("end",null,"derived");
    if (state.slots.duration_minutes?.source.kind === "derived") update("duration_minutes",null,"derived");
  }
  for (const [key,v] of Object.entries(patch.set)) if (validValue(key,v)) update(key,v);
  if (value(state,"action_type") === "daily_limit" && value(state,"start") == null) {
    update("start",{type:"now"},"derived",["action_type"]);
  }
  const start = value(state,"start"), end = value(state,"end"), duration = value(state,"duration_minutes");
  if (start?.type === "time" && end != null && duration != null && (start.minute + duration) % 1440 !== end) state.errors.push({ code:"time_duration_conflict", slot:"time_consistency", text:patch.evidence });
  else if (start?.type === "time" && end == null && duration != null) update("end",(start.minute + duration) % 1440,"derived",["start","duration_minutes"]);
  else if (start?.type === "time" && end != null && duration == null && start.minute !== end) update("duration_minutes",(end - start.minute + 1440) % 1440,"derived",["start","end"]);
  state.errors.push(...patch.errors);
  state.errors = state.errors.slice(-12);
  state.corrections = state.corrections.slice(-20);
  const fingerprint = proposalFingerprint(state);
  if (fingerprint !== oldFingerprint || patch.errors.length) { state.slots.confirmation = null; state.last_action_fingerprint = null; state.delivery = null; state.revision += 1; }
  if (patch.confirmation && previous?.next_question === "confirmation" && fingerprint === oldFingerprint && previous.status === "awaiting_confirmation" && !state.errors.length) {
    update("confirmation",{ status:"confirmed", fingerprint });
  } else if (state.intent === "block" && patch.meaningful && !state.errors.length) {
    // An explicit activation request is itself authorization. Once BM has every
    // operational fact, it must execute the one canonical distraction block
    // without asking the person to confirm the same instruction again. Keeping
    // the fingerprinted receipt preserves correction and replay safety.
    update("confirmation",{ status:"confirmed", fingerprint });
  }
  return state;
}

function requiredFields(state, context = {}) {
  if (state.intent !== "block") return [];
  const pending = [];
  if (!usesSingleDistractionBlock(context) && !value(state,"apps")?.length) pending.push("apps");
  if (!value(state,"action_type")) pending.push("action_type");
  if (!value(state,"start") || (value(state,"action_type") === "daily_limit" && value(state,"start")?.type !== "now")) pending.push("start");
  if (value(state,"end") == null && value(state,"duration_minutes") == null) pending.push("end_or_duration");
  const recurrence = value(state,"recurrence");
  if (!recurrence) pending.push("recurrence");
  const start = value(state,"start");
  if (value(state,"action_type") !== "daily_limit" && start?.type === "time" && recurrence && recurrence.type !== "once" && !value(state,"schedule_horizon_days")) pending.push("schedule_horizon_days");
  if (value(state,"action_type") === "daily_limit" && value(state,"schedule_horizon_days") != null) pending.push("schedule_horizon_days");
  if (value(state,"hard_mode") === true && (start?.type === "time" || value(state,"action_type") === "daily_limit")) pending.push("hard_mode");
  if (start?.type === "now" && value(state,"duration_minutes") == null && !pending.includes("end_or_duration")) pending.push("end_or_duration");
  if (start?.type === "now" && recurrence && recurrence.type !== "once" && value(state,"action_type") !== "daily_limit") pending.push("start");
  if (start?.type === "time" && start.minute === value(state,"end")) pending.push("end_or_duration");
  if (value(state,"action_type") === "daily_limit" && (!recurrence || recurrence.type !== "daily")) pending.push("recurrence");
  for (const error of state.errors) if (!pending.includes(error.slot)) pending.unshift(error.slot);
  return [...new Set(pending)];
}

function capabilityGap(state, context) {
  const channel = fold(context.channel || context.assistant_channel);
  const native = ["ios", "android", "app"].includes(channel);
  const present = native || context.device_execution_ready === true || context.app_presence_recent === true || context.app_presence_state === "recently_seen";
  if (!present) return "app_presence";
  if (context.screen_time_authorized !== true) return "permissions";
  if (usesSingleDistractionBlock(context)) return context.has_selected_apps === true ? null : "app_selection";
  return context.has_selected_apps === true ? null : "app_selection";
}

function semanticActionFromFacts(state, context = {}) {
  const start = value(state,"start"), recurrence = value(state,"recurrence");
  const duration = value(state,"duration_minutes"), end = value(state,"end");
  // Existing native action schema cannot represent a local date. Never turn tomorrow
  // into an immediate one-day repeating rule, or a weekly rule into seven-day expiry.
  if (start.type === "time" && recurrence.type === "once") return [];
  if (start.type === "now" && (recurrence.date || recurrence.relative_date === "tomorrow")) return [];
  if (value(state,"action_type") === "daily_limit") {
    if (start.type !== "now" || recurrence.type !== "daily" || duration < 5 || duration > 240) return [];
    if (value(state,"schedule_horizon_days") != null) return [];
    return [{ type:"set_daily_limit", minutes:duration }];
  }
  if (start.type === "now") {
    if (duration < 5 || duration > 240) return [];
    return [{
      type:"start_protection",
      minutes:duration,
      hard_mode:value(state,"hard_mode") ?? false,
    }];
  }
  // Canonical state uses ISO Monday=1. Both native Calendar APIs use Sunday=1.
  const nativeWeekdays = recurrence.weekdays.map(day => day === 7 ? 1 : day+1).sort((a,b)=>a-b);
  return [{
    type:"apply_schedule",
    name:"Protection",
    start_minute:start.minute,
    end_minute:end,
    weekdays:nativeWeekdays,
    duration_days:value(state,"schedule_horizon_days"),
  }];
}

function buildSemanticActions(state, context = {}) {
  if (state.intent !== "block" || value(state,"requested_capability") || requiredFields(state,context).length || value(state,"confirmation")?.fingerprint !== proposalFingerprint(state) || capabilityGap(state,context)) return [];
  return semanticActionFromFacts(state, context);
}

// A confirmed proposal may be transported to the native review screen before a
// fresh app heartbeat arrives. The action is still only a proposal: the app
// performs the final presence, permission and selection checks before applying it.
function buildSemanticReviewAction(state, context = {}) {
  if (state.intent !== "block" || value(state,"requested_capability") || requiredFields(state,context).length || value(state,"confirmation")?.fingerprint !== proposalFingerprint(state)) return [];
  if (capabilityGap(state, context) !== "app_presence") return [];
  return semanticActionFromFacts(state, context);
}

function decideSemanticState(state, context = {}) {
  if (state.intent === "cancelled") return { type:"cancelled", slot:null };
  if (value(state,"requested_capability")) { state.status="idle"; state.pending_slots=[]; state.next_question=null; return {type:"none",slot:null}; }
  if (state.intent === "advice" && (value(state,"apps") || value(state,"moment") || value(state,"start"))) {
    const pending = [];
    if (!value(state,"start")) pending.push("start");
    if (!value(state,"apps")) pending.push("apps");
    if (value(state,"end") == null && value(state,"duration_minutes") == null) pending.push("end_or_duration");
    if (!value(state,"recurrence")) pending.push("recurrence");
    if (value(state,"start")?.type === "time" && value(state,"recurrence")?.type !== "once" && value(state,"recurrence") && !value(state,"schedule_horizon_days")) pending.push("schedule_horizon_days");
    pending.push("action_type");
    for (const error of state.errors) pending.unshift(error.slot);
    state.pending_slots = [...new Set(pending)]; state.status = "collecting"; state.next_question = state.pending_slots[0];
    return { type:"ask", slot:state.next_question };
  }
  if (state.intent !== "block") { state.status = "idle"; state.pending_slots = []; state.next_question = null; return { type:"none", slot:null }; }
  state.pending_slots = requiredFields(state,context);
  const start = value(state,"start"), recurrence = value(state,"recurrence");
  if (!state.pending_slots.length && ((start.type === "time" && recurrence.type === "once") || (start.type === "now" && (recurrence.date || recurrence.relative_date === "tomorrow")))) state.pending_slots.push("calendar_date");
  if (!state.pending_slots.length && start.type === "now" && (value(state,"duration_minutes") < 5 || value(state,"duration_minutes") > 240)) state.pending_slots.push("duration_minutes");
  if (!state.pending_slots.length && value(state,"action_type") === "daily_limit" && start.type !== "now") state.pending_slots.push("start");
  if (state.pending_slots.length) { state.status = "collecting"; state.next_question = state.pending_slots[0]; return { type:"ask", slot:state.next_question }; }
  if (value(state,"confirmation")?.fingerprint !== proposalFingerprint(state)) { state.pending_slots = ["confirmation"]; state.next_question = "confirmation"; state.status = "awaiting_confirmation"; return { type:"confirm", slot:"confirmation" }; }
  const gap = capabilityGap(state,context);
  if (gap) { state.status = "needs_setup"; state.pending_slots = [gap]; state.next_question = gap; return { type:"setup", slot:gap }; }
  state.status = "ready"; state.pending_slots = []; state.next_question = null;
  return { type:"ready", slot:null };
}

function isThanksAcknowledgement(prompt) {
  return /^(?:thanks(?: a lot)?|thank you(?: very much)?|gracias|muchas gracias)$/.test(fold(prompt).replace(/[^a-z0-9]+/g, " ").trim());
}
function clockLabel(v) { return `${String(Math.floor(v / 60)).padStart(2,"0")}:${String(v % 60).padStart(2,"0")}`; }
function clockMeridiemLabel(v) {
  const hour24 = Math.floor(v / 60) % 24;
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(v % 60).padStart(2,"0")} ${hour24 < 12 ? "AM" : "PM"}`;
}
function semanticTargetLabel(state, context = {}) {
  const es = state.language === "es";
  if (usesSingleDistractionBlock(context)) return es ? "tus distracciones seleccionadas" : "your selected distractions";
  return es ? "tus distracciones seleccionadas" : "your selected distractions";
}

function semanticSummary(state, context = {}) {
  const es = state.language === "es";
  const apps = semanticTargetLabel(state, context);
  const start = value(state,"start"), duration = value(state,"duration_minutes"), recurrence = value(state,"recurrence");
  const time = start?.type === "now" ? `${es ? "ahora durante" : "now for"} ${duration} ${es ? "minutos" : "minutes"}` : `${es ? "de" : "from"} ${clockLabel(start?.minute || 0)} ${es ? "a" : "to"} ${clockLabel(value(state,"end") || 0)}`;
  const repeat = recurrence?.type === "once" ? (es ? "solo esta vez" : "just once") : recurrence?.type === "daily" ? (es ? "cada día" : "every day") : (recurrence?.weekdays || []).map(d => DAYS[d-1][es ? 1 : 0]).join(es ? " y " : " and ");
  if (value(state,"action_type") === "daily_limit") return es ? `Limitar ${apps} a ${duration} minutos al día, desde ahora` : `Limit ${apps} to ${duration} minutes per day, starting now`;
  const horizon = value(state,"schedule_horizon_days");
  return `${es ? "Bloquear" : "Block"} ${apps} ${time}, ${repeat}${value(state,"hard_mode") === true ? (es ? ", con modo estricto" : ", with hard mode") : value(state,"hard_mode") === false ? (es ? ", con protección normal" : ", with regular protection") : ""}${start?.type === "time" && horizon ? `, ${es ? "durante" : "for"} ${horizon} ${es ? "días" : "days"}` : ""}`;
}

function knownFactLead(state, context = {}) {
  const es = state.language === "es";
  const apps = semanticTargetLabel(state, context);
  const start = value(state,"start");
  const end = value(state,"end");
  const duration = value(state,"duration_minutes");
  if (value(state,"action_type") === "daily_limit") {
    const allowance = duration == null ? "" : (es ? ` de ${duration} minutos al día` : ` of ${duration} minutes per day`);
    const horizon = value(state,"schedule_horizon_days");
    const requestedStart = start?.type === "time" ? (es ? `, desde las ${clockMeridiemLabel(start.minute)}` : `, starting at ${clockMeridiemLabel(start.minute)}`) : "";
    const expiry = horizon == null ? "" : (es ? `, durante ${horizon} días` : `, for ${horizon} days`);
    return es ? `Pides un límite diario${allowance} para ${apps}${requestedStart}${expiry}.` : `You requested a daily limit${allowance} for ${apps}${requestedStart}${expiry}.`;
  }
  const facts = [];
  if (apps) facts.push(apps);
  if (start?.type === "now") facts.push(es ? "ahora" : "now");
  else if (start?.type === "time") facts.push(`${es ? "a las" : "at"} ${clockMeridiemLabel(start.minute)}`);
  if (end != null) facts.push(`${es ? "hasta las" : "until"} ${clockMeridiemLabel(end)}`);
  else if (duration != null) facts.push(`${es ? "durante" : "for"} ${duration} ${es ? "minutos" : "minutes"}`);
  if (!facts.length) return "";
  return `${es ? "Entendido" : "Got it"}: ${facts.join(" ")}.`;
}

function renderSemanticResponse(state, decision, context = {}, prompt = "") {
  const es = state.language === "es";
  const capability = value(state,"requested_capability");
  if (capability === "adult_filter") return es ? "La petición es filtrar contenido adulto. Este chat aún no puede configurar ese filtro; revísalo en los controles de Blankmind." : "You're asking to filter adult content. This chat cannot configure that filter yet; review it in Blankmind's controls.";
  if (capability === "allow_only") return es ? "Quieres permitir solo algunas aplicaciones. Este chat aún no puede configurar esa lista de excepciones; revísala en Blankmind." : "You want to allow only certain apps. This chat cannot configure that exception list yet; review it in Blankmind.";
  if (capability === "work_use_constraint") {
    const studying=/\b(?:study|studying|estudiar|estudio)\b/.test(fold(state.slots.requested_capability.source.text));
    return es ? `Necesitas esa app para ${studying ? "estudiar" : "trabajar"}. Blankmind no distingue ese uso del personal dentro de una misma app; esa restricción necesita revisión manual antes de bloquearla.` : `You need that app for ${studying ? "study" : "work"}. Blankmind cannot distinguish that use from personal use inside the same app; that restriction needs manual review before blocking it.`;
  }
  if (capability === "past_block_review") {
    const acceptedReview = /^(?:yes|yes please|okay|ok|sure|go ahead|si|vale|de acuerdo|adelante)[.!]?$/i.test(fold(prompt));
    if (acceptedReview) return es
      ? "¿Qué te llevó a terminar ese bloqueo: una tarea necesaria, algo que querías consultar o una distracción?"
      : "What led you to end that block: something you needed to do, something you wanted to check, or a distraction?";
    return es ? "Hablas de un bloqueo anterior. Podemos revisar qué lo interrumpió y ajustar la próxima propuesta con ese contexto." : "You're describing a previous block. We can review what interrupted it and use that context when discussing a future proposal.";
  }
  if (capability === "weekly_review") {
    const minutes=context.weekly_protected_minutes, breaks=context.weekly_break_count;
    return typeof minutes === "number" && typeof breaks === "number" ? (es ? `Esta semana registras ${minutes} minutos protegidos y ${breaks} interrupciones. Estos datos describen tu semana; no requieren cambiar ningún bloqueo.` : `This week you recorded ${minutes} protected minutes and ${breaks} breaks. Those figures summarize your week without changing any blocks.`) : (es ? "Todavía no tengo tus métricas semanales. Abre Blankmind para sincronizarlas y poder revisar tu semana." : "I don't have your weekly metrics yet. Open Blankmind to sync them so we can review your week.");
  }
  if (decision.type === "cancelled") {
    if (isThanksAcknowledgement(prompt)) return es ? "De nada." : "You're welcome.";
    return es
      ? "He retirado esta instrucción. Si la protección ya empezó en tu dispositivo, tendrás que detenerla allí."
      : "I've withdrawn this instruction. If protection has already started on your device, you'll need to stop it there.";
  }
  if (decision.type === "none") return null;
  if (decision.type === "ask" && decision.slot === "calendar_date") {
    const recurrence = value(state,"recurrence");
    const requestedDate = recurrence?.date || (recurrence?.relative_date === "tomorrow" ? (es ? "mañana" : "tomorrow") : (es ? "una fecha única" : "a specific date"));
    const duration = value(state,"duration_minutes");
    const start = value(state,"start");
    const requestedTime = start?.type === "time" ? (es ? ` a las ${clockMeridiemLabel(start.minute)}` : ` at ${clockMeridiemLabel(start.minute)}`) : "";
    const requestedDuration = duration == null ? "" : (es ? ` durante ${duration} minutos` : ` for ${duration} minutes`);
    return es
      ? `Pides bloquear ${semanticTargetLabel(state,context)} para ${requestedDate}${requestedTime}${requestedDuration}. Este tipo de programación no admite una fecha única; no he iniciado ningún bloqueo. ¿Quieres definir un horario recurrente en su lugar?`
      : `You requested a block for ${semanticTargetLabel(state,context)} on ${requestedDate}${requestedTime}${requestedDuration}. This schedule cannot target a specific one-off date; I have not started a block. Would you like to define a recurring schedule instead?`;
  }
  if (decision.type === "ask" && decision.slot === "time_consistency"
    && value(state,"start")?.type === "time" && value(state,"end") != null && value(state,"duration_minutes") != null) {
    const start = value(state,"start"), end = value(state,"end"), duration = value(state,"duration_minutes");
    return es
      ? `Pides bloquear de ${clockMeridiemLabel(start.minute)} a ${clockMeridiemLabel(end)} y también una duración de ${duration} minutos. Esos datos no coinciden. ¿Quieres conservar las horas o la duración?`
      : `You requested a block from ${clockMeridiemLabel(start.minute)} to ${clockMeridiemLabel(end)} and also a duration of ${duration} minutes. Those details conflict. Should I keep the clock times or the duration?`;
  }
  if (decision.type === "ask" && value(state,"action_type") === "daily_limit" && ["start","schedule_horizon_days"].includes(decision.slot)) {
    const futureStart = value(state,"start")?.type === "time";
    const expiry = value(state,"schedule_horizon_days") != null;
    const limitation = futureStart && expiry
      ? (es ? "Los límites diarios solo pueden empezar ahora y no pueden caducar automáticamente." : "Daily limits can only start now and cannot expire automatically.")
      : expiry
        ? (es ? "Los límites diarios no pueden caducar automáticamente." : "Daily limits cannot expire automatically.")
        : (es ? "Los límites diarios solo pueden empezar ahora." : "Daily limits can only start now.");
    const question = expiry
      ? (es ? "¿Quieres un límite desde ahora hasta que lo quites, o prefieres un bloqueo programado?" : "Would you like a limit starting now until you remove it, or a scheduled block instead?")
      : (es ? "¿Quieres que empiece ahora o prefieres un bloqueo programado?" : "Should it start now, or would you prefer a scheduled block?");
    return `${knownFactLead(state,context)} ${limitation} ${question}`;
  }
  if (decision.type === "confirm") return `${semanticSummary(state,context)}. ${es ? "¿Lo confirmas?" : "Do you confirm?"}`;
  if (decision.type === "ready") {
    const effect = value(state,"action_type") === "daily_limit" ? (es ? "el límite" : "the limit") : (es ? "el bloqueo" : "the block");
    return `${semanticSummary(state,context)}. ${es ? `Lo estoy enviando a tu dispositivo vinculado. Pulsa la notificación de Blankmind para terminar; solo confirmaré el éxito cuando el dispositivo verifique ${effect}.` : `I'm sending it to your linked device. Tap the Blankmind notification to finish; I'll only report success after the device verifies ${effect}.`}`;
  }
  if (decision.type === "setup" && decision.slot === "permissions") return es
    ? `${semanticSummary(state,context)}. Pulsa la notificación de Blankmind y concede el permiso de bloqueo; después dime cuando esté listo para continuar. La protección todavía no está verificada.`
    : `${semanticSummary(state,context)}. Tap the Blankmind notification and grant blocking permission, then tell me when it's ready to continue. Protection is not verified yet.`;
  if (decision.type === "setup" && decision.slot === "app_selection") return es
    ? `${semanticSummary(state,context)}. Pulsa la notificación de Blankmind para elegir tus distracciones; al aceptar la selección, el dispositivo intentará aplicar esta propuesta. Solo confirmaré el resultado cuando el dispositivo lo verifique.`
    : `${semanticSummary(state,context)}. Tap the Blankmind notification to choose your distractions, then confirm the selection so your device can apply this proposal. I'll only confirm the result after the device verifies it.`;
  if (decision.slot === "app_presence" && value(state,"confirmation")?.fingerprint === proposalFingerprint(state)) {
    const followup = /^(?:done|ok(?:ay)?|i have it|i(?:'|’)ve got it|i(?:'|’)ve opened (?:the )?app|i have already opened (?:the )?app|it(?:'|’)s already opened|it(?:'|’)s already open|the app is already open|opened it|already opened(?: (?:the )?app)?|ya está|ya esta|ya está abierta|ya esta abierta|ya la he abierto|ya abrí|ya la abri)$/i.test(clean(prompt, 160));
    if (followup) return es
      ? "Todavía necesito que Blankmind confirme la conexión. Usa el enlace de revisión del mensaje anterior para continuar. No se ha aplicado ningún cambio."
      : "I still need Blankmind to confirm the connection. Open Blankmind to review and apply the proposal. Nothing has been applied yet.";
    return es
      ? `${semanticSummary(state,context)}. Abre Blankmind para revisar y aplicar la propuesta.`
      : `${semanticSummary(state,context)}. Open Blankmind to review and apply the proposal.`;
  }
  if (decision.slot === "start") {
    const moment=value(state,"moment") || "";
    const event=/after breakfast|despues de desayunar/.test(moment) ? ["breakfast","desayunar"] : /after lunch|despues de comer/.test(moment) ? ["lunch","comer"] : /after dinner|despues de cenar/.test(moment) ? ["dinner","cenar"] : /after work|finish work|work ends|trabajar/.test(moment) ? ["work","trabajar"] : null;
    if (event) return es ? `¿A qué hora sueles terminar de ${event[1]}?` : `What time do you usually finish ${event[0]}?`;
  }
  const questions = {
    apps:es ? (value(state,"app_category") ? "¿Qué aplicaciones de esa categoría quieres bloquear?" : "¿Qué aplicaciones quieres bloquear?") : (value(state,"app_category") ? "Which apps in that category do you want to block?" : "Which apps do you want to block?"),
    action_type:state.intent === "advice" ? (es ? "¿Quieres convertir estos detalles en una propuesta de bloqueo?" : "Would you like to turn these details into a blocking proposal?") : (es ? "¿Quieres bloquearlas durante una franja o fijar un límite diario?" : "Do you want a blocking window or a daily usage limit?"),
    start:value(state,"action_type") === "daily_limit"
      ? (es ? "Los límites diarios solo pueden empezar ahora. ¿Quieres que empiece ahora o prefieres un bloqueo programado?" : "Daily limits can only start now. Should it start now, or would you prefer a scheduled block?")
      : state.intent === "advice" ? (es ? "¿A qué hora suele empezar ese uso del móvil? Indica mañana o tarde, o usa el formato de 24 horas." : "What time does that scrolling usually start? Include AM/PM or use a 24-hour time.")
      : ["daily","weekly"].includes(value(state,"recurrence")?.type)
        ? (es ? "Un horario recurrente necesita una hora fija. ¿A qué hora exacta debe empezar? Indica mañana o tarde, o usa el formato de 24 horas." : "A recurring schedule needs a fixed time. What exact time should it start? Include AM/PM or use a 24-hour time.")
        : (es ? "¿Cuándo debe empezar: ahora o a qué hora exacta? Indica mañana o tarde, o usa el formato de 24 horas." : "When should it start: now or at what exact time? Include AM/PM or use a 24-hour time."),
    end:es ? "¿A qué hora exacta debe terminar? Indica mañana o tarde, o usa el formato de 24 horas." : "What exact time should it end? Include AM/PM or use a 24-hour time.",
    end_or_duration:es ? "¿Cuánto debe durar o a qué hora exacta debe terminar?" : "How long should it last, or what exact time should it end?",
    duration_minutes:es ? "¿Qué duración exacta quieres en minutos? El bloqueo inmediato admite de 5 a 240 minutos." : "What exact duration do you want in minutes? An immediate block supports 5 to 240 minutes.",
    recurrence:es ? "¿Es solo esta vez o se repite? Si se repite, ¿qué días?" : "Is this just once or recurring? If recurring, which days?",
    schedule_horizon_days:value(state,"action_type") === "daily_limit"
      ? (es ? "Los límites diarios no pueden caducar automáticamente. ¿Quieres mantener el límite hasta que lo quites o usar un bloqueo programado?" : "Daily limits cannot expire automatically. Do you want to keep the limit until you remove it, or use a scheduled block?")
      : (es ? "¿Durante cuántos días quieres repetirlo? La app admite de 1 a 14 días por programación." : "For how many days should it repeat? The app supports 1 to 14 days per schedule."),
    hard_mode:value(state,"action_type") === "daily_limit" ? (es ? "El modo estricto no está disponible para límites diarios. Elige un límite normal o un bloqueo estricto inmediato." : "Hard mode is not available for daily limits. Choose a regular limit or an immediate hard block.") : (es ? "El modo estricto solo admite bloqueos inmediatos. ¿Quieres protección normal programada o iniciar el modo estricto ahora?" : "Hard mode supports immediate blocks only. Do you want regular scheduled protection or to start hard mode now?"),
    time_consistency:es ? "La hora final y la duración no coinciden. ¿Cuál quieres mantener?" : "The end time and duration disagree. Which should I keep?",
    calendar_date:es ? "La app aún no admite una fecha única en este tipo de programación. Puedo ayudarte a revisarla manualmente en Blankmind." : "The app does not yet support a specific one-off date for this schedule. You can review it manually in Blankmind.",
    app_presence:es ? "Abre Blankmind para comprobar que la app está disponible antes de aplicar la propuesta." : "Open Blankmind so I can check the app is available before you apply the proposal.",
    permissions:es ? "Abre Blankmind y concede el permiso de bloqueo. La propuesta todavía no se ha aplicado." : "Open Blankmind and grant blocking permission. The proposal has not been applied yet.",
    app_selection:usesSingleDistractionBlock(context)
      ? (es ? "Selecciona una vez todas las apps, categorías y webs que te distraen en Blankmind. Esa misma lista se usará en cada protección." : "Choose all distracting apps, categories, and websites once in Blankmind. The same list will be used for every protection.")
      : (es ? `Selecciona exactamente ${(value(state,"apps") || []).join(" y ")} en Blankmind. La propuesta todavía no se ha aplicado.` : `Select exactly ${(value(state,"apps") || []).join(" and ")} in Blankmind. The proposal has not been applied yet.`),
  };
  const question = value(state,"action_type") === "daily_limit" && decision.slot === "end_or_duration"
    ? (es ? "¿Cuántos minutos al día quieres permitir?" : "How many minutes per day should the limit allow?")
    : questions[decision.slot] || (es ? "Necesito aclarar ese dato antes de seguir." : "I need to clarify that detail before continuing.");
  if (decision.type === "ask" && decision.slot === "recurrence"
      && /^(?:yes|yeah|yep|yes please|okay|ok|sure|si|si por favor|vale|de acuerdo)[.!?]?$/.test(fold(prompt))) {
    return es ? "¿Lo quieres solo esta vez, cada día o en días concretos de la semana?"
      : "Should it happen just once, every day, or on specific days of the week?";
  }
  const lead = knownFactLead(state,context);
  return lead ? `${lead} ${question}` : question;
}

function asBlockingContract(state, context = {}) {
  const start = value(state,"start"), end = value(state,"end"), duration = value(state,"duration_minutes"), recurrence = value(state,"recurrence");
  return { is_blocking_request:state.intent === "block", user_request:state.intent === "block", ready:state.status === "ready", missing_fields:state.pending_slots, app_source:usesSingleDistractionBlock(context) ? "canonical_distraction_selection" : "semantic_state", app_category:value(state,"app_category"), data:state.intent === "block" ? { apps:usesSingleDistractionBlock(context) ? ["selected_apps"] : value(state,"apps"), action:value(state,"action_type") === "daily_limit" ? "daily_limit" : "hard_block", start:start ? { type:start.type, value:start.type === "now" ? "now" : start.minute, source:"semantic_state" } : null, end:duration != null ? {type:"duration",value:duration,source:"semantic_state"} : end != null ? {type:"time",value:end,source:"semantic_state"} : null, recurrence:recurrence ? {type:recurrence.type,value:recurrence.type === "once" ? [0] : recurrence.weekdays,source:"semantic_state"} : null } : null };
}

function advanceSemanticState({ previousState, prompt, context = {}, language, now = Date.now(), replayHistory = true, extraction } = {}) {
  const suppliedState = previousState || context.semantic_state || context.memory?.conversation_state?.semantic_state || context.memory?.semantic_state;
  let previous = normalizeSemanticState(suppliedState, now);
  if (!previous && !suppliedState && replayHistory) {
    // Migration trusts user turns only, never old deterministic/model assistant claims.
    const history = Array.isArray(context.recent_messages) ? context.recent_messages : context.memory?.conversation_state?.recent_messages || [];
    const users = history.filter(m => m?.role === "user").slice(-16);
    if (users.length && clean(users[users.length-1].content || users[users.length-1].text) === clean(prompt)) users.pop();
    for (const message of users) previous = advanceSemanticState({ previousState:previous, prompt:message.content || message.text, context, language, now, replayHistory:false }).state;
    // History migration restores facts, not a delivery receipt or authorization.
    // A supplied but expired/invalid state must never be resurrected from prose.
    if (previous) { previous.slots.confirmation = null; previous.last_action_fingerprint = null; previous.delivery = null; }
  }
  const base = previous || emptyState(language || context.language,now);
  const patch = extractSemanticPatch({ prompt, state:base, context });
  const extractionValidation = extraction ? validateSemanticPatch(extraction,{prompt,state:base,context}) : null;
  if (extractionValidation) {
    for (const [key,v] of Object.entries(extractionValidation.accepted.set)) {
      if (!Object.hasOwn(patch.set,key)) { patch.set[key]=v; patch.meaningful=true; }
    }
  }
  const state = reduceSemanticState(base,patch,{language,now});
  const decision = decideSemanticState(state,context);
  // Acknowledging a withdrawal must not fall through to free conversation,
  // where prior messages could be mistaken for a proposal to restart.
  const cancelledAcknowledgement = state.intent === "cancelled"
    && (isThanksAcknowledgement(prompt) || /^(?:yes|yeah|yea|yep|yes please|yes do it|confirm|confirmed|do it|go ahead|ok|okay|understood|si|confirmo|hazlo|adelante|vale|entendido)$/.test(fold(prompt).replace(/[^a-z0-9]+/g," ").trim()));
  const handled = state.intent === "block" || patch.cancelled || cancelledAcknowledgement || Boolean(value(state,"requested_capability")) || (state.intent === "advice" && decision.type === "ask");
  let actions = decision.type === "ready" ? buildSemanticActions(state,context) : [];
  const reviewOnlyAppPresence = decision.type === "setup" && decision.slot === "app_presence";
  if (reviewOnlyAppPresence) actions = buildSemanticReviewAction(state, context);
  if (decision.type === "setup" && decision.slot === "permissions") actions = [{type:"request_screen_time_permission"}];
  if (decision.type === "setup" && decision.slot === "app_selection") {
    const executable = semanticActionFromFacts(state, context)[0];
    actions = executable
      ? [{
          ...executable,
          type:"open_app_picker",
          name:executable.type === "set_daily_limit" ? "Daily Limit" : "Distractions",
        }]
      : [{type:"open_app_picker",name:"Distractions"}];
  }
  const delivery = applySemanticDelivery({ delivery:state.delivery, fingerprint:proposalFingerprint(state), actions, legacyActionFingerprint:state.last_action_fingerprint });
  const actionReplaySuppressed = delivery.suppressed;
  actions = delivery.actions;
  state.delivery = delivery.delivery;
  if (state.delivery?.sent.includes("execution")) state.last_action_fingerprint = proposalFingerprint(state);
  const responseText = actionReplaySuppressed
    ? `${semanticSummary(state,context)}. ${renderSuppressedDelivery(state.language, state.delivery)}`
    : renderSemanticResponse(state,decision,context,prompt);
  return { state, handled, decision, actions, actionReplaySuppressed, reviewOnlyAppPresence: reviewOnlyAppPresence && actions.length > 0, blockingContract:asBlockingContract(state,context), responseText, patch, extractionValidation };
}

module.exports = { VERSION, TTL_MS, SLOT_NAMES, emptyState, normalizeSemanticState, proposalFingerprint, extractSemanticPatch, validateSemanticPatch, reduceSemanticState, requiredFields, decideSemanticState, buildSemanticActions, buildSemanticReviewAction, renderSemanticResponse, semanticSummary, advanceSemanticState };
