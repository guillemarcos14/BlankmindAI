const crypto = require("crypto");
const { json, requireMethod } = require("./_membership");
const { userByPhone, phoneForStorage } = require("./_waitlist_store");
const { isFinalQaWhatsApp, privateQaGateConfigured } = require("./_bm_final_qa_access");
const {
  enqueueTwilioMessage,
  shouldUseAsyncTwilio,
} = require("./_waitlist_whatsapp");
const { processMessage: processWaitlistMessage } = require("./waitlist-agent");
const { handler: blankedAgentHandler } = require("./blanked-agent");
const { freshConversationState, deriveAppPresence, buildAgentContext } = require("./bm-context");
const { reviewActionLink } = require("./_bm_action_link");
const { sendAssistantActionPush } = require("./_assistant_push");
const { semanticPersistenceRequired } = require("./_bm_semantic_store");
const { enrichAssistantContext } = require("./_bm_user_context");
const { proposalFingerprint, buildSemanticActions, buildSemanticReviewAction } = require("./bm-semantic-state");
const {
  hasSelectedDistractions,
  onboardingMessages,
  queueOnboardingPicker,
  markOnboardingDispatched,
  onboardingProgress,
  dispatchWhatsAppOnboarding,
  shouldSendOnboarding,
} = require("./bm-onboarding");
const {
  PENDING_ASSISTANT_ACTION_TYPES,
  firstPendingAction,
  pendingActionFromPlan,
} = require("./bm-pending-action");
const {
  attachAssistantUserContext,
  claimAssistantInboundMessage,
  connectCodeFromText,
  completeAssistantInboundMessage,
  releaseAssistantInboundMessage,
  ensureAssistantConnectionForPhone,
  getAssistantMemory,
  getAssistantUserContext,
  recordAssistantConversationTurn,
  recordAssistantChannel,
  recordAssistantMemory,
  recordPendingAssistantAction,
  supersededAssistantReply,
  recordAssistantUserContext,
  sendWhatsAppMessage,
} = require("./_assistant_channel");

function text(statusCode, body, contentType = "text/plain; charset=utf-8") {
  return {
    statusCode,
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
    },
    body,
  };
}

function rawBody(event) {
  if (!event.body) return "";
  return event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
}

function parseSmsBody(event) {
  const headers = event.headers || {};
  const contentType = headers["content-type"] || headers["Content-Type"] || "";
  const raw = rawBody(event);
  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(raw || "{}");
      const media = mediaItemsFromObject(parsed);
      return {
        from: cleanText(parsed.from || parsed.From, 80),
        body: cleanText(parsed.body || parsed.Body || parsed.text, 800),
        messageSid: cleanText(parsed.messageSid || parsed.MessageSid || parsed.SmsMessageSid, 80),
        media,
      };
    } catch {
      return { from: "", body: "", messageSid: "", media: [] };
    }
  }

  const params = new URLSearchParams(raw);
  const media = mediaItemsFromParams(params);
  return {
    from: cleanText(params.get("From") || params.get("from"), 80),
    body: cleanText(params.get("Body") || params.get("body"), 800),
    messageSid: cleanText(params.get("MessageSid") || params.get("SmsMessageSid") || params.get("MessageID"), 80),
    media,
  };
}

function channelFromSender(from) {
  return cleanText(from, 90).toLowerCase().startsWith("whatsapp:") ? "whatsapp" : "sms";
}

