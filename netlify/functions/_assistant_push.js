const crypto = require("crypto");
const http2 = require("http2");

let cachedProviderToken = null;
let cachedProviderTokenAt = 0;

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function apnsCredentials() {
  const raw = String(process.env.APNS_AUTH_KEY || "").replace(/\\n/g, "\n").trim();
  const compact = raw.match(/^([A-Za-z0-9_-]{43})\.([A-Z0-9]{10})\.([A-Z0-9]{10})$/);
  if (!compact) {
    return {
      privateKey: raw,
      keyId: String(process.env.APNS_KEY_ID || "").trim(),
      teamId: String(process.env.APNS_TEAM_ID || "").trim(),
    };
  }

  const privateScalar = Buffer.from(compact[1], "base64url");
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(privateScalar);
  const publicKey = ecdh.getPublicKey(null, "uncompressed");
  return {
    privateKey: crypto.createPrivateKey({
      format: "jwk",
      key: {
        kty: "EC",
        crv: "P-256",
        d: compact[1],
        x: publicKey.subarray(1, 33).toString("base64url"),
        y: publicKey.subarray(33, 65).toString("base64url"),
      },
    }),
    keyId: compact[2],
    teamId: compact[3],
  };
}

function providerToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedProviderToken && now - cachedProviderTokenAt < 45 * 60) return cachedProviderToken;
  const { keyId, teamId, privateKey } = apnsCredentials();
  if (!keyId || !teamId || !privateKey) return "";
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = base64url(JSON.stringify({ iss: teamId, iat: now }));
  const unsigned = `${header}.${claims}`;
  const signature = crypto.sign("sha256", Buffer.from(unsigned), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  cachedProviderToken = `${unsigned}.${signature}`;
  cachedProviderTokenAt = now;
  return cachedProviderToken;
}

function normalizeDevicePush(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const token = String(value.token || "").replace(/[^a-fA-F0-9]/g, "").toLowerCase();
  if (token.length < 32 || token.length > 200) return null;
  return {
    token,
    environment: String(value.environment || "production").toLowerCase() === "sandbox" ? "sandbox" : "production",
    app_install_id: String(value.app_install_id || "").slice(0, 160),
    updated_at: String(value.updated_at || "").slice(0, 40),
  };
}

function pushPayload(action, options = {}) {
  if (options.notification) return {aps:{alert:{title:"Blankmind",body:options.notification.text},sound:"default"},bm_event_id:options.notification.id,blank_url:"blank://assistant"};
  if (options.silent) return {aps:{"content-available":1},bm_action_id:action.id,bm_autonomous:true};
  const alertBody = action?.type === "open_app_picker"
    ? "Tap to choose your distractions in Blankmind."
    : action?.type === "request_screen_time_permission"
      ? "Tap to finish setting up Blankmind."
      : "Tap to apply this block in Blankmind.";
  return {
    aps: {
      "content-available": 1,
      category: "BM_PENDING_ACTION",
      alert: { title: "Blankmind", body: alertBody },
    },
    bm_action_id: String(action?.id || "").slice(0, 80),
    bm_action_type: String(action?.type || "").slice(0, 60),
    bm_action_created_at: String(action?.created_at || "").slice(0, 40),
    bm_action_expires_at: String(action?.expires_at || "").slice(0, 40),
  };
}

function pushExpiration(action) {
  const expiresAt = Date.parse(action?.expires_at || "");
  const fallback = Date.now() + 2 * 60 * 60 * 1000;
  return Math.floor((Number.isFinite(expiresAt) ? expiresAt : fallback) / 1000);
}

async function sendAssistantActionPushOnce(devicePush, action, options = {}) {
  const device = normalizeDevicePush(devicePush);
  const auth = providerToken();
  const topic = String(process.env.APNS_TOPIC || "com.blanknfc.app.ios").trim();
  if (!device) return { sent: false, reason: "missing_device_token" };
  if (!auth || !topic) return { sent: false, reason: "apns_not_configured" };
  const host = device.environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
  const body = JSON.stringify(pushPayload(action, options));
  const apnsId = crypto.randomUUID();

  return new Promise((resolve) => {
    const client = http2.connect(host);
    let settled = false;
    let timeout;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      client.close();
      resolve(result);
    };
    timeout = setTimeout(() => finish({ sent: false, reason: "apns_timeout" }), 5000);
    client.on("error", (error) => finish({ sent: false, reason: `apns_connection:${error.message}` }));
    const request = client.request({
      ":method": "POST",
      ":path": `/3/device/${device.token}`,
      authorization: `bearer ${auth}`,
      "apns-topic": topic,
      "apns-push-type": options.silent ? "background" : "alert",
      "apns-priority": options.silent ? "5" : "10",
      "apns-expiration": String(pushExpiration(action)),
      "apns-collapse-id": String(action?.id || "blankmind-action").slice(0, 64),
      "apns-id": apnsId,
      "content-type": "application/json",
    });
    let responseBody = "";
    let status = 0;
    request.setEncoding("utf8");
    request.on("response", (headers) => { status = Number(headers[":status"] || 0); });
    request.on("data", (chunk) => { responseBody += chunk; });
    request.on("end", () => finish(status === 200
      ? { sent: true, reason: "", status, apns_id: apnsId, accepted_at: new Date().toISOString() }
      : { sent: false, reason: `apns_${status}:${responseBody.slice(0, 160)}`, status, apns_id: apnsId, attempted_at: new Date().toISOString() }));
    request.on("error", (error) => finish({ sent: false, reason: `apns_request:${error.message}` }));
    request.end(body);
  });
}

async function sendAssistantActionPush(devicePush, action, options = {}) {
  let result = { sent: false, reason: "apns_not_attempted" };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    result = await sendAssistantActionPushOnce(devicePush, action, options);
    result.attempt = attempt;
    if (result.sent) return result;
    const retryableStatus = result.status === 429 || result.status >= 500;
    const retryableTransport = /^apns_(?:timeout|connection|request)/.test(result.reason || "");
    if (!retryableStatus && !retryableTransport) return result;
  }
  return result;
}

const sendBMBNotification = (device,event) => sendAssistantActionPush(device,{id:event.id,expires_at:event.expires_at},{notification:event});
module.exports = { apnsCredentials, normalizeDevicePush, pushPayload, pushExpiration, sendAssistantActionPush, sendBMBNotification };
