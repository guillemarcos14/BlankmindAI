const crypto = require("crypto");
const { supabaseFetch } = require("./_membership");
const { freshConversationState, normalizeConversationState, normalizeUserContext } = require("./bm-context");
const {semanticPersistenceRequired,readSemanticConversation,commitSemanticConversation}=require("./_bm_semantic_store");
const EVENT_TABLE="digital_wellness_feature_payloads";
function cleanText(value, maxLength = 240) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function cleanChannel(value) {
  const channel = cleanText(value, 20).toLowerCase();
  return channel === "app" ? channel : "";
}

function normalizeConnectCode(value) {
  return cleanText(value, 32).toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

function assistantUserId(connectCode) {
  return `connect:${normalizeConnectCode(connectCode)}`;
}

function assistantChannelUserId(channel, channelUser) {
  const key = `${cleanChannel(channel)}:${cleanText(channelUser, 160)}`;
  const hash = crypto.createHash("sha256").update(key).digest("hex").slice(0, 32);
  return `assistant:${hash}`;
}

async function recordAssistantChannel({ event, channel, connectCode, channelUser = "", userPhone = "", preferredChannel = "", metadata = {} }) {
  const normalizedCode = normalizeConnectCode(connectCode);
  if (!normalizedCode) return;
  const now = new Date().toISOString();
  await supabaseFetch(EVENT_TABLE, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      anonymous_user_id: assistantUserId(normalizedCode),
      schema_version: 1,
      payload: {
        event,
        properties: {
          channel: cleanChannel(channel),
          preferred_channel: cleanChannel(preferredChannel) || cleanChannel(channel),
          connect_code: normalizedCode,
          channel_user: cleanText(channelUser, 120),
          user_phone: cleanText(userPhone, 80),
          ...(metadata && typeof metadata === "object" ? metadata : {}),
        },
      },
      insight: { event },
      platform: cleanChannel(channel) || cleanChannel(preferredChannel) || "assistant",
      locale: "",
      app_version: "",
      build_number: "",
      data_consent: true,
      consent_text: "Assistant channel connection",
      privacy_raw_health_samples_sent: false,
      privacy_raw_sleep_stage_timestamps_sent: false,
      privacy_exact_app_selection_sent: false,
      privacy_exact_location_sent: false,
      submitted_at: now,
    }),
  });
}

async function findAssistantConnection(connectCode, preferredChannel = "") {
  const normalizedCode = normalizeConnectCode(connectCode);
  if (!normalizedCode) return null;
  const rows = await supabaseFetch(
    assistantConnectionPath(normalizedCode),
    { method: "GET" }
  );
  const preferred = cleanChannel(preferredChannel);
  const candidates = rows
    .map((row) => row.payload?.properties || {})
    .filter((props) => props.connect_code === normalizedCode);
  const connected = candidates.filter((props) => props.channel_user);
  const match = connected.find((props) => cleanChannel(props.channel) === preferred)
    || connected[0]
    || candidates.find((props) => cleanChannel(props.preferred_channel) === preferred)
    || candidates[0];
  if (!match) return null;
  const channel = cleanChannel(match.channel) || cleanChannel(match.preferred_channel) || preferred;
  const channelUser = cleanText(match.channel_user, 120);
  return channel && channelUser ? { channel, channelUser, connectCode: normalizedCode } : null;
}

function assistantConnectionPath(connectCode) {
  const normalizedCode = normalizeConnectCode(connectCode);
  return `${EVENT_TABLE}?anonymous_user_id=eq.${encodeURIComponent(assistantUserId(normalizedCode))}`
    + "&payload->properties->>channel_user=not.is.null"
    + "&select=*&order=submitted_at.desc&limit=20";
}

