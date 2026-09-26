const crypto = require("crypto");
const { supabaseFetch } = require("./_membership");
const { freshConversationState, normalizeConversationState, normalizeUserContext } = require("./bm-context");
const { identityForPhone } = require("./_identity");
const { semanticPersistenceRequired, readSemanticConversation, commitSemanticConversation } = require("./_bm_semantic_store");

const EVENT_TABLE = "digital_wellness_feature_payloads";

function cleanText(value, maxLength = 240) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function cleanChannel(value) {
  const channel = cleanText(value, 20).toLowerCase();
  return channel === "whatsapp" || channel === "sms" ? channel : "";
}

function connectCodeFromText(text) {
  const match = cleanText(text, 80).match(/^connect\s+([a-z0-9-]{4,24})$/i);
  return match ? match[1].toUpperCase() : "";
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

function proactiveTemplateSids() {
  const configured = cleanText(process.env.TWILIO_WHATSAPP_PROACTIVE_CONTENT_SIDS, 600);
  const values = configured
    ? configured.split(",").map((value) => cleanText(value, 80)).filter(Boolean)
    : [];
  return Array.from({ length: 5 }, (_, index) => values[index] || cleanText(process.env[`TWILIO_WHATSAPP_PROACTIVE_CONTENT_SID_${index + 1}`], 80)).filter(Boolean);
}

function proactiveFingerprint(message) {
  return crypto.createHash("sha256").update(cleanText(message, 900).toLowerCase()).digest("hex");
}

async function approvedProactiveTemplateSids() {
  const configured = proactiveTemplateSids();
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!configured.length || !sid || !token) return [];
  const authorization = `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
  const approved = [];
  for (const contentSid of configured) {
    try {
      const response = await fetch(`https://content.twilio.com/v1/Content/${encodeURIComponent(contentSid)}/ApprovalRequests`, {
        headers: { authorization },
      });
      if (!response.ok) continue;
      const approval = await response.json();
      if (String(approval.whatsapp?.status || "").toLowerCase() === "approved") approved.push(contentSid);
    } catch (_) {
      // An unavailable approval check must never turn into an unapproved send.
    }
  }
  return approved;
}

