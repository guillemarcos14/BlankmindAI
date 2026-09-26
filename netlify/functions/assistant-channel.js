const { json, parseJsonBody, requireMethod, supabaseFetch } = require("./_membership");
const {
  cleanChannel,
  cleanText,
  findAssistantConnection,
  attachAssistantUserContext,
  recordAssistantMemory,
  transitionPendingAssistantAction,
  getAssistantMemory,
  getAssistantActionRecord,
  isInferredActionOutcome,
  getAssistantUserContext,
  normalizeConnectCode,
  recordAssistantUserContext,
  recordAssistantChannel,
  proactiveGate,
  sendAssistantMessage,
} = require("./_assistant_channel");
const { identityForAppInstall, identityForPhone, normalizePhone } = require("./_identity");
const { enrichAssistantContext, persistCanonicalSnapshot } = require("./_bm_user_context");
const { normalizeDevicePush } = require("./_assistant_push");
const { PENDING_ASSISTANT_ACTION_TYPES: PENDING_ACTION_TYPES } = require("./bm-pending-action");

async function registerPreference(body) {
  const connectCode = normalizeConnectCode(body.connect_code);
  const preferredChannel = cleanChannel(body.preferred_channel || body.channel);
  if (!connectCode || !preferredChannel) {
    return json(400, { error: "missing_connect_code_or_channel" });
  }

  await recordAssistantChannel({
    event: "assistant_channel_preference_set",
    channel: preferredChannel,
    preferredChannel,
    connectCode,
    userPhone: body.user_phone || body.phone_number || "",
  });

  if (body.context && typeof body.context === "object" && !Array.isArray(body.context)) {
    const normalizedContext = await recordAssistantUserContext({
      connectCode,
      context: body.context,
      channel: preferredChannel,
      userPhone: body.user_phone || body.phone_number || "",
    });
    const connection = await findAssistantConnection(connectCode, preferredChannel);
    if (connection && normalizedContext) {
      await attachAssistantUserContext({
        connectCode,
        channel: connection.channel,
        channelUser: connection.channelUser,
      });
    }
  }

  return json(200, { ok: true, connect_code: connectCode, preferred_channel: preferredChannel });
}

async function sendProactive(body) {
  const connectCode = normalizeConnectCode(body.connect_code);
  const preferredChannel = cleanChannel(body.preferred_channel || body.channel);
  const message = cleanText(body.message || body.body || body.text, 900);
  if (!connectCode || !message) {
    return json(400, { error: "missing_connect_code_or_message" });
  }

  const connection = await findAssistantConnection(connectCode, preferredChannel);
  const gate = await proactiveGate(connectCode, message, connection?.channel || preferredChannel, body.update_key || body.signal_id || "", connection?.channelUser || "");
  if (!gate.allowed) {
    await recordAssistantChannel({
      event: "assistant_proactive_delivery_skipped",
      channel: connection?.channel || preferredChannel,
      preferredChannel,
      connectCode,
      channelUser: connection?.channelUser || "",
      metadata: { reason: gate.reason },
    });
    return json(200, { ok: true, delivered: false, channel: connection?.channel || preferredChannel || "", reason: gate.reason });
  }
  if (connection?.channel === "whatsapp" && !gate.contentSid) {
    return json(200, { ok: true, delivered: false, channel: "whatsapp", reason: "missing_proactive_template" });
  }
  const result = await sendAssistantMessage(connection, message, gate.contentSid ? { contentSid: gate.contentSid } : {});
  await recordAssistantChannel({
    event: result.skipped ? "assistant_proactive_delivery_skipped" : "assistant_proactive_delivered",
    channel: connection?.channel || preferredChannel,
    preferredChannel,
    connectCode,
    channelUser: connection?.channelUser || "",
    metadata: {
      proactive_fingerprint: gate.proactiveFingerprint,
      update_key: cleanText(body.update_key || body.signal_id, 120),
      template_index: gate.templateIndex,
      content_sid: gate.contentSid,
    },
  });

  if (!result.skipped && connection?.channel === "whatsapp") {
    await require("./_assistant_channel").recordAssistantMemory({
      channel: "whatsapp",
      channelUser: connection.channelUser,
      memory: {
        pending_proactive_message: message,
        pending_proactive_update_key: cleanText(body.update_key || body.signal_id, 120),
        pending_proactive_sent_at: new Date().toISOString(),
      },
      source: "assistant_proactive_template",
    });
  }

  return json(200, {
    ok: true,
    delivered: !result.skipped,
    channel: connection?.channel || preferredChannel || "",
    reason: result.reason || "",
  });
}

