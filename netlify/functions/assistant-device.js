"use strict";
const {getSupabaseUser,json,parseJsonBody,requireMethod,supabaseFetch}=require("./_membership");
const {cleanText,findAssistantConnection,recordAssistantMemory,transitionPendingAssistantAction,getAssistantMemory,getAssistantActionRecord,isInferredActionOutcome,getAssistantUserContext,normalizeConnectCode,recordAssistantUserContext}=require("./_assistant_memory");
const {authUserHasAppleIdentity,identityForAuthUser}=require("./_identity");
const {enrichAssistantContext,persistCanonicalSnapshot}=require("./_bm_user_context");
const {normalizeDevicePush}=require("./_assistant_push");
const {PENDING_ASSISTANT_ACTION_TYPES:PENDING_ACTION_TYPES}=require("./bm-pending-action");
const {onboardingReady}=require("./_app_onboarding_access");
async function connectedChannel(body,appAuth){
 if(!appAuth)return {error:"authentication_required"};
 const identity=appAuth.identity,connectCode=appAuth.connectCode;
 if(identity.app_install_id!==body.app_install_id)return {error:"installation_not_verified"};
 const connection=await findAssistantConnection(connectCode,"app");
 if(connection?.channel!=="app")return {error:"app_channel_not_activated"};
 if(connection.channelUser!==appAuth.user.id||identity.auth_user_id!==appAuth.user.id)return {error:"assistant_identity_conflict"};
 return {connectCode,preferredChannel:"app",connection,identity,appAuth};
}
async function completeOnboarding(body,appAuth){
 const result=await connectedChannel(body,appAuth);
 if(result.error)return json(403,{error:result.error});
 const context=await getAssistantUserContext(result.connectCode);
 const ready=onboardingReady(context,{},"app");
 return json(200,{ok:true,ready,...(!ready?{reason:"device_setup_incomplete"}:{})});
}
async function registerDevicePush(body,appAuth){
 const result=await connectedChannel(body,appAuth);
 if(result.error)return json(403,{error:result.error});
 const devicePush=normalizeDevicePush({token:body.device_token,environment:body.environment,app_install_id:body.app_install_id,updated_at:new Date().toISOString()});
 if(!devicePush)return json(400,{error:"invalid_device_token"});
 await recordAssistantMemory({channel:"app",channelUser:appAuth.user.id,memory:{assistant_device_push:devicePush},source:"assistant_device_push_registered"});
 return json(200,{ok:true,registered:true,environment:devicePush.environment});
}
async function connectionStatus(body,appAuth){
 const result=await connectedChannel(body,appAuth);
 return result.error?json(403,{error:result.error}):json(200,{ok:true,linked:true,channel:"app"});
}
async function authenticatedAppIdentity(event, body) {
  const user = await getSupabaseUser(event);
  if (!user?.id) return { error: "authentication_required", status: 401 };
  if (!authUserHasAppleIdentity(user)) return { error: "apple_identity_required", status: 403 };
  const appInstallId = typeof body.app_install_id === "string" ? body.app_install_id.trim() : "";
  if (!appInstallId || appInstallId.length > 160) return { error: "installation_not_verified", status: 403 };
  const identity = await identityForAuthUser(user.id);
  const suppliedCode = normalizeConnectCode(body.connect_code);
  if (!identity?.auth_user_id || identity.auth_user_id !== user.id
      || !identity.assistant_connect_code || identity.app_install_id !== appInstallId
      || (suppliedCode && suppliedCode !== normalizeConnectCode(identity.assistant_connect_code))) {
    return { error: "installation_not_verified", status: 403 };
  }
  return { user, identity, connectCode: normalizeConnectCode(identity.assistant_connect_code) };
}

