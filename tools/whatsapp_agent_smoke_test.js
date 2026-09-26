const assert = require("assert");

process.env.OPENAI_API_KEY = "";
process.env.BM_SEMANTIC_PERSISTENCE = "legacy"; // Legacy event-store mock; required CAS has its own suite.
process.env.WHATSAPP_VERIFY_TOKEN = "test-token";
delete process.env.WHATSAPP_ACCESS_TOKEN;
delete process.env.WHATSAPP_PHONE_NUMBER_ID;

const { handler, whatsappReplyText } = require("../netlify/functions/whatsapp-agent");
const { handler: assistantChannelHandler } = require("../netlify/functions/assistant-channel");

const semanticMemoryRows = new Map();

function recentAssistantMemoryResponse(target, options = {}) {
  if (!String(target).startsWith("https://supabase.test/rest/v1/")) return null;
  if (String(target).includes("/blankmind_identity_links")) {
    const rows = String(target).includes("app_install_id=eq.install-1")
      ? [{ assistant_connect_code: "ABC123", app_install_id: "install-1", phone_e164: "+34600000000" }]
      : [];
    return { ok: true, status: 200, text: async () => JSON.stringify(rows), json: async () => rows };
  }
  if ((options.method || "GET").toUpperCase() === "POST") {
    const row = JSON.parse(options.body || "{}");
    if (row.anonymous_user_id && row.payload) {
      const list = semanticMemoryRows.get(row.anonymous_user_id) || [];
      list.push({ payload: row.payload, submitted_at: row.submitted_at });
      semanticMemoryRows.set(row.anonymous_user_id, list);
    }
    return { ok: true, status: 201, text: async () => "", json: async () => ({}) };
  }
  const keyMatch = String(target).match(/anonymous_user_id=eq\.([^&]+)/);
  const key = keyMatch ? decodeURIComponent(keyMatch[1]) : "";
  const result = [{
    payload: {
      event: "assistant_memory_updated",
      properties: {
        memory: {
          user_context: {
            has_selected_apps: true,
            selection_count: 2,
            selected_app_names: ["Instagram", "TikTok"],
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
  result.push(...(semanticMemoryRows.get(key) || []));
  result.reverse(); // Supabase GET requests order=submitted_at.desc.
  return { ok: true, status: 200, text: async () => JSON.stringify(result), json: async () => result };
}

async function verifyWebhook() {
  const response = await handler({
    httpMethod: "GET",
    queryStringParameters: {
      "hub.mode": "subscribe",
      "hub.verify_token": "test-token",
      "hub.challenge": "challenge-ok",
    },
  });
  assert.strictEqual(response.statusCode, 200, response.body);
  assert.strictEqual(response.body, "challenge-ok");
}

async function receiveMessage() {
  const response = await handler({
    httpMethod: "POST",
    headers: {},
    body: JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "34600000000",
                    id: "wamid.test",
                    text: { body: "Block Instagram from 10 to 7" },
                  },
                ],
              },
            },
          ],
        },
      ],
    }),
  });
  assert.strictEqual(response.statusCode, 200, response.body);
  const body = JSON.parse(response.body);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.received, 1);
  assert.strictEqual(body.results[0].skipped, true);
  assert.strictEqual(body.results[0].reason, "missing_whatsapp_credentials");
}

async function connectMessage() {
  const response = await handler({
    httpMethod: "POST",
    headers: {},
    body: JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "34600000000",
                    id: "wamid.connect",
                    text: { body: "CONNECT ABC123" },
                  },
                ],
              },
            },
          ],
        },
      ],
    }),
  });
  assert.strictEqual(response.statusCode, 200, response.body);
  const body = JSON.parse(response.body);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.received, 1);
  assert.strictEqual(body.results[0].skipped, true);
  assert.strictEqual(body.results[0].reason, "missing_whatsapp_credentials");
}

