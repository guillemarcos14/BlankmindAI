const assert = require("assert");

process.env.OPENAI_API_KEY = "";
process.env.BM_SEMANTIC_PERSISTENCE = "legacy"; // Exercises event-store compatibility, not durable CAS.
process.env.SUPABASE_URL = "https://supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.BLANKED_PUBLIC_APP_LINK_BASE = "https://getblank.netlify.app";
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.TWILIO_FROM_NUMBER;
delete process.env.TWILIO_MESSAGING_SERVICE_SID;

const { handler: whatsappHandler, callBlankedAgent } = require("../netlify/functions/whatsapp-agent");
const { handler: smsHandler } = require("../netlify/functions/sms-agent");
const { handler: agentHandler } = require("../netlify/functions/blanked-agent");
const { buildAgentContext } = require("../netlify/functions/bm-context");

function seededMemory() {
  return {
    user_context: {
      has_selected_apps: true,
      selection_count: 3,
      screen_time_authorized: true,
      app_presence: {
        app_present: true,
        app_ready: true,
        last_seen_at: new Date().toISOString(),
      },
    },
  };
}

function seededRow() {
  return {
    payload: {
      event: "assistant_memory_updated",
      properties: { memory: seededMemory() },
    },
    submitted_at: new Date().toISOString(),
  };
}

async function withMemoryStore(callback) {
  const rows = new Map();
  const originalFetch = global.fetch;
  let clock = Date.now();
  global.fetch = async (target, options = {}) => {
    const url = String(target);
    if (!url.startsWith("https://supabase.test/rest/v1/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
        text: async () => "",
      };
    }
    const method = (options.method || "GET").toUpperCase();
    const isMemoryEvent = url.includes("digital_wellness_feature_payloads");
    if (method === "POST" && isMemoryEvent) {
      const row = JSON.parse(options.body || "{}");
      const list = rows.get(row.anonymous_user_id) || [seededRow()];
      list.push({ payload: row.payload, submitted_at: new Date(++clock).toISOString() });
      rows.set(row.anonymous_user_id, list);
      return { ok: true, status: 201, json: async () => ({}), text: async () => "" };
    }
    if (method === "GET" && isMemoryEvent) {
      const match = url.match(/anonymous_user_id=eq\.([^&]+)/);
      const key = match ? decodeURIComponent(match[1]) : "";
      const result = rows.get(key) || [seededRow()];
      return { ok: true, status: 200, json: async () => result, text: async () => JSON.stringify(result) };
    }
    return { ok: true, status: 200, json: async () => [], text: async () => "[]" };
  };
  try {
    return await callback(rows);
  } finally {
    global.fetch = originalFetch;
  }
}

function whatsappEvent(from, textValue, id) {
  return {
    httpMethod: "POST",
    headers: {},
    body: JSON.stringify({
      entry: [{ changes: [{ value: { messages: [{ from, id, text: { body: textValue } }] } }] }],
    }),
  };
}

function smsEvent(from, textValue, id) {
  return {
    httpMethod: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", host: "getblank.netlify.app" },
    body: new URLSearchParams({ From: from, Body: textValue, MessageSid: id }).toString(),
  };
}

async function whatsappKeepsBedtimeQuestion() {
  const outbound = [];
  process.env.WHATSAPP_ACCESS_TOKEN = "test-access-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "test-phone-number-id";
  try {
    await withMemoryStore(async (rows) => {
      const memoryFetch = global.fetch;
      global.fetch = async (target, options = {}) => {
        const url = String(target);
        if (url.startsWith("https://graph.facebook.com/")) {
          outbound.push(JSON.parse(options.body).text.body);
          return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => "" };
        }
        return memoryFetch(target, options);
      };
      try {
        const first = await whatsappHandler(whatsappEvent("34600000010", "How can I scroll less at night?", "wa-memory-1"));
        assert.strictEqual(first.statusCode, 200, first.body);
        const second = await whatsappHandler(whatsappEvent("34600000010", "11pm", "wa-memory-2"));
        assert.strictEqual(second.statusCode, 200, second.body);
        assertRetainedStart(rows);
      } finally {
        global.fetch = memoryFetch;
      }
    });
  } finally {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  }
  assert.ok(outbound.length >= 2, "WhatsApp should send both replies");
  assert.match(outbound[0], /scrolling.*start/i);
  assert.doesNotMatch(outbound[1], /10:30|30 minutes|review-action/);
  assert.doesNotMatch(outbound[1], /I'm here\. Tell me what's going on/i);
}

async function smsKeepsBedtimeQuestion() {
  await withMemoryStore(async (rows) => {
    const first = await smsHandler(smsEvent("+34600000011", "How can I scroll less at night?", "sms-memory-1"));
    assert.strictEqual(first.statusCode, 200, first.body);
    const second = await smsHandler(smsEvent("+34600000011", "11pm", "sms-memory-2"));
    assert.strictEqual(second.statusCode, 200, second.body);
    assertRetainedStart(rows);
    assert.doesNotMatch(second.body, /10:30|30 minutes|review-action/);
    assert.doesNotMatch(second.body, /I'm here\. Tell me what's going on/i);
  });
}

