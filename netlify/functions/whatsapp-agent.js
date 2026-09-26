const crypto = require("crypto");
const { isFinalQaWhatsApp, isFinalAppLinkedWhatsApp, privateQaGateConfigured } = require("./_bm_final_qa_access");
const { identityForConnectCode, normalizePhone } = require("./_identity");
const { sendAssistantActionPush } = require("./_assistant_push");
const { json, parseJsonBody, supabaseFetch } = require("./_membership");
const {
  attachAssistantUserContext,
  claimAssistantInboundMessage,
  connectCodeFromText,
  completeAssistantInboundMessage,
  releaseAssistantInboundMessage,
  ensureAssistantConnectionForPhone,
  getAssistantMemory,
  recordAssistantConversationTurn,
  recordAssistantChannel,
  recordAssistantMemory,
  recordPendingAssistantAction,
  transitionPendingAssistantAction,
  supersededAssistantReply,
  sendWhatsAppMessage,
} = require("./_assistant_channel");
const { handler: blankedAgentHandler } = require("./blanked-agent");
const { freshConversationState } = require("./bm-context");
const { semanticPersistenceRequired } = require("./_bm_semantic_store");
const { enrichAssistantContext } = require("./_bm_user_context");
const {
  hasSelectedDistractions,
  onboardingMessages,
  queueOnboardingPicker,
  onboardingProgress,
  dispatchWhatsAppOnboarding,
  shouldSendOnboarding,
} = require("./bm-onboarding");
const {
  PENDING_ASSISTANT_ACTION_TYPES: PENDING_ACTION_TYPES,
  firstPendingAction,
  pendingActionFromPlan: buildPendingActionFromPlan,
  isActivePendingAction,
} = require("./bm-pending-action");

function cleanText(value, maxLength = 600) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function explicitDurationMinutes(text) {
  const match = cleanText(text, 600).toLowerCase().match(/(\d{1,3})\s*[-–]?\s*(?:min|mins|minute|minutes|minutos?)/i);
  if (!match) return null;
  return Math.min(Math.max(Number(match[1]), 5), 240);
}

function asksForDailyLimit(text) {
  const value = cleanText(text, 600).toLowerCase();
  return /\b(daily limit|per day|each day|every day|l[ií]mite diario|por d[ií]a)\b/i.test(value)
    || (/\b(limit|l[ií]mite|cap|tope)\b/i.test(value) && /\d+\s*(?:min|mins|minute|minutes|minutos?)/i.test(value));
}

function header(event, name) {
  const target = name.toLowerCase();
  const entries = Object.entries(event.headers || {});
  const match = entries.find(([key]) => key.toLowerCase() === target);
  return match ? match[1] : "";
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(left || "");
  const rightBuffer = Buffer.from(right || "");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function rawBody(event) {
  if (!event.body) return "";
  return event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
}

function isProductionEnvironment() {
  return process.env.NODE_ENV === "production"
    || process.env.CONTEXT === "production"
    || process.env.NETLIFY === "true";
}

function audioExtension(contentType) {
  const type = cleanText(contentType, 120).toLowerCase();
  if (type.includes("ogg")) return "ogg";
  if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
  if (type.includes("mp4") || type.includes("m4a")) return "m4a";
  if (type.includes("wav")) return "wav";
  if (type.includes("webm")) return "webm";
  if (type.includes("amr")) return "amr";
  return "audio";
}

async function transcribeMetaAudio(message) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const mediaId = cleanText(message.audio_id, 160);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!token || !mediaId) throw new Error("whatsapp_audio_media_not_configured");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
  const graphVersion = process.env.WHATSAPP_GRAPH_API_VERSION || "v26.0";
  const mediaResponse = await fetch(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(mediaId)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!mediaResponse.ok) throw new Error(`whatsapp_media_metadata_failed_${mediaResponse.status}`);
  const media = await mediaResponse.json();
  const mediaUrl = cleanText(media.url, 1600);
  if (!mediaUrl) throw new Error("whatsapp_media_url_missing");
  const audioResponse = await fetch(mediaUrl, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!audioResponse.ok) throw new Error(`whatsapp_media_download_failed_${audioResponse.status}`);
  const contentLength = Number(audioResponse.headers?.get?.("content-length") || 0);
  if (contentLength > 24 * 1024 * 1024) throw new Error("whatsapp_audio_too_large");
  const audio = Buffer.from(await audioResponse.arrayBuffer());
  if (audio.length > 24 * 1024 * 1024) throw new Error("whatsapp_audio_too_large");
  const contentType = cleanText(message.audio_content_type, 120) || "audio/ogg";
  const form = new FormData();
  form.append("model", process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1");
  form.append("file", new Blob([audio], { type: contentType }), `whatsapp-audio.${audioExtension(contentType)}`);
  const transcriptionResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const raw = await transcriptionResponse.text();
  let parsed = {};
  try { parsed = raw ? JSON.parse(raw) : {}; } catch (_) { parsed = {}; }
  if (!transcriptionResponse.ok) throw new Error(`openai_transcription_failed_${transcriptionResponse.status}:${cleanText(parsed.error?.message || raw, 180)}`);
  const transcript = cleanText(parsed.text, 800);
  if (!transcript) throw new Error("whatsapp_transcription_empty");
  return transcript;
}