async function recordAssistantMemory({ channel, channelUser, memory = {}, source = "" }) {
  if (semanticPersistenceRequired() && Object.hasOwn(memory, "pending_assistant_action")) {
    throw new Error("pending_action_requires_atomic_write");
  }
  const normalizedChannel = cleanChannel(channel);
  const normalizedUser = cleanText(channelUser, 160);
  if (!normalizedChannel || !normalizedUser || !memory || !Object.keys(memory).length) return;
  const now = new Date().toISOString();
  await supabaseFetch(EVENT_TABLE, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      anonymous_user_id: assistantChannelUserId(normalizedChannel, normalizedUser),
      schema_version: 1,
      payload: {
        event: "assistant_memory_updated",
        properties: {
          channel: normalizedChannel,
          memory,
          source: cleanText(source, 240),
        },
      },
      insight: { event: "assistant_memory_updated" },
      platform: normalizedChannel,
      locale: "",
      app_version: "",
      build_number: "",
      data_consent: true,
      consent_text: "Assistant personal memory from user-provided chat data",
      privacy_raw_health_samples_sent: false,
      privacy_raw_sleep_stage_timestamps_sent: false,
      privacy_exact_app_selection_sent: false,
      privacy_exact_location_sent: false,
      submitted_at: now,
    }),
  });
}

async function recordPendingAssistantAction({ channel, channelUser, pending = null, expectedVersion, source = "assistant_action_pending" }) {
  if (!semanticPersistenceRequired()) {
    // Explicit legacy environments retain the event-store contract.
    await recordAssistantMemory({ channel, channelUser, memory: { pending_assistant_action: pending }, source });
    return { enqueued: true, status: pending ? "queued" : "invalidated" };
  }
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error("assistant_action_missing_semantic_version");
  const result = await supabaseFetch("rpc/enqueue_assistant_channel_action", {
    method: "POST", body: JSON.stringify({ p_anonymous_user_id: assistantChannelUserId(channel, channelUser),
      p_channel: channel, p_expected_version: expectedVersion, p_action: pending }),
  });
  const receipt = Array.isArray(result) ? result[0] : result;
  if (!receipt || (!receipt.enqueued && receipt.status !== "superseded")) throw new Error("assistant_action_enqueue_failed");
  return receipt;
}

async function transitionPendingAssistantAction({ channel, channelUser, previous = null, pending = null, outcome = null, expectedVersion, invalidateGeneration = false, source = "assistant_action_transition" }) {
  if (!semanticPersistenceRequired()) {
    await recordAssistantMemory({ channel, channelUser, memory: {
      pending_assistant_action: pending,
      ...(outcome ? { last_assistant_action_outcome: outcome } : {}),
    }, source });
    return { updated: true, status: "updated" };
  }
  if (invalidateGeneration && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0)) {
    throw new Error("assistant_action_missing_semantic_version");
  }
  const result = invalidateGeneration ? await supabaseFetch("rpc/invalidate_assistant_channel_generation", {
    method: "POST", body: JSON.stringify({ p_anonymous_user_id: assistantChannelUserId(channel, channelUser),
      p_channel: channel, p_expected_version: expectedVersion }),
  }) : await supabaseFetch("rpc/transition_assistant_pending_action", {
    method: "POST", body: JSON.stringify({ p_anonymous_user_id: assistantChannelUserId(channel, channelUser),
      p_channel: channel, p_expected_action_id: previous?.id || null,
      p_expected_status: previous ? previous.status || "queued" : null,
      p_action: pending, p_outcome: outcome, p_expected_version: Number.isSafeInteger(expectedVersion) ? expectedVersion : null }),
  });
  const receipt = Array.isArray(result) ? result[0] : result;
  if (!receipt || (!receipt.updated && !["superseded", "status_changed"].includes(receipt.status))) {
    throw new Error("assistant_action_transition_failed");
  }
  return receipt;
}

function isInferredActionOutcome(outcome) {
  return outcome?.detail === "action_expired_before_execution";
}