async function webContextKeepsBedtimeQuestion() {
  const first = await agentHandler({
    httpMethod: "POST",
    body: JSON.stringify({
      prompt: "How can I scroll less at night?",
      context: { channel: "web_preview", assistant_channel: "web", web_preview: true },
    }),
  });
  const firstPlan = JSON.parse(first.body).plan;
  const second = await agentHandler({
    httpMethod: "POST",
    body: JSON.stringify({
      prompt: "11pm",
      context: {
        channel: "web_preview",
        assistant_channel: "web",
        web_preview: true,
        recent_messages: [
          { role: "user", content: "How can I scroll less at night?" },
          { role: "assistant", content: firstPlan.message_text },
        ],
      },
    }),
  });
  const secondPlan = JSON.parse(second.body).plan;
  assert.strictEqual(secondPlan.semantic_state.slots.start.value.minute, 1380);
  assert.strictEqual(secondPlan.semantic_state.slots.end, null);
  assert.strictEqual(secondPlan.semantic_state.next_question, "apps");
  assert.deepStrictEqual(secondPlan.actions, []);
  assert.doesNotMatch(secondPlan.message_text, /10:30|30 minutes/);
  assert.doesNotMatch(secondPlan.message_text, /I'm here\. Tell me what's on my mind/i);
}

function assertRetainedStart(rows) {
  const states = [...rows.values()].flat().map(row => row.payload?.properties?.memory?.conversation_state?.semantic_state).filter(Boolean);
  const state = states[states.length - 1];
  assert.ok(state, "canonical state is persisted by the real channel handler");
  assert.strictEqual(state.intent, "advice");
  assert.strictEqual(state.slots.start.value.minute, 1380);
  assert.strictEqual(state.slots.start.source.text, "11pm");
  assert.strictEqual(state.slots.end, null, "bedtime advice never invents a 30-minute window");
  assert.strictEqual(state.next_question, "apps");
}

function expiredConversationIsIgnored() {
  const context = buildAgentContext({
    memory: {
      conversation_state: {
        updated_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        pending_slot: "bedtime",
        recent_messages: [{ role: "assistant", content: "Tell me your usual bedtime." }],
      },
    },
  });
  assert.deepStrictEqual(context.recent_messages, []);
  assert.strictEqual(context.memory.conversation_state, undefined);
}

async function modelFallbackMetadataIsInternal() {
  await withMemoryStore(async () => {
    const memoryFetch = global.fetch;
    const previousKey = process.env.OPENAI_API_KEY;
    let modelRequests = 0;
    let privateBodyReads = 0;
    global.fetch = async (target, options = {}) => {
      const url = String(target);
      if (url === "https://api.openai.com/v1/responses") {
        modelRequests += 1;
        return { ok: false, status: 429, body: { cancel: async () => {} },
          text: async () => { privateBodyReads += 1; return "private provider detail"; } };
      }
      assert.ok(url.startsWith("https://supabase.test/rest/v1/"), "unexpected external request");
      return memoryFetch(target, options);
    };
    try {
      process.env.OPENAI_API_KEY = "";
      const healthy = await callBlankedAgent("Block my selected apps now for 30 minutes once.", "34600000099");
      assert.strictEqual(healthy.modelUnavailable, false);
      assert.strictEqual(modelRequests, 0);
      process.env.OPENAI_API_KEY = "synthetic-test-key-no-network";
      for (const prompt of ["Block my selected apps now for 30 minutes once.", "Cancel this request.", "Stop."]) {
        const before = modelRequests;
        const degraded = await callBlankedAgent(prompt, "34600000099");
        assert.strictEqual(degraded.modelUnavailable, true, prompt);
        assert.strictEqual(modelRequests - before, 1, "HTTP 429 remains fail-fast");
        assert.deepStrictEqual(Object.keys(degraded).sort(), ["context", "modelUnavailable", "plan"]);
        assert.ok(!JSON.stringify(degraded).includes("private provider detail"));
        if (prompt !== "Block my selected apps now for 30 minutes once.") {
          assert.strictEqual(degraded.plan.semantic_state.intent, "cancelled");
          assert.strictEqual(degraded.plan.semantic_state.status, "cancelled");
          assert.strictEqual(degraded.plan.semantic_decision.type, "cancelled");
          assert.deepStrictEqual(degraded.plan.actions, []);
        }
      }
      assert.strictEqual(privateBodyReads, 0);
    } finally {
      process.env.OPENAI_API_KEY = previousKey;
      global.fetch = memoryFetch;
    }
  });
}

(async () => {
  expiredConversationIsIgnored();
  await whatsappKeepsBedtimeQuestion();
  await smsKeepsBedtimeQuestion();
  await webContextKeepsBedtimeQuestion();
  await modelFallbackMetadataIsInternal();
  console.log("assistant conversation memory tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
