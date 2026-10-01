const {
  getSupabaseUser,
  json,
  parseJsonBody,
  requireMethod,
  supabaseFetch,
  supabaseAuthFetch,
} = require("./_membership");
const { decryptToken, revokeToken } = require("./_wearable_oauth");
const { ensureIdentityForAuthUser, identityForAuthUser } = require("./_identity");
const { assistantChannelUserId } = require("./_assistant_channel");
const { revokeAppleAuthorization } = require("./_apple_revoke");

const DATA_TABLES = [
  "digital_wellness_feature_payloads",
  "onboarding_responses",
  "wearable_connections",
  "wearable_feature_snapshots",
  "wearable_recommendation_outcomes",
  "wellness_signal_events",
  "bai_user_plan_outcomes",
  "bai_recommendation_decisions",
  "bai_recommendation_feedback",
  "bai_user_memory_signals",
  "bai_learning_changes",
  "assistant_semantic_conversations",
  "assistant_inbound_messages",
  "bm_loop_runs",
];

function cleanText(value, maxLength = 120) {
  return String(value || "").trim().slice(0, maxLength);
}

function userId(user) {
  return cleanText(user?.id, 80);
}

async function requireUser(event) {
  const user = await getSupabaseUser(event);
  return user && userId(user) ? user : null;
}

async function linkIdentity(event) {
  const user = await requireUser(event);
  if (!user) return json(401, { error: "authentication_required" });
  const body = parseJsonBody(event);
  const anonymousUserId = cleanText(body.anonymous_user_id);
  if (!anonymousUserId || body.data_consent !== true) {
    return json(400, { error: "missing_consent_or_user_id" });
  }

  await ensureIdentityForAuthUser({
    authUserId: userId(user),
    phoneE164: user.phone || "",
  });

  await supabaseFetch("privacy_user_links?on_conflict=auth_user_id", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      auth_user_id: userId(user),
      anonymous_user_id: anonymousUserId,
      updated_at: new Date().toISOString(),
    }),
  });
  await supabaseFetch(`blankmind_identity_links?auth_user_id=eq.${encodeURIComponent(userId(user))}`, {
    method: "PATCH",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ anonymous_user_id: anonymousUserId, updated_at: new Date().toISOString() }),
  });
  return json(200, { ok: true });
}

async function linkedAnonymousIds(authUserId) {
  const rows = await supabaseFetch(
    `privacy_user_links?auth_user_id=eq.${encodeURIComponent(authUserId)}&select=anonymous_user_id`,
    { method: "GET" },
  );
  return rows.map((row) => cleanText(row.anonymous_user_id)).filter(Boolean);
}

async function revokeWearableTokens(anonymousIds) {
  for (const anonymousUserId of anonymousIds) {
    const rows = await supabaseFetch(
      `wearable_connections?anonymous_user_id=eq.${encodeURIComponent(anonymousUserId)}&select=provider,encrypted_access_token,encrypted_refresh_token`,
      { method: "GET" },
    );
    for (const row of rows) {
      const encrypted = row.encrypted_refresh_token || row.encrypted_access_token;
      if (!encrypted) continue;
      try {
        await revokeToken(row.provider, decryptToken(encrypted));
      } catch (_) {
        // Deletion continues even if an external provider is unavailable.
      }
    }
  }
}

async function deleteData(event, requireAppleRevocation = false) {
  const user = await requireUser(event);
  if (!user) return json(401, { error: "authentication_required" });
  const authUserId = userId(user);
  if (requireAppleRevocation) {
    const appleIdentity = (user.identities || []).find((item) => item.provider === "apple");
    const appleSubject = appleIdentity?.identity_data?.sub || appleIdentity?.id;
    if (!appleSubject) return json(409, { error: "apple_identity_unavailable" });
    await revokeAppleAuthorization({
      authorizationCode: parseJsonBody(event).apple_authorization_code,
      expectedSubject: appleSubject,
    });
  }
  const ids = await linkedAnonymousIds(authUserId);
  const identity = await identityForAuthUser(authUserId);
  if (identity?.assistant_connect_code) ids.push(`connect:${identity.assistant_connect_code}`);
  if (identity?.anonymous_user_id) ids.push(identity.anonymous_user_id);
  ids.push(assistantChannelUserId("app", authUserId));
  if (identity?.phone_e164) {
    ids.push(assistantChannelUserId("whatsapp", identity.phone_e164));
    ids.push(assistantChannelUserId("sms", identity.phone_e164));
  }

  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));

  await revokeWearableTokens(uniqueIds);
  await supabaseFetch(`assistant_app_turns?auth_user_id=eq.${encodeURIComponent(authUserId)}`, {
    method: "DELETE",
    headers: { prefer: "return=minimal" },
  });
  if (identity?.assistant_connect_code) {
    await supabaseFetch(`bm_legacy_context_snapshots?connect_code=eq.${encodeURIComponent(identity.assistant_connect_code)}`, {
      method: "DELETE",
      headers: { prefer: "return=minimal" },
    });
  }
  for (const anonymousUserId of uniqueIds) {
    for (const table of DATA_TABLES) {
      await supabaseFetch(`${table}?anonymous_user_id=eq.${encodeURIComponent(anonymousUserId)}`, {
        method: "DELETE",
        headers: { prefer: "return=minimal" },
      });
    }
  }

  await supabaseFetch(`referral_codes?auth_user_id=eq.${encodeURIComponent(authUserId)}`, {
    method: "DELETE",
    headers: { prefer: "return=minimal" },
  });
  await supabaseFetch(`privacy_user_links?auth_user_id=eq.${encodeURIComponent(authUserId)}`, {
    method: "DELETE",
    headers: { prefer: "return=minimal" },
  });
  await supabaseFetch(`app_handoffs?auth_user_id=eq.${encodeURIComponent(authUserId)}`, {
    method: "DELETE",
    headers: { prefer: "return=minimal" },
  });
  await supabaseFetch(`bm_user_context_snapshots?user_id=eq.${encodeURIComponent(authUserId)}`, {
    method: "DELETE",
    headers: { prefer: "return=minimal" },
  });
  await supabaseFetch(`blankmind_identity_links?auth_user_id=eq.${encodeURIComponent(authUserId)}`, {
    method: "DELETE",
    headers: { prefer: "return=minimal" },
  });
  await supabaseFetch(`waitlist_users?auth_user_id=eq.${encodeURIComponent(authUserId)}`, {
    method: "DELETE",
    headers: { prefer: "return=minimal" },
  });

  // The client confirms the destructive action before calling this endpoint.
  await supabaseAuthFetch(`admin/users/${encodeURIComponent(authUserId)}`, {
    method: "DELETE",
  });
  return json(200, { ok: true, deleted: true });
}

exports.handler = async (event) => {
  const methodError = requireMethod(event, "POST");
  if (methodError) return methodError;
  try {
    const action = cleanText(parseJsonBody(event).action, 40) || "link";
    if (action === "link") return await linkIdentity(event);
    if (action === "delete") return await deleteData(event);
    if (action === "delete_apple") return await deleteData(event, true);
    return json(400, { error: "unsupported_action" });
  } catch (error) {
    if (error.appleAuth) return json(error.status, { error: error.code });
    return json(500, { error: "account_data_request_failed", detail: error.message });
  }
};