function verifySignature(event) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return !isProductionEnvironment() && process.env.WHATSAPP_REQUIRE_SIGNATURE !== "true";
  const signature = header(event, "x-hub-signature-256");
  if (!signature.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody(event), "utf8").digest("hex")}`;
  return timingSafeEqual(signature, expected);
}

function verifyChallenge(event) {
  const params = event.queryStringParameters || {};
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (params["hub.mode"] !== "subscribe" || !params["hub.challenge"]) {
    return json(400, { error: "invalid_whatsapp_challenge" });
  }
  if (!token || params["hub.verify_token"] !== token) {
    return json(403, { error: "invalid_whatsapp_verify_token" });
  }
  return {
    statusCode: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    body: params["hub.challenge"],
  };
}

function incomingMessages(body) {
  const messages = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    if (!entry || typeof entry !== "object") continue;
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      if (!change || typeof change !== "object") continue;
      const value = change.value || {};
      for (const message of Array.isArray(value.messages) ? value.messages : []) {
        if (!message || typeof message !== "object") continue;
        const text = cleanText(
          (message.text && message.text.body)
          || (message.button && (message.button.text || message.button.payload))
          || (message.interactive && message.interactive.button_reply && (message.interactive.button_reply.title || message.interactive.button_reply.id))
          || (message.interactive && message.interactive.list_reply && (message.interactive.list_reply.title || message.interactive.list_reply.id))
        );
        const from = cleanText(message.from, 40);
        const audioId = cleanText(message.audio && message.audio.id, 160);
        const audioContentType = cleanText(message.audio && (message.audio.mime_type || message.audio.mimeType), 120);
        if ((!text && !audioId) || !from) continue;
        messages.push({
          from,
          id: cleanText(message.id, 120),
          text,
          audio_id: audioId,
          audio_content_type: audioContentType,
        });
      }
    }
  }
  return messages;
}

function acceptsProactiveUpdate(text) {
  return /^(yes|yes,?\s*(show|please)|show( me)?|tell me|show update|sure|go ahead|okay|ok)$/i.test(cleanText(text, 120));
}

// A pending action is already the user's confirmed intent. Short acknowledgements
// must redeliver that exact action instead of sending the prompt through planning
// again, where a transient app snapshot could replace it with an app-picker action.
function acceptsPendingActionConfirmation(text) {
  return /^(?:yes|yeah|yep|yea|ok|okay|sure|go ahead|apply(?: it)?|confirm(?: it)?|yes[, ]+(?:apply|confirm|do it)(?: it)?)\.?$/i
    .test(cleanText(text, 120));
}

function requestedAppNames(text) {
  const source = ` ${cleanText(text, 600).toLowerCase()} `;
  const candidates = [
    { keys: ["tiktok", "tik tok"], label: "TikTok" },
    { keys: ["instagram", "insta", " ig "], label: "Instagram" },
    { keys: [" x ", "twitter"], label: "X" },
    { keys: ["youtube", "yt", "youtube shorts"], label: "YouTube" },
    { keys: ["reddit"], label: "Reddit" },
    { keys: ["facebook"], label: "Facebook" },
    { keys: ["snapchat"], label: "Snapchat" },
  ];
  return candidates
    .map((candidate) => ({
      label: candidate.label,
      index: Math.min(...candidate.keys.map((key) => source.indexOf(key)).filter((index) => index >= 0)),
    }))
    .filter((candidate) => Number.isFinite(candidate.index))
    .sort((left, right) => left.index - right.index)
    .map((candidate) => candidate.label);
}

function detectedLanguage(text) {
  const value = cleanText(text, 800).toLowerCase();
  return /[¿áéíóúñ]|\b(quiero|bloquea|bloquear|despues|después|comer|cenar|dormir|ayudame|ayúdame|consejo|redes sociales|hola|buenas|gracias|puedes|s[ií])\b/i.test(value)
    ? "es"
    : "en";
}

function messageLanguage(text, savedLanguage = "") {
  const value = cleanText(text, 120).toLowerCase();
  if (/^(?:sí|si|vale|perfecto?|gracias)\.?$/i.test(value)) return "es";
  if (/^(?:yes|yeah|yep|sure|thanks?)\.?$/i.test(value)) return "en";
  const neutralFollowup = /^(?:ok|okay|\d{1,2}(?::\d{2})?\s*(?:am|pm)?|usually\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|sobre\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\.?$/i.test(value);
  if (neutralFollowup && /^(?:es|en)/i.test(savedLanguage)) return savedLanguage.toLowerCase().startsWith("es") ? "es" : "en";
  return detectedLanguage(text);
}

function pendingActionFromPlan(plan, prompt = "", idPrefix = "wa") {
  return buildPendingActionFromPlan(plan, { idPrefix });
}

async function recordPushAttempt(connection, pending, pushResult) {
  const attempt = {
    action_id: pending.id,
    action_type: pending.type,
    sent: pushResult?.sent === true,
    reason: cleanText(pushResult?.reason, 200),
    status: Number(pushResult?.status || 0),
    apns_id: cleanText(pushResult?.apns_id, 80),
    attempted_at: pushResult?.accepted_at || pushResult?.attempted_at || new Date().toISOString(),
  };
  await recordAssistantMemory({
    channel: connection.channel,
    channelUser: connection.channelUser,
    memory: { last_assistant_push_attempt: attempt },
    source: attempt.sent ? "assistant_push_accepted" : "assistant_push_failed",
  });
  return attempt;
}

async function scheduleActionRetry(connection, pending) {
  const siteURL = String(process.env.URL || "").replace(/\/$/, "");
  const secret = String(process.env.WHATSAPP_APP_SECRET || "");
  if (!siteURL || !secret || !connection?.channelUser || !pending?.id) return { scheduled: false };
  const message = `${connection.channel}:${connection.channelUser}:${pending.id}`;
  const signature = crypto.createHmac("sha256", secret).update(message).digest("hex");
  try {
    const response = await fetch(`${siteURL}/.netlify/functions/assistant-action-retry-background`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel: connection.channel, channel_user: connection.channelUser, action_id: pending.id, signature }),
    });
    return { scheduled: response.ok, status: response.status };
  } catch (error) {
    return { scheduled: false, reason: cleanText(error.message, 160) };
  }
}

async function deliverPendingAssistantAction(connection, pending, memory = {}) {
  let pushResult;
  try { pushResult = await sendAssistantActionPush(memory.assistant_device_push, pending); }
  catch (error) { pushResult = { sent: false, reason: `push_exception:${error.message}` }; }
  const push = await recordPushAttempt(connection, pending, pushResult);
  await scheduleActionRetry(connection, pending);
  return { action: pending, push, duplicate: true };
}

async function queuePendingAssistantAction(connection, plan, prompt = "", idPrefix = "wa", preparedAction = null, expectedVersion) {
  if (!connection?.connectCode) return null;
  const pending = preparedAction || pendingActionFromPlan(plan, prompt, idPrefix);
  if (!pending) return null;
  let memory = {};
  try {
    memory = await getAssistantMemory(connection.channel, connection.channelUser, { requireSemantic: Boolean(preparedAction) });
  } catch (error) {
    if (preparedAction || semanticPersistenceRequired()) throw error;
  }
  const existing = memory.pending_assistant_action;
  // App retries resume the exact durable action, including its original expiry.
  // A newer WhatsApp turn or a terminal receipt must never resurrect it.
  if (preparedAction) {
    const outcome = memory.last_assistant_action_outcome;
    if (outcome?.id === pending.id) return { action: { ...pending, status: outcome.status }, duplicate: true };
    if (existing?.id === pending.id && !isActivePendingAction(existing)) return { action: existing, duplicate: true };
    if (memory.semantic_store_version !== pending.semantic_version) {
      return { action: { ...pending, status: "superseded" }, duplicate: true };
    }
    if (existing?.id === pending.id) {
      return deliverPendingAssistantAction(connection, existing, memory);
    }
    if (Date.parse(pending.expires_at || "") <= Date.now()) {
      return { action: { ...pending, status: "expired" }, duplicate: true };
    }
    const result = await supabaseFetch("rpc/enqueue_assistant_app_action", {
      method: "POST", body: JSON.stringify({ p_auth_user_id: connection.authUserId,
        p_turn_id: pending.id.slice(4), p_lease_owner: connection.turnLeaseOwner }),
    });
    const committed = Array.isArray(result) ? result[0] : result;
    if (!committed?.action) throw new Error("assistant_app_enqueue_failed");
    if (!committed.enqueued) return { action: committed.action, duplicate: true };
    return deliverPendingAssistantAction(connection, committed.action, memory);
  }
  if (semanticPersistenceRequired()) {
    // Every committed provider turn owns a fresh action ID. Reusing an older ID
    // could resurrect a receipt that arrived after this worker read the inbox.
    const next = pending;
    const receipt = await recordPendingAssistantAction({ channel: connection.channel, channelUser: connection.channelUser,
      pending: next, expectedVersion });
    if (!receipt.enqueued) return { action: { ...next, status: "superseded" }, duplicate: true };
    const delivery = await deliverPendingAssistantAction(connection, next, memory);
    return { ...delivery, duplicate: false };
  }
  if (existing?.fingerprint === pending.fingerprint && Date.parse(existing.expires_at || "") > Date.now()) {
    return deliverPendingAssistantAction(connection, existing, memory);
  }
  await recordAssistantMemory({
    channel: connection.channel,
    channelUser: connection.channelUser,
    memory: { pending_assistant_action: pending },
    source: "assistant_action_pending",
  });
  const delivery = await deliverPendingAssistantAction(connection, pending, memory);
  return { ...delivery, duplicate: false };
}

function pendingActionConfirmationPlan(action) {
  const summary = cleanText(action?.summary, 320) || "I still have that change ready.";
  return {
    message_text: summary,
    response_text: summary,
    actions: [action],
    blocking_ready: true,
    semantic_state: { status: "ready" },
  };
}

function whatsappReplyText(plan, delivery = null) {
  return require("./_assistant_reply").assistantReplyText(plan, delivery, "whatsapp");
}

async function sendPlanReply(to, plan, delivery = null) {
  return sendWhatsAppMessage(to, whatsappReplyText(plan, delivery));
}

function minuteOfDay(hour, minute, meridiem) {
  if (!Number.isFinite(hour) || hour < 1 || hour > 12 || !Number.isFinite(minute) || minute < 0 || minute > 59) return null;
  const normalized = meridiem === "pm" && hour !== 12 ? hour + 12 : meridiem === "am" && hour === 12 ? 0 : hour;
  return normalized * 60 + minute;
}

function mealEndMinute(text, terms) {
  const value = cleanText(text, 800).toLowerCase();
  if (!terms.test(value)) return null;
  const matches = [...value.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi)];
  if (!matches.length) return null;
  const match = matches[matches.length - 1];
  const hour = Number(match[1]);
  const meridiem = match[3] || (hour >= 8 && hour <= 11 ? "am" : "pm");
  return minuteOfDay(hour, Number(match[2] || 0), meridiem);
}

function breakfastEndMinute(text) {
  return mealEndMinute(text, /(breakfast|desayuno|desayunar)/i);
}

function lunchEndMinute(text) {
  return mealEndMinute(text, /(lunch|comida|comer|almuerzo)/i);
}

function memoryFactsFromText(text, savedMemory = {}) {
  const value = cleanText(text, 800).toLowerCase();
  const apps = requestedAppNames(text);
  const minutes = explicitDurationMinutes(text);
  const breakfastMinute = breakfastEndMinute(text);
  const lunchMinute = lunchEndMinute(text);
  const facts = {};
  if (/(sleep|bed|night|dormir|duermo|cama|noche)/i.test(value)) facts.last_topic = "sleep";
  else if (/(scroll|social|instagram|tiktok|youtube|reddit|reels|shorts|redes)/i.test(value)) facts.last_topic = "social";
  else if (/(focus|work|study|foco|trabaj|estudi)/i.test(value)) facts.last_topic = "focus";
  if (apps.length) facts.main_apps = apps;
  if (lunchMinute != null) {
    facts.lunch_end_minute = lunchMinute;
    facts.weak_hours = [Math.floor(lunchMinute / 60)];
  }
  if (breakfastMinute != null) {
    facts.breakfast_end_minute = breakfastMinute;
    facts.weak_hours = [Math.floor(breakfastMinute / 60)];
  }
  if (savedMemory.pending_action === "set_daily_limit" && minutes != null) {
    facts.pending_action = "";
    facts.pending_app_names = [];
  } else if (asksForDailyLimit(text) && minutes == null) {
    facts.pending_action = "set_daily_limit";
    facts.pending_app_names = apps.length
      ? apps
      : (Array.isArray(savedMemory.main_apps) ? savedMemory.main_apps.slice(0, 8) : []);
  }
  return facts;
}

async function agentContext(from, prompt, linkedConnection = null) {
  let savedMemory = {};
  try {
    savedMemory = await getAssistantMemory("whatsapp", from, { requireSemantic: linkedConnection?.canonicalMemoryRequired === true });
  } catch (error) {
    if (linkedConnection?.canonicalMemoryRequired === true || semanticPersistenceRequired()) throw error;
    savedMemory = {};
  }
  const newFacts = memoryFactsFromText(prompt, savedMemory);
  const language = messageLanguage(prompt, savedMemory.language || savedMemory.conversation_state?.semantic_state?.language);
  const conversationState = freshConversationState(savedMemory.conversation_state);
  const memory = {
    ...savedMemory,
    ...newFacts,
    language,
    main_apps: newFacts.main_apps || savedMemory.main_apps,
    weak_hours: newFacts.weak_hours || savedMemory.weak_hours,
    conversation_state: conversationState,
  };
  const storedUserContext = savedMemory.user_context && typeof savedMemory.user_context === "object"
    ? savedMemory.user_context
    : {};
  const userContext = await enrichAssistantContext(
    storedUserContext,
    linkedConnection?.connectCode || savedMemory.assistant_connect_code,
  );
    if (Object.keys(newFacts).length || savedMemory.language !== language) {
      try {
        await recordAssistantMemory({ channel: "whatsapp", channelUser: from, memory: { ...newFacts, language }, source: prompt });
    } catch (_) {
      // Memory must never block a reply.
    }
  }
  return {
    ...userContext,
    channel: "whatsapp",
    assistant_channel: "whatsapp",
    language,
    allow_spanish_response: true,
    is_blank_active: userContext.is_blank_active === undefined ? false : userContext.is_blank_active,
    has_selected_apps: userContext.has_selected_apps === true,
    selection_count: Number.isFinite(userContext.selection_count) ? userContext.selection_count : 0,
    screen_time_authorized: userContext.screen_time_authorized === true,
    emergency_unlocks_remaining: Number.isFinite(userContext.emergency_unlocks_remaining) ? userContext.emergency_unlocks_remaining : 3,
    vacation_mode_active: userContext.vacation_mode_active === undefined ? false : userContext.vacation_mode_active,
    risk_window: userContext.risk_window || "the usual risk window",
    recommended_duration_minutes: Number.isFinite(userContext.recommended_duration_minutes) ? userContext.recommended_duration_minutes : 30,
    user_context: userContext,
    memory,
    recent_messages: conversationState?.recent_messages || [],

  };
}

async function callBlankedAgent(prompt, from, linkedConnection = null) {
  const context = await agentContext(from, prompt, linkedConnection);
  const response = await blankedAgentHandler({
    httpMethod: "POST",
    body: JSON.stringify({ prompt, context }),
  });
  const body = JSON.parse(response.body || "{}");
  if (response.statusCode < 200 || response.statusCode >= 300 || !body.ok) {
    throw new Error(body.error || "blanked_agent_failed");
  }
  // Keep provider diagnostics internal. App turns need to distinguish a model
  // fallback from a completed reply without exposing its error text.
  return { plan: body.plan, context, modelUnavailable: Boolean(body.model_error) };
}

async function recordAssistantConnection({ channel, connectCode, from, identityLinked = false }) {
  let previousMemory = {};
  try {
    previousMemory = await getAssistantMemory(channel, from);
  } catch (_) {
    // Connection delivery must still work when durable memory is temporarily unavailable.
  }
  let context = {};
  try {
    await recordAssistantChannel({
      event: "assistant_channel_connected",
      channel,
      connectCode,
      channelUser: from,
    });
    await recordAssistantMemory({
      channel,
      channelUser: from,
      memory: {
        proactive_updates_paused: false,
        assistant_connect_code: String(connectCode || "").toUpperCase(),
      },
      source: "assistant_channel_connected",
    });
    if (!identityLinked) await transitionPendingAssistantAction({ channel, channelUser: from,
      previous: previousMemory.pending_assistant_action, pending: null,
      expectedVersion: previousMemory.semantic_store_version, invalidateGeneration: true, source: "assistant_channel_connected" });
    const attachedContext = await attachAssistantUserContext({ connectCode, channel, channelUser: from });
    context = attachedContext && Object.keys(attachedContext).length ? attachedContext : previousMemory.user_context || {};
  } catch (error) {
    if (identityLinked) throw error;
    // Connection delivery must not depend on the context snapshot being available.
  }
  return {
    identityLinked,
    alreadyAcknowledged: Boolean(previousMemory.assistant_connection_ack_sent_at),
    firstConnection: shouldSendOnboarding(previousMemory),
    context: context || {},
    onboardingProgress: onboardingProgress(previousMemory),
  };
}

async function sendConnectionOnboarding(from, connection = {}) {
  if (connection.firstConnection === false) return { sent: false, reason: "already_onboarded" };
  const context = connection.context || {};
  const messages = onboardingMessages(context);
  const selected = hasSelectedDistractions(context);
  let queued = null;
  if (!selected) {
    try {
      queued = await queueOnboardingPicker({ channel: "whatsapp", channelUser: from, messages });
    } catch (_) {
      // The visible copy remains useful even when the action store or APNs is unavailable.
    }
  }

  const dispatch = await dispatchWhatsAppOnboarding({
    channel: "whatsapp",
    channelUser: from,
    messages: { welcome: messages.welcome, setup: selected ? messages.ready : messages.setup },
    button: queued?.button || null,
    progress: connection.onboardingProgress || {},
    sendMessage: sendWhatsAppMessage,
  });
  if (!dispatch.dispatched) return { skipped: true, reason: dispatch.reason || "whatsapp_delivery_skipped" };
  return { sent: true, selected, push: queued?.push || null };
}

async function processMessage(message) {
  let prompt = message.text;
  if (message.audio_id) {
    try {
      const transcript = await transcribeMetaAudio(message);
      prompt = prompt ? `${prompt}\n${transcript}` : transcript;
    } catch (_) {
      return sendWhatsAppMessage(message.from, "I could not understand that voice note yet. Send it as text or try another audio.");
    }
  }
  if (!prompt) return sendWhatsAppMessage(message.from, "I could not read that message yet. Send it as text or try another audio.");
  const connectCode = connectCodeFromText(prompt);
  if (connectCode) {
    const identity = await identityForConnectCode(connectCode);
    const identityLinked = Boolean(identity?.app_install_id);
    if (identity && (!identityLinked || normalizePhone(message.from) !== identity.phone_e164)) {
      return sendWhatsAppMessage(message.from, "Verify this phone number in the Blankmind app before connecting WhatsApp.");
    }
    if (!identity && !isFinalQaWhatsApp("whatsapp", message.from)
        && (isProductionEnvironment() || process.env.BM_FINAL_APP_LINKED_ROUTING_ENABLED === "true")) {
      return sendWhatsAppMessage(message.from, "Verify your phone in the Blankmind app first, then connect WhatsApp from there.");
    }
    const connection = await recordAssistantConnection({ channel: "whatsapp", connectCode, from: message.from, identityLinked });
    if (identityLinked) {
      if (!connection.alreadyAcknowledged) {
        const spanish = /^es(?:$|[-_])/i.test(String(connection.context.locale || connection.context.language || ""));
        const acknowledgement = spanish
          ? "WhatsApp conectado a tu app. Vuelve a Blankmind para comprobar que el iPhone está listo para bloquear."
          : "WhatsApp is connected to your app. Return to Blankmind to check that your iPhone is ready to block.";
        const delivery = await sendWhatsAppMessage(message.from, acknowledgement);
        if (delivery?.skipped) return delivery;
        await recordAssistantMemory({
          channel: "whatsapp", channelUser: message.from,
          memory: { assistant_connection_ack_sent_at: new Date().toISOString() },
          source: "assistant_connection_ack_sent",
        });
      }
      return { sent: true, onboarding: false };
    }
    const onboarding = await sendConnectionOnboarding(message.from, connection);
    return onboarding?.skipped
      ? onboarding
      : { sent: true, onboarding: connection.firstConnection !== false };
  }

  let linkedConnection = null;
  try {
    linkedConnection = await ensureAssistantConnectionForPhone({ channel: "whatsapp", channelUser: message.from });
  } catch (_) {
    // Automatic identity matching is additive; legacy CONNECT remains available.
  }

  const command = prompt.toLowerCase();
  if (command === "stop" || command === "disconnect") {
    const stoppedMemory = await getAssistantMemory("whatsapp", message.from);
    await transitionPendingAssistantAction({ channel: "whatsapp", channelUser: message.from,
      previous: stoppedMemory.pending_assistant_action, pending: null,
      expectedVersion: stoppedMemory.semantic_store_version, invalidateGeneration: true, source: "assistant_channel_paused" });
    await recordAssistantMemory({
      channel: "whatsapp",
      channelUser: message.from,
      memory: {
        proactive_updates_paused: true,
        pending_proactive_message: "",
      },
      source: "assistant_channel_paused",
    });
    return sendWhatsAppMessage(message.from, "WhatsApp updates paused. Reconnect from Blankmind when you want to use this channel again.");
  }
  let pendingMemory = {};
  try {
    pendingMemory = await getAssistantMemory("whatsapp", message.from);
  } catch (_) {
    pendingMemory = {};
  }
  if (!linkedConnection && pendingMemory.assistant_connect_code) {
    linkedConnection = {
      channel: "whatsapp",
      channelUser: message.from,
      connectCode: String(pendingMemory.assistant_connect_code).toUpperCase(),
    };
  }
  const pendingMessage = cleanText(pendingMemory.pending_proactive_message, 900);
  if (pendingMessage && acceptsProactiveUpdate(prompt)) {
    await recordAssistantMemory({
      channel: "whatsapp",
      channelUser: message.from,
      memory: { pending_proactive_message: "", pending_proactive_update_key: "", pending_proactive_sent_at: "" },
      source: "assistant_proactive_opened",
    });
    return sendWhatsAppMessage(message.from, pendingMessage);
  }
  const pendingAction = pendingMemory.pending_assistant_action;
  if (linkedConnection && isActivePendingAction(pendingAction) && acceptsPendingActionConfirmation(prompt)) {
    let delivery = null;
    try {
      delivery = await deliverPendingAssistantAction(linkedConnection, pendingAction, pendingMemory);
    } catch (error) {
      if (semanticPersistenceRequired()) throw error;
    }
    return sendPlanReply(message.from, pendingActionConfirmationPlan(pendingAction), delivery);
  }
  const result = await callBlankedAgent(prompt, message.from, linkedConnection);
  const plan = result.plan;
  try {
    await recordAssistantConversationTurn({
      channel: "whatsapp",
      channelUser: message.from,
      previousState: result.context.memory?.conversation_state,
      userMessage: prompt,
      assistantMessage: plan.message_text || plan.response_text || "",
      semanticState: plan.semantic_state,
      expectedVersion: result.context.memory?.semantic_store_version,
      topic: result.context.memory?.last_topic || "",
    });
  } catch (error) {
    if (semanticPersistenceRequired()) throw error;
    // Short-term memory must never block the user-facing reply.
  }
  if (plan.blocking_user_request === true) {
    try {
      await recordAssistantMemory({
        channel: "whatsapp",
        channelUser: message.from,
        memory: {
          pending_blocking: plan.blocking_ready === false
            ? { ...(plan.blocking_data || {}), updated_at: new Date().toISOString() }
            : null,
        },
        source: plan.blocking_ready === false ? "blocking_details_requested" : "blocking_contract_completed",
      });
    } catch (_) {
      // Pending blocking state must never block the user-facing reply.
    }
  }
  let queued = null;
  try {
    const committedVersion = result.context.memory?.semantic_store_version + 1;
    queued = await queuePendingAssistantAction(linkedConnection, plan, prompt, "wa", null, committedVersion);
    const invalidatesQueuedAction = plan.semantic_state?.intent === "cancelled"
      || (plan.semantic_state?.intent === "block" && ["collecting", "awaiting_confirmation"].includes(plan.semantic_state?.status));
    if (!queued && linkedConnection?.connectCode && invalidatesQueuedAction) {
      const invalidation = await recordPendingAssistantAction({
        channel: linkedConnection.channel,
        channelUser: linkedConnection.channelUser,
        pending: null,
        expectedVersion: committedVersion,
        source: "assistant_action_invalidated",
      });
      if (!invalidation.enqueued) return sendWhatsAppMessage(message.from, supersededAssistantReply(plan));
    }
  } catch (error) {
    if (semanticPersistenceRequired()) throw error;
  }
  return sendPlanReply(message.from, plan, queued);
}

// Called only after the provider signature has been checked by the ingress.
// The access check is repeated here so an internal caller cannot bypass it.
async function processTrustedQaMessage(message) {
  if (!isFinalQaWhatsApp("whatsapp", message?.from)) {
    return { skipped: true, reason: "bm_final_qa_not_allowed" };
  }
  if (!message?.id) return { skipped: true, reason: "bm_final_qa_message_id_required" };
  const claim = await claimAssistantInboundMessage("whatsapp", message.from, message.id);
  if (!claim.claimed) return { skipped: true, reason: "duplicate_inbound" };
  let result;
  try {
    result = await processMessage(message);
  } catch (error) {
    await releaseAssistantInboundMessage("whatsapp", message.from, message.id).catch(() => null);
    throw error;
  }
  const deliveryFailed = result?.skipped === true && /credentials|template_requires/i.test(result.reason || "")
    || result?.text?.skipped === true && /credentials|template_requires/i.test(result.text.reason || "");
  if (!deliveryFailed) await completeAssistantInboundMessage("whatsapp", message.from, message.id);
  return result;
}

async function processTrustedAppMessage(message) {
  if (!await isFinalAppLinkedWhatsApp("whatsapp", message?.from, message?.text)) {
    return { skipped: true, reason: "bm_final_app_not_linked" };
  }
  if (!message?.id) return { skipped: true, reason: "bm_final_message_id_required" };
  const claim = await claimAssistantInboundMessage("whatsapp", message.from, message.id);
  if (!claim.claimed) return { skipped: true, reason: "duplicate_inbound" };
  let result;
  try {
    result = await processMessage(message);
  } catch (error) {
    await releaseAssistantInboundMessage("whatsapp", message.from, message.id).catch(() => null);
    throw error;
  }
  const deliveryFailed = result?.skipped === true && /credentials|template_requires/i.test(result.reason || "")
    || result?.text?.skipped === true && /credentials|template_requires/i.test(result.text.reason || "");
  if (!deliveryFailed) await completeAssistantInboundMessage("whatsapp", message.from, message.id);
  return result;
}

exports.handler = async (event) => {
  // In production every public Meta webhook uses the same per-sender gate.
  if (isProductionEnvironment() || privateQaGateConfigured()) return require("./waitlist-agent").handler(event);
  if (event.httpMethod === "GET") return verifyChallenge(event);
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: json(200, {}).headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });
  if (!verifySignature(event)) return json(403, { error: "invalid_whatsapp_signature" });

  try {
    const body = parseJsonBody(event);
    if (!body || typeof body !== "object" || Array.isArray(body)) return json(400, { error: "invalid_whatsapp_payload" });
    const messages = incomingMessages(body);
    const results = [];
    const seenInRequest = new Set();
    for (const message of messages.slice(0, 5)) {
      if (message.id) {
        if (seenInRequest.has(message.id)) {
          results.push({ skipped: true, reason: "duplicate_inbound" });
          continue;
        }
        seenInRequest.add(message.id);
        try {
          const claim = await claimAssistantInboundMessage("whatsapp", message.from, message.id);
          if (!claim.claimed) {
            results.push({ skipped: true, reason: "duplicate_inbound" });
            continue;
          }
        } catch (_) {
          // A temporary memory outage must not discard an inbound message.
        }
      }
      let result;
      try {
        result = await processMessage(message);
      } catch (error) {
        try { await releaseAssistantInboundMessage("whatsapp", message.from, message.id); } catch (_) { /* Return failure; never deliver an uncommitted action. */ }
        throw error;
      }
      results.push(result);
      const deliveryFailed = result?.skipped === true && /credentials|template_requires/i.test(result.reason || "")
        || result?.text?.skipped === true && /credentials|template_requires/i.test(result.text.reason || "");
      if (message.id && !deliveryFailed) {
        try {
          await completeAssistantInboundMessage("whatsapp", message.from, message.id);
        } catch (_) {
          // Inbound idempotency is best effort when memory persistence is unavailable.
        }
      }
    }
    return json(200, { ok: true, received: Math.min(messages.length, 5), results });
  } catch (error) {
    return json(500, { error: "whatsapp_agent_failed", detail: error.message });
  }
};

exports.acceptsPendingActionConfirmation = acceptsPendingActionConfirmation;
exports.pendingActionConfirmationPlan = pendingActionConfirmationPlan;
exports.processTrustedQaMessage = processTrustedQaMessage;
exports.processTrustedAppMessage = processTrustedAppMessage;
exports.whatsappReplyText = whatsappReplyText;
// The app transport shares the exact BM Final planner, semantic memory and
// pending-action delivery path. It supplies its own authenticated ingress and
// renders its own output, so no WhatsApp message is sent for an in-app turn.
exports.callBlankedAgent = callBlankedAgent;
exports.queuePendingAssistantAction = queuePendingAssistantAction;
