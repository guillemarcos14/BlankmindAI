"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { configuration, resolvedConfiguration, clientSecret } = require("../netlify/functions/_apple_revoke");
const pair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const stored = { APPLE_SIGN_IN_TEAM_ID: "ABCDEFGHIJ", APPLE_SIGN_IN_KEY_ID: "KLMNOPQRST", APPLE_SIGN_IN_CLIENT_ID: "com.blanknfc.app.ios",
  APPLE_SIGN_IN_PRIVATE_KEY: pair.privateKey.export({ type: "pkcs8", format: "pem" }) };
const server = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "server-only" };
(async () => {
  let calls = 0;
  const read = async () => { calls++; return stored; };
  const fromEnv = await resolvedConfiguration(stored, read);
  assert.equal(calls, 0);
  assert.equal(fromEnv.clientID, configuration(stored).clientID);
  const fromVault = await resolvedConfiguration(server, read);
  assert.equal(calls, 1);
  const jwt = clientSecret(fromVault).split(".");
  assert(crypto.verify("sha256", Buffer.from(jwt.slice(0, 2).join(".")), { key: pair.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(jwt[2], "base64url")));
  await assert.rejects(resolvedConfiguration({ ...server, APPLE_SIGN_IN_KEY_ID: "bad" }, read), /apple_revocation_not_configured/);
  assert.equal(calls, 1);
  for (const value of [null, [], {}, { ...stored, APPLE_SIGN_IN_CLIENT_ID: "another.app" }]) {
    await assert.rejects(resolvedConfiguration(server, async () => value), /apple_revocation_not_configured/);
  }
  await assert.rejects(resolvedConfiguration(server, async () => { throw Error("do not leak upstream secrets"); }), error => error.message === "apple_revocation_not_configured" && error.status === 503);
  await assert.rejects(resolvedConfiguration({}, read), /apple_revocation_not_configured/);
  console.log("PASS Vault configuration, signed client secret, explicit-key precedence and safe failures");
})().catch(error => { console.error(error.message); process.exitCode = 1; });