async function proactiveGate(connectCode, message, channel, updateKey = "", channelUser = "") {
  const normalizedCode = normalizeConnectCode(connectCode);
  if (!normalizedCode || !cleanText(message, 900)) return { allowed: false, reason: "missing_proactive_input" };
  if (channelUser) {
    try {
      if ((await getAssistantMemory(channel, channelUser)).proactive_updates_paused === true) {
        return { allowed: false, reason: "proactive_updates_paused" };
      }
    } catch (_) {
      return { allowed: false, reason: "proactive_state_unavailable" };
    }
  }
  const rows = await supabaseFetch(
    `${EVENT_TABLE}?anonymous_user_id=eq.${encodeURIComponent(assistantUserId(normalizedCode))}&select=payload,submitted_at&order=submitted_at.desc&limit=100`,
    { method: "GET" }
  );
  const delivered = rows.filter((row) => row.payload?.properties?.event === "assistant_proactive_delivered");
  const now = Date.now();
  const latest = delivered.find((row) => now - new Date(row.submitted_at || 0).getTime() < 24 * 60 * 60 * 1000);
  if (latest) return { allowed: false, reason: "daily_limit" };
  const fingerprintValue = proactiveFingerprint(message);
  const duplicate = delivered.find((row) => {
    const properties = row.payload?.properties || {};
    return properties.proactive_fingerprint === fingerprintValue || (updateKey && properties.update_key === cleanText(updateKey, 120));
  });
  if (duplicate) return { allowed: false, reason: "duplicate_update" };
  const hour = new Date().getUTCHours();
  const quietStart = Number(process.env.ASSISTANT_PROACTIVE_QUIET_START_UTC || 21);
  const quietEnd = Number(process.env.ASSISTANT_PROACTIVE_QUIET_END_UTC || 8);
  const inQuietHours = quietStart > quietEnd ? hour >= quietStart || hour < quietEnd : hour >= quietStart && hour < quietEnd;
  if (inQuietHours) return { allowed: false, reason: "quiet_hours" };
  const sids = channel === "whatsapp" ? await approvedProactiveTemplateSids() : [];
  if (channel === "whatsapp" && !sids.length) return { allowed: false, reason: "no_approved_proactive_template" };
  const templateIndex = delivered.length % Math.max(sids.length, 1);
  return { allowed: true, templateIndex, contentSid: sids[templateIndex] || "", proactiveFingerprint: fingerprintValue };
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

function connectionForChannelUser(rows, channel, channelUser) {
  const normalizedChannel = cleanChannel(channel);
  const normalizedUser = cleanText(channelUser, 160);
  const match = (Array.isArray(rows) ? rows : [])
    .map((row) => row?.payload?.properties || {})
    .find((props) => cleanChannel(props.channel || props.preferred_channel) === normalizedChannel
      && cleanText(props.channel_user, 160) === normalizedUser
      && normalizeConnectCode(props.connect_code));
  if (!match) return null;
  return {
    channel: normalizedChannel,
    channelUser: normalizedUser,
    connectCode: normalizeConnectCode(match.connect_code),
  };
}

async function findAssistantConnectionForChannelUser(channel, channelUser) {
  const normalizedChannel = cleanChannel(channel);
  const normalizedUser = cleanText(channelUser, 160);
  if (!normalizedChannel || !normalizedUser) return null;
  const rows = await supabaseFetch(
    `${EVENT_TABLE}?payload->properties->>channel_user=eq.${encodeURIComponent(normalizedUser)}&select=payload,submitted_at&order=submitted_at.desc&limit=50`,
    { method: "GET" }
  );
  return connectionForChannelUser(rows, normalizedChannel, normalizedUser);
}

async function ensureAssistantConnectionForPhone({ channel, channelUser }) {
  const normalizedChannel = cleanChannel(channel);
  const normalizedPhone = cleanText(channelUser, 160);
  if (!normalizedChannel || !normalizedPhone) return null;
  const existing = await findAssistantConnectionForChannelUser(normalizedChannel, normalizedPhone);
  if (existing) return existing;
  const identity = await identityForPhone(normalizedPhone);
  // A web waitlist identity alone must never activate the production agent.
  if (!identity?.assistant_connect_code || !identity.app_install_id) return null;
  const connectCode = normalizeConnectCode(identity.assistant_connect_code);
  await recordAssistantChannel({
    event: "assistant_channel_auto_connected",
    channel: normalizedChannel,
    preferredChannel: normalizedChannel,
    connectCode,
    channelUser: normalizedPhone,
    userPhone: normalizedPhone,
  });
  await attachAssistantUserContext({
    connectCode,
    channel: normalizedChannel,
    channelUser: normalizedPhone,
  });
  return {
    channel: normalizedChannel,
    channelUser: normalizedPhone,
    connectCode,
    appInstallId: cleanText(identity.app_install_id, 160),
  };
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
  const rows = await supabaseFetch(
    `${EVENT_TABLE}?anonymous_user_id=eq.${encodeURIComponent(assistantChannelUserId(normalizedChannel, normalizedUser))}&select=payload,submitted_at&order=submitted_at.desc,id.desc&limit=100`,
    { method: "GET" }
  );
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
  if (options.requireSemantic === true || semanticPersistenceRequired()) {
    const stored = await readSemanticConversation(assistantChannelUserId(normalizedChannel, normalizedUser));
    // An empty or expired dedicated session must not resurrect older event-log state.
    delete memory.conversation_state;
    delete memory.pending_blocking;
    if (stored.state) memory.conversation_state = normalizeConversationState(stored.state);
    memory.semantic_store_version = stored.storageVersion;
  }
  return memory;
}

function inboundMessageId(value) {
  return cleanText(value, 160);
}

async function hasProcessedAssistantMessage(channel, channelUser, messageId) {
  const normalizedId = inboundMessageId(messageId);
  if (!normalizedId) return false;
  const memory = await getAssistantMemory(channel, channelUser);
  return Array.isArray(memory.processed_inbound_ids) && memory.processed_inbound_ids.includes(normalizedId);
}

async function claimAssistantInboundMessage(channel, channelUser, messageId) {
  const normalizedChannel = cleanChannel(channel);
  const normalizedUser = cleanText(channelUser, 160);
  const normalizedId = inboundMessageId(messageId);
  if (!normalizedChannel || !normalizedUser || !normalizedId) return { claimed: true, atomic: false, status: "unkeyed" };
  try {
    const result = await supabaseFetch("rpc/claim_assistant_inbound_message", {
      method: "POST",
      body: JSON.stringify({
        p_anonymous_user_id: assistantChannelUserId(normalizedChannel, normalizedUser),
        p_channel: normalizedChannel,
        p_message_id: normalizedId,
        p_lease_seconds: 300,
      }),
    });
    const row = Array.isArray(result) ? result[0] : result;
    if (row && typeof row.claimed === "boolean") {
      return { claimed: row.claimed, atomic: true, status: cleanText(row.status, 32) || "unknown" };
    }
  } catch (_) {
    // Older environments may not have migration 014 yet. Fall back to the
    // legacy event-store marker until the RPC is available.
  }
  try {
    const duplicate = await hasProcessedAssistantMessage(normalizedChannel, normalizedUser, normalizedId);
    return { claimed: !duplicate, atomic: false, status: duplicate ? "duplicate_legacy" : "claimed_legacy" };
  } catch (_) {
    // A memory outage must not turn a provider retry into a 500 response.
    return { claimed: true, atomic: false, status: "claim_unavailable" };
  }
}

async function recordProcessedAssistantMessage(channel, channelUser, messageId) {
  const normalizedId = inboundMessageId(messageId);
  if (!normalizedId) return;
  const memory = await getAssistantMemory(channel, channelUser);
  const previous = Array.isArray(memory.processed_inbound_ids) ? memory.processed_inbound_ids : [];
  const processed = Array.from(new Set([...previous, normalizedId])).slice(-48);
  await recordAssistantMemory({
    channel,
    channelUser,
    memory: { processed_inbound_ids: processed },
    source: "assistant_inbound_processed",
  });
}

async function completeAssistantInboundMessage(channel, channelUser, messageId) {
  const normalizedChannel = cleanChannel(channel);
  const normalizedUser = cleanText(channelUser, 160);
  const normalizedId = inboundMessageId(messageId);
  if (!normalizedChannel || !normalizedUser || !normalizedId) return { completed: false, atomic: false };
  let atomic = false;
  try {
    const result = await supabaseFetch("rpc/complete_assistant_inbound_message", {
      method: "POST",
      body: JSON.stringify({
        p_anonymous_user_id: assistantChannelUserId(normalizedChannel, normalizedUser),
        p_message_id: normalizedId,
      }),
    });
    if (typeof result === "boolean" || (Array.isArray(result) && typeof result[0] === "boolean")) atomic = true;
  } catch (_) {
    // The legacy marker below keeps retries safe while migration 014 rolls out.
  }
  try {
    await recordProcessedAssistantMessage(normalizedChannel, normalizedUser, normalizedId);
  } catch (error) {
    if (!atomic) throw error;
  }
  return { completed: true, atomic };
}

async function releaseAssistantInboundMessage(channel, channelUser, messageId) {
  if (!semanticPersistenceRequired() || !inboundMessageId(messageId)) return;
  await supabaseFetch("rpc/release_assistant_inbound_message", {
    method: "POST",
    body: JSON.stringify({
      p_anonymous_user_id: assistantChannelUserId(channel, channelUser),
      p_message_id: inboundMessageId(messageId),
    }),
  });
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

async function attachAssistantUserContext({ connectCode, channel, channelUser }) {
  const context = await getAssistantUserContext(connectCode);
  if (!Object.keys(context).length) return context;
  await recordAssistantMemory({
    channel,
    channelUser,
    memory: { user_context: context },
    source: "assistant_user_context_attached",
  });
  return context;
}

async function sendSmsMessage(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (!sid || !token || (!from && !messagingServiceSid)) {
    return { skipped: true, reason: "missing_sms_credentials" };
  }

  const params = new URLSearchParams();
  params.set("To", to);
  params.set("Body", body);
  if (messagingServiceSid) {
    params.set("MessagingServiceSid", messagingServiceSid);
  } else {
    params.set("From", from);
  }

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`sms_send_failed_${response.status}:${detail.slice(0, 240)}`);
  }
  return response.json();
}