async function connectGreeting() {
  process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-number-id";
  const outboundTexts = [];
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    outboundTexts.push(JSON.parse(options.body).text.body);
    return {
      ok: true,
      json: async () => ({ ok: true }),
    };
  };

  try {
    const response = await handler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: "34600000000",
                      id: "wamid.connect.greeting",
                      text: { body: "CONNECT ABC123" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    });
    assert.strictEqual(response.statusCode, 200, response.body);
    assert.strictEqual(outboundTexts.length, 2);
  assert.match(outboundTexts[0], /Hey, I’m Blankmind/i);
  assert.match(outboundTexts[0], /pulling you into your phone/i);
    assert.match(outboundTexts[1], /Pick the apps that pull you in most/i);
    assert.match(outboundTexts[1], /come back here/i);
    assert.doesNotMatch(outboundTexts[0], /connected|thread|digital wellness assistant/i);
  } finally {
    global.fetch = originalFetch;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  }
}

async function linkIncludesRequestedApps() {
  semanticMemoryRows.clear();
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-number-id";
  let outboundText = "";
  const originalFetch = global.fetch;
  global.fetch = async (_url, options = {}) => {
    const memoryResponse = recentAssistantMemoryResponse(_url, options);
    if (memoryResponse) return memoryResponse;
    outboundText = JSON.parse(options.body).text.body;
    return {
      ok: true,
      json: async () => ({ ok: true }),
    };
  };

  try {
    await handler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ from: "34600000000", id: "wamid.plan.connect", text: { body: "CONNECT ABC123" } }] } }] }] }),
    });
    const response = await handler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: "34600000000",
                      id: "wamid.plan",
                      text: { body: "Block Instagram TikTok from 10 pm to 7 am every day for 7 days" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    });
    assert.strictEqual(response.statusCode, 200, response.body);
    assert.doesNotMatch(outboundText, /Do you confirm|review-action/i);
    assert.doesNotMatch(outboundText, /https?:\/\/|review-action/);
    assert.match(outboundText, /couldn't send a notification/i);
    assert.match(outboundText, /Open Blankmind/i);
    const pendingRows = [...semanticMemoryRows.values()].flat()
      .map((row) => row.payload?.properties?.memory?.pending_assistant_action)
      .filter(Boolean);
    assert.strictEqual(pendingRows.length, 1);
    assert.strictEqual(pendingRows[0].type, "apply_schedule");
    assert.deepStrictEqual(pendingRows[0].app_names, []);

    const polled = await assistantChannelHandler({
      httpMethod: "POST",
      body: JSON.stringify({ action: "poll_pending_action", connect_code: "ABC123", preferred_channel: "whatsapp" }),
    });
    const polledBody = JSON.parse(polled.body);
    assert.strictEqual(polled.statusCode, 200, polled.body);
    assert.strictEqual(polledBody.linked, true);
    assert.strictEqual(polledBody.pending_action.id, pendingRows[0].id);
    assert.deepStrictEqual(polledBody.pending_action.app_names, []);

    const acknowledged = await assistantChannelHandler({
      httpMethod: "POST",
      body: JSON.stringify({ action: "ack_pending_action", connect_code: "ABC123", preferred_channel: "whatsapp", action_id: pendingRows[0].id, status: "confirmed" }),
    });
    assert.strictEqual(acknowledged.statusCode, 200, acknowledged.body);
    assert.strictEqual(JSON.parse(acknowledged.body).acknowledged, true);

    const stillPending = await assistantChannelHandler({
      httpMethod: "POST",
      body: JSON.stringify({ action: "poll_pending_action", app_install_id: "install-1", preferred_channel: "whatsapp" }),
    });
    const stillPendingBody = JSON.parse(stillPending.body);
    assert.strictEqual(stillPending.statusCode, 200, stillPending.body);
    assert.strictEqual(stillPendingBody.pending_action.id, pendingRows[0].id);
    assert.strictEqual(stillPendingBody.pending_action.status, "confirmed");

    const started = await assistantChannelHandler({
      httpMethod: "POST",
      body: JSON.stringify({ action: "ack_pending_action", app_install_id: "install-1", preferred_channel: "whatsapp", action_id: pendingRows[0].id, status: "execution_started" }),
    });
    assert.strictEqual(started.statusCode, 200, started.body);
    assert.strictEqual(JSON.parse(started.body).status, "execution_started");

    const verified = await assistantChannelHandler({
      httpMethod: "POST",
      body: JSON.stringify({ action: "ack_pending_action", app_install_id: "install-1", preferred_channel: "whatsapp", action_id: pendingRows[0].id, status: "verified", detail: "schedule_persisted" }),
    });
    assert.strictEqual(verified.statusCode, 200, verified.body);
    assert.strictEqual(JSON.parse(verified.body).status, "verified");

    const terminalPoll = await assistantChannelHandler({
      httpMethod: "POST",
      body: JSON.stringify({ action: "poll_pending_action", app_install_id: "install-1", preferred_channel: "whatsapp" }),
    });
    assert.strictEqual(JSON.parse(terminalPoll.body).pending_action, null);

    const verifiedRetry = await assistantChannelHandler({
      httpMethod: "POST",
      body: JSON.stringify({ action: "ack_pending_action", app_install_id: "install-1", preferred_channel: "whatsapp", action_id: pendingRows[0].id, status: "verified", detail: "schedule_persisted" }),
    });
    const verifiedRetryBody = JSON.parse(verifiedRetry.body);
    assert.strictEqual(verifiedRetryBody.acknowledged, true);
    assert.strictEqual(verifiedRetryBody.idempotent, true);
  } finally {
    global.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  }
}