function cleanText(value, maxLength = 240) {
  return String(value || "").trim().slice(0, maxLength);
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

function mediaItemsFromObject(parsed) {
  const items = [];
  const count = Number(parsed.NumMedia || parsed.numMedia || 0);
  for (let index = 0; index < Math.min(Math.max(count || 0, 0), 10); index += 1) {
    const url = cleanText(parsed[`MediaUrl${index}`] || parsed[`mediaUrl${index}`], 1200);
    const contentType = cleanText(parsed[`MediaContentType${index}`] || parsed[`mediaContentType${index}`], 120);
    if (url) items.push({ url, contentType });
  }
  if (Array.isArray(parsed.media)) {
    for (const item of parsed.media.slice(0, 10)) {
      const url = cleanText(item?.url || item?.mediaUrl, 1200);
      const contentType = cleanText(item?.contentType || item?.mediaContentType, 120);
      if (url) items.push({ url, contentType });
    }
  }
  return items;
}

function mediaItemsFromParams(params) {
  const items = [];
  const count = Number(params.get("NumMedia") || params.get("numMedia") || 0);
  for (let index = 0; index < Math.min(Math.max(count || 0, 0), 10); index += 1) {
    const url = cleanText(params.get(`MediaUrl${index}`) || params.get(`mediaUrl${index}`), 1200);
    const contentType = cleanText(params.get(`MediaContentType${index}`) || params.get(`mediaContentType${index}`), 120);
    if (url) items.push({ url, contentType });
  }
  return items;
}

function audioMedia(media) {
  return (Array.isArray(media) ? media : []).find((item) => /^audio\//i.test(item.contentType || ""));
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

function twilioAuthHeader() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return "";
  return `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
}

async function downloadTwilioMedia(item) {
  const headers = {};
  const authorization = twilioAuthHeader();
  if (authorization) headers.authorization = authorization;
  const response = await fetch(item.url, { headers });
  if (!response.ok) {
    throw new Error(`twilio_media_download_failed_${response.status}`);
  }
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 24 * 1024 * 1024) {
    throw new Error("twilio_audio_too_large");
  }
  return Buffer.from(await response.arrayBuffer());
}

async function transcribeAudio(item) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const audio = await downloadTwilioMedia(item);
  if (audio.length > 24 * 1024 * 1024) {
    throw new Error("twilio_audio_too_large");
  }

  const contentType = item.contentType || "application/octet-stream";
  const extension = audioExtension(contentType);
  const form = new FormData();
  form.append("model", process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1");
  form.append("file", new Blob([audio], { type: contentType }), `whatsapp-audio.${extension}`);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
  const raw = await response.text();
  let parsed = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch (_) {
    parsed = {};
  }
  if (!response.ok) {
    throw new Error(`openai_transcription_failed_${response.status}:${cleanText(parsed.error?.message || raw, 180)}`);
  }
  const transcript = cleanText(parsed.text, 800);
  if (!transcript) throw new Error("twilio_transcription_empty");
  return transcript;
}

function twiml(message) {
  const messages = Array.isArray(message) ? message : [message];
  const body = messages.filter(Boolean).map((item) => `<Message><Body>${escapeXml(item)}</Body></Message>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

async function handleWaitlistMessage(event, parsedBody, options = {}) {
  if (!options.force) {
    let user;
    try {
      user = await userByPhone(parsedBody.from);
    } catch (_) {
      return null;
    }
    if (!user || user.status !== "active" || user.data_consent !== true || user.whatsapp_consent !== true) {
      return null;
    }
  }

  const message = {
    provider: "twilio",
    providerMessageId: parsedBody.messageSid || null,
    phone: parsedBody.from.replace(/^whatsapp:/i, ""),
    channel: channelFromSender(parsedBody.from),
    text: parsedBody.body,
    audio: audioMedia(parsedBody.media) || null,
  };

  if (shouldUseAsyncTwilio()) {
    await enqueueTwilioMessage(message, event);
    return text(200, '<?xml version="1.0" encoding="UTF-8"?><Response></Response>', "application/xml; charset=utf-8");
  }

  if (isFinalQaWhatsApp(message.channel, message.phone)) {
    await require("./_bm_final_qa_dispatch").processFinalTwilioMessage(message);
    return text(200, twiml(""), "application/xml; charset=utf-8");
  }

  const result = await processWaitlistMessage(message);
  return text(200, twiml(result.reply || ""), "application/xml; charset=utf-8");
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function isProductionEnvironment() {
  return process.env.NODE_ENV === "production"
    || process.env.CONTEXT === "production"
    || process.env.NETLIFY === "true";
}

function header(event, name) {
  const target = name.toLowerCase();
  const match = Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === target);
  return match ? String(match[1] || "") : "";
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(left || "");
  const rightBuffer = Buffer.from(right || "");
  if (!leftBuffer.length || leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function twilioWebhookUrl(event) {
  const configured = cleanText(process.env.TWILIO_WEBHOOK_URL, 600);
  if (configured) return configured;
  const protocol = header(event, "x-forwarded-proto") || "https";
  const host = header(event, "x-forwarded-host") || header(event, "host");
  const path = event.path || "/.netlify/functions/sms-agent";
  return host ? `${protocol}://${host}${path}` : "";
}

function verifyTwilioSignature(event) {
  const configured = process.env.TWILIO_VALIDATE_WEBHOOK_SIGNATURE;
  const shouldValidate = isProductionEnvironment() || privateQaGateConfigured() || configured === "true";
  if (!shouldValidate) return true;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const signature = header(event, "x-twilio-signature");
  const url = twilioWebhookUrl(event);
  if (!token || !signature || !url) return false;
  const params = new URLSearchParams(rawBody(event));
  const canonical = Array.from(params.entries())
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
    .map(([key, value]) => `${key}${value}`)
    .join("");
  const expected = crypto.createHmac("sha1", token).update(`${url}${canonical}`, "utf8").digest("base64");
  return timingSafeEqual(signature, expected);
}

function actionIntro(actions) {
  const first = primaryAction(actions);
  if (!first) return "";
  if (first.type === "set_daily_limit") return "Open Blankmind to review the daily limit.";
  if (first.type === "apply_schedule") return "Open Blankmind to review the protection window.";
  if (first.type === "start_protection") return "Open Blankmind to start the block.";
  if (first.type === "open_app_picker" || first.type === "request_screen_time_permission") return "Open Blankmind to finish setup.";
  return "Open Blankmind to review the next step.";
}

function minuteText(value) {
  const minute = clamp(value, 0, 1439);
  const hour24 = Math.floor(minute / 60);
  const minutePart = String(minute % 60).padStart(2, "0");
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${minutePart} ${suffix}`;
}

function appTargetText(appNames = []) {
  const names = Array.isArray(appNames) ? appNames.filter(Boolean).slice(0, 4) : [];
  if (names.length === 1) return names[0];
  if (names.length > 1) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return "selected apps";
}

function actionSentence(actions, appNames = []) {
  const first = primaryAction(actions);
  if (!first) return "";
  if (first.type === "apply_schedule") {
    return `This opens Blankmind with a protection window for ${appTargetText(appNames)} from ${minuteText(first.start_minute)} to ${minuteText(first.end_minute)}.`;
  }
  if (first.type === "start_protection") {
    return Number.isFinite(first.minutes)
      ? `This opens Blankmind with a ${first.minutes}-minute app block ready to review.`
      : "This opens Blankmind with an app block ready to review.";
  }
  if (first.type === "request_screen_time_permission") {
    return "This opens Blankmind so you can grant blocking permission, then tell me when it is ready to continue.";
  }
  if (first.type === "open_app_picker") {
    return "This opens Blankmind so you can choose the apps to block.";
  }
  if (first.type === "set_daily_limit") {
    return Number.isFinite(first.minutes)
      ? `This opens Blankmind with a ${first.minutes}-minute daily limit ready to review.`
      : "This opens Blankmind to review the daily limit.";
  }
  if (first.type === "enable_allow_only") return "This opens Blankmind so you can turn on Allow Only.";
  if (first.type === "enable_adult_filter") return "This opens Blankmind so you can turn on adult web protection.";
  if (first.type === "pause_rules") return "This opens Blankmind so you can pause scheduled protection.";
  if (first.type === "disable_pause") return "This opens Blankmind so you can resume scheduled protection.";
  return "This opens Blankmind so you can review the next step.";
}

function voiceActionText(actions, appNames, link) {
  const summary = actionSentence(actions, appNames);
  const intro = actionIntro(actions);
  if (!summary || !link) return "";
  return `${summary}\n\n${intro}\n${link}`;
}

function voiceActionCue(actions, appNames = []) {
  const summary = actionSentence(actions, appNames);
  if (!summary) return "";
  return `${summary} I left the link in the text message.`;
}

function whatsappActionButtonVariables(link) {
  let linkPath = link;
  try {
    const parsed = new URL(link);
    linkPath = `${parsed.pathname.replace(/^\//, "")}${parsed.search}`;
  } catch (_) {
    linkPath = link.replace(/^https?:\/\/[^/]+\//i, "");
  }
  const configured = cleanText(process.env.TWILIO_WHATSAPP_ACTION_CONTENT_VARIABLES, 1000);
  if (configured) {
    try {
      const parsed = JSON.parse(configured);
      return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [
        key,
        String(value)
          .replace(/\{\{link\}\}/g, link)
          .replace(/\{\{link_path\}\}/g, linkPath),
      ]));
    } catch (_) {
      return { "1": linkPath };
    }
  }
  return { "1": linkPath };
}

function smsCommand(text) {
  const value = cleanText(text, 40).toUpperCase();
  return ["BLOCK", "START", "OPEN", "REPORT"].includes(value) ? value : "";
}

function commandForAction(actions) {
  const first = primaryAction(actions);
  if (!first) return "OPEN";
  if (["start_protection", "apply_schedule", "open_app_picker", "request_screen_time_permission", "enable_allow_only"].includes(first.type)) {
    return "BLOCK";
  }
  if (first.type === "set_daily_limit") return "START";
  return "OPEN";
}

function smsActionCue(actions) {
  const command = commandForAction(actions);
  if (command === "BLOCK") return "Reply BLOCK to open Blankmind with this ready.";
  if (command === "START") return "Reply START to open Blankmind with this ready.";
  return "Reply OPEN to review it in Blankmind.";
}

function pendingActionFromMemory(memory = {}, now = Date.now()) {
  const link = cleanText(memory.pending_action_link, 1200);
  if (!link) return null;
  const expires = Date.parse(memory.pending_action_expires_at || "");
  if (!Number.isFinite(expires) || expires <= now || expires > now + 2 * 60 * 60 * 1000) return null;
  const state = freshConversationState(memory.conversation_state, now)?.semantic_state;
  if (!state || !["ready", "needs_setup"].includes(state.status)) return null;
  const fingerprint = proposalFingerprint(state);
  if (memory.pending_proposal_fingerprint !== fingerprint || state.slots?.confirmation?.value?.fingerprint !== fingerprint) return null;
  const reviewOnlyAppPresence = state.status === "needs_setup" && state.next_question === "app_presence";
  if (!reviewOnlyAppPresence && !deriveAppPresence(memory.user_context?.app_presence, now).recent) return null;
  try {
    const url = new URL(link);
    const allowed = new URL(process.env.BLANKED_PUBLIC_APP_LINK_BASE || "https://getblank.netlify.app");
    if (url.origin !== allowed.origin || url.pathname !== `${allowed.pathname.replace(/\/$/, "")}/open`
      || url.searchParams.get("action") !== "review-action") return null;
    const actions = state.status === "ready" ? buildSemanticActions(state, buildAgentContext({ ...(memory.user_context || {}), channel: "sms" }))
      : reviewOnlyAppPresence ? buildSemanticReviewAction(state, buildAgentContext({ ...(memory.user_context || {}), channel: "sms" }))
        : state.next_question === "permissions" ? [{ type: "request_screen_time_permission" }]
        : state.next_question === "app_selection" ? [{ type: "open_app_picker" }] : [];
    const expectedLink = actionDeepLink(actions, state.slots?.apps?.value || []);
    if (!expectedLink) return null;
    const expected = new URL(expectedLink);
    url.searchParams.sort();
    expected.searchParams.sort();
    if (url.href !== expected.href) return null;
  } catch (_) { return null; }
  return {
    link,
    summary: cleanText(memory.pending_action_summary, 500),
    command: cleanText(memory.pending_action_command, 20).toUpperCase() || "OPEN",
  };
}

async function smsCommandReply(from, command) {
  let memory = {};
  try {
    memory = await getAssistantMemory("sms", from);
  } catch (error) {
    if (semanticPersistenceRequired()) throw error;
    memory = {};
  }
  const pending = pendingActionFromMemory(memory);
  if (command === "REPORT" && !pending) {
    return { text: "Tell me what you want to review, and I will turn it into a Blankmind next step." };
  }
  if (!pending) {
    return { text: "No pending Blankmind action. Tell me what you want to block or change." };
  }
  if (command !== "OPEN" && command !== pending.command && !(command === "START" && pending.command === "BLOCK")) {
    return { text: `I have one Blankmind action ready. Reply ${pending.command} or OPEN to continue.` };
  }
  try {
    await recordAssistantMemory({
      channel: "sms",
      channelUser: from,
      memory: {
        pending_action_link: null,
        pending_action_summary: null,
        pending_action_command: null,
        pending_proposal_fingerprint: null,
        pending_action_expires_at: null,
      },
      source: command,
    });
  } catch (_) {
    // Clearing a pending action must never block delivery.
  }
  const intro = pending.summary ? `${pending.summary}\n\n` : "";
  return { text: `${intro}Open Blankmind: ${pending.link}` };
}

function voiceInputSummary(prompt) {
  const value = cleanText(prompt, 160);
  return value ? `I understood your voice note as "${value}".` : "";
}

function withVoiceInputContext(text, prompt) {
  const summary = voiceInputSummary(prompt);
  if (!summary) return text;
  return `${summary}\n\n${text}`;
}

function naturalReplyText(text) {
  return cleanText(text, 1400)
    .replace(/\b(Read|Pattern|Move|Signal|Feedback|Protection|Lectura|Patrón|Movimiento|Señal|Protección):\s*/gi, "")
    .replace(/\bAction:\s*/gi, "")
    .replace(/\bI prepared a Blankmind link\b/gi, "This Blankmind link")
    .replace(/\bI[’']ll give you one concrete Blankmind action for it\.?/gi, "I prepared the next step in Blankmind for it.")
    .replace(/\bone concrete Blankmind action\b/gi, "a simple next step in Blankmind")
    .trim();
}

function pendingAssistantActionFromPlan(plan, appNames = []) {
  return pendingActionFromPlan(plan, { idPrefix: "wa" });
}

// Transport-only receipts must not become part of the durable action payload.
const deliveryPushReceipts = new WeakMap();
async function queuePendingAssistantAction(connection, plan, appNames, expectedVersion) {
  if (!connection?.connectCode) return null;
  const pending = pendingAssistantActionFromPlan(plan, appNames);
  if (!pending) return null;
  const memory = await getAssistantMemory(connection.channel, connection.channelUser);
  const existing = memory.pending_assistant_action;
  async function deliver(action) {
    let push;
    try { push = await sendAssistantActionPush(memory.assistant_device_push, action); }
    catch (_) { push = { sent: false, reason: "push_failed" }; }
    deliveryPushReceipts.set(action, push || { sent: false, reason: "push_receipt_missing" });
    return action;
  }
  if (semanticPersistenceRequired()) {
    const next = pending;
    const receipt = await recordPendingAssistantAction({ channel: connection.channel, channelUser: connection.channelUser,
      pending: next, expectedVersion });
    if (!receipt.enqueued) return { ...next, status: "superseded" };
    return deliver(next);
  }
  if (existing?.fingerprint === pending.fingerprint && Date.parse(existing.expires_at || "") > Date.now()) {
    return deliver(existing);
  }
  await recordAssistantMemory({
    channel: connection.channel,
    channelUser: connection.channelUser,
    memory: { pending_assistant_action: pending },
    source: "assistant_action_pending",
  });
  return deliver(pending);
}

function whatsappReplyText(plan, fallbackText, delivery = null, channel = "sms") {
  return require("./_assistant_reply").assistantReplyText({ ...plan, message_text: plan.message_text || plan.response_text || fallbackText }, delivery, channel);
}

function whatsappSetupButton(plan, appNames = []) {
  const action = (Array.isArray(plan.actions) ? plan.actions : [])
    .find(item => item && ["open_app_picker", "request_screen_time_permission"].includes(item.type));
  if (!action) return null;
  const link = reviewActionLink(action, appNames);
  const contentSid = cleanText(process.env.TWILIO_WHATSAPP_ACTION_CONTENT_SID, 80);
  if (!link || !contentSid) return null;
  return {
    contentSid,
    contentVariables: whatsappActionButtonVariables(link),
  };
}

async function recordMessageConnection(connectCode, from, channel) {
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
      preferredChannel: channel,
      connectCode,
      channelUser: from,
    });
    const attachedContext = await attachAssistantUserContext({ connectCode, channel, channelUser: from });
    context = attachedContext && Object.keys(attachedContext).length ? attachedContext : previousMemory.user_context || {};
  } catch (_) {
    // Connection delivery must not depend on the context snapshot being available.
  }
  return {
    firstConnection: shouldSendOnboarding(previousMemory),
    context: context || {},
    onboardingProgress: onboardingProgress(previousMemory),
  };
}

async function connectionOnboarding(channel, from, connection = {}) {
  if (connection.firstConnection === false) return null;
  const context = connection.context || {};
  const messages = onboardingMessages(context);
  const selected = hasSelectedDistractions(context);
  let queued = null;
  if (!selected) {
    try {
      queued = await queueOnboardingPicker({ channel, channelUser: from, messages });
    } catch (_) {
      // The visible copy remains useful even when the action store or APNs is unavailable.
    }
  }
  return {
    messages: [messages.welcome, selected ? messages.ready : messages.setup],
    button: queued?.button || null,
    progress: connection.onboardingProgress || {},
  };
}

function namedApps(text) {
  const value = ` ${cleanText(text, 800).toLowerCase()} `;
  const apps = [
    ["tiktok", "TikTok"],
    ["tik tok", "TikTok"],
    ["instagram", "Instagram"],
    ["insta", "Instagram"],
    ["youtube", "YouTube"],
    ["yt", "YouTube"],
    ["reddit", "Reddit"],
    ["twitter", "Twitter"],
    ["facebook", "Facebook"],
    ["snapchat", "Snapchat"],
  ];
  return Array.from(new Set(apps.filter(([key]) => value.includes(` ${key} `) || value.includes(key)).map(([, app]) => app)));
}

function minuteOfDay(hour, minute, meridiem) {
  if (!Number.isFinite(hour) || hour < 1 || hour > 12 || !Number.isFinite(minute) || minute < 0 || minute > 59) return null;
  const normalized = meridiem === "pm" && hour !== 12 ? hour + 12 : meridiem === "am" && hour === 12 ? 0 : hour;
  return normalized * 60 + minute;
}

function lunchEndMinute(text) {
  const value = cleanText(text, 800).toLowerCase();
  if (!/(lunch|comida|comer|almuerzo)/i.test(value)) return null;
  const matches = [...value.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi)];
  if (!matches.length) return null;
  const match = matches[matches.length - 1];
  const hour = Number(match[1]);
  const meridiem = match[3] || (hour >= 8 && hour <= 11 ? "am" : "pm");
  return minuteOfDay(hour, Number(match[2] || 0), meridiem);
}

function memoryFactsFromText(text) {
  const value = cleanText(text, 800).toLowerCase();
  const apps = namedApps(text);
  const lunchMinute = lunchEndMinute(text);
  const facts = {};
  const name = cleanText(text, 800).match(/\b(?:my name is|call me|me llamo|ll[aá]mame)\s+([A-Za-zÀ-ÖØ-öø-ÿ]{2,32})\b/i);
  if (name) facts.profile_name = name[1];
  const age = cleanText(text, 800).match(/\b(?:i(?:'|’)m|i am)\s+(\d{1,2})\s+years?\s+old\b|\btengo\s+(\d{1,2})\s+a[ñn]os\b/i);
  const exactAge = Number(age?.[1] || age?.[2]);
  if (Number.isInteger(exactAge) && exactAge >= 13 && exactAge <= 99) {
    facts.age = exactAge;
    facts.age_range = exactAge < 18 ? "Under 18" : exactAge < 25 ? "18-24" : exactAge < 35 ? "25-34" : exactAge < 45 ? "35-44" : "45+";
  }
  const goal = cleanText(text, 800).match(/\b(?:i want to|i'd like to|quiero|me gustar[ií]a)\s+([^.!?]{5,120})/i);
  if (goal) facts.declared_goal = cleanText(goal[1], 120);
  if (/(sleep|bed|night|dormir|duermo|cama|noche)/i.test(value)) facts.last_topic = "sleep";
  else if (/(scroll|social|instagram|tiktok|youtube|reddit|reels|shorts|redes)/i.test(value)) facts.last_topic = "social";
  else if (/(focus|work|study|foco|trabaj|estudi)/i.test(value)) facts.last_topic = "focus";
  if (apps.length) facts.main_apps = apps;
  if (lunchMinute != null) {
    facts.lunch_end_minute = lunchMinute;
    facts.weak_hours = [Math.floor(lunchMinute / 60)];
  }
  return facts;
}

async function askBAI(prompt, from, channel, linkedConnection = null) {
  let savedMemory = {};
  try {
    savedMemory = await getAssistantMemory(channel, from);
  } catch (error) {
    if (semanticPersistenceRequired()) throw error;
    savedMemory = {};
  }
  const newFacts = memoryFactsFromText(prompt);
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
  const connectCode = linkedConnection?.connectCode || savedMemory.assistant_connect_code;
  let sharedContext = {};
  if (connectCode) {
    try { sharedContext = await getAssistantUserContext(connectCode); } catch (_) { /* Conversation remains available. */ }
  }
  const enrichedContext = await enrichAssistantContext(
    { ...storedUserContext, ...sharedContext },
    connectCode,
  );
  const userContext = {
    ...enrichedContext,
    profile_name: newFacts.profile_name || sharedContext.profile_name || savedMemory.profile_name || enrichedContext.profile_name,
    age_range: newFacts.age_range || sharedContext.age_range || savedMemory.age_range || enrichedContext.age_range,
    personal_profile: {
      ...(enrichedContext.personal_profile || {}),
      ...(sharedContext.personal_profile || {}),
      ...(Number.isInteger(newFacts.age || savedMemory.age) ? { age: newFacts.age || savedMemory.age } : {}),
      ...((newFacts.declared_goal || savedMemory.declared_goal) ? { goal: newFacts.declared_goal || savedMemory.declared_goal } : {}),
    },
  };
  if (connectCode && (newFacts.profile_name || newFacts.age || newFacts.declared_goal)) {
    try {
      await recordAssistantUserContext({
        connectCode, channel, userPhone: from,
        context: { ...sharedContext, ...userContext },
      });
    } catch (_) { /* Profile persistence must not block the reply. */ }
  }
  const response = await blankedAgentHandler({
    httpMethod: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt,
      locale: language === "es" ? "es-ES" : "en-US",
      context: {
        ...userContext,
        channel,
        assistant_channel: channel,
        language,
        allow_spanish_response: true,
        has_selected_apps: userContext.has_selected_apps === true,
        screen_time_authorized: userContext.screen_time_authorized === true,
        user_context: userContext,
        memory,
        recent_messages: conversationState?.recent_messages || [],
      },
    }),
  });

  if (Object.keys(newFacts).length || savedMemory.language !== language) {
    try {
      await recordAssistantMemory({ channel, channelUser: from, memory: { ...newFacts, language }, source: prompt });
    } catch (_) {
      // Memory must never block a reply.
    }
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const fallback = "BM could not read that yet. Try again in a moment.";
    return { text: fallback };
  }
  const parsed = JSON.parse(response.body || "{}");
  const plan = parsed.plan || {};
  if (plan.blocking_user_request === true) {
    try {
      await recordAssistantMemory({
        channel,
        channelUser: from,
        memory: {
          pending_blocking: plan.blocking_ready === false
            ? { ...(plan.blocking_data || {}), updated_at: new Date().toISOString() }
            : null,
          language,
        },
        source: plan.blocking_ready === false ? "blocking_details_requested" : "blocking_contract_completed",
      });
    } catch (_) {
      // Pending blocking state must never block the user-facing reply.
    }
  }
  const message = naturalReplyText(plan.message_text || plan.response_text);
  try {
    await recordAssistantConversationTurn({
      channel,
      channelUser: from,
      previousState: savedMemory.conversation_state,
      userMessage: prompt,
      assistantMessage: message,
      semanticState: plan.semantic_state,
      expectedVersion: savedMemory.semantic_store_version,
      topic: memory.last_topic || "",
    });
  } catch (error) {
    if (semanticPersistenceRequired()) throw error;
    // Short-term memory must never block the user-facing reply.
  }
  const actions = plan.actions || [];
  const responseApps = Array.isArray(plan.blocking_data?.apps)
    ? plan.blocking_data.apps
    : Array.isArray(plan.semantic_state?.slots?.apps?.value) ? plan.semantic_state.slots.apps.value : memory.main_apps;
  const actionLink = actionDeepLink(actions, responseApps, plan.blocking_data);
  const modelFollowup = naturalReplyText(plan.followup_text || "");
  const primaryPendingAction = (Array.isArray(actions) ? actions : []).find((item) => item && PENDING_ASSISTANT_ACTION_TYPES.has(item.type));
  const existingPendingAction = memory.pending_assistant_action;
  const isRecurrenceReply = /^(?:just\s+)?(?:once|one\s+time|single\s+time|daily|every\s+day|recurring|for\s+\d+\s+days?)\b/i.test(prompt.trim());
  let queuedAction = null;
  if (channel === "whatsapp" || channel === "sms") {
    try {
      queuedAction = await queuePendingAssistantAction(linkedConnection, plan, responseApps, savedMemory.semantic_store_version + 1);
      if (queuedAction?.status === "superseded") return { text: supersededAssistantReply(plan) };
      const invalidatesQueuedAction = plan.semantic_state?.intent === "cancelled"
        || (plan.semantic_state?.intent === "block" && ["collecting", "awaiting_confirmation"].includes(plan.semantic_state?.status));
      if (!queuedAction && linkedConnection?.connectCode && invalidatesQueuedAction) {
        const invalidation = await recordPendingAssistantAction({
          channel,
          channelUser: from,
          pending: null,
          expectedVersion: savedMemory.semantic_store_version + 1,
          source: "assistant_action_invalidated",
        });
        if (!invalidation.enqueued) return { text: supersededAssistantReply(plan) };
      }
    } catch (error) {
      if (semanticPersistenceRequired()) throw error;
    }
  }
  // A cancellation or a capability answer must not resurrect the memory snapshot's old action.
  const effectivePendingAction = primaryPendingAction || queuedAction;
  const delivery = queuedAction ? { action: queuedAction, push: deliveryPushReceipts.get(queuedAction) } : null;
  const duplicatePendingRequest = Boolean(
    channel === "whatsapp"
      && primaryPendingAction
      && queuedAction?.fingerprint
      && existingPendingAction?.fingerprint === queuedAction.fingerprint
      && !isRecurrenceReply
  );
  if (channel === "whatsapp") {
    if (duplicatePendingRequest) {
      try {
        const invalidation = await recordPendingAssistantAction({
          channel,
          channelUser: from,
          pending: null,
          expectedVersion: savedMemory.semantic_store_version + 1,
          source: "assistant_action_replaced_by_new_request",
        });
        if (!invalidation.enqueued) return { text: supersededAssistantReply(plan) };
      } catch (_) {
        // The conversational clarification remains safe even if cleanup is unavailable.
      }
      const spanish = String(plan.response_language || plan.semantic_state?.language || "").toLowerCase().startsWith("es");
      return { text: spanish ? "¿Quieres aplicarlo una vez o de forma recurrente?" : "Would you like this once or recurring?" };
    }
    const actionButton = queuedAction ? whatsappSetupButton(plan, responseApps) : null;
    const replyPlan = effectivePendingAction && !primaryPendingAction ? { ...plan, actions: [effectivePendingAction] } : plan;
    const cleanReply = whatsappReplyText(replyPlan, message, delivery, "whatsapp")
      .replace(/\n\n(?:Select the apps to apply it|Selecciona las apps para aplicarlo):\nhttps?:\/\/\S+/i, "")
      .trim();
    if (actionButton) return { text: cleanReply, actionButton };
    return { text: cleanReply };
  }
  if (channel === "sms" && effectivePendingAction) {
    const pendingPlan = primaryPendingAction ? plan : { ...plan, actions: [effectivePendingAction] };
    return { text: whatsappReplyText(pendingPlan, message, delivery) };
  }
  if (channel === "sms" && plan.semantic_state && !actionLink) {
    try {
      await recordAssistantMemory({
        channel, channelUser: from,
        memory: { pending_action_link: null, pending_action_summary: null, pending_action_command: null, pending_proposal_fingerprint: null, pending_action_expires_at: null },
        source: "semantic_proposal_invalidated",
      });
    } catch (_) { /* The authoritative semantic fingerprint already invalidates the cached link. */ }
  }
  if (channel === "sms" && actionLink) {
    const pendingCommand = commandForAction(actions);
    let pendingStored = false;
    try {
      await recordAssistantMemory({
        channel,
        channelUser: from,
        memory: {
          pending_action_link: actionLink,
          pending_action_summary: actionSentence(actions, responseApps),
          pending_action_command: pendingCommand,
          pending_proposal_fingerprint: plan.semantic_state ? proposalFingerprint(plan.semantic_state) : null,
          pending_action_expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          language,
        },
        source: prompt,
      });
      pendingStored = true;
    } catch (_) {
      // SMS should still reply even if pending action storage is unavailable.
    }
    if (!pendingStored) {
      return {
        text: `${message}\n\n${modelFollowup || actionIntro(actions)}\n${actionLink}`,
        actionText: `${actionSentence(actions, responseApps)}\n\n${modelFollowup || actionIntro(actions)}\n${actionLink}`,
      };
    }
    return {
      text: `${message}\n\n${smsActionCue(actions)}`,
      actionText: `${actionSentence(actions, responseApps)}\n\n${modelFollowup || actionIntro(actions)}\n${actionLink}`,
    };
  }
  return {
    text: actionLink ? `${message}\n\n${modelFollowup || actionIntro(actions)}\n${actionLink}` : message,
    actionText: actionLink ? `${actionSentence(actions, responseApps)}\n\n${modelFollowup || actionIntro(actions)}\n${actionLink}` : "",
  };
}

function publicOpenLink(actionName, params = {}) {
  const base = (process.env.BLANKED_PUBLIC_APP_LINK_BASE || "https://getblank.netlify.app").replace(/\/$/, "");
  const query = new URLSearchParams({ action: actionName });
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    query.set(key, String(value));
  }
  return `${base}/open?${query.toString()}`;
}

function appsQuery(appNames) {
  const names = Array.isArray(appNames) ? appNames.filter(Boolean).slice(0, 8) : [];
  return names.length ? `&apps=${encodeURIComponent(names.join(","))}` : "";
}

function actionDeepLink(actions, appNames = [], blockingData = null) {
  if (blockingData && Array.isArray(blockingData.apps)) {
    const contractApps = blockingData.apps.filter((app) => app && !String(app).startsWith("mode:") && app !== "selected_apps");
    if (contractApps.length) appNames = contractApps;
  }
  const first = primaryAction(actions);
  if (!first) return "";

  return reviewActionLink(first, appNames);
}

function primaryAction(actions) {
  const executable = Array.isArray(actions) ? actions.filter((item) => item && item.type && item.type !== "none") : [];
  return executable.find((item) => item.type === "apply_schedule") || executable[0] || null;
}

function clamp(value, lower, upper) {
  const number = Number(value);
  if (!Number.isFinite(number)) return lower;
  return Math.min(Math.max(Math.round(number), lower), upper);
}

exports.handler = async (event) => {
  const methodError = requireMethod(event, "POST");
  if (methodError) return methodError;
  if (!verifyTwilioSignature(event)) return text(403, "invalid_twilio_signature");

  const parsedBody = parseSmsBody(event);
  const { from, body, media, messageSid } = parsedBody;
  if (!from) return json(400, { error: "missing_sms_sender" });
  const sender = phoneForStorage(from);
  const ownSenders = [process.env.TWILIO_WHATSAPP_FROM_NUMBER, process.env.TWILIO_FROM_NUMBER]
    .filter(Boolean).map(phoneForStorage);
  if (sender && ownSenders.includes(sender)) {
    return text(200, '<?xml version="1.0" encoding="UTF-8"?><Response></Response>', "application/xml; charset=utf-8");
  }
  if (isProductionEnvironment() || privateQaGateConfigured()) {
    // Legacy Twilio URLs use the same private QA gate and public waitlist path.
    return handleWaitlistMessage(event, parsedBody, { force: true });
  }
  // Twilio may still point at this legacy endpoint while the waitlist webhook
  // is being rolled over. Route active waitlist users into the same handler so
  // their first reply keeps the waitlist history and facts.
  const waitlistResponse = await handleWaitlistMessage(event, parsedBody);
  if (waitlistResponse) return waitlistResponse;
  if (messageSid) {
    try {
      const claim = await claimAssistantInboundMessage(channelFromSender(from), from, messageSid);
      if (!claim.claimed) {
        return text(200, `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, "application/xml; charset=utf-8");
      }
    } catch (_) {
      // A temporary memory outage must not discard an inbound message.
    }
  }
  const audio = audioMedia(media);
  let prompt = body;
  if (!prompt && audio) {
    try {
      prompt = await transcribeAudio(audio);
    } catch (error) {
      if (messageSid) {
        try { await completeAssistantInboundMessage(channelFromSender(from), from, messageSid); } catch (_) { /* best effort */ }
      }
      return text(200, twiml("I could not understand that voice note yet. Send it as text or try another audio."), "application/xml; charset=utf-8");
    }
  }

  if (!prompt) {
    return json(400, { error: "missing_sms_body" });
  }

  const connectCode = connectCodeFromText(prompt);
  const channel = channelFromSender(from);
  let linkedConnection = null;
  if (!connectCode) {
    try {
      linkedConnection = await ensureAssistantConnectionForPhone({ channel, channelUser: from });
    } catch (_) {
      // Automatic identity matching is additive; legacy CONNECT remains available.
    }
  }
  const command = channel === "sms" ? smsCommand(prompt) : "";
  let reply;
  try {
    reply = connectCode
      ? { onboarding: await connectionOnboarding(channel, from, await recordMessageConnection(connectCode, from, channel)) }
      : command
        ? await smsCommandReply(from, command)
      : await askBAI(prompt, from, channel, linkedConnection);
  } catch (error) {
    try { await releaseAssistantInboundMessage(channel, from, messageSid); } catch (_) { /* Leave the provider request failed. */ }
    throw error;
  }

  if (reply.onboarding) {
    if (channel === "whatsapp") {
      const dispatch = await dispatchWhatsAppOnboarding({
        channel,
        channelUser: from,
        messages: {
          welcome: reply.onboarding.messages[0],
          setup: reply.onboarding.messages[1],
        },
        button: reply.onboarding.button,
        progress: reply.onboarding.progress,
        sendMessage: sendWhatsAppMessage,
      });
      if (messageSid) {
        try { await completeAssistantInboundMessage(channel, from, messageSid); } catch (_) { /* best effort */ }
      }
      if (!dispatch.dispatched) console.warn(`assistant_onboarding_not_dispatched:${cleanText(dispatch.reason, 160)}`);
      return text(200, `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, "application/xml; charset=utf-8");
    }
    if (messageSid) {
      try { await completeAssistantInboundMessage(channel, from, messageSid); } catch (_) { /* best effort */ }
    }
    const onboardingResponse = text(200, twiml(reply.onboarding.messages), "application/xml; charset=utf-8");
    await markOnboardingDispatched(channel, from, {
      welcomeAccepted: true,
      setupAccepted: true,
      buttonRequired: false,
      buttonAccepted: true,
    });
    return onboardingResponse;
  }

  if (channel === "whatsapp" && reply.actionButton) {
    try {
      await sendWhatsAppMessage(from, reply.text);
      await sendWhatsAppMessage(from, "", reply.actionButton);
    } catch (error) {
      // Never expose the raw setup URL. The queued action remains recoverable
      // from Blankmind and through the APNs notification.
      try {
        await sendWhatsAppMessage(from, "Open Blankmind to continue the pending request.");
      } catch (_) {
        if (!String(error?.message || "").includes("twilio_whatsapp_send_failed")) throw error;
      }
    }
    if (messageSid) {
      try { await completeAssistantInboundMessage(channel, from, messageSid); } catch (_) { /* best effort */ }
    }
    return text(200, `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, "application/xml; charset=utf-8");
  }
  const replyText = audio ? withVoiceInputContext(reply.text, prompt) : reply.text;
  if (messageSid) {
    try { await completeAssistantInboundMessage(channel, from, messageSid); } catch (_) { /* best effort */ }
  }
  return text(200, twiml(replyText), "application/xml; charset=utf-8");
};

exports.actionDeepLink = actionDeepLink;
exports.pendingActionFromMemory = pendingActionFromMemory;
exports.pendingAssistantActionFromPlan = pendingAssistantActionFromPlan;
exports.verifyTwilioSignature = verifyTwilioSignature;
exports.memoryFactsFromText = memoryFactsFromText;
exports.queuePendingAssistantAction = queuePendingAssistantAction;
exports.whatsappReplyText = whatsappReplyText;
