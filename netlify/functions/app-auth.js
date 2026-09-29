const {
  json,
  parseJsonBody,
  requireMethod,
} = require("./_membership");
const { cleanText } = require("./_identity");

function supabasePublicKey() {
  return process.env.SUPABASE_ANON_KEY
    || process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || "";
}

async function authRequest(path, body, accessToken = "") {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = supabasePublicKey();
  if (!url || !key) throw new Error("supabase_auth_not_configured");
  const response = await fetch(`${url}/auth/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${accessToken || key}`,
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

function bearerToken(event) {
  const headers = event?.headers || {};
  const value = headers.authorization || headers.Authorization || "";
  return /^Bearer\s+(.+)$/i.exec(value)?.[1]?.trim() || "";
}

function sessionResponse(session) {
  const appleIdentity = (session.user?.identities || []).find((identity) => identity.provider === "apple");
  const appleEmail = appleIdentity?.identity_data?.email
    || (session.user?.app_metadata?.provider === "apple" ? session.user?.email : "")
    || "";
  return {
    ok: true,
    access_token: session.access_token || "",
    refresh_token: session.refresh_token || "",
    expires_in: session.expires_in || 0,
    user: session.user || null,
    apple_email: appleEmail,
  };
}

async function signInWithApple(event, body) {
  const idToken = cleanText(body.id_token, 12_000);
  const nonce = cleanText(body.nonce, 128);
  if (!idToken || nonce.length < 32 || nonce.length > 128) {
    return json(400, { error: "invalid_apple_credential" });
  }

  let currentAccessToken = bearerToken(event);
  const refreshToken = cleanText(body.refresh_token, 2048);
  const exchange = (accessToken) => authRequest("token?grant_type=id_token", {
    provider: "apple",
    id_token: idToken,
    nonce,
    ...(accessToken ? { link_identity: true } : {}),
  }, accessToken);

  if (!currentAccessToken && refreshToken) {
    const current = await authRequest("token?grant_type=refresh_token", { refresh_token: refreshToken });
    currentAccessToken = current.access_token || "";
  }

  let session;
  try {
    session = await exchange(currentAccessToken);
  } catch (error) {
    if (error.status !== 401 || !currentAccessToken || !refreshToken) throw error;
    const current = await authRequest("token?grant_type=refresh_token", { refresh_token: refreshToken });
    const refreshedAccessToken = current.access_token || "";
    if (!refreshedAccessToken) throw error;
    session = await exchange(refreshedAccessToken);
  }
  if (!session.access_token || !session.refresh_token || !session.user?.id) {
    return json(502, { error: "app_auth_unavailable" });
  }
  return json(200, sessionResponse(session));
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
    if (action === "sign_in_with_apple") return await signInWithApple(event, body);
    if (action === "refresh_session") return await refreshSession(body);
    return json(400, { error: "unsupported_action" });
  } catch (error) {
    if (error.status === 429) return json(429, { error: "too_many_requests" });
    if ([400, 401, 403, 422].includes(error.status)) return json(400, { error: "account_sign_in_failed" });
    return json(502, { error: "app_auth_unavailable" });
  }
};