async function twilioButtonTemplateHidesRawUrlFromMainReply() {
  semanticMemoryRows.clear();
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  process.env.TWILIO_ACCOUNT_SID = "ACtest";
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  process.env.TWILIO_WHATSAPP_FROM_NUMBER = "+13478366767";
  process.env.TWILIO_WHATSAPP_REVIEW_CONTENT_SID = "HXbutton";
  process.env.TWILIO_WHATSAPP_REVIEW_TEMPLATE_ENABLED = "true";
  const requests = [];
  const originalFetch = global.fetch;
  global.fetch = async (_url, options = {}) => {
    const memoryResponse = recentAssistantMemoryResponse(_url, options);
    if (memoryResponse) return memoryResponse;
    const params = new URLSearchParams(options.body);
    requests.push(Object.fromEntries(params.entries()));
    return {
      ok: true,
      json: async () => ({ ok: true }),
    };
  };

  try {
    const response = await handler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: "34600000000",
                      id: "wamid.button",
                      text: { body: "Block Instagram and TikTok from 10 pm to 7 am every day for 7 days" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    });
    assert.strictEqual(response.statusCode, 200, response.body);
    assert.strictEqual(requests.length, 1);
    assert.doesNotMatch(requests[0].Body, /Do you confirm|review-action/i);
    assert.doesNotMatch(requests[0].Body, /https?:\/\//);
    assert.match(requests[0].Body, /haven't sent the request yet/i);
    assert.match(requests[0].Body, /Open Blankmind to connect this WhatsApp/i);
    assert.doesNotMatch(requests[0].Body, /tap.*notification/i);
  } finally {
    global.fetch = originalFetch;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_WHATSAPP_FROM_NUMBER;
    delete process.env.TWILIO_WHATSAPP_REVIEW_CONTENT_SID;
    delete process.env.TWILIO_WHATSAPP_REVIEW_TEMPLATE_ENABLED;
  }
}

async function legacyModePhraseUsesCanonicalProtection() {
  process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-number-id";
  let outboundText = "";
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    outboundText = JSON.parse(options.body).text.body;
    return {
      ok: true,
      json: async () => ({ ok: true }),
    };
  };

  try {
    const response = await handler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: "34600000000",
                      id: "wamid.mode",
                      text: { body: "I'm in social mode now for 45 minutes" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    });
    assert.strictEqual(response.statusCode, 200, response.body);
    assert.doesNotMatch(outboundText, /review-action/);
    assert.doesNotMatch(outboundText, /not.*saved|not.*created|create.*mode/i);
    assert.match(outboundText, /protection|selected distractions|choose|confirm/i);
  } finally {
    global.fetch = originalFetch;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  }
}

