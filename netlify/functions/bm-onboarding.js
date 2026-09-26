const crypto = require("crypto");
const { getAssistantMemory, recordAssistantMemory, transitionPendingAssistantAction } = require("./_assistant_channel");
const { sendAssistantActionPush } = require("./_assistant_push");
const { reviewActionLink } = require("./_bm_action_link");
const { isActivePendingAction } = require("./bm-pending-action");

const ONBOARDING_VERSION = "natural-v2-en-single-selection";
const ONBOARDING_ACTION_TYPE = "open_app_picker";

function cleanText(value, maxLength = 600) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function spanishContext(context = {}) {
  const language = cleanText(context.language || context.locale, 24).toLowerCase();
  return language === "es" || language.startsWith("es-") || language.startsWith("es_");
}

function hasSelectedDistractions(context = {}) {
  return context.has_selected_apps === true
    || Number(context.selection_count) > 0
    || (Array.isArray(context.selected_app_names) && context.selected_app_names.length > 0);
}

function onboardingMessages(context = {}) {
  if (spanishContext(context)) {
    return {
      welcome: "Hola, soy Blankmind. Cuéntame qué te está llevando al móvil o qué te gustaría hacer más fácil.",
      setup: "Elige las apps que más te enganchan. Esa será la lista que usaré cuando me pidas un bloqueo o un plan. Pulsa la notificación para seleccionarlas y vuelve aquí.",
      ready: context.device_execution_ready === true
        ? "Cuéntame qué te está llevando al móvil, cuándo lo coges o qué te gustaría cambiar."
        : "Ya recibí tu lista de distracciones. Vuelve a Blankmind para terminar de conectar este iPhone.",
    };
  }
  return {
    welcome: "Hey, I’m Blankmind. Tell me what’s been pulling you into your phone, or what you’d like to make easier.",
    setup: "Pick the apps that pull you in most. That list is what I’ll use when you ask for a block or a plan. Tap the notification to choose them, then come back here.",
    ready: context.device_execution_ready === true
      ? "Tell me what’s been pulling you in, when you reach for your phone, or what you want to change."
      : "I have your distraction list. Return to Blankmind to finish connecting this iPhone.",
  };
}

function onboardingAction(messages, now = Date.now()) {
  const createdAt = new Date(now).toISOString();
  const payload = {
    type: ONBOARDING_ACTION_TYPE,
    // A pure onboarding tap opens the picker; it must not imply a block or activate anything.
    name: null,
    minutes: null,
    hard_mode: false,
    start_minute: null,
    end_minute: null,
    weekdays: [],
    duration_days: null,
    hours: null,
    app_names: [],
  };
  const fingerprint = crypto.createHash("sha256")
    .update(`onboarding:${ONBOARDING_VERSION}:${JSON.stringify(payload)}`)
    .digest("hex")
    .slice(0, 32);
  return {
    id: `onboarding_${now.toString(36)}_${crypto.randomBytes(6).toString("hex")}`,
    fingerprint,
    ...payload,
    status: "queued",
    summary: cleanText(messages.setup, 320),
    source: "onboarding",
    created_at: createdAt,
    requested_at: createdAt,
    expires_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
  };
}

function whatsappButtonVariables(link) {
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
        String(value).replace(/\{\{link\}\}/g, link).replace(/\{\{link_path\}\}/g, linkPath),
      ]));
    } catch (_) {
      return { "1": linkPath };
    }
  }
  return { "1": linkPath };
}

function onboardingButton(action) {
  const contentSid = cleanText(
    process.env.TWILIO_WHATSAPP_ONBOARDING_CONTENT_SID || process.env.TWILIO_WHATSAPP_ACTION_CONTENT_SID,
    80,
  );
  const link = reviewActionLink(action, []);
  if (!contentSid || !link) return null;
  return { contentSid, contentVariables: whatsappButtonVariables(link) };
}

async function queueOnboardingPicker({ channel, channelUser, messages }) {
  const memory = await getAssistantMemory(channel, channelUser);
  const existing = memory.pending_assistant_action;
  if (isActivePendingAction(existing) && existing.source !== "onboarding") {
    return {
      action: existing,
      push: { sent: false, reason: "existing_action_preserved" },
      button: null,
      preserved: true,
    };
  }
  if (existing?.source === "onboarding" && isActivePendingAction(existing)) {
    let push = { sent: false, reason: "push_not_attempted" };
    try { push = await sendAssistantActionPush(memory.assistant_device_push, existing); } catch (error) { push = { sent: false, reason: `push_exception:${error.message}` }; }
    return { action: existing, push, button: onboardingButton(existing) };
  }

  const action = onboardingAction(messages);
  const receipt = await transitionPendingAssistantAction({
    channel,
    channelUser,
    previous: existing,
    pending: action,
    expectedVersion: memory.semantic_store_version,
    source: "assistant_onboarding_picker_pending",
  });
  if (!receipt.updated) return { action: null, push: { sent: false, reason: "newer_action_preserved" }, button: null, preserved: true };
  let push = { sent: false, reason: "push_not_attempted" };
  try { push = await sendAssistantActionPush(memory.assistant_device_push, action); }
  catch (error) { push = { sent: false, reason: `push_exception:${error.message}` }; }
  try {
    await recordAssistantMemory({
      channel,
      channelUser,
      memory: {
        last_assistant_push_attempt: {
          action_id: action.id,
          action_type: action.type,
          sent: push.sent === true,
          reason: cleanText(push.reason, 200),
          status: Number(push.status || 0),
          apns_id: cleanText(push.apns_id, 80),
          attempted_at: push.accepted_at || push.attempted_at || new Date().toISOString(),
        },
      },
      source: push.sent === true ? "assistant_onboarding_push_accepted" : "assistant_onboarding_push_failed",
    });
  } catch (_) {
    // The pending action is already durable; push-attempt telemetry is best effort.
  }
  return { action, push, button: onboardingButton(action) };
}

