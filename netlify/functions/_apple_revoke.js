"use strict";

const crypto = require("node:crypto");

const APPLE_ORIGIN = "https://appleid.apple.com";
const APPLE_KEYS_URL = `${APPLE_ORIGIN}/auth/keys`;
const APPLE_TOKEN_URL = `${APPLE_ORIGIN}/auth/token`;
const APPLE_REVOKE_URL = `${APPLE_ORIGIN}/auth/revoke`;

function appleError(code, status) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  error.appleAuth = true;
  return error;
}

function configuration(env = process.env) {
  const teamID = String(env.APPLE_SIGN_IN_TEAM_ID || "").trim();
  const keyID = String(env.APPLE_SIGN_IN_KEY_ID || "").trim();
  const clientID = String(env.APPLE_SIGN_IN_CLIENT_ID || "").trim();
  const pem = String(env.APPLE_SIGN_IN_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
  if (!/^[A-Z0-9]{10}$/.test(teamID) || !/^[A-Z0-9]{10}$/.test(keyID)
      || clientID !== "com.blanknfc.app.ios" || !pem) {
    throw appleError("apple_revocation_not_configured", 503);
  }
  let key;
  try { key = crypto.createPrivateKey(pem); } catch (_) { throw appleError("apple_revocation_not_configured", 503); }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw appleError("apple_revocation_not_configured", 503);
  }
  return { teamID, keyID, clientID, key };
}

function clientSecret(config, now = Math.floor(Date.now() / 1000)) {
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: config.keyID })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ iss: config.teamID, iat: now, exp: now + 300,
    aud: APPLE_ORIGIN, sub: config.clientID })).toString("base64url");
  const unsigned = `${header}.${body}`;
  const signature = crypto.sign("sha256", Buffer.from(unsigned), {
    key: config.key, dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `${unsigned}.${signature}`;
}

async function verifiedAppleSubject(idToken, clientID, fetcher = fetch) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw appleError("apple_identity_mismatch", 400);
  let header, claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch (_) { throw appleError("apple_identity_mismatch", 400); }
  if (header.alg !== "RS256" || typeof header.kid !== "string"
      || claims.iss !== APPLE_ORIGIN || claims.aud !== clientID
      || typeof claims.sub !== "string" || !claims.sub
      || !Number.isFinite(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) {
    throw appleError("apple_identity_mismatch", 400);
  }
  let response;
  try { response = await fetcher(APPLE_KEYS_URL, { signal: AbortSignal.timeout(8000) }); }
  catch (_) { throw appleError("apple_verification_unavailable", 503); }
  if (!response.ok) throw appleError("apple_verification_unavailable", 503);
  let keys;
  try { keys = (await response.json()).keys; } catch (_) { throw appleError("apple_verification_unavailable", 503); }
  const jwk = Array.isArray(keys) && keys.find((item) => item.kid === header.kid && item.kty === "RSA" && item.use === "sig");
  if (!jwk) throw appleError("apple_identity_mismatch", 400);
  let valid = false;
  try {
    valid = crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`),
      crypto.createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"));
  } catch (_) { /* Invalid signature or key. */ }
  if (!valid) throw appleError("apple_identity_mismatch", 400);
  return claims.sub;
}

async function revokeAppleAuthorization({ authorizationCode, expectedSubject, env = process.env, fetcher = fetch }) {
  if (typeof authorizationCode !== "string" || !authorizationCode || authorizationCode.length > 4096
      || typeof expectedSubject !== "string" || !expectedSubject) {
    throw appleError("apple_reauthorization_required", 400);
  }
  const config = configuration(env);
  const common = { client_id: config.clientID, client_secret: clientSecret(config) };
  let tokenResponse;
  try {
    tokenResponse = await fetcher(APPLE_TOKEN_URL, { method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...common, grant_type: "authorization_code", code: authorizationCode }),
      signal: AbortSignal.timeout(10000) });
  } catch (_) { throw appleError("apple_verification_unavailable", 503); }
  if (!tokenResponse.ok) throw appleError("apple_reauthorization_failed", 400);
  let tokens;
  try { tokens = await tokenResponse.json(); } catch (_) { throw appleError("apple_verification_unavailable", 503); }
  const subject = await verifiedAppleSubject(tokens.id_token, config.clientID, fetcher);
  if (subject !== expectedSubject) throw appleError("apple_identity_mismatch", 403);
  const token = tokens.refresh_token || tokens.access_token;
  if (typeof token !== "string" || !token) throw appleError("apple_verification_unavailable", 503);
  let revokeResponse;
  try {
    revokeResponse = await fetcher(APPLE_REVOKE_URL, { method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...common, token,
        token_type_hint: tokens.refresh_token ? "refresh_token" : "access_token" }),
      signal: AbortSignal.timeout(10000) });
  } catch (_) { throw appleError("apple_revocation_unavailable", 503); }
  if (!revokeResponse.ok) throw appleError("apple_revocation_unavailable", 503);
}

module.exports = { configuration, clientSecret, verifiedAppleSubject, revokeAppleAuthorization };