async function sendWhatsAppMessage(to, body, options = {}) {
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_WHATSAPP_FROM_NUMBER || process.env.TWILIO_FROM_NUMBER;
  if (twilioSid && twilioToken && twilioFrom && String(process.env.WAITLIST_WHATSAPP_PROVIDER || "").toLowerCase() !== "meta") {
    const params = new URLSearchParams();
    const normalizedTo = String(to || "").startsWith("whatsapp:") ? to : `whatsapp:+${String(to || "").replace(/^\+/, "")}`;
    const normalizedFrom = String(twilioFrom).startsWith("whatsapp:") ? twilioFrom : `whatsapp:${twilioFrom}`;
    params.set("To", normalizedTo);
    params.set("From", normalizedFrom);
    if (options.contentSid) {
      params.set("ContentSid", options.contentSid);
      if (options.contentVariables) params.set("ContentVariables", JSON.stringify(options.contentVariables));
    } else {
      params.set("Body", body);
    }
    if (options.mediaUrl) params.set("MediaUrl", options.mediaUrl);

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioSid)}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`twilio_whatsapp_send_failed_${response.status}:${detail.slice(0, 240)}`);
    }
    return response.json();
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (options.contentSid) return { skipped: true, reason: "template_requires_twilio" };
  if (!token || !phoneNumberId) {
    return { skipped: true, reason: "missing_whatsapp_credentials" };
  }

  const graphVersion = process.env.WHATSAPP_GRAPH_API_VERSION || "v26.0";
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { preview_url: false, body },
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`whatsapp_send_failed_${response.status}:${detail.slice(0, 240)}`);
  }
  return response.json();
}

