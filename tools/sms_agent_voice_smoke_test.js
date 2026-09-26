const assert = require("assert");
const crypto = require("crypto");

process.env.OPENAI_API_KEY = "";
process.env.BM_SEMANTIC_PERSISTENCE = "legacy"; // Legacy event-store mock; required CAS has its own suite.
process.env.BLANKED_PUBLIC_APP_LINK_BASE = "https://getblank.netlify.app";
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;

const { handler: smsHandler, actionDeepLink } = require("../netlify/functions/sms-agent");
const { handler: audioHandler } = require("../netlify/functions/assistant-audio");
const { handler: assistantChannelHandler } = require("../netlify/functions/assistant-channel");

async function withAssistantMemoryMock(callback, selectedAppNames = ["Instagram"]) {
  const rows = new Map();
  const twilioCalls = [];
  const originalFetch = global.fetch;
  global.fetch = async (target, options = {}) => {
    const url = String(target);
    if (url.startsWith("https://supabase.test/rest/v1/blankmind_identity_links")) {
      const identity = [{ phone_e164: "+34600000001", assistant_connect_code: "ABC123", app_install_id: "install-sms-wa" }];
      return { ok: true, status: 200, text: async () => JSON.stringify(identity), json: async () => identity };
    }
    if (url.startsWith("https://supabase.test/rest/v1/digital_wellness_feature_payloads")) {
      if ((options.method || "GET").toUpperCase() === "POST") {
        const row = JSON.parse(options.body || "{}");
        const list = rows.get(row.anonymous_user_id) || [{
          payload: {
            event: "assistant_memory_updated",
            properties: {
              memory: {
                user_context: {
                  has_selected_apps: selectedAppNames.length > 0,
                  selection_count: selectedAppNames.length,
                  selected_app_names: selectedAppNames,
                  screen_time_authorized: true,
                  app_presence: {
                    app_present: true,
                    app_ready: true,
                    last_seen_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
                  },
                },
              },
            },
          },
          submitted_at: new Date().toISOString(),
        }];
        list.push({ payload: row.payload, submitted_at: row.submitted_at });
        rows.set(row.anonymous_user_id, list);
        return { ok: true, status: 201, text: async () => "", json: async () => ({}) };
      }
      const match = url.match(/anonymous_user_id=eq\.([^&]+)/);
      const key = match ? decodeURIComponent(match[1]) : "";
      const seeded = {
        payload: {
          event: "assistant_memory_updated",
          properties: {
            memory: {
              user_context: {
                has_selected_apps: selectedAppNames.length > 0,
                selection_count: selectedAppNames.length,
                selected_app_names: selectedAppNames,
                screen_time_authorized: true,
                app_presence: {
                  app_present: true,
                  app_ready: true,
                  last_seen_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
                },
              },
            },
          },
        },
        submitted_at: new Date().toISOString(),
      };
      const result = [...(rows.get(key) || [seeded])].reverse(); // API contract is newest first; do not mutate backing rows.
      return { ok: true, status: 200, text: async () => JSON.stringify(result), json: async () => result };
    }
    if (/^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\//.test(url)) {
      twilioCalls.push({ url, body: String(options.body || "") });
      return { ok: true, status: 201, text: async () => "{}", json: async () => ({}) };
    }
    return originalFetch(target, options);
  };
  try {
    return await callback({ rows, twilioCalls });
  } finally {
    global.fetch = originalFetch;
  }
}

async function whatsappVoiceRequestStaysText() {
  const response = await smsHandler({
    httpMethod: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", host: "getblank.netlify.app" },
    body: new URLSearchParams({
      From: "whatsapp:+34600000000",
      Body: "Can you say it as a voice note? Block Instagram from 10 pm to 7 am every day.",
      MessageSid: "SMvoice",
    }).toString(),
  });

  assert.strictEqual(response.statusCode, 200, response.body);
  assert.match(response.body, /<Body>/);
  assert.doesNotMatch(response.body, /Action:/i);
  assert.doesNotMatch(response.body, /I prepared a Blanked link/i);
  assert.match(response.body, /How many days/i);
  assert.doesNotMatch(response.body, /apps\.apple\.com/);
  assert.doesNotMatch(response.body, /Open Blanked to apply the protection window:/);
  assert.doesNotMatch(response.body, /<Media>/);
  assert.doesNotMatch(response.body, /action=review-action/);
  assert.doesNotMatch(response.body, /type=open_app_picker/);
}