async function categoryRequestUsesSingleSelectionFlow() {
  process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-number-id";
  let outboundText = "";
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    outboundText = JSON.parse(options.body).text.body;
    return {
      ok: true,
      json: async () => ({ ok: true }),
    };
  };

  try {
    const response = await handler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  messages: [
                    {
                      from: "34600000000",
                      id: "wamid.social.category",
                      text: { body: "Block social media" },
                    },
                  ],
                },
              },
            ],
          },
        ],
      }),
    });
    assert.strictEqual(response.statusCode, 200, response.body);
    assert.doesNotMatch(outboundText, /review-action/);
    assert.match(outboundText, /When should it start|Should it start now|How long/i);
  } finally {
    global.fetch = originalFetch;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  }
}

async function whatsappAudioInputGetsTranscribedTextReply() {
  const previousApiKey = process.env.OPENAI_API_KEY;
  const previousAccessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const previousPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const originalFetch = global.fetch;
  let outboundText = "";
  let transcriptionCalled = false;
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-number-id";
  global.fetch = async (target, options = {}) => {
    const url = String(target);
    if (url === "https://graph.facebook.com/v26.0/audio-media") {
      return { ok: true, status: 200, json: async () => ({ url: "https://media.test/audio.ogg" }) };
    }
    if (url === "https://media.test/audio.ogg") {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => Buffer.from("fake-audio"),
      };
    }
    if (url === "https://api.openai.com/v1/audio/transcriptions") {
      transcriptionCalled = true;
      return { ok: true, status: 200, text: async () => JSON.stringify({ text: "Hi, I need help with my focus." }) };
    }
    outboundText = JSON.parse(options.body).text.body;
    return { ok: true, json: async () => ({ ok: true }) };
  };

  try {
    const response = await handler({
      httpMethod: "POST",
      headers: {},
      body: JSON.stringify({
        entry: [{ changes: [{ value: { messages: [{
          from: "34600000002",
          id: "wamid.audio",
          audio: { id: "audio-media", mime_type: "audio/ogg" },
        }] } }] }],
      }),
    });
    assert.strictEqual(response.statusCode, 200, response.body);
    assert.strictEqual(JSON.parse(response.body).ok, true);
    assert.strictEqual(transcriptionCalled, true);
    assert.ok(outboundText);
  } finally {
    global.fetch = originalFetch;
    if (previousApiKey) process.env.OPENAI_API_KEY = previousApiKey; else delete process.env.OPENAI_API_KEY;
    if (previousAccessToken) process.env.WHATSAPP_ACCESS_TOKEN = previousAccessToken; else delete process.env.WHATSAPP_ACCESS_TOKEN;
    if (previousPhoneId) process.env.WHATSAPP_PHONE_NUMBER_ID = previousPhoneId; else delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  }
}

