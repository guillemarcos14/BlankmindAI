"use strict";

// Device observations stay separate from model/user statements. Only this
// allowlist may enter the canonical snapshot; neither tokens nor raw app usage.
const MAX_SESSIONS = 2000;
const date = value => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const clean = (value, max = 160) => typeof value === "string" ? value.trim().slice(0, max) : "";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function normalizeBrainSnapshot(input) {
  if (!input || input.schema_version !== 1 || !date(input.generated_at)) return null;
  if (typeof input.timezone !== "string" || !input.timezone) return null;
  let timezone;
  try { timezone = new Intl.DateTimeFormat("en", { timeZone: input.timezone }).resolvedOptions().timeZone; }
  catch (_) { return null; }
  if (!timezone || !Array.isArray(input.sessions) || input.sessions.length > MAX_SESSIONS) return null;
  const ids = new Set(), sessions = [];
  for (const row of input.sessions) {
    const started = date(row?.started_at), ended = row?.ended_at == null ? null : date(row.ended_at);
    if (!uuid.test(row?.id || "") || ids.has(row.id) || !started || (row.ended_at != null && !ended)
        || (ended && ended < started) || Date.parse(started) > Date.parse(input.generated_at)) continue;
    ids.add(row.id);
    sessions.push({ id: row.id, started_at: started, ended_at: ended,
      pause_started_at: date(row.pause_started_at), pause_ended_at: date(row.pause_ended_at),
      ended_reason: ["manual", "emergency", "timer", "nfc", "schedule", "expired"].includes(row.ended_reason) ? row.ended_reason : null,
      entry_mode: clean(row.entry_mode, 32) });
  }
  return { schema_version: 1, generated_at: date(input.generated_at), timezone,
    local_date: localDate(Date.parse(input.generated_at), timezone),
    week_starts_on: Number.isInteger(input.week_starts_on) && input.week_starts_on >= 1 && input.week_starts_on <= 7 ? input.week_starts_on : 2,
    history_started_at: date(input.history_started_at), history_complete: input.history_complete === true && sessions.length === input.sessions.length,
    sessions, account: { signed_in: input.account?.signed_in === true,
      premium_access: input.account?.premium_access === true,
      active_product_ids: Array.isArray(input.account?.active_product_ids)?input.account.active_product_ids.filter(v=>typeof v==="string"&&/^[\w.-]{1,120}$/.test(v)).slice(0,8):[],
      referral_trial_ends_at: date(input.account?.referral_trial_ends_at),
      referral_count: Number.isInteger(input.account?.referral_count)&&input.account.referral_count>=0?Math.min(input.account.referral_count,100000):0,
      demo_access: input.account?.demo_access === true,
      subscription_source: "device_entitlement_observation", billing_details_available: false },
    capabilities: ["configuration", "statistics", "session_history", "conversation_history", "personal_memory", "native_actions"] };
}

function freshness(snapshot, now = Date.now()) {
  const age = now - Date.parse(snapshot?.generated_at || "");
  return Number.isFinite(age) && age >= -30000 && age <= 120000;
}

function localDate(timestamp, timezone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(timestamp));
}
function dayOffset(day, days) {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T12:00:00Z`))) throw new Error("brain_invalid_date");
  return new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
function midnight(day, timezone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T00:00:00Z`))
      || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) throw new Error("brain_invalid_date");
  const target = Date.parse(`${day}T00:00:00Z`);
  let result = target;
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (let i = 0; i < 4; i++) {
    const p = Object.fromEntries(fmt.formatToParts(result).map(item => [item.type, item.value]));
    const represented = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    result += target - represented;
  }
  return result;
}
function periodBounds(query, snapshot, now = Date.now()) {
  const zone = snapshot.timezone, today = localDate(now, zone);
  const monthStart = `${today.slice(0, 7)}-01`;
  const jsDay = new Date(`${today}T12:00:00Z`).getUTCDay();
  const weekStart = dayOffset(today, -((jsDay + 7 - ((snapshot.week_starts_on || 2)-1)) % 7));
  let start, end = dayOffset(today, 1);
  switch (query.period) {
    case "today": start = today; break;
    case "yesterday": start = dayOffset(today, -1); end = today; break;
    case "this_week": start = weekStart; break;
    case "last_week": start = dayOffset(weekStart, -7); end = weekStart; break;
    case "this_month": start = monthStart; break;
    case "last_month": end = monthStart; start = `${dayOffset(monthStart, -1).slice(0, 7)}-01`; break;
    case "last_7_days": start = dayOffset(today, -6); break;
    case "last_30_days": start = dayOffset(today, -29); break;
    case "all_time": start = snapshot.history_started_at ? localDate(Date.parse(snapshot.history_started_at), zone) : today; break;
    case "custom": start = query.start_date; end = dayOffset(query.end_date, 1); break;
    default: throw new Error("brain_unknown_period");
  }
  const from = midnight(start, zone), to = Math.min(midnight(end, zone), now);
  if (from >= to || (query.period === "custom" && midnight(query.end_date, zone) < from)) throw new Error("brain_invalid_period");
  return { from, to, start_date: start, end_date: localDate(to - 1, zone), timezone: zone };
}

function unionSeconds(intervals) {
  let seconds = 0, end = -Infinity;
  for (const [a,b] of intervals.sort((x,y) => x[0]-y[0])) {
    if (b > end) { seconds += (b - Math.max(a,end)) / 1000; end = b; }
  }
  return seconds;
}
function statistics(snapshot, bounds, now = Date.now()) {
  if (!snapshot?.history_started_at) return { available: false, reason: "no_recorded_history", ...bounds };
  const intervals = [], selected = [], breaks = [];
  for (const row of snapshot.sessions) {
    const start = Date.parse(row.started_at), end = Math.min(Date.parse(row.ended_at || snapshot.generated_at), now);
    if (end > bounds.from && start < bounds.to) {
      const a = Math.max(start,bounds.from), b = Math.min(end,bounds.to);
      const p = Date.parse(row.pause_started_at), q = Date.parse(row.pause_ended_at || row.ended_at || snapshot.generated_at);
      if (Number.isFinite(p) && Number.isFinite(q) && p < b && q > a) {
        if (a < p) intervals.push([a,Math.min(p,b)]);
        if (q < b) intervals.push([Math.max(q,a),b]);
      } else if (b > a) intervals.push([a,b]);
      selected.push(row);
    }
    if (["manual","emergency"].includes(row.ended_reason) && row.ended_at
        && Date.parse(row.ended_at) >= bounds.from && Date.parse(row.ended_at) < bounds.to) breaks.push(row);
  }
  return { available: true, ...bounds, protected_seconds: Math.floor(unionSeconds(intervals)),
    session_count: selected.length, break_count: breaks.length,
    partial: !snapshot.history_complete || Date.parse(snapshot.history_started_at) > bounds.from || !freshness(snapshot, now),
    observed_at: snapshot.generated_at, metric: "recorded_protection_duration", saved_time_available: false,
    sessions: selected.sort((a,b) => b.started_at.localeCompare(a.started_at)).slice(0, 20) };
}

module.exports = { MAX_SESSIONS, normalizeBrainSnapshot, freshness, periodBounds, statistics, midnight, dayOffset };
