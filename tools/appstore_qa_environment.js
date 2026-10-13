"use strict";
// Only public flags/voice IDs in the existing isolated QA site. Never exports keys.
const fs = require("node:fs"), path = require("node:path");
const SITE = "2ef5a74e-af70-4893-a5f6-63fb2537720d";
async function main() {
  const apply = process.argv.includes("--configure");
  if (process.argv.slice(2).some(x => x !== "--configure")) throw Error("unsupported_argument");
  const config = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, "netlify/Config/config.json")));
  const token = (config.users[config.userId] || Object.values(config.users)[0]).auth.token;
  async function api(route, method = "GET", body) {
    const r = await fetch("https://api.netlify.com/api/v1" + route, { method,
      headers: { authorization: "Bearer " + token, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw Error("netlify_configuration_http_" + r.status);
    return r.status === 204 ? null : r.json();
  }
  const site = await api("/sites/" + SITE);
  if (site.ssl_url !== "https://blank-product-staging-20260926.netlify.app") throw Error("qa_site_mismatch");
  const route = "/accounts/" + site.account_id + "/env", query = "?site_id=" + SITE;
  let vars = await api(route + query);
  const value = v => v?.values?.find(x => x.context === "production")?.value ?? v?.values?.find(x => x.context === "all")?.value;
  if (value(vars.find(v => v.key === "SUPABASE_URL")) !== "https://njqbovsmoowkhhsqmitn.supabase.co") throw Error("qa_database_mismatch");
  const key = vars.find(v => v.key === "ELEVENLABS_API_KEY");
  const providerKeyConfigured = Boolean(key?.is_secret && key.scopes?.includes("functions") && value(key));
  const desired = { BM_RETRIEVAL_STEP_ENABLED: "true", BM_DECISIONS_DATA_POLICY: "authenticated-account-records",
    BM_RETRIEVAL_STEP_QA_ENABLED: "false", BM_DECISIONS_QA_ENABLED: "false", BM_JEV_SHADOW_ENABLED: "false",
    BM_JEV_PREFETCH_EXPERIMENT: "false", BM_VOICE_PROVIDER: "elevenlabs",
    ELEVENLABS_VOICE_ID_ES: "dNjJKg63Fr5AXwIdkATa", ELEVENLABS_VOICE_ID_EN: "WtA85syCrJwasGeHGH2p",
    BM_VOICE_ENABLED: providerKeyConfigured ? "true" : "false" };
  const changed = [];
  if (apply) for (const [name, wanted] of Object.entries(desired)) {
    const current = vars.find(v => v.key === name);
    if (value(current) === wanted && current.scopes.includes("functions")) continue;
    const values = [...(current?.values || []).filter(x => x.context !== "production"), { context: "production", value: wanted }];
    const body = { key: name, scopes: [...new Set([...(current?.scopes || []), "functions"])], values };
    await api(current ? route + "/" + encodeURIComponent(name) + query : route + query, current ? "PATCH" : "POST", current ? body : [body]);
    changed.push(name);
  }
  if (apply) {
    vars = await api(route + query);
    for (const [name, wanted] of Object.entries(desired)) if (value(vars.find(v => v.key === name)) !== wanted) throw Error("qa_flag_not_saved_" + name);
  }
  const report = { generated_at: new Date().toISOString(), site_id: SITE, configured: apply, changed,
    flags: desired, protected_provider_key_present: providerKeyConfigured, provider_key_tested: false,
    paid_calls: 0, production_mutations: 0, voice_blocker: providerKeyConfigured ? null : "Configure existing ELEVENLABS_API_KEY as a protected Functions/production secret on QA, then rerun --configure." };
  fs.mkdirSync("tmp/appstore-final", { recursive: true });
  fs.writeFileSync("tmp/appstore-final/qa-environment.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