async function duplicateInboundIsIgnoredAcrossRetries() {
  const previousSupabaseUrl = process.env.SUPABASE_URL;
  const previousSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousAccessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const previousPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const originalFetch = global.fetch;
  const rows = [];
  const atomicClaims = new Set();
  let outboundCount = 0;
  process.env.SUPABASE_URL = "https://supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-number-id";
  global.fetch = async (target, options = {}) => {
    const url = String(target);
    if (url.startsWith("https://supabase.test/rest/v1/")) {
      if (url.endsWith("/rpc/claim_assistant_inbound_message")) {
        const input = JSON.parse(options.body || "{}");
        const key = `${input.p_anonymous_user_id}:${input.p_message_id}`;
        if (atomicClaims.has(key)) return { ok: true, status: 200, text: async () => JSON.stringify([{ claimed: false, status: "duplicate" }]), json: async () => [{ claimed: false, status: "duplicate" }] };
        atomicClaims.add(key);
        return { ok: true, status: 200, text: async () => JSON.stringify([{ claimed: true, status: "claimed" }]), json: async () => [{ claimed: true, status: "claimed" }] };
      }
      if (url.endsWith("/rpc/complete_assistant_inbound_message")) {
        return { ok: true, status: 200, text: async () => "true", json: async () => true };
      }
      if ((options.method || "GET").toUpperCase() === "POST") {
        const row = JSON.parse(options.body || "{}");
        rows.push(row);
        return { ok: true, status: 201, text: async () => "", json: async () => ({}) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(rows), json: async () => rows };
    }
    outboundCount += 1;
    return { ok: true, json: async () => ({ ok: true }) };
  };

  const event = {
    httpMethod: "POST",
    headers: {},
    body: JSON.stringify({
      entry: [{ changes: [{ value: { messages: [{
        from: "34600000003",
        id: "wamid.retry",
        text: { body: "Hi" },
      }] } }] }],
    }),
  };
  try {
    const [first, second] = await Promise.all([handler(event), handler(event)]);
    assert.strictEqual(first.statusCode, 200, first.body);
    assert.strictEqual(second.statusCode, 200, second.body);
    const results = [JSON.parse(first.body).results[0], JSON.parse(second.body).results[0]];
    assert.strictEqual(results.filter((item) => item.reason === "duplicate_inbound").length, 1);
    assert.strictEqual(outboundCount, 1);
  } finally {
    global.fetch = originalFetch;
    if (previousSupabaseUrl) process.env.SUPABASE_URL = previousSupabaseUrl; else delete process.env.SUPABASE_URL;
    if (previousSupabaseKey) process.env.SUPABASE_SERVICE_ROLE_KEY = previousSupabaseKey; else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (previousAccessToken) process.env.WHATSAPP_ACCESS_TOKEN = previousAccessToken; else delete process.env.WHATSAPP_ACCESS_TOKEN;
    if (previousPhoneId) process.env.WHATSAPP_PHONE_NUMBER_ID = previousPhoneId; else delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  }
}

function notificationCopyRequiresPush() {
  const plan = {
    message_text: "Bloquear tus distracciones ahora durante 10 minutos.",
    actions: [{ type: "start_protection", minutes: 10 }],
    response_language: "es",
    semantic_state: { status: "ready" },
    blocking_ready: true,
  };
  assert.doesNotMatch(whatsappReplyText(plan), /Pulsa la notificaci[oó]n/i);
  assert.doesNotMatch(whatsappReplyText(plan, { action: plan.actions[0], push: { sent: false, reason: "missing_device_token" } }), /Pulsa la notificaci[oó]n/i);
  assert.match(whatsappReplyText(plan, { action: plan.actions[0], push: { sent: true } }), /Pulsa la notificaci[oó]n/i);
  assert.doesNotMatch(whatsappReplyText({ ...plan, semantic_state: { status: "needs_setup" } }, { action: plan.actions[0], push: { sent: true } }), /Pulsa la notificaci[oó]n/i);
}

(async () => {
  notificationCopyRequiresPush();
  await verifyWebhook();
  await receiveMessage();
  await connectMessage();
  await connectGreeting();
  await linkIncludesRequestedApps();
  await twilioButtonTemplateHidesRawUrlFromMainReply();
  await legacyModePhraseUsesCanonicalProtection();
  await categoryRequestUsesSingleSelectionFlow();
  await whatsappAudioInputGetsTranscribedTextReply();
  await duplicateInboundIsIgnoredAcrossRetries();
  console.log("whatsapp-agent smoke tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
