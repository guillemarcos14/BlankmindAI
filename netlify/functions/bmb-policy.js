"use strict";
const crypto = require("node:crypto");
const TYPES = ["start_protection", "update_schedule"];
const fingerprint = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function zone(value) { return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone; }
function minute(now, timezone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map(p=>[p.type,p.value]));
  return +p.hour*60 + +p.minute;
}
function inWindow(m, start, end) { return start === end || (start < end ? m >= start && m < end : m >= start || m < end); }
function settings(input = {}) {
  const grant = input.grant || {}, notifications = input.notifications || {}, rest=input.rest||{};
  const integer = (v, fallback, low, high) => v == null ? fallback : Number.isInteger(v) && v >= low && v <= high ? v : (()=>{throw Error("bmb_invalid_limit");})();
  const timezone = zone(input.timezone || "UTC");
  const result = { timezone, paused_until: input.paused_until || null,
    grant: { active: grant.active === true, action_types: [...new Set(grant.action_types || [])],
      start_minute: integer(grant.start_minute,0,0,1439), end_minute: integer(grant.end_minute,0,0,1439),
      max_minutes: integer(grant.max_minutes,30,5,240), max_per_day: integer(grant.max_per_day,1,0,10),
      max_per_week: integer(grant.max_per_week,3,0,30), min_interval_minutes: integer(grant.min_interval_minutes,1440,15,10080),
      expires_at: grant.expires_at || null },
    rest: { adjustments_enabled:rest.adjustments_enabled===true,global_learning_enabled:rest.global_learning_enabled===true,
      weekdays:[...new Set(rest.weekdays||[1,2,3,4,5,6,7])],start_minute:integer(rest.start_minute,1260,0,1439),end_minute:integer(rest.end_minute,480,0,1439),
      max_shift_minutes:integer(rest.max_shift_minutes,15,5,30),review_after_days:integer(rest.review_after_days,14,7,14)},
    notifications: { enabled: notifications.enabled === true, start_minute: integer(notifications.start_minute,480,0,1439),
      end_minute: integer(notifications.end_minute,1320,0,1439), max_per_day: integer(notifications.max_per_day,1,0,10),
      max_per_week: integer(notifications.max_per_week,3,0,30), opportunities: notifications.opportunities !== false,
      interventions: notifications.interventions !== false, failures: notifications.failures !== false } };
  if (result.grant.action_types.some(t=>!TYPES.includes(t)) || (result.grant.active && (!result.grant.action_types.length || !Number.isFinite(Date.parse(result.grant.expires_at)) || Date.parse(result.grant.expires_at) <= Date.now()))) throw Error("bmb_invalid_grant");
  if (result.paused_until && !Number.isFinite(Date.parse(result.paused_until))) throw Error("bmb_invalid_pause");
  if(result.rest.weekdays.some(d=>!Number.isInteger(d)||d<1||d>7))throw Error("rest_invalid_weekdays");
  return result;
}
function actionGate(action, policy, context, now=Date.now()) {
  const g=policy?.grant, paused=Date.parse(policy?.paused_until || "") > now;
  if (!g?.active || paused || Date.parse(g.expires_at) <= now) return {allowed:false,reason:paused?"paused":"grant_inactive"};
  if (!TYPES.includes(action.type)||!g.action_types.includes(action.type)) return {allowed:false,reason:"type_not_authorized"};
  const day=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(new Intl.DateTimeFormat("en-US",{timeZone:policy.timezone,weekday:"short"}).format(now))+1;
  if(policy.rest?.weekdays&&!policy.rest.weekdays.includes(day))return {allowed:false,reason:"rest_day_excluded"};
  if (!inWindow(minute(now,policy.timezone),g.start_minute,g.end_minute)) return {allowed:false,reason:"outside_authorized_hours"};
  if (!context.has_selected_apps || !context.screen_time_authorized || context.is_blank_active || context.vacation_mode_active || context.schedule?.paused_until*1000 > now) return {allowed:false,reason:"device_not_ready_or_paused"};
  if(action.type==="update_schedule")return scheduleGate(action,policy,context,now);
  if (action.hard_mode || (action.minutes || 0) > g.max_minutes) return {allowed:false,reason:"outside_duration_or_scope"};
  return {allowed:true,reason:"current_grant"};
}
function scheduleGate(action,policy,context,now=Date.now()) {
  const rest=policy.rest;
  const existing=context.schedule?.windows?.find(w=>w.id===action.window_id);
  if(!rest?.adjustments_enabled||!existing||action.hard_mode||!['weekly','continuous'].includes(action.recurrence)
    ||action.timezone!==policy.timezone||!Array.isArray(action.weekdays)||!action.weekdays.length
    ||action.weekdays.some(d=>!rest.weekdays.includes(d)||(action.start_minute>=action.end_minute&&!rest.weekdays.includes(d%7+1))))return {allowed:false,reason:"rest_adjustment_not_authorized"};
  const days=existing.weekdays||[];
  if(JSON.stringify([...days].sort())!==JSON.stringify([...action.weekdays].sort())
    ||existing.end_minute!==action.end_minute||Math.abs(((action.start_minute-existing.start_minute+2160)%1440)-720)>rest.max_shift_minutes
    ||!inWindow(action.start_minute,rest.start_minute,rest.end_minute)
    ||action.end_minute!==rest.end_minute&&!inWindow(action.end_minute,rest.start_minute,rest.end_minute)
    ||(existing.expires_at&&existing.expires_at*1000<=now))return {allowed:false,reason:"rest_adjustment_outside_bounds"};
  return {allowed:true,reason:"current_measured_rest_grant"};
}
function notificationGate(event, policy, context, now=Date.now()) {
  const n=policy?.notifications;
  if (!n?.enabled || !context.notification_authorized || Date.parse(policy.paused_until || "") > now) return {allowed:false,reason:"notifications_disabled_or_paused"};
  if (Date.parse(event.expires_at) <= now) return {allowed:false,reason:"expired"};
  if (Date.parse(context.chat_active_until || "") > now) return {allowed:false,reason:"chat_open"};
  if (!inWindow(minute(now,policy.timezone),n.start_minute,n.end_minute)) return {allowed:false,reason:"sleep_or_quiet_hours"};
  if (!n[{opportunity:"opportunities",intervention:"interventions",failure:"failures"}[event.kind]]) return {allowed:false,reason:"preference"};
  return {allowed:true};
}
function budgetGate(kind,event,policy,ledger,now=Date.now()) {
  const limits=kind==="action"?policy.grant:policy.notifications;
  const day=t=>new Intl.DateTimeFormat("en-CA",{timeZone:policy.timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(t);
  const recent=ledger.filter(e=>Date.parse(e.created_at)>now-7*86400000);
  if(recent.some(e=>e.kind===kind&&(e.event_key===event.event_key||e.meaning_key===event.meaning_key)))return {allowed:false,reason:"duplicate"};
  const own=recent.filter(e=>e.kind===kind);
  if(own.length>=limits.max_per_week||own.filter(e=>day(Date.parse(e.created_at))===day(now)).length>=limits.max_per_day)return {allowed:false,reason:"budget"};
  if(kind==="action"&&own.some(e=>Date.parse(e.created_at)>now-limits.min_interval_minutes*60000))return {allowed:false,reason:"minimum_interval"};
  const root=event.facts?.source==="native_receipt"?recent.find(e=>e.id===event.facts.event_id)?.initiative_key:event.meaning_key;
  const roots=list=>new Set(list.map(e=>e.initiative_key||e.meaning_key));
  const caps=k=>Math.max(policy.grant?.active?policy.grant[k]:0,policy.notifications?.enabled?policy.notifications[k]:0);
  if(!roots(recent).has(root)&&(roots(recent).size>=caps("max_per_week")||roots(recent.filter(e=>day(Date.parse(e.created_at))===day(now))).size>=caps("max_per_day")))return {allowed:false,reason:"shared_initiative_budget"};
  return {allowed:true};
}
function notificationExpiry(event,policy,now=Date.now()) {
  let until=Date.parse(event.expires_at);
  const n=policy.notifications;
  if(n.start_minute!==n.end_minute)for(let t=Math.floor(now/60000)*60000+60000;t<Math.min(until,now+26*3600000);t+=60000) {
    if(!inWindow(minute(t,policy.timezone),n.start_minute,n.end_minute)){until=t;break;}
  }
  return new Date(until).toISOString();
}
module.exports={TYPES,fingerprint,zone,minute,inWindow,settings,actionGate,scheduleGate,notificationGate,budgetGate,notificationExpiry};
