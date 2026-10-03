const crypto = require("node:crypto");
const { getSupabaseUser, json, parseJsonBody, requireMethod, supabaseFetch } = require("./_membership");
const { authUserHasAppleIdentity, ensureIdentityForAuthUser, identityForAuthUser, linkAppInstall } = require("./_identity");
const { assistantChannelUserId, findAssistantConnection, getAssistantMemory, recordAssistantChannel, recordConversationTurnState } = require("./_assistant_channel");
const { pendingActionFromPlan } = require("./bm-pending-action");
const { callBlankedAgent, queuePendingAssistantAction } = require("./whatsapp-agent");
const { normalizeUserContext } = require("./bm-context");
const { persistCanonicalSnapshot } = require("./_bm_user_context");
const { commitMemory } = require("./bm-brain");
const { chatText, hasValidatedCopy } = require("./bm-conversation-copy");

const TABLE = "assistant_app_turns";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const TERMINAL = new Set(["verified", "delayed", "failed", "dismissed", "expired", "superseded"]);
const APP_CHANNEL = "app";

async function authenticatedIdentity(event, body, action = "") {
  const user = await getSupabaseUser(event);
  if (!user?.id) return { error: "authentication_required", status: 401 };
  if (!authUserHasAppleIdentity(user)) return { error: "apple_identity_required", status: 403 };
  const appInstallId = typeof body.app_install_id === "string" ? body.app_install_id.trim() : "";
  if (!appInstallId || appInstallId.length > 160) return { error: "invalid_installation", status: 400 };
  let identity = action === "activate"
    ? await ensureIdentityForAuthUser({ authUserId: user.id })
    : await identityForAuthUser(user.id);
  if (action === "activate") {
    try {
      identity = await linkAppInstall({ authUserId: user.id, appInstallId });
    } catch (error) {
      if (error.message === "identity_app_install_conflict") {
        return { error: "installation_not_verified", status: 403 };
      }
      throw error;
    }
  }
  if (!identity?.auth_user_id || identity.auth_user_id !== user.id
      || !identity.app_install_id || identity.app_install_id !== appInstallId
      || !identity.assistant_connect_code) {
    return { error: "installation_not_verified", status: 403 };
  }
  return { user, identity, connection: {
    channel: APP_CHANNEL, channelUser: user.id, connectCode: identity.assistant_connect_code, canonicalMemoryRequired: true,
  } };
}

async function activate(auth) {
  const code = auth.identity.assistant_connect_code;
  const existing = await findAssistantConnection(code, APP_CHANNEL);
  if (existing?.channel !== APP_CHANNEL || existing.channelUser !== auth.user.id) {
    await recordAssistantChannel({
      event: "assistant_app_activated",
      channel: APP_CHANNEL,
      preferredChannel: APP_CHANNEL,
      connectCode: code,
      channelUser: auth.user.id,
    });
  }
  return json(200, { ok: true, activated: true, assistant_connect_code: code });
}

function turnPath(userId, turnId) {
  return `${TABLE}?id=eq.${encodeURIComponent(turnId)}&auth_user_id=eq.${encodeURIComponent(userId)}`;
}

async function readTurn(userId, turnId) {
  const rows = await supabaseFetch(`${turnPath(userId, turnId)}&select=*`, { method: "GET" });
  return rows[0] || null;
}

function actionStatus(actionId, memory = {}, savedStatus = "") {
  if (!actionId) return "";
  if (TERMINAL.has(savedStatus)) return savedStatus;
  if (memory.last_assistant_action_outcome?.id === actionId) {
    return memory.last_assistant_action_outcome.status || "failed";
  }
  if (memory.pending_assistant_action?.id === actionId) {
    const pending = memory.pending_assistant_action;
    if (TERMINAL.has(pending.status)) return pending.status;
    const expiry = Date.parse(pending.expires_at || "");
    if (Number.isFinite(expiry) && expiry <= Date.now()) return "expired";
    return pending.status || "queued";
  }
  return "superseded";
}

function presentTurn(row, memory = {}) {
  return {
    id: row.id, user_text: row.user_text, assistant_text: row.assistant_text || "", status: row.status,
    action_id: row.action_id || "", action_label: row.action_label || "",
    action_status: actionStatus(row.action_id, memory, row.action_status), created_at: row.created_at,
    auto_apply: row.auto_apply === true && ["queued", "delivered"].includes(actionStatus(row.action_id, memory, row.action_status)),
    control_section: row.control_section || null,
  };
}