async function markOnboardingDispatched(channel, channelUser, delivery = {}) {
  try {
    await recordAssistantMemory({
      channel,
      channelUser,
      memory: {
        assistant_onboarding_version: ONBOARDING_VERSION,
        assistant_onboarding_status: "dispatched",
        assistant_onboarding_dispatched_at: new Date().toISOString(),
        assistant_onboarding_delivery: {
          channel,
          welcome_accepted: delivery.welcomeAccepted === true,
          setup_accepted: delivery.setupAccepted === true,
          button_accepted: delivery.buttonAccepted === true || delivery.buttonRequired !== true,
        },
      },
      source: "assistant_onboarding_dispatched",
    });
  } catch (_) {
    // Provider acceptance must never turn a successful connection into a failure.
  }
}

function onboardingProgress(memory = {}) {
  const progress = memory.assistant_onboarding_progress;
  if (!progress || progress.version !== ONBOARDING_VERSION) return {};
  return {
    welcomeAccepted: progress.welcome_accepted === true,
    setupAccepted: progress.setup_accepted === true,
    buttonAccepted: progress.button_accepted === true,
  };
}

async function recordOnboardingProgress(channel, channelUser, progress, step) {
  const next = { ...progress, [step]: true };
  try {
    await recordAssistantMemory({
      channel,
      channelUser,
      memory: {
        assistant_onboarding_progress: {
          version: ONBOARDING_VERSION,
          welcome_accepted: next.welcomeAccepted === true,
          setup_accepted: next.setupAccepted === true,
          button_accepted: next.buttonAccepted === true,
          updated_at: new Date().toISOString(),
        },
      },
      source: `assistant_onboarding_${step.replace("Accepted", "")}_accepted`,
    });
  } catch (_) {
    // Delivery remains useful even if progress telemetry is temporarily unavailable.
  }
  return next;
}

async function dispatchWhatsAppOnboarding({ channel, channelUser, messages, button, progress = {}, sendMessage }) {
  let current = progress;
  const deliveries = [];
  const sendStep = async (step, body, options = {}) => {
    if (current[step] === true) return { accepted: true, reused: true };
    let delivery;
    try {
      delivery = await sendMessage(channelUser, body, options);
    } catch (error) {
      return { accepted: false, reason: cleanText(error?.message || "onboarding_send_failed", 200) };
    }
    if (delivery?.skipped === true) return { accepted: false, reason: delivery.reason || "onboarding_delivery_skipped" };
    current = await recordOnboardingProgress(channel, channelUser, current, step);
    deliveries.push(delivery);
    return { accepted: true, delivery };
  };

  const welcome = await sendStep("welcomeAccepted", messages.welcome);
  if (!welcome.accepted) return { dispatched: false, reason: welcome.reason, progress: current, deliveries };
  const setup = await sendStep("setupAccepted", messages.setup);
  if (!setup.accepted) return { dispatched: false, reason: setup.reason, progress: current, deliveries };
  if (button) {
    const buttonResult = await sendStep("buttonAccepted", "", button);
    if (!buttonResult.accepted) return { dispatched: false, reason: buttonResult.reason, progress: current, deliveries };
  }

  await markOnboardingDispatched(channel, channelUser, {
    welcomeAccepted: true,
    setupAccepted: true,
    buttonRequired: Boolean(button),
    buttonAccepted: !button || current.buttonAccepted === true,
  });
  return { dispatched: true, progress: current, deliveries };
}

function shouldSendOnboarding(memory = {}) {
  return memory.assistant_onboarding_version !== ONBOARDING_VERSION
    || memory.assistant_onboarding_status !== "dispatched";
}

module.exports = {
  ONBOARDING_VERSION,
  hasSelectedDistractions,
  onboardingMessages,
  onboardingAction,
  onboardingButton,
  queueOnboardingPicker,
  markOnboardingDispatched,
  onboardingProgress,
  dispatchWhatsAppOnboarding,
  shouldSendOnboarding,
};