async function getAssistantActionRecord(channel, channelUser, actionId) {
  const key = assistantChannelUserId(channel, channelUser);
  const id = cleanText(actionId, 80);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  const filter = `(payload->properties->memory->pending_assistant_action->>id.eq.${id},payload->properties->memory->last_assistant_action_outcome->>id.eq.${id})`;
  const rows = await supabaseFetch(`${EVENT_TABLE}?anonymous_user_id=eq.${encodeURIComponent(key)}&or=${encodeURIComponent(filter)}&select=payload&order=submitted_at.desc,id.desc&limit=1`, { method: "GET" });
  const memory = rows[0]?.payload?.properties?.memory;
  if (isInferredActionOutcome(memory?.last_assistant_action_outcome)) {
    // Expiry is an observation of delivery, not an acknowledgement from iPhone.
    // Recover A's immutable envelope so a late native receipt is still validated.
    const actions = await supabaseFetch(`${EVENT_TABLE}?anonymous_user_id=eq.${encodeURIComponent(key)}&payload->properties->memory->pending_assistant_action->>id=eq.${encodeURIComponent(id)}&select=payload&order=submitted_at.desc,id.desc&limit=1`, { method: "GET" });
    return { pending: actions[0]?.payload?.properties?.memory?.pending_assistant_action, outcome: memory.last_assistant_action_outcome };
  }
  return memory ? { pending: memory.pending_assistant_action, outcome: memory.last_assistant_action_outcome } : null;
}

function supersededAssistantReply(plan) {
  return String(plan.response_language || plan.semantic_state?.language || "").toLowerCase().startsWith("es")
    ? "Otra petición ha actualizado la conversación. No he aplicado esta solicitud anterior."
    : "Another request updated the conversation. I haven't applied this earlier request.";
}

async function getAssistantMemory(channel, channelUser, options = {}) {
  const normalizedChannel = cleanChannel(channel);
  const normalizedUser = cleanText(channelUser, 160);
  if (!normalizedChannel || !normalizedUser) return {};
  const requiresSemantic = options.requireSemantic === true || semanticPersistenceRequired();
  const [rows, stored] = await Promise.all([
    supabaseFetch(`${EVENT_TABLE}?anonymous_user_id=eq.${encodeURIComponent(assistantChannelUserId(normalizedChannel, normalizedUser))}&select=payload,submitted_at&order=submitted_at.desc,id.desc&limit=100`, { method: "GET" }),
    requiresSemantic ? readSemanticConversation(assistantChannelUserId(normalizedChannel, normalizedUser)) : null,
  ]);
  const memory = rows.reverse().reduce((memory, row) => {
    const next = row.payload?.properties?.memory;
    if (!next || typeof next !== "object") return memory;
    const merged = {
      ...memory,
      ...next,
      main_apps: Array.isArray(next.main_apps) ? next.main_apps : memory.main_apps,
      weak_hours: Array.isArray(next.weak_hours) ? next.weak_hours : memory.weak_hours,
    };
    if (next.pending_blocking && typeof next.pending_blocking === "object" && !Array.isArray(next.pending_blocking)) {
      merged.pending_blocking = {
        ...next.pending_blocking,
        updated_at: next.pending_blocking.updated_at || row.submitted_at || "",
      };
    }
    if (next.conversation_state !== undefined) {
      const state = normalizeConversationState(next.conversation_state);
      if (state) merged.conversation_state = state;
      else delete merged.conversation_state;
    }
    return merged;
  }, {});
  if (requiresSemantic) {
    // An empty or expired dedicated session must not resurrect older event-log state.
    delete memory.conversation_state;
    delete memory.pending_blocking;
    if (stored.state) memory.conversation_state = normalizeConversationState(stored.state);
    memory.semantic_store_version = stored.storageVersion;
  }
  return memory;
}

function pendingConversationSlot(text) {
  const value = cleanText(text, 420).toLowerCase();
  if (/(what time do you want to be asleep|when do you want to be asleep|when you want to be asleep|usual bedtime|hora quieres dormir|hora habitual de dormir)/i.test(value)) return "bedtime";
  if (/(finish dinner|finish eating|finish lunch|terminar de cenar|terminar de comer)/i.test(value)) return "meal_end";
  if (/(finish work|terminar de trabajar|after work|despu[eé]s de trabajar)/i.test(value)) return "work_end";
  if (/(wake up|despertarte|despiertas|al despertarte)/i.test(value)) return "wake";
  return "";
}