async function syncContext(body, appAuth = null) {
  const preferredChannel = "app";
  const connectCode = preferredChannel === "app" ? appAuth?.connectCode : normalizeConnectCode(body.connect_code);
  const context = body.context && typeof body.context === "object" && !Array.isArray(body.context)
    ? body.context
    : null;
  if (!connectCode || !context) return json(400, { error: "missing_connect_code_or_context" });
  if (preferredChannel === "app" && !appAuth) return json(401, { error: "authentication_required" });
  if (preferredChannel === "app" && context.brain_snapshot) {
    context.anonymous_user_id = appAuth.identity.anonymous_user_id || `app:${appAuth.user.id}`;
  }

  const previousContext = await getAssistantUserContext(connectCode);
  const mergedContext = {
    ...previousContext,
    ...context,
    profile_name: context.profile_name || previousContext.profile_name,
    age_range: context.age_range || previousContext.age_range,
    personal_profile: { ...(previousContext.personal_profile || {}), ...(context.personal_profile || {}) },
  };
  const normalizedContext = await recordAssistantUserContext({
    connectCode,
    context: mergedContext,
    channel: preferredChannel,
    userPhone: body.user_phone || body.phone_number || "",
  });
  const canonicalSnapshot = await persistCanonicalSnapshot(connectCode, normalizedContext || mergedContext, "app_context_sync", {identity:appAuth.identity});
  const connection = await findAssistantConnection(connectCode, preferredChannel);
  if (connection && normalizedContext) {
    const canonicalContext = await enrichAssistantContext({}, connectCode, {identity:appAuth.identity});
    await recordAssistantMemory({
      channel: connection.channel,
      channelUser: connection.channelUser,
      memory: { user_context: canonicalContext },
      source: "assistant_user_context_sync",
    });
    const memory = await getAssistantMemory(connection.channel, connection.channelUser);
    const pending = normalizePendingAction(memory.pending_assistant_action);
    if (pending && pendingScheduleTargetIsMissing(pending, canonicalContext)) {
      await transitionPendingAssistantAction({
        channel: connection.channel,
        channelUser: connection.channelUser,
        previous: memory.pending_assistant_action,
        pending: null,
        outcome: {
            id: pending.id,
            type: pending.type,
            status: "failed",
            resolved_at: new Date().toISOString(),
            detail: "schedule_target_missing_after_app_sync",
        },
        source: "assistant_action_invalidated_by_app_context",
      });
    }
  }
  return json(200, {
    ok: true,
    synced: Boolean(normalizedContext),
    canonical_snapshot: Boolean(canonicalSnapshot),
    selection_count: Number(normalizedContext?.selection_count) || 0,
    attached_channel: connection?.channel || "",
  });
}

const TERMINAL_ACTION_STATUSES = new Set(["verified", "delayed", "failed", "dismissed"]);
const ACTION_STATUS_TRANSITIONS = {
  queued: new Set(["delivered"]),
  delivered: new Set(["confirmed", "failed", "dismissed"]),
  confirmed: new Set(["execution_started", "failed", "dismissed"]),
  execution_started: new Set(["verified", "delayed", "failed"]),
  verified: new Set(),
  delayed: new Set(),
  failed: new Set(),
  dismissed: new Set(),
};
const ACTION_STATUS_RANK = {
  queued: 0,
  delivered: 1,
  confirmed: 2,
  execution_started: 3,
  verified: 4,
  delayed: 4,
  failed: 4,
  dismissed: 4,
};



function normalizeActionStatus(value) {
  const status = cleanText(value, 24).toLowerCase();
  return status === "received" ? "delivered" : status;
}

function pendingActionTransition(currentValue, requestedValue) {
  const current = normalizeActionStatus(currentValue) || "queued";
  const requested = normalizeActionStatus(requestedValue);
  if (!ACTION_STATUS_TRANSITIONS[current] || !ACTION_STATUS_TRANSITIONS[requested]) {
    return { allowed: false, idempotent: false, current, requested, reason: "invalid_status" };
  }
  if (current === requested) {
    return { allowed: true, idempotent: true, current, requested, next: current };
  }
  if (ACTION_STATUS_RANK[requested] < ACTION_STATUS_RANK[current]) {
    return { allowed: true, idempotent: true, current, requested, next: current };
  }
  if (!ACTION_STATUS_TRANSITIONS[current].has(requested)) {
    return { allowed: false, idempotent: false, current, requested, reason: "invalid_transition" };
  }
  return { allowed: true, idempotent: false, current, requested, next: requested };
}

