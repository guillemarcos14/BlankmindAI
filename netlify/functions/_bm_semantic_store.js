"use strict";
const { supabaseFetch } = require("./_membership");

function semanticPersistenceRequired() {
  if (process.env.BM_SEMANTIC_PERSISTENCE === "legacy") return false;
  return process.env.BM_SEMANTIC_PERSISTENCE === "required"
    || process.env.NODE_ENV === "production"
    || process.env.CONTEXT === "production"
    || process.env.NETLIFY === "true";
}

function conversationKey(value) {
  if (!/^assistant:[a-f0-9]{32}$/.test(String(value || ""))) throw new Error("semantic_store_invalid_identity");
  return value;
}

async function readSemanticConversation(anonymousUserId, now = Date.now()) {
  const key = conversationKey(anonymousUserId);
  const rows = await supabaseFetch(
    `assistant_semantic_conversations?anonymous_user_id=eq.${encodeURIComponent(key)}&select=state,storage_version,expires_at&limit=1`,
    { method: "GET" },
  );
  if (!Array.isArray(rows)) throw new Error("semantic_store_invalid_read");
  if (!rows.length) return { state: null, storageVersion: 0 };
  const row = rows[0];
  if (!Number.isSafeInteger(row.storage_version) || row.storage_version < 0) throw new Error("semantic_store_invalid_version");
  const expires = Date.parse(row.expires_at || "");
  if (!Number.isFinite(expires)) throw new Error("semantic_store_invalid_expiry");
  // Preserve the CAS version after expiry. The semantic conversation starts fresh.
  return { state: expires > now ? row.state : null, storageVersion: row.storage_version };
}

async function commitSemanticConversation({ anonymousUserId, channel, expectedVersion, state }) {
  const key = conversationKey(anonymousUserId);
  if (channel !== "app") throw new Error("semantic_store_invalid_channel");
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw new Error("semantic_store_missing_version");
  if (!state || typeof state !== "object" || Array.isArray(state) || !state.semantic_state) throw new Error("semantic_store_missing_state");
  if (Buffer.byteLength(JSON.stringify(state), "utf8") > 65536) throw new Error("semantic_store_oversized_state");
  const result = await supabaseFetch("rpc/commit_assistant_semantic_conversation", {
    method: "POST",
    body: JSON.stringify({
      p_anonymous_user_id: key, p_channel: channel, p_expected_version: expectedVersion,
      p_state: state, p_ttl_seconds: 7200,
    }),
  });
  const row = Array.isArray(result) ? result[0] : result;
  if (row?.committed !== true) throw new Error(`semantic_store_${row?.status === "conflict" ? "conflict" : "commit_failed"}`);
  if (row.storage_version !== expectedVersion + 1) throw new Error("semantic_store_invalid_commit_version");
  return { storageVersion: row.storage_version };
}

module.exports = { semanticPersistenceRequired, readSemanticConversation, commitSemanticConversation };