function recordConversationTurnState(previousState, userMessage, assistantMessage, topic = "", semanticState = null) {
  const previous = freshConversationState(previousState) || {};
  const user = cleanText(userMessage, 420);
  const assistant = cleanText(assistantMessage, 420);
  const recentMessages = [
    ...(Array.isArray(previous.recent_messages) ? previous.recent_messages : []),
    user ? { role: "user", content: user } : null,
    assistant ? { role: "assistant", content: assistant } : null,
  ].filter(Boolean).slice(-8);
  const pendingSlot = semanticState?.next_question || pendingConversationSlot(assistant);
  return normalizeConversationState({
    topic: cleanText(topic, 48) || previous.topic,
    pending_slot: pendingSlot,
    pending_question: pendingSlot ? assistant : "",
    last_user_message: user,
    last_assistant_message: assistant,
    recent_messages: recentMessages,
    semantic_state: semanticState,
    updated_at: new Date().toISOString(),
  });
}

async function recordAssistantConversationTurn({ channel, channelUser, previousState, userMessage, assistantMessage, topic = "", semanticState = null, expectedVersion }) {
  const state = recordConversationTurnState(previousState, userMessage, assistantMessage, topic, semanticState);
  if (!state) return null;
  if (semanticPersistenceRequired()) {
    await commitSemanticConversation({
      anonymousUserId: assistantChannelUserId(channel, channelUser), channel,
      expectedVersion, state,
    });
  }
  const audit = () => recordAssistantMemory({
    channel,
    channelUser,
    memory: { conversation_state: state },
    source: "assistant_conversation_turn",
  });
  if (semanticPersistenceRequired()) {
    try { await audit(); } catch (_) { /* The canonical state is already committed. */ }
  } else {
    await audit();
  }
  return state;
}

async function recordAssistantUserContext({ connectCode, context = {}, channel = "", userPhone = "" }) {
  const normalizedCode = normalizeConnectCode(connectCode);
  const normalizedContext = normalizeUserContext(context);
  if (!normalizedCode || !Object.keys(normalizedContext).length) return null;
  const now = new Date().toISOString();
  if (normalizedContext.app_presence?.app_present === true) {
    normalizedContext.app_presence = {
      ...normalizedContext.app_presence,
      last_seen_at: now,
      source: "assistant_context_sync",
    };
  }
  await supabaseFetch(EVENT_TABLE, {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      anonymous_user_id: assistantUserId(normalizedCode),
      schema_version: 1,
      payload: {
        event: "assistant_user_context_synced",
        properties: {
          connect_code: normalizedCode,
          channel: cleanChannel(channel),
          user_phone: cleanText(userPhone, 80),
          context: normalizedContext,
        },
      },
      insight: { event: "assistant_user_context_synced" },
      platform: cleanChannel(channel) || "assistant",
      locale: "",
      app_version: "",
      build_number: "",
      data_consent: true,
      consent_text: "Assistant personal context sync authorized in Blankmind",
      privacy_raw_health_samples_sent: false,
      privacy_raw_sleep_stage_timestamps_sent: false,
      privacy_exact_app_selection_sent: true,
      privacy_exact_location_sent: false,
      submitted_at: now,
    }),
  });
  return normalizedContext;
}

async function getAssistantUserContext(connectCode) {
  const normalizedCode = normalizeConnectCode(connectCode);
  if (!normalizedCode) return {};
  const rows = await supabaseFetch(
    `${EVENT_TABLE}?anonymous_user_id=eq.${encodeURIComponent(assistantUserId(normalizedCode))}&select=payload,submitted_at&order=submitted_at.desc&limit=20`,
    { method: "GET" }
  );
  const latest = rows.find((row) => row.payload?.event === "assistant_user_context_synced");
  return normalizeUserContext(latest?.payload?.properties?.context);
}
module.exports={cleanText,cleanChannel,normalizeConnectCode,assistantUserId,assistantChannelUserId,recordAssistantChannel,findAssistantConnection,assistantConnectionPath,recordAssistantMemory,recordPendingAssistantAction,transitionPendingAssistantAction,isInferredActionOutcome,getAssistantActionRecord,supersededAssistantReply,getAssistantMemory,pendingConversationSlot,recordConversationTurnState,recordAssistantConversationTurn,recordAssistantUserContext,getAssistantUserContext};
