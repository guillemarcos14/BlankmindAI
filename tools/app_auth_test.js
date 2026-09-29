const assert = require("node:assert/strict");
process.env.SUPABASE_URL = "https://auth.example.test";
process.env.SUPABASE_ANON_KEY = "test-public-key";
let upstreamStatus = 200;
let upstreamBody = {};
const calls = [];
global.fetch = async (url, request) => {
  calls.push({ url, request });
  return { ok: upstreamStatus < 300, status: upstreamStatus, text: async () => JSON.stringify(upstreamBody) };
};
const { handler } = require("../netlify/functions/app-auth");
const request = async (body, headers = {}) => {
  const result = await handler({ httpMethod: "POST", headers, body: JSON.stringify(body) });
  return { status: result.statusCode, body: JSON.parse(result.body) };
};

(async () => {
  assert.equal((await request(null)).status, 400);
  assert.equal((await request([])).status, 400);
  assert.equal((await handler({ httpMethod: "POST", body: "{" })).statusCode, 400);
  assert.equal((await request({ action: "refresh_session" })).status, 400);
  assert.equal((await request({ action: "request_otp", phone: "+34123456789" })).body.error, "unsupported_action");
  assert.equal((await request({ action: "verify_otp", phone: "+34123456789", token: "123456" })).body.error, "unsupported_action");
  assert.equal((await request({ action: "sign_in_with_apple", id_token: "token", nonce: "short" })).body.error, "invalid_apple_credential");

  upstreamBody = { access_token: "fresh-access", refresh_token: "rotated-refresh", expires_in: 3600 };
  let result = await request({ action: "refresh_session", refresh_token: "original-refresh" });
  assert.equal(result.status, 200);
  assert.equal(result.body.refresh_token, "rotated-refresh");
  assert.equal(JSON.parse(calls.at(-1).request.body).refresh_token, "original-refresh");
  for (const status of [400, 401, 403]) {
    upstreamStatus = status;
    upstreamBody = { msg: "private token details", error_code: "refresh_token_not_found" };
    result = await request({ action: "refresh_session", refresh_token: "expired" });
    assert.deepEqual(result, { status: 401, body: { error: "session_expired" } });
  }
  upstreamStatus = 429;
  assert.equal((await request({ action: "refresh_session", refresh_token: "still-valid" })).status, 429);
  upstreamStatus = 500;
  result = await request({ action: "refresh_session", refresh_token: "still-valid" });
  assert.deepEqual(result, { status: 502, body: { error: "app_auth_unavailable" } });

  upstreamStatus = 200;
  upstreamBody = { access_token: "apple-access", refresh_token: "apple-refresh", expires_in: 3600, user: { id: "apple-user" } };
  result = await request({ action: "sign_in_with_apple", id_token: "apple-id-token", nonce: "a".repeat(43) });
  assert.equal(result.status, 200);
  assert.equal(result.body.access_token, "apple-access");
  assert.equal(calls.at(-1).url, "https://auth.example.test/auth/v1/token?grant_type=id_token");
  assert.deepEqual(JSON.parse(calls.at(-1).request.body), {
    provider: "apple", id_token: "apple-id-token", nonce: "a".repeat(43),
  });
  assert.equal(calls.at(-1).request.headers.authorization, "Bearer test-public-key");

  await request({ action: "sign_in_with_apple", id_token: "apple-id-token", nonce: "b".repeat(43), refresh_token: "current-refresh" }, {
    authorization: "Bearer current-access",
  });
  assert.deepEqual(JSON.parse(calls.at(-1).request.body), {
    provider: "apple", id_token: "apple-id-token", nonce: "b".repeat(43), link_identity: true,
  });
  assert.equal(calls.at(-1).request.headers.authorization, "Bearer current-access");

  upstreamStatus = 422;
  upstreamBody = { msg: "private provider details", error_code: "identity_conflict" };
  assert.deepEqual(await request({ action: "sign_in_with_apple", id_token: "apple-id-token", nonce: "c".repeat(43) }), {
    status: 400, body: { error: "account_sign_in_failed" },
  });
  console.log("app auth: Apple token sign-in/linking, refresh rotation, legacy OTP removal, rate limits and private error redaction passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