function presentWithAvailableMemory(row, memory) {
  const turn = presentTurn(row, memory || {});
  if (!memory && row.action_id && !TERMINAL.has(row.action_status)) turn.action_status = "unavailable";
  return turn;
}

async function presentWithMemory(auth, row) {
  if (row.status === "completed" && row.brain_memory_effect && !row.brain_memory_applied_at) await commitMemory(auth.user.id, row.id);
  // A transient memory read failure must not hide an already committed reply.
  const memory = await getAssistantMemory(APP_CHANNEL, auth.user.id, { requireSemantic: true }).catch(() => null);
  return presentWithAvailableMemory(row, memory);
}

function decodeCursor(value) {
  if (!value) return null;
  if (typeof value !== "string" || value.length > 512) throw new Error("invalid_history_cursor");
  if (value.startsWith("v1.")) {
    const parsed = JSON.parse(Buffer.from(value.slice(3), "base64url").toString("utf8"));
    if (!TIMESTAMP.test(parsed.at) || !Number.isFinite(Date.parse(parsed.at)) || !UUID.test(parsed.id)) {
      throw new Error("invalid_history_cursor");
    }
    return parsed;
  }
  // Timestamp cursors from the first iOS candidate remain accepted.
  if (!TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("invalid_history_cursor");
  return { at: value };
}

async function history(auth, body) {
  let before;
  try { before = decodeCursor(body.before); }
  catch (_) { return json(400, { error: "invalid_history_cursor" }); }
  let cursorFilter = "";
  if (before?.id) {
    const filter = `(created_at.lt.${before.at},and(created_at.eq.${before.at},id.lt.${before.id}))`;
    cursorFilter = `&or=${encodeURIComponent(filter)}`;
  } else if (before) cursorFilter = `&created_at=lt.${encodeURIComponent(before.at)}`;
  const rows = await supabaseFetch(
    `${TABLE}?auth_user_id=eq.${encodeURIComponent(auth.user.id)}${cursorFilter}&select=*&order=created_at.desc,id.desc&limit=61`,
    { method: "GET" },
  );
  const page = rows.slice(0, 60);
  for (const row of page) {
    if (row.status === "completed" && row.brain_memory_effect && !row.brain_memory_applied_at) await commitMemory(auth.user.id,row.id);
  }
  const last = page[page.length - 1];
  const memory = await getAssistantMemory(APP_CHANNEL, auth.user.id, { requireSemantic: true }).catch(() => null);
  return json(200, {
    ok: true,
    turns: page.reverse().map((row) => presentWithAvailableMemory(row, memory)),
    next_before: rows.length > 60
      ? `v1.${Buffer.from(JSON.stringify({ at: last.created_at, id: last.id })).toString("base64url")}` : null,
  });
}

async function status(auth, body) {
  if (typeof body.turn_id !== "string" || !UUID.test(body.turn_id)) return json(400, { error: "invalid_turn" });
  const row = await readTurn(auth.user.id, body.turn_id);
  if (!row) return json(404, { error: "turn_not_found" });
  return json(200, { ok: true, turn: await presentWithMemory(auth, row) });
}

function actionCopy(action, spanish) {
  if (!action) return null;
  const picker = action.type === "open_app_picker";
  let type = action.type;
  if (picker) type = action.name === "Daily Limit" && Number.isInteger(action.minutes) ? "set_daily_limit"
    : Number.isInteger(action.start_minute) && Number.isInteger(action.end_minute)
      ? "apply_schedule" : Number.isInteger(action.minutes) ? "start_protection" : type;
  let description;
  if (type === "start_protection" && Number.isInteger(action.minutes)) description = spanish
    ? `Bloqueo${action.hard_mode ? " estricto" : ""} de ${action.minutes} min para tus distracciones`
    : `${action.minutes}-minute${action.hard_mode ? " hard" : ""} block for your distractions`;
  if (type === "set_daily_limit" && Number.isInteger(action.minutes)) description = spanish
    ? `Límite de ${action.minutes} minutos de uso al día para tus distracciones`
    : `${action.minutes} minutes of use per day for your distractions`;
  if (["apply_schedule", "update_schedule"].includes(type)) {
    const days = spanish ? ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"] : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const clock = value => { const minute = Math.min(1439, Math.max(0, value)); return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`; };
    const selectedDays = [...new Set(action.weekdays || [])].filter(day => Number.isInteger(day) && day >= 1 && day <= 7);
    const weekdays = !selectedDays.length || selectedDays.length === 7 ? (spanish ? "cada día" : "every day") : selectedDays.map(day => days[day - 1]).join(", ");
    // Mirror native creation defaults; editing a schedule preserves its expiry.
    const durationDays = type === "apply_schedule" ? Math.min(14, Math.max(1, action.duration_days ?? 7)) : null;
    const horizon = durationDays === null ? "" : (spanish ? ` durante ${durationDays} días` : ` for ${durationDays} days`);
    description = spanish ? `Bloqueo de ${clock(action.start_minute)} a ${clock(action.end_minute)}, ${weekdays}${horizon}`
      : `Block from ${clock(action.start_minute)} to ${clock(action.end_minute)}, ${weekdays}${horizon}`;
  }
  if (action.type === "request_screen_time_permission") return { label: spanish ? "Conceder permiso" : "Grant permission", text: spanish
    ? "Pulsa el botón para dar permiso al bloqueo. Avísame cuando lo tengas y seguimos."
    : "Tap the button to let Blankmind block your distractions. Let me know when you're ready and we'll carry on." };
  if (picker && !description) return { label: spanish ? "Elegir distracciones" : "Choose distractions", text: spanish
    ? "Elige primero qué apps quieres bloquear con el botón y seguimos."
    : "Choose which apps you'd like to block with the button and we'll carry on." };
  if (picker) return { label: spanish ? "Elegir distracciones" : "Choose distractions", text: `${description}. ${spanish
    ? "Elige tus distracciones con el botón y confirma la selección. Entonces lo intentaré en tu iPhone."
    : "Choose your distractions with the button and confirm your selection. Then I'll try it on your iPhone."}` };
  if (!description) return null;
  const label = type === "start_protection" ? (spanish ? `Bloquear ${action.minutes} min` : `Block ${action.minutes} min`)
    : type === "set_daily_limit" ? (spanish ? "Aplicar límite" : "Apply daily limit") : (spanish ? "Aplicar horario" : "Apply schedule");
  return { label, text: `${description}. ${spanish ? "Pulsa el botón para probarlo en tu iPhone. Te diré si se ha podido aplicar." : "Tap the button to try it on your iPhone. I'll let you know whether it worked."}` };
}

function visibleReply(plan, context, action) {
  const answer = chatText(String(plan.message_text || plan.response_text || "").trim().slice(0, 4000));
  if (!answer) throw new Error("assistant_empty_reply");
  const spanish = String(plan.response_language || context.language || "").startsWith("es");
  const proposedAction = Array.isArray(plan.actions) && plan.actions.length > 0;
  if (proposedAction && !action) {
    return spanish
      ? "No he podido preparar esta acción. No se ha aplicado ningún cambio. Puedes volver a pedírmela."
      : "I couldn't prepare this action. No change was applied. You can ask me to try again.";
  }
  if (plan.bmb_generated || hasValidatedCopy(plan)) return answer;
  const copy = actionCopy(action, spanish);
  if (copy) return chatText(copy.text);
  const claimsExecution = /\b(?:already blocked|blocked your|already applied|activated your|he bloqueado|he aplicado|ya est[aá]n bloquead[ao]s|ya est[aá] aplicado)\b/i.test(answer);
  const requestsNotification = /\b(?:notification|notificaci[oó]n)\b/i.test(answer);
  if (action && (claimsExecution || requestsNotification)) {
    const duration = action.type === "start_protection" && Number.isInteger(action.minutes) ? ` ${action.minutes} min` : "";
    return spanish
      ? `La acción${duration ? ` de${duration}` : ""} está preparada para tus distracciones seleccionadas. Pulsa el botón para aplicarla; el resultado requiere la verificación del iPhone.`
      : `The action${duration ? ` for${duration}` : ""} is ready for your selected distractions. Tap the button to apply it; the result needs verification from your iPhone.`;
  }
  return answer;
}

async function prepare(auth, row, leaseOwner, prompt, deviceContext) {
  if (deviceContext != null) {
    const context = normalizeUserContext(deviceContext);
    if (!context.brain_snapshot || !Number.isSafeInteger(context.context_revision)) throw new Error("invalid_brain_snapshot");
    // Bind IDs to the authenticated installation, never to client-supplied IDs.
    context.anonymous_user_id = auth.identity.anonymous_user_id || `app:${auth.user.id}`;
    const saved = await persistCanonicalSnapshot(auth.identity.assistant_connect_code, context, "app_turn_fresh_snapshot");
    if (!saved) throw new Error("brain_snapshot_not_persisted");
  }
  const { plan, context, modelUnavailable } = await callBlankedAgent(prompt, auth.user.id, auth.connection);
  // Do not commit a degraded reply as completed: the existing failed-turn lease
  // lets the client retry this exact UUID and payload. A canonical withdrawal is
  // safe without a model and must still invalidate a pending instruction.
  const canonicalCancellation = plan.semantic_state?.intent === "cancelled"
    && plan.semantic_state?.status === "cancelled" && plan.semantic_decision?.type === "cancelled"
    && Array.isArray(plan.actions) && plan.actions.length === 0;
  if (modelUnavailable && !canonicalCancellation) throw new Error("assistant_model_unavailable");
  const version = context.memory?.semantic_store_version;
  if (!Number.isSafeInteger(version) || version < 0) throw new Error("semantic_store_missing_version");
  const action = pendingActionFromPlan(plan, { idPrefix: "app" });
  if (action) {
    action.id = `app_${row.id}`;
    action.semantic_version = version + 1;
  }
  let answer = visibleReply(plan, context, action);
  const spanish = String(plan.response_language || context.language || "").startsWith("es");
  const autoApply = Boolean(context.brain_request?.execute && action && plan.actions?.length === 1
    && (plan.bmb_generated ? !["open_app_picker","request_screen_time_permission"].includes(action.type)
      : ["start_protection","apply_schedule","update_schedule","set_daily_limit","enable_allow_only","enable_adult_filter","disable_pause"].includes(action.type))
    && context.brain_snapshot && context.has_selected_apps && context.screen_time_authorized);
  if (autoApply && !plan.bmb_generated && !hasValidatedCopy(plan)) answer = spanish ? "Voy a intentarlo en tu iPhone. Te diré si se ha podido aplicar." : "I'll try that on your iPhone. I'll let you know whether it worked.";
  const state = recordConversationTurnState(context.memory?.conversation_state, prompt, answer,
    context.memory?.last_topic || "", plan.semantic_state);
  if (plan.bmb_state) state.bmb_state = plan.bmb_state;
  const payload = {
    assistant_text: answer, action,
    brain_memory_effect: context.brain_memory_effect || null,
    auto_apply: autoApply,
    control_section: ["report","settings","schedule","distractions","emergency"].includes(plan.control_section) ? plan.control_section : null,
    action_label: actionCopy(action, spanish)?.label || (action ? (spanish ? "Aplicar ahora" : "Apply now") : null),
    semantic_version: version + 1,
    invalidates: plan.bmb_invalidates || plan.semantic_state?.intent === "cancelled"
      || (plan.semantic_state?.intent === "block" && ["collecting", "awaiting_confirmation"].includes(plan.semantic_state?.status)),
  };
  const result = await supabaseFetch("rpc/prepare_assistant_app_turn", {
    method: "POST", body: JSON.stringify({ p_auth_user_id: auth.user.id, p_turn_id: row.id, p_lease_owner: leaseOwner,
      p_anonymous_user_id: assistantChannelUserId(APP_CHANNEL, auth.user.id),
      p_expected_version: version, p_state: state, p_payload: payload }),
  });
  const prepared = Array.isArray(result) ? result[0] : result;
  if (!prepared?.prepared || !prepared.turn?.prepared_payload) throw new Error(`assistant_prepare_${prepared?.status || "failed"}`);
  return prepared.turn;
}

async function send(auth, body) {
  const turnId = body.turn_id;
  const prompt = typeof body.text === "string" ? body.text.trim() : "";
  if (typeof turnId !== "string" || !UUID.test(turnId) || !prompt || prompt.length > 4000) {
    return json(400, { error: "invalid_turn" });
  }
  const leaseOwner = crypto.randomUUID();
  const result = await supabaseFetch("rpc/claim_assistant_app_turn", {
    method: "POST", body: JSON.stringify({ p_auth_user_id: auth.user.id, p_turn_id: turnId,
      p_user_text: prompt, p_lease_owner: leaseOwner }),
  });
  const claim = Array.isArray(result) ? result[0] : result;
  if (!claim?.claimed) {
    if (claim?.status === "completed") {
      return json(200, { ok: true, turn: await presentWithMemory(auth, claim.turn), idempotent: true });
    }
    if (claim?.status === "processing") return json(202, { ok: true, turn: presentTurn(claim.turn), retry_after: 3 });
    if (claim?.status === "payload_conflict") return json(409, { error: "turn_payload_conflict" });
    if (claim?.status === "conversation_in_progress") return json(409, { error: "conversation_in_progress", retry_after: 3 });
    throw new Error("assistant_claim_failed");
  }
  const ownedPath = `${turnPath(auth.user.id, turnId)}&lease_owner=eq.${leaseOwner}&status=eq.processing`;
  try {
    const row = claim.turn.prepared_payload ? claim.turn : await prepare(auth, claim.turn, leaseOwner, prompt, body.context);
    const payload = row.prepared_payload;
    let action = null;
    if (payload.action) {
      const queued = await queuePendingAssistantAction({ ...auth.connection, authUserId: auth.user.id, turnLeaseOwner: leaseOwner }, {}, prompt, "app", payload.action);
      if (!queued?.action) throw new Error("assistant_queue_unavailable");
      action = queued.action;
    } else if (payload.invalidates) {
      const result = await supabaseFetch("rpc/enqueue_assistant_app_action", {
        method: "POST", body: JSON.stringify({ p_auth_user_id: auth.user.id, p_turn_id: turnId, p_lease_owner: leaseOwner }),
      });
      const cleared = Array.isArray(result) ? result[0] : result;
      if (!["invalidated", "duplicate", "superseded"].includes(cleared?.status)) throw new Error("assistant_invalidation_failed");
    }
    if (TERMINAL.has(action?.status)) {
      // Never overwrite a receipt that raced the final response persistence.
      await supabaseFetch(`${ownedPath}&action_status=is.null`, {
        method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ action_status: action.status }),
      });
    }
    const rows = await supabaseFetch(ownedPath, {
      method: "PATCH", headers: { prefer: "return=representation" },
      body: JSON.stringify({ assistant_text: payload.assistant_text, action_id: action?.id || null,
        action_label: payload.action_label,
        ...(payload.brain_memory_effect ? { brain_memory_effect: payload.brain_memory_effect } : {}),
        ...(payload.auto_apply ? { auto_apply: true } : {}),
        ...(payload.control_section ? { control_section: payload.control_section } : {}),
        status: "completed", completed_at: new Date().toISOString(), lease_expires_at: null,
        prepared_payload: null }),
    });
    if (!rows[0]) throw new Error("assistant_lease_lost");
    return json(200, { ok: true, turn: await presentWithMemory(auth, rows[0]) });
  } catch (error) {
    // A lost commit response must recover the saved reply, not repeat its action.
    const recovered = await readTurn(auth.user.id, turnId).catch(() => null);
    if (recovered?.status === "completed") {
      return json(200, { ok: true, turn: await presentWithMemory(auth, recovered), idempotent: true });
    }
    await supabaseFetch(ownedPath, {
      method: "PATCH", headers: { prefer: "return=minimal" },
      body: JSON.stringify({ status: "failed", lease_expires_at: null }),
    }).catch(() => null);
    throw error;
  }
}

