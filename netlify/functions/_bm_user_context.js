"use strict";

const { supabaseFetch } = require("./_membership");

function clean(value, max = 160) {
  return String(value == null ? "" : value).trim().replace(/\s+/g, " ").slice(0, max);
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function safeRows(path) {
  try {
    const rows = await supabaseFetch(path, { method: "GET" });
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

async function canonicalIdentity(connectCode) {
  const code = clean(connectCode, 32).toUpperCase();
  if (!code) return null;
  // Local contract tests intentionally run without a Supabase environment.
  // A partially configured or failing production environment still throws.
  if (!process.env.SUPABASE_URL && !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const rows = await supabaseFetch(`blankmind_identity_links?assistant_connect_code=eq.${encodeURIComponent(code)}&select=auth_user_id,anonymous_user_id,assistant_connect_code&limit=1`, { method: "GET" });
  return rows[0] || null;
}

function verifiedIdentity(connectCode, identity) {
  return identity?.auth_user_id && clean(identity.assistant_connect_code, 32).toUpperCase() === clean(connectCode, 32).toUpperCase() ? identity : null;
}

async function persistCanonicalSnapshot(connectCode, context, source = "assistant_context_sync", options = {}) {
  const code = clean(connectCode, 32).toUpperCase();
  if (!code || !safeObject(context).anonymous_user_id) return null;
  const identity = verifiedIdentity(code, options.identity) || await canonicalIdentity(code);
  if (!identity?.auth_user_id) {
    const legacyRows = await supabaseFetch("rpc/upsert_bm_legacy_user_context", {
      method: "POST",
      body: JSON.stringify({
        p_connect_code: code,
        p_context: context,
        p_source: clean(source, 80) || "app",
      }),
    });
    return Array.isArray(legacyRows) ? legacyRows[0] || null : legacyRows;
  }
  const rows = await supabaseFetch("rpc/upsert_bm_user_context", {
    method: "POST",
    body: JSON.stringify({
      p_connect_code: code,
      p_anonymous_user_id: clean(context.anonymous_user_id, 120),
      p_context: context,
      p_source: clean(source, 80) || "app",
    }),
  });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

async function enrichAssistantContext(input = {}, connectCode = "", options = {}) {
  const base = safeObject(input);
  const identity = verifiedIdentity(connectCode, options.identity) || await canonicalIdentity(connectCode);
  const snapshotRows = identity?.auth_user_id
    ? await supabaseFetch(`bm_user_context_snapshots?user_id=eq.${encodeURIComponent(identity.auth_user_id)}&select=anonymous_user_id,context,context_version,updated_at&limit=1`, { method: "GET" })
    : await safeRows(`bm_legacy_context_snapshots?connect_code=eq.${encodeURIComponent(clean(connectCode, 32).toUpperCase())}&select=context,context_version,updated_at&limit=1`);
  const snapshot = snapshotRows[0] || {};
  const durableContext = safeObject(snapshot.context);
  // The canonical app snapshot is authoritative. Channel memory may lag when
  // several iOS syncs complete out of order and must never overwrite it.
  const mergedBase = { ...base, ...durableContext };
  const anonymousUserId = clean(mergedBase.anonymous_user_id || identity?.anonymous_user_id || snapshot.anonymous_user_id, 120);
  if (!anonymousUserId) return mergedBase;

  return {...mergedBase, anonymous_user_id:anonymousUserId,
    canonical_user_id:clean(identity?.auth_user_id,80)};
}

module.exports = { canonicalIdentity, enrichAssistantContext, persistCanonicalSnapshot };