async function sendAssistantMessage(connection, body, options = {}) {
  if (!connection) return { skipped: true, reason: "missing_connection" };
  if (connection.channel === "sms") return sendSmsMessage(connection.channelUser, body);
  if (connection.channel === "whatsapp") return sendWhatsAppMessage(connection.channelUser, body, options);
  return { skipped: true, reason: "unsupported_channel" };
}

module.exports = {
  assistantChannelUserId,
  attachAssistantUserContext,
  cleanChannel,
  cleanText,
  connectCodeFromText,
  claimAssistantInboundMessage,
  completeAssistantInboundMessage,
  releaseAssistantInboundMessage,
  assistantConnectionPath,
  findAssistantConnection,
  findAssistantConnectionForChannelUser,
  connectionForChannelUser,
  ensureAssistantConnectionForPhone,
  getAssistantUserContext,
  getAssistantMemory,
  getAssistantActionRecord,
  isInferredActionOutcome,
  hasProcessedAssistantMessage,
  normalizeConnectCode,
  proactiveGate,
  proactiveTemplateSids,
  proactiveFingerprint,
  approvedProactiveTemplateSids,
  recordAssistantChannel,
  recordAssistantMemory,
  recordPendingAssistantAction,
  transitionPendingAssistantAction,
  supersededAssistantReply,
  recordAssistantConversationTurn,
  recordConversationTurnState,
  recordProcessedAssistantMessage,
  recordAssistantUserContext,
  sendAssistantMessage,
  sendSmsMessage,
  sendWhatsAppMessage,
};