exports.handler = async (event) => {
  const methodError = requireMethod(event, "POST");
  if (methodError) return methodError;
  let body;
  try { body = parseJsonBody(event); }
  catch (_) { return json(400, { error: "invalid_json" }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json(400, { error: "invalid_json" });
  try {
    const auth = await authenticatedIdentity(event, body, body.action);
    if (auth.error) return json(auth.status, { error: auth.error });
    if (body.action === "activate") return await activate(auth);
    if (body.action?.startsWith("bmb_")) return await require("./bmb-service").api(auth,body) || json(400,{error:"unsupported_action"});
    if (body.action === "history") return await history(auth, body);
    if (body.action === "status") return await status(auth, body);
    if (body.action === "transcribe") {
      const result = await require("./bm-audio-input").transcribe(body);
      return json(result.status, result.error ? { error: result.error } : { ok: true, text: result.text });
    }
    if (body.action === "send") return await send(auth, body);
    return json(400, { error: "unsupported_action" });
  } catch (error) {
    // Diagnostic codes only: never log messages, tokens or provider payloads.
    console.error("assistant_app_failure", JSON.stringify({
      action: ["activate","history","status","send","transcribe"].includes(body.action) ? body.action : "other",
      code: /^\w{1,100}$/.test(error.message || "") ? error.message : "unexpected_failure",
      location: String(error.stack || "").match(/(?:bmb-brain|assistant-app|_membership)\.js:\d+:\d+/)?.[0] || null,
    }));
    return json(503, { error: "assistant_app_unavailable", retry_after: 3 });
  }
};

exports.authenticatedIdentity = authenticatedIdentity;
exports.actionStatus = actionStatus;
exports.visibleReply = visibleReply;