async function smsDoesNotAttachVoice() {
  await withAssistantMemoryMock(async () => {
    const response = await smsHandler({
      httpMethod: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", host: "getblank.netlify.app" },
      body: new URLSearchParams({
        From: "+34600000000",
        Body: "Can you say it as a voice note? Block Instagram from 10 pm to 7 am every day.",
        MessageSid: "SMsms",
      }).toString(),
    });

    assert.strictEqual(response.statusCode, 200, response.body);
    assert.doesNotMatch(response.body, /<Media>/);
    assert.doesNotMatch(response.body, /https?:\/\//);
    assert.match(response.body, /How many days/i);
    assert.doesNotMatch(response.body, /Reply BLOCK/);
  });
}

async function smsCommandOpensStoredAction() {
  await withAssistantMemoryMock(async () => {
    const first = await smsHandler({
      httpMethod: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", host: "getblank.netlify.app" },
      body: new URLSearchParams({
        From: "+34600000000",
        Body: "Block Instagram from 10 pm to 7 am every day for 7 days.",
        MessageSid: "SMsms-plan",
      }).toString(),
    });
    assert.strictEqual(first.statusCode, 200, first.body);
    assert.match(first.body, /22:00.*07:00.*every day.*7 days/i);
    assert.match(first.body, /saved the request.*couldn(?:'|&apos;)t send a notification.*Open Blankmind/i);
    assert.doesNotMatch(first.body, /tap.*notification|already applied|already blocked/i);
    assert.doesNotMatch(first.body, /Reply BLOCK/);
    assert.doesNotMatch(first.body, /https?:\/\//);

    assert.doesNotMatch(first.body, /Reply BLOCK|Open Blanked|Do you confirm/i);

    const polled = await assistantChannelHandler({
      httpMethod: "POST",
      body: JSON.stringify({ action: "poll_pending_action", connect_code: "ABC123", preferred_channel: "sms" }),
    });
    assert.strictEqual(polled.statusCode, 200, polled.body);
    const pending = JSON.parse(polled.body).pending_action;
    assert.strictEqual(pending.type, "apply_schedule");
    assert.strictEqual(pending.start_minute, 1320);
    assert.strictEqual(pending.end_minute, 420);
    assert.strictEqual(pending.duration_days, 7);
    assert.deepStrictEqual(pending.app_names, []);
  });
}

async function whatsappBlockingFollowupKeepsPendingContract() {
  const previousTwilio = {
    sid: process.env.TWILIO_ACCOUNT_SID,
    token: process.env.TWILIO_AUTH_TOKEN,
    from: process.env.TWILIO_WHATSAPP_FROM_NUMBER,
    enabled: process.env.TWILIO_WHATSAPP_REVIEW_TEMPLATE_ENABLED,
    content: process.env.TWILIO_WHATSAPP_REVIEW_CONTENT_SID,
  };
  process.env.TWILIO_ACCOUNT_SID = "ACtest";
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  process.env.TWILIO_WHATSAPP_FROM_NUMBER = "+13478366767";
  process.env.TWILIO_WHATSAPP_REVIEW_TEMPLATE_ENABLED = "true";
  process.env.TWILIO_WHATSAPP_REVIEW_CONTENT_SID = "HXreview";
  await withAssistantMemoryMock(async ({ twilioCalls }) => {
    const first = await smsHandler({
      httpMethod: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", host: "getblank.netlify.app" },
      body: new URLSearchParams({
        From: "whatsapp:+34600000001",
        Body: "Block Instagram now for 5 minutes",
        MessageSid: "SMpending-1",
      }).toString(),
    });
    assert.strictEqual(first.statusCode, 200, first.body);
    assert.match(first.body, /once|days/i);
    assert.doesNotMatch(first.body, /https?:\/\//);

    const second = await smsHandler({
      httpMethod: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", host: "getblank.netlify.app" },
      body: new URLSearchParams({
        From: "whatsapp:+34600000001",
        Body: "Just once",
        MessageSid: "SMpending-2",
      }).toString(),
    });
    assert.strictEqual(second.statusCode, 200, second.body);
    assert.match(second.body, /Block your selected distractions.*5 minutes.*just once/i);
    assert.match(second.body, /saved the request.*couldn(?:'|&apos;)t send a notification.*Open Blankmind/i);
    assert.doesNotMatch(second.body, /tap.*notification|already applied|already blocked/i);
    assert.doesNotMatch(second.body, /https?:\/\//);
    assert.doesNotMatch(second.body, /https?:\/\/|review-action|ContentSid|Do you confirm/i);
    assert.match(second.body, /Execution is not verified/i);
    assert.strictEqual(twilioCalls.length, 0, "Twilio WhatsApp must not send a duplicate review template");

    const polled = await assistantChannelHandler({
      httpMethod: "POST",
      body: JSON.stringify({ action: "poll_pending_action", app_install_id: "install-sms-wa", preferred_channel: "whatsapp" }),
    });
    const polledBody = JSON.parse(polled.body);
    assert.strictEqual(polled.statusCode, 200, polled.body);
    assert.strictEqual(polledBody.linked, true);
    assert.strictEqual(polledBody.pending_action.type, "start_protection");
    assert.strictEqual(polledBody.pending_action.minutes, 5);
    assert.deepStrictEqual(polledBody.pending_action.app_names, []);

    const repeated = await smsHandler({
      httpMethod: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", host: "getblank.netlify.app" },
      body: new URLSearchParams({
        From: "whatsapp:+34600000001",
        Body: "Block Instagram now for 5 minutes",
        MessageSid: "SMpending-repeat",
      }).toString(),
    });
    assert.strictEqual(repeated.statusCode, 200, repeated.body);
    assert.match(repeated.body, /once or recurring/i);
    assert.doesNotMatch(repeated.body, /Open Blankmind|https?:\/\/|review-action/i);

    const afterRepeat = await assistantChannelHandler({
      httpMethod: "POST",
      body: JSON.stringify({ action: "poll_pending_action", app_install_id: "install-sms-wa", preferred_channel: "whatsapp" }),
    });
    assert.strictEqual(JSON.parse(afterRepeat.body).pending_action, null, afterRepeat.body);
  });
  for (const [key, value] of Object.entries(previousTwilio)) {
    const envKey = { sid: "TWILIO_ACCOUNT_SID", token: "TWILIO_AUTH_TOKEN", from: "TWILIO_WHATSAPP_FROM_NUMBER", enabled: "TWILIO_WHATSAPP_REVIEW_TEMPLATE_ENABLED", content: "TWILIO_WHATSAPP_REVIEW_CONTENT_SID" }[key];
    if (value == null) delete process.env[envKey]; else process.env[envKey] = value;
  }
}

async function whatsappTextHasNoAudioAttachment() {
  const response = await smsHandler({
    httpMethod: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", host: "getblank.netlify.app" },
    body: new URLSearchParams({
      From: "whatsapp:+34600000000",
      Body: "Block Instagram from 10 pm to 7 am every day.",
      MessageSid: "SMtext",
    }).toString(),
  });

  assert.strictEqual(response.statusCode, 200, response.body);
  assert.doesNotMatch(response.body, /<Media>/);
  assert.match(response.body, /How many days/i);
  assert.doesNotMatch(response.body, /apps\.apple\.com/);
  assert.doesNotMatch(response.body, /action=review-action/);
}

async function whatsappMissingSelectionCarriesConfirmedProtection() {
  const previousTwilio = {
    sid: process.env.TWILIO_ACCOUNT_SID,
    token: process.env.TWILIO_AUTH_TOKEN,
    from: process.env.TWILIO_WHATSAPP_FROM_NUMBER,
    content: process.env.TWILIO_WHATSAPP_ACTION_CONTENT_SID,
  };
  process.env.TWILIO_ACCOUNT_SID = "ACtest";
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  process.env.TWILIO_WHATSAPP_FROM_NUMBER = "+13478366767";
  process.env.TWILIO_WHATSAPP_ACTION_CONTENT_SID = "HXchooseapps";
  await withAssistantMemoryMock(async ({ twilioCalls }) => {
    const send = (body, sid) => smsHandler({
      httpMethod: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", host: "getblank.netlify.app" },
      body: new URLSearchParams({ From: "whatsapp:+34600000002", Body: body, MessageSid: sid }).toString(),
    });
    const first = await send("Block Instagram now for 5 minutes", "SMselection-1");
    assert.match(first.body, /once or recurring/i);
    const second = await send("Once", "SMselection-2");
    assert.doesNotMatch(second.body, /Do you confirm/i);
    assert.strictEqual(twilioCalls.length, 2);
    const textMessage = new URLSearchParams(twilioCalls[0].body);
    const buttonMessage = new URLSearchParams(twilioCalls[1].body);
    assert.doesNotMatch(textMessage.get("Body") || "", /https?:\/\//);
    assert.match(textMessage.get("Body") || "", /couldn't send a notification.*Open Blankmind.*selection/i);
    assert.doesNotMatch(textMessage.get("Body") || "", /tap.*notification|already applied|already blocked/i);
    assert.strictEqual(buttonMessage.get("ContentSid"), "HXchooseapps");
    assert.match(buttonMessage.get("ContentVariables") || "", /review-action/);
    assert.match(buttonMessage.get("ContentVariables") || "", /open_app_picker/);

    const polled = await assistantChannelHandler({
      httpMethod: "POST",
      body: JSON.stringify({ action: "poll_pending_action", connect_code: "ABC123", preferred_channel: "whatsapp" }),
    });
    const pending = JSON.parse(polled.body).pending_action;
    assert.strictEqual(pending.type, "open_app_picker");
    assert.strictEqual(pending.name, "Distractions");
    assert.strictEqual(pending.minutes, 5);
    assert.strictEqual(pending.hard_mode, false);
    assert.deepStrictEqual(pending.app_names, []);
  }, []);
  for (const [key, value] of Object.entries(previousTwilio)) {
    const envKey = { sid: "TWILIO_ACCOUNT_SID", token: "TWILIO_AUTH_TOKEN", from: "TWILIO_WHATSAPP_FROM_NUMBER", content: "TWILIO_WHATSAPP_ACTION_CONTENT_SID" }[key];
    if (value == null) delete process.env[envKey]; else process.env[envKey] = value;
  }
}

async function connectOnboardingIsNaturalAndQueuesPicker() {
  await withAssistantMemoryMock(async () => {
    const response = await smsHandler({
      httpMethod: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", host: "getblank.netlify.app" },
      body: new URLSearchParams({
        From: "+34600000001",
        Body: "CONNECT ABC123",
        MessageSid: "SM-onboarding",
      }).toString(),
    });
    assert.strictEqual(response.statusCode, 200, response.body);
    assert.strictEqual((response.body.match(/<Message>/g) || []).length, 2);
    assert.match(response.body, /Hey, I’m Blankmind/i);
    assert.match(response.body, /Pick the apps that pull you in most/i);
    assert.match(response.body, /come back here/i);
    assert.doesNotMatch(response.body, /Hey! Blankmind here|Connected\. This WhatsApp thread/i);

    const polled = await assistantChannelHandler({
      httpMethod: "POST",
      body: JSON.stringify({ action: "poll_pending_action", app_install_id: "install-sms-wa", preferred_channel: "sms" }),
    });
    const body = JSON.parse(polled.body);
    assert.strictEqual(polled.statusCode, 200, polled.body);
    assert.strictEqual(body.pending_action.type, "open_app_picker");
    assert.strictEqual(body.pending_action.name, null);
  }, []);
}

async function skippedWhatsappOnboardingIsNotMarkedDispatched() {
  const previous = {
    sid: process.env.TWILIO_ACCOUNT_SID,
    token: process.env.TWILIO_AUTH_TOKEN,
    from: process.env.TWILIO_WHATSAPP_FROM_NUMBER,
    onboardingContent: process.env.TWILIO_WHATSAPP_ONBOARDING_CONTENT_SID,
    actionContent: process.env.TWILIO_WHATSAPP_ACTION_CONTENT_SID,
  };
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_WHATSAPP_FROM_NUMBER;
  delete process.env.TWILIO_WHATSAPP_ONBOARDING_CONTENT_SID;
  delete process.env.TWILIO_WHATSAPP_ACTION_CONTENT_SID;
  try {
    await withAssistantMemoryMock(async ({ rows }) => {
      const response = await smsHandler({
        httpMethod: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", host: "getblank.netlify.app" },
        body: new URLSearchParams({
          From: "whatsapp:+34600000001",
          Body: "CONNECT ABC123",
          MessageSid: "SM-onboarding-skipped",
        }).toString(),
      });
      assert.strictEqual(response.statusCode, 200, response.body);
      const memories = [...rows.values()].flat()
        .map((row) => row.payload?.properties?.memory)
        .filter(Boolean);
      assert.strictEqual(
        memories.some((memory) => memory.assistant_onboarding_status === "dispatched"),
        false,
        "a skipped WhatsApp send was recorded as dispatched",
      );
    }, []);
  } finally {
    const envMap = {
      sid: "TWILIO_ACCOUNT_SID",
      token: "TWILIO_AUTH_TOKEN",
      from: "TWILIO_WHATSAPP_FROM_NUMBER",
      onboardingContent: "TWILIO_WHATSAPP_ONBOARDING_CONTENT_SID",
      actionContent: "TWILIO_WHATSAPP_ACTION_CONTENT_SID",
    };
    for (const [key, envKey] of Object.entries(envMap)) {
      if (previous[key] == null) delete process.env[envKey]; else process.env[envKey] = previous[key];
    }
  }
}

async function whatsappUsesCanonicalSelectionForRequestedApp() {
  await withAssistantMemoryMock(async () => {
    const send = (body, sid) => smsHandler({
      httpMethod: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", host: "getblank.netlify.app" },
      body: new URLSearchParams({ From: "whatsapp:+34600000003", Body: body, MessageSid: sid }).toString(),
    });
    assert.match((await send("Block Instagram now for 5 minutes", "SMcopy-1")).body, /once or recurring/i);
    const activated = await send("Once", "SMcopy-2");
    assert.match(activated.body, /Block your selected distractions.*5 minutes.*just once/i);
    assert.match(activated.body, /saved the request.*couldn(?:'|&apos;)t send a notification.*Open Blankmind/i);
    assert.doesNotMatch(activated.body, /tap.*notification|Do you confirm|Select exactly Instagram/i);

    const polled = await assistantChannelHandler({
      httpMethod: "POST",
      body: JSON.stringify({ action: "poll_pending_action", connect_code: "ABC123", preferred_channel: "whatsapp" }),
    });
    const pending = JSON.parse(polled.body).pending_action;
    assert.strictEqual(pending.type, "start_protection");
    assert.strictEqual(pending.name, null);
    assert.strictEqual(pending.source_mode_name, undefined);
    assert.strictEqual(pending.copy_mode, undefined);
    assert.strictEqual(pending.minutes, 5);
  });
}

async function whatsappInputAudioGetsTranscribedTextReply() {
  const previousApiKey = process.env.OPENAI_API_KEY;
  const originalFetch = global.fetch;
  process.env.OPENAI_API_KEY = "test-openai-key";
  global.fetch = async (target, options = {}) => {
    const url = String(target);
    if (url === "https://api.twilio.com/fake-audio.ogg") {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => Buffer.from("fake-audio"),
      };
    }
    if (url === "https://api.openai.com/v1/audio/transcriptions") {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ text: "I usually scroll Instagram after breakfast." }),
      };
    }
    return originalFetch(target, options);
  };

  try {
    const response = await withAssistantMemoryMock(() => smsHandler({
      httpMethod: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", host: "getblank.netlify.app" },
      body: new URLSearchParams({
        From: "whatsapp:+34600000000",
        Body: "",
        NumMedia: "1",
        MediaUrl0: "https://api.twilio.com/fake-audio.ogg",
        MediaContentType0: "audio/ogg",
        MessageSid: "SMinputaudio",
      }).toString(),
    }));

    assert.strictEqual(response.statusCode, 200, response.body);
    assert.match(response.body, /I understood your voice note as &quot;I usually scroll Instagram after breakfast\.&quot;\./);
    assert.doesNotMatch(response.body, /<Media>/);
  } finally {
    global.fetch = originalFetch;
    if (previousApiKey) process.env.OPENAI_API_KEY = previousApiKey;
    else delete process.env.OPENAI_API_KEY;
  }
}

async function audioEndpointIsDisabled() {
  const response = await audioHandler({ httpMethod: "GET" });
  assert.strictEqual(response.statusCode, 410, response.body);
  assert.strictEqual(response.body, "audio_replies_disabled");
}

async function smsSignatureAndMidnightLinkChecks() {
  const link = actionDeepLink([
    { type: "apply_schedule", start_minute: 0, end_minute: 60, duration_days: 7 },
  ], ["Instagram"]);
  assert.match(link, /start=0/);
  assert.match(link, /end=60/);

  const previousValidation = process.env.TWILIO_VALIDATE_WEBHOOK_SIGNATURE;
  const previousToken = process.env.TWILIO_AUTH_TOKEN;
  process.env.TWILIO_VALIDATE_WEBHOOK_SIGNATURE = "true";
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  const body = new URLSearchParams({ From: "+34600000000", Body: "Hi", MessageSid: "SMsigned" }).toString();
  const canonical = Array.from(new URLSearchParams(body).entries())
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
    .map(([key, value]) => `${key}${value}`)
    .join("");
  const signature = crypto.createHmac("sha1", process.env.TWILIO_AUTH_TOKEN)
    .update(`https://getblank.netlify.app/.netlify/functions/sms-agent${canonical}`)
    .digest("base64");
  try {
    const valid = await smsHandler({
      httpMethod: "POST",
      headers: {
        host: "getblank.netlify.app",
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": signature,
      },
      path: "/.netlify/functions/sms-agent",
      body,
    });
    assert.notStrictEqual(valid.statusCode, 403, valid.body);
    const invalid = await smsHandler({
      httpMethod: "POST",
      headers: {
        host: "getblank.netlify.app",
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": "invalid",
      },
      path: "/.netlify/functions/sms-agent",
      body,
    });
    assert.strictEqual(invalid.statusCode, 403, invalid.body);
  } finally {
    if (previousValidation) process.env.TWILIO_VALIDATE_WEBHOOK_SIGNATURE = previousValidation; else delete process.env.TWILIO_VALIDATE_WEBHOOK_SIGNATURE;
    if (previousToken) process.env.TWILIO_AUTH_TOKEN = previousToken; else delete process.env.TWILIO_AUTH_TOKEN;
  }
}

(async () => {
  await whatsappVoiceRequestStaysText();
  await smsDoesNotAttachVoice();
  await smsCommandOpensStoredAction();
  await whatsappBlockingFollowupKeepsPendingContract();
  await whatsappTextHasNoAudioAttachment();
  await whatsappMissingSelectionCarriesConfirmedProtection();
  await connectOnboardingIsNaturalAndQueuesPicker();
  await skippedWhatsappOnboardingIsNotMarkedDispatched();
  await whatsappUsesCanonicalSelectionForRequestedApp();
  await whatsappInputAudioGetsTranscribedTextReply();
  await audioEndpointIsDisabled();
  await smsSignatureAndMidnightLinkChecks();
  console.log("sms-agent audio input smoke tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