function normalizePendingAction(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = cleanText(value.id, 80);
  const legacyType = cleanText(value.type, 60);
  const type = legacyType === "activate_mode" ? "start_protection" : legacyType === "switch_mode" ? "open_app_picker" : legacyType;
  const expiresAt = Date.parse(value.expires_at || "");
  if (!id || !PENDING_ACTION_TYPES.has(type) || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  const action = {
    id,
    type,
    name: cleanText(value.name, 80) || null,
    window_id: cleanText(value.window_id, 80) || null,
    minutes: Number.isInteger(value.minutes) ? Math.min(Math.max(value.minutes, 5), 240) : null,
    hard_mode: value.hard_mode === true,
    start_minute: Number.isInteger(value.start_minute) ? Math.min(Math.max(value.start_minute, 0), 1439) : null,
    end_minute: Number.isInteger(value.end_minute) ? Math.min(Math.max(value.end_minute, 0), 1439) : null,
    weekdays: Array.isArray(value.weekdays)
      ? value.weekdays.filter((day) => Number.isInteger(day) && day >= 1 && day <= 7).slice(0, 7)
      : [],
    duration_days: Number.isInteger(value.duration_days) ? Math.min(Math.max(value.duration_days, 1), 365) : null,
    recurrence: value.recurrence || null,
    local_date: value.local_date || null,
    timezone: value.timezone || null,
    starts_at: value.starts_at || null,
    ends_at: value.ends_at || null,
    autonomous: value.autonomous === true,
    grant_version: Number.isSafeInteger(value.grant_version) ? value.grant_version : null,
    hours: Number.isInteger(value.hours) ? Math.min(Math.max(value.hours, 1), 168) : null,
    app_names: Array.isArray(value.app_names)
      ? value.app_names.map((name) => cleanText(name, 40)).filter(Boolean).slice(0, 12)
      : [],
    summary: cleanText(value.summary, 320),
    created_at: cleanText(value.created_at, 40),
    requested_at: cleanText(value.requested_at || value.created_at, 40),
    expires_at: new Date(expiresAt).toISOString(),
    status: normalizeActionStatus(value.status) || "queued",
    delivered_at: cleanText(value.delivered_at, 40),
    confirmed_at: cleanText(value.confirmed_at, 40),
    execution_started_at: cleanText(value.execution_started_at, 40),
  };
  if (["update_schedule", "delete_schedule"].includes(type) && !action.window_id) return null;
  if (["apply_schedule", "update_schedule"].includes(type) && (
    !Number.isInteger(action.start_minute)
    || !Number.isInteger(action.end_minute)
    || action.start_minute === action.end_minute
  )) return null;
  return action;
}

function pendingScheduleTargetIsMissing(pending, context = {}) {
  // A delivered delete may sync the missing window before its acknowledgement.
  // Only an action that has not reached the device can be invalidated here.
  if (!pending || pending.status !== "queued" || !["update_schedule", "delete_schedule"].includes(pending.type)) return false;
  const windows = Array.isArray(context.schedule?.windows) ? context.schedule.windows : [];
  return !windows.some((window) => cleanText(window?.id, 80) === cleanText(pending.window_id, 80));
}

function normalizeExecutionEvidence(body, pending) {
  const startedAt = cleanText(body.started_at, 40);
  const effectiveUntil = cleanText(body.effective_until, 40);
  const requestedAt = cleanText(body.requested_at, 40);
  const duration = Number.isInteger(body.requested_duration_minutes) ? body.requested_duration_minutes : null;
  const requestedMs = Date.parse(requestedAt);
  const effectiveMs = Date.parse(effectiveUntil);
  const expectedEndMs = Number.isFinite(requestedMs) && Number.isInteger(duration)
    ? requestedMs + duration * 60 * 1000
    : NaN;
  return {
    action_id: cleanText(body.action_id, 80),
    origin: cleanText(body.origin, 40),
    requested_at: requestedAt,
    started_at: startedAt,
    requested_duration_minutes: duration,
    effective_until: effectiveUntil,
    result: cleanText(body.result, 120),
    start_delay_seconds: Number.isFinite(body.start_delay_seconds) ? Math.max(0, Math.round(body.start_delay_seconds)) : null,
    merged_with_existing: body.merged_with_existing === true,
    valid: pending.type !== "start_protection" || (
      cleanText(body.action_id, 80) === pending.id
      && cleanText(body.origin, 40) === "assistant_remote"
      && Number.isFinite(Date.parse(requestedAt))
      && Number.isFinite(Date.parse(startedAt))
      && (
        duration === pending.minutes
        && requestedAt === pending.requested_at
        && Number.isFinite(effectiveMs)
        && effectiveMs >= expectedEndMs - 1000
      )
    ),
  };
}

async function persistAppActionReceipt(result, body, actionId, status) {
  const match = /^app_([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(actionId);
  if (!match) return;
  const identity = result.identity;
  if (result.connection.channel !== "app" || !identity?.auth_user_id
      || !result.appAuth || result.appAuth.user.id !== identity.auth_user_id
      || normalizeConnectCode(identity.assistant_connect_code) !== result.connectCode
      || !body.app_install_id || identity.app_install_id !== body.app_install_id) {
    throw new Error("app_receipt_identity_mismatch");
  }
  // Store the device outcome before replacing the channel's single last-outcome
  // slot. Scope by account AND action; another user's UUID can never be updated.
  // A receipt may replace an inferred expiry/supersession, but not a different
  // device-confirmed terminal result.
  const rows = await supabaseFetch(
    `assistant_app_turns?id=eq.${encodeURIComponent(match[1])}&auth_user_id=eq.${encodeURIComponent(identity.auth_user_id)}`
      + `&action_id=eq.${encodeURIComponent(actionId)}&or=${encodeURIComponent(`(action_status.is.null,action_status.eq.${status},action_status.in.(expired,superseded))`)}`,
    { method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify({ action_status: status }) },
  );
  if (!rows[0]) throw new Error("app_receipt_not_persisted");
}

async function pollPendingAction(body, appAuth = null) {
  const result = await connectedChannel(body, appAuth);
  if (result.error) return json(result.error === "authentication_required" ? 401 : 400, { error: result.error });
  if (!result.connection) return json(200, { ok: true, linked: false, pending_action: null });

  const memory = await getAssistantMemory(result.connection.channel, result.connection.channelUser);
  const pending = normalizePendingAction(memory.pending_assistant_action);
  if (pending?.autonomous && result.appAuth && !await require("./bmb-service").autonomousPendingAllowed(result.appAuth.user.id,pending,memory.user_context || {})) {
    await transitionPendingAssistantAction({channel:"app",channelUser:result.appAuth.user.id,previous:memory.pending_assistant_action,pending:null,
      outcome:{id:pending.id,type:pending.type,status:"dismissed",detail:"autonomy_revoked_or_outside_limits",resolved_at:new Date().toISOString()},source:"bmb_current_authorization"});
    return json(200,{ok:true,linked:true,pending_action:null});
  }
  if (!pending && memory.pending_assistant_action) {
    const expired = memory.pending_assistant_action;
    const expiredAt = Date.parse(expired.expires_at || "");
    const expiredOutcome = Number.isFinite(expiredAt) && expiredAt <= Date.now()
      ? {
          id: cleanText(expired.id, 80),
          type: cleanText(expired.type, 60),
          status: "failed",
          resolved_at: new Date().toISOString(),
          detail: "action_expired_before_execution",
        }
      : null;
    if (expiredOutcome) await persistAppActionReceipt(result, body, expiredOutcome.id, "expired");
    const expiry = await transitionPendingAssistantAction({
      channel: result.connection.channel,
      channelUser: result.connection.channelUser,
      previous: expired,
      pending: null,
      outcome: expiredOutcome,
      source: "assistant_action_expired",
    });

  }
  if (pending && pending.status === "queued") {
    const transition = pendingActionTransition(pending.status, "delivered");
    const delivered = { ...memory.pending_assistant_action, status: transition.next, delivered_at: new Date().toISOString() };
    const receipt = await transitionPendingAssistantAction({
      channel: result.connection.channel,
      channelUser: result.connection.channelUser,
      previous: memory.pending_assistant_action,
      pending: delivered,
      source: "assistant_action_delivered",
    });
    if (!receipt.updated) return json(200, { ok: true, linked: true, pending_action: null });
    Object.assign(pending, normalizePendingAction(delivered));
  }
  return json(200, {
    ok: true,
    linked: true,
    pending_action: pending,
  });
}

async function acknowledgePendingAction(body, appAuth = null) {
  const result = await connectedChannel(body, appAuth);
  const actionId = cleanText(body.action_id, 80);
  const status = normalizeActionStatus(body.status);
  if (result.error || !actionId) return json(result.error === "authentication_required" ? 401 : 400, { error: result.error || "missing_action_id" });
  if (!ACTION_STATUS_TRANSITIONS[status]) return json(400, { error: "invalid_action_status" });
  if (!result.connection) return json(200, { ok: true, acknowledged: false, reason: "not_linked" });

  const memory = await getAssistantMemory(result.connection.channel, result.connection.channelUser);
  let rawPending = memory.pending_assistant_action;
  let pending = normalizePendingAction(rawPending)
    || (cleanText(rawPending?.id, 80) === actionId
      ? normalizePendingAction({ ...rawPending, expires_at: new Date(Date.now() + 60_000).toISOString() })
      : null);
  if (!pending || pending.id !== actionId) {
    const outcome = memory.last_assistant_action_outcome;
    if (outcome?.id === actionId && !isInferredActionOutcome(outcome) && TERMINAL_ACTION_STATUSES.has(normalizeActionStatus(outcome.status))) {
      await persistAppActionReceipt(result, body, actionId, normalizeActionStatus(outcome.status));
      return json(200, {
        ok: true,
        acknowledged: true,
        idempotent: true,
        status: normalizeActionStatus(outcome.status),
      });
    }
    if (TERMINAL_ACTION_STATUSES.has(status)) {
      const historical = await getAssistantActionRecord(result.connection.channel, result.connection.channelUser, actionId);
      if (historical?.outcome?.id === actionId && !isInferredActionOutcome(historical.outcome) && TERMINAL_ACTION_STATUSES.has(normalizeActionStatus(historical.outcome.status))) {
        await persistAppActionReceipt(result, body, actionId, normalizeActionStatus(historical.outcome.status));
        return json(200, { ok: true, acknowledged: true, idempotent: true, status: normalizeActionStatus(historical.outcome.status) });
      }
      if (historical?.pending?.id === actionId) {
        rawPending = historical.pending;
        pending = normalizePendingAction({ ...rawPending, expires_at: new Date(Date.now() + 60_000).toISOString() });
      }
    }
    if (!pending || pending.id !== actionId) return json(200, { ok: true, acknowledged: false, reason: pending ? "action_mismatch" : "no_pending_action" });
  }
  const transition = pendingActionTransition(pending.status, status);
  if (pending.autonomous && ["confirmed","execution_started"].includes(status)
      && (!result.appAuth || !await require("./bmb-service").autonomousPendingAllowed(result.appAuth.user.id,pending,memory.user_context || {}))) {
    return json(200,{ok:true,acknowledged:false,reason:"autonomy_revoked_or_outside_limits"});
  }
  if (!transition.allowed) {
    return json(200, {
      ok: true,
      acknowledged: false,
      reason: transition.reason,
      current_status: transition.current,
      requested_status: transition.requested,
    });
  }
  if (transition.idempotent) {
    if (TERMINAL_ACTION_STATUSES.has(transition.next)) {
      await persistAppActionReceipt(result, body, actionId, transition.next);
    }
    return json(200, { ok: true, acknowledged: true, idempotent: true, status: transition.next });
  }
  const now = new Date().toISOString();
  const terminal = TERMINAL_ACTION_STATUSES.has(status);
  const execution = terminal ? normalizeExecutionEvidence(body, pending) : null;
  if ((status === "verified" || status === "delayed") && !execution.valid) {
    return json(200, { ok: true, acknowledged: false, reason: "invalid_execution_evidence" });
  }
  if (status === "verified" && execution.start_delay_seconds > 60) {
    return json(200, { ok: true, acknowledged: false, reason: "late_execution_cannot_be_verified_as_immediate" });
  }
  if (status === "delayed" && !(execution.start_delay_seconds > 60)) {
    return json(200, { ok: true, acknowledged: false, reason: "delayed_status_without_measured_delay" });
  }
  if (terminal) await persistAppActionReceipt(result, body, actionId, status);
  if (terminal && result.appAuth && memory.user_context?.personal_profile?.rest_snapshot?.schema_version===1)
    await require("./bmb-rest").receipt(result.appAuth.user.id,actionId,status,execution);
  if (terminal && actionId.startsWith("bmb_") && result.appAuth) await require("./bmb-service").receipt(result.appAuth.user.id,actionId,status,execution);
  const timestampKey = status === "confirmed" ? "confirmed_at"
    : status === "execution_started" ? "execution_started_at"
      : status === "delivered" ? "delivered_at" : "resolved_at";
  const updated = { ...rawPending, status, [timestampKey]: now };
  const receipt = await transitionPendingAssistantAction({
    channel: result.connection.channel,
    channelUser: result.connection.channelUser,
    previous: rawPending,
    pending: terminal ? null : updated,
    outcome: terminal ? {
            id: actionId,
            type: pending.type,
            status,
            resolved_at: now,
            detail: cleanText(body.detail, 240),
            execution,
        } : null,
    source: `assistant_action_${status}`,
  });
  if (!receipt.updated && (!terminal || receipt.status === "status_changed")) {
    return json(200, { ok: true, acknowledged: false, reason: receipt.status });
  }
  return json(200, { ok: true, acknowledged: true, status });
}
const actions={sync_context:syncContext,register_device_push:registerDevicePush,connection_status:connectionStatus,complete_onboarding:completeOnboarding,poll_pending_action:pollPendingAction,ack_pending_action:acknowledgePendingAction};
exports.handler=async event=>{
 const methodError=requireMethod(event,"POST");if(methodError)return methodError;
 let body;try{body=parseJsonBody(event);}catch(_){return json(400,{error:"invalid_json"});}
 if(!body||typeof body!=="object"||Array.isArray(body))return json(400,{error:"invalid_json"});
 if((body.preferred_channel||body.channel)!=="app")return json(403,{error:"app_only"});
 const action=actions[body.action];if(!action)return json(400,{error:"unsupported_action"});
 try{
  const auth=await authenticatedAppIdentity(event,body);
  if(auth.error)return json(auth.status,{error:auth.error});
  return await action(body,auth);
 }catch(error){
  if(String(error.message).includes("bm_anonymous_identity_conflict"))return json(409,{error:"assistant_identity_conflict"});
  return json(500,{error:"assistant_device_failed",detail:error.message});
 }
};
Object.assign(exports,{normalizePendingAction,pendingActionTransition,normalizeExecutionEvidence,pendingScheduleTargetIsMissing});