async function syncContext(body) {
  const connectCode = normalizeConnectCode(body.connect_code);
  const preferredChannel = cleanChannel(body.preferred_channel || body.channel);
  const context = body.context && typeof body.context === "object" && !Array.isArray(body.context)
    ? body.context
    : null;
  if (!connectCode || !context) return json(400, { error: "missing_connect_code_or_context" });

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
  const canonicalSnapshot = await persistCanonicalSnapshot(connectCode, normalizedContext || mergedContext);
  const connection = await findAssistantConnection(connectCode, preferredChannel);
  if (connection && normalizedContext) {
    const canonicalContext = await enrichAssistantContext({}, connectCode);
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

async function registerDevicePush(body) {
  const result = await connectedChannel(body);
  if (result.error) return json(400, { error: result.error });
  if (!result.connection) return json(200, { ok: true, registered: false, reason: "not_linked" });
  const identity = await identityForAppInstall(body.app_install_id);
  if (!identity || normalizeConnectCode(identity.assistant_connect_code) !== result.connectCode
      || require("./_identity").normalizePhone(result.connection.channelUser) !== identity.phone_e164) {
    return json(403, { error: "installation_not_verified" });
  }
  const devicePush = normalizeDevicePush({
    token: body.device_token,
    environment: body.environment,
    app_install_id: body.app_install_id,
    updated_at: new Date().toISOString(),
  });
  if (!devicePush) return json(400, { error: "invalid_device_token" });
  await recordAssistantMemory({
    channel: result.connection.channel,
    channelUser: result.connection.channelUser,
    memory: { assistant_device_push: devicePush },
    source: "assistant_device_push_registered",
  });
  return json(200, { ok: true, registered: true, environment: devicePush.environment });
}

async function connectionStatus(body) {
  const result = await connectedChannel(body);
  if (result.error) return json(400, { error: result.error });
  const identity = await identityForAppInstall(body.app_install_id);
  if (!identity || normalizeConnectCode(identity.assistant_connect_code) !== result.connectCode) {
    return json(403, { error: "installation_not_verified" });
  }
  const linked = result.connection?.channel === result.preferredChannel
    && require("./_identity").normalizePhone(result.connection.channelUser) === identity.phone_e164;
  return json(200, { ok: true, linked: Boolean(linked), channel: result.preferredChannel });
}

async function completeOnboarding(body) {
  const status = await connectedChannel(body);
  if (status.error) return json(400, { error: status.error });
  const identity = await identityForAppInstall(body.app_install_id);
  if (!identity || normalizeConnectCode(identity.assistant_connect_code) !== status.connectCode
      || status.connection?.channel !== status.preferredChannel
      || require("./_identity").normalizePhone(status.connection.channelUser) !== identity.phone_e164) {
    return json(403, { error: "channel_not_verified_for_installation" });
  }
  const context = await getAssistantUserContext(status.connectCode);
  const memory = await getAssistantMemory(status.connection.channel, status.connection.channelUser);
  const ready = context.has_selected_apps === true
    && Number(context.selection_count) > 0
    && context.screen_time_authorized === true
    && context.notification_authorized === true
    && Boolean(memory.assistant_device_push?.token);
  if (!ready) return json(200, { ok: true, ready: false, reason: "device_setup_incomplete" });
  if (memory.assistant_activation_ready_sent_at) return json(200, { ok: true, ready: true, already_sent: true });
  const spanish = /^es(?:$|[-_])/i.test(String(context.locale || context.language || ""));
  const channelName = status.connection.channel === "sms" ? "SMS" : "WhatsApp";
  const message = spanish
    ? `Tu app ya está vinculada a este ${channelName} y tus distracciones están listas. Cuéntame qué te gustaría cambiar con tu móvil; puedes pedirme un bloqueo cuando quieras.`
    : `Your app is linked to this ${channelName} and your distractions are ready. Tell me what you'd like to change about your phone; you can ask me for a block whenever you want.`;
  const delivery = await sendAssistantMessage(status.connection, message);
  if (delivery?.skipped) return json(502, { error: delivery.reason || "activation_message_not_sent" });
  await recordAssistantMemory({
    channel: status.connection.channel,
    channelUser: status.connection.channelUser,
    memory: { assistant_activation_ready_sent_at: new Date().toISOString() },
    source: "assistant_activation_ready_sent",
  });
  return json(200, { ok: true, ready: true, sent: true });
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
    duration_days: Number.isInteger(value.duration_days) ? Math.min(Math.max(value.duration_days, 1), 14) : null,
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

async function connectedChannel(body) {
  const preferredChannel = cleanChannel(body.preferred_channel || body.channel);
  if (!preferredChannel) return { error: "missing_channel" };
  let connectCode = normalizeConnectCode(body.connect_code);
  const installation = cleanText(body.app_install_id, 160);
  // A phone number is public contact data, never an inbox credential. Legacy
  // clients retain their CONNECT code; app clients can use a linked install.
  if (!connectCode && !installation) return { error: "installation_not_linked" };
  const identity = installation ? await identityForAppInstall(installation) : null;
  if (!connectCode) connectCode = normalizeConnectCode(identity?.assistant_connect_code);
  if (!connectCode) return { error: "installation_not_linked" };
  if (identity && normalizeConnectCode(identity.assistant_connect_code) !== connectCode) {
    return { error: "assistant_identity_conflict" };
  }
  const connection = await findAssistantConnection(connectCode, preferredChannel);
  if (connection) {
    // Meta's WhatsApp sender omits "+" while Twilio and account identity use E.164.
    const connectedPhone = normalizePhone(connection.channelUser).replace(/^\+/, "");
    const suppliedPhone = normalizePhone(body.user_phone || body.phone_number).replace(/^\+/, "");
    if ((identity && normalizePhone(identity.phone_e164).replace(/^\+/, "") !== connectedPhone)
        || (suppliedPhone && suppliedPhone !== connectedPhone)) {
      return { error: "assistant_identity_conflict" };
    }
  }
  return { connectCode, preferredChannel, connection };
}

async function persistAppActionReceipt(result, body, actionId, status) {
  const match = /^app_([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(actionId);
  if (!match) return;
  const identity = await identityForPhone(result.connection.channelUser);
  if (result.connection.channel !== "whatsapp" || !identity?.auth_user_id
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

async function pollPendingAction(body) {
  const result = await connectedChannel(body);
  if (result.error) return json(400, { error: result.error });
  if (!result.connection) return json(200, { ok: true, linked: false, pending_action: null });

  const memory = await getAssistantMemory(result.connection.channel, result.connection.channelUser);
  const pending = normalizePendingAction(memory.pending_assistant_action);
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
    if (expiredOutcome && expiry.updated) {
      const spanish = String(memory.language || "").toLowerCase().startsWith("es");
      const message = spanish
        ? "La acción caducó antes de llegar al iPhone. No se aplicó ningún cambio. Puedes pedírmela otra vez."
        : "The action expired before it reached the iPhone. Nothing was changed. You can ask me to try again.";
      if (!String(expired?.id || "").startsWith("app_")) {
        try { await sendAssistantMessage(result.connection, message); } catch (_) { /* The explicit outcome remains recorded. */ }
      }
    }
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

async function acknowledgePendingAction(body) {
  const result = await connectedChannel(body);
  const actionId = cleanText(body.action_id, 80);
  const status = normalizeActionStatus(body.status);
  if (result.error || !actionId) return json(400, { error: result.error || "missing_action_id" });
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
  if (terminal) {
    const spanish = String(memory.language || "").toLowerCase().startsWith("es");
    let message;
    if (status === "verified") {
      const target = pending.app_names.length ? pending.app_names.join(", ") : "the selected distractions";
      if (pending.type === "start_protection") {
        message = spanish
          ? `${pending.app_names.length ? pending.app_names.join(", ") : "Tus distracciones seleccionadas"} ${pending.minutes ? `están bloqueadas durante ${pending.minutes} minutos` : "están bloqueadas"}.`
          : `${target} is blocked${pending.minutes ? ` for ${pending.minutes} minutes` : ""}.`;
      } else if (pending.type === "apply_schedule") {
        message = spanish ? "El nuevo horario de bloqueo ya está aplicado." : "The new blocking schedule is applied.";
      } else if (pending.type === "update_schedule") {
        message = spanish ? "La franja de bloqueo se ha actualizado." : "The blocking window was updated.";
      } else if (pending.type === "delete_schedule") {
        message = spanish ? "La franja de bloqueo se ha eliminado." : "The blocking window was removed.";
      } else if (pending.type === "delete_all_schedules") {
        message = spanish ? "Se han eliminado todas las franjas de bloqueo." : "All blocking windows were removed.";
      } else {
        message = spanish ? "Hecho. El cambio se ha aplicado y verificado." : "Done. The change is applied and verified.";
      }
    } else if (status === "delayed") {
      const delay = execution?.start_delay_seconds || 0;
      message = spanish
        ? `El iPhone aplicó la orden con ${delay} segundos de retraso. La protección efectiva termina a las ${execution?.effective_until || "la hora registrada por el dispositivo"}; no la cuento como ejecución inmediata.`
        : `The iPhone applied the request ${delay} seconds late. Effective protection ends at ${execution?.effective_until || "the device-recorded time"}; I am not counting it as immediate execution.`;
    } else if (status === "dismissed") {
      message = spanish ? "Cancelado. No se ha cambiado nada en el iPhone." : "Cancelled. Nothing was changed on the iPhone.";
    } else {
      message = spanish ? "No he podido aplicar el bloqueo en el iPhone. No se ha marcado como completado." : "I couldn't apply the block on the iPhone. It hasn't been marked as completed.";
    }
    if (!actionId.startsWith("app_")) {
      try { await sendAssistantMessage(result.connection, message); } catch (_) { /* The verified outcome remains recorded. */ }
    }
  }
  return json(200, { ok: true, acknowledged: true, status });
}

exports.handler = async (event) => {
  const methodError = requireMethod(event, "POST");
  if (methodError) return methodError;

  try {
    const body = parseJsonBody(event);
    const action = cleanText(body.action, 60).toLowerCase();
    if (action === "register_preference") return await registerPreference(body);
    if (action === "sync_context") return await syncContext(body);
    if (action === "register_device_push") return await registerDevicePush(body);
    if (action === "connection_status") return await connectionStatus(body);
    if (action === "complete_onboarding") return await completeOnboarding(body);
    if (action === "send_proactive") return await sendProactive(body);
    if (action === "poll_pending_action") return await pollPendingAction(body);
    if (action === "ack_pending_action") return await acknowledgePendingAction(body);
    return json(400, { error: "unsupported_action" });
  } catch (error) {
    if (String(error.message || "").includes("bm_anonymous_identity_conflict")) {
      return json(409, { error: "assistant_identity_conflict" });
    }
    return json(500, { error: "assistant_channel_failed", detail: error.message });
  }
};

exports.normalizePendingAction = normalizePendingAction;
exports.pendingActionTransition = pendingActionTransition;
exports.normalizeExecutionEvidence = normalizeExecutionEvidence;
exports.pendingScheduleTargetIsMissing = pendingScheduleTargetIsMissing;
