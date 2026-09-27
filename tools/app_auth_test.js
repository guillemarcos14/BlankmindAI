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
const request = async (body) => {
  const result = await handler({ httpMethod: "POST", body: JSON.stringify(body) });
  return { status: result.statusCode, body: JSON.parse(result.body) };
};

(async () => {
  assert.equal((await request(null)).status, 400);
  assert.equal((await request([])).status, 400);
  assert.equal((await handler({ httpMethod: "POST", body: "{" })).statusCode, 400);
  assert.equal((await request({ action: "refresh_session" })).status, 400);
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
  upstreamStatus = 422;
  assert.equal((await request({ action: "verify_otp", phone: "+34123456789", token: "123456" })).body.error, "phone_verification_failed");
  upstreamStatus = 200;
  assert.equal((await request({ action: "request_otp", phone: "+34123456789" })).status, 200);
  assert.equal(JSON.parse(calls.at(-1).request.body).channel, "sms");
  console.log("app auth: malformed input, token rotation, expired versus transient refresh, rate limit and private error redaction passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
