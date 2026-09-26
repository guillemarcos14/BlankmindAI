const {
  json,
  parseJsonBody,
  requireMethod,
} = require("./_membership");
const { cleanText, normalizePhone } = require("./_identity");

function supabasePublicKey() {
  return process.env.SUPABASE_ANON_KEY
    || process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || "";
}

async function authRequest(path, body) {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = supabasePublicKey();
  if (!url || !key) throw new Error("supabase_auth_not_configured");
  const response = await fetch(`${url}/auth/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error("supabase_auth_failed");
    error.status = response.status;
    error.code = data.error_code || data.code || "";
    throw error;
  }
  return data;
}

async function requestOtp(body) {
  const phone = normalizePhone(body.phone);
  if (!phone) return json(400, { error: "missing_phone" });
  // Authentication is independent of the assistant channel. An unsolicited
  // WhatsApp OTP requires an approved template and cannot be relied on here.
  await authRequest("otp", { phone, create_user: true, channel: "sms" });
  return json(200, { ok: true, phone_e164: phone, channel: "sms" });
}

async function verifyOtp(body) {
  const phone = normalizePhone(body.phone);
  const token = cleanText(body.token || body.code, 12).replace(/\s/g, "");
  if (!phone || !/^\d{4,8}$/.test(token)) return json(400, { error: "missing_phone_or_code" });
  const session = await authRequest("verify", { phone, token, type: "sms" });
  return json(200, {
    ok: true,
    access_token: session.access_token || "",
    refresh_token: session.refresh_token || "",
    expires_in: session.expires_in || 0,
    user: session.user || null,
  });
}

async function refreshSession(body) {
  const token = cleanText(body.refresh_token, 2048);
  if (!token) return json(400, { error: "missing_refresh_token" });
  let session;
  try { session = await authRequest("token?grant_type=refresh_token", { refresh_token: token }); }
  catch (error) {
    if ([400, 401, 403].includes(error.status)) return json(401, { error: "session_expired" });
    throw error;
  }
  return json(200, {
    ok: true,
    access_token: session.access_token || "",
    refresh_token: session.refresh_token || "",
    expires_in: session.expires_in || 0,
  });
}

exports.handler = async (event) => {
  const methodError = requireMethod(event, "POST");
  if (methodError) return methodError;
  let body;
  try { body = parseJsonBody(event); }
  catch (_) { return json(400, { error: "invalid_json" }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json(400, { error: "invalid_json" });
  try {
    const action = cleanText(body.action, 40).toLowerCase();
    if (action === "request_otp") return await requestOtp(body);
    if (action === "verify_otp") return await verifyOtp(body);
    if (action === "refresh_session") return await refreshSession(body);
    return json(400, { error: "unsupported_action" });
  } catch (error) {
    if (error.status === 429) return json(429, { error: "too_many_requests" });
    if ([400, 401, 403, 422].includes(error.status)) return json(400, { error: "phone_verification_failed" });
    return json(502, { error: "app_auth_unavailable" });
  }
};
