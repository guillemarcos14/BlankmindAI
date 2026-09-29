const crypto = require("crypto");
const { supabaseFetch } = require("./_membership");

function cleanText(value, maxLength = 240) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function normalizePhone(value) {
  let raw = cleanText(value, 80).toLowerCase().replace(/^whatsapp:/, "");
  raw = raw.replace(/[()\s.-]/g, "");
  if (raw.startsWith("00")) raw = `+${raw.slice(2)}`;
  if (raw.startsWith("+")) raw = `+${raw.slice(1).replace(/\D/g, "")}`;
  else raw = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) return raw.length >= 8 ? raw : "";
  return raw.length >= 7 ? raw : "";
}

function newConnectCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(10);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function authUserHasAppleIdentity(user) {
  const metadata = user?.app_metadata && typeof user.app_metadata === "object" ? user.app_metadata : {};
  return metadata.provider === "apple"
    || (Array.isArray(metadata.providers) && metadata.providers.includes("apple"));
}

async function identityForAuthUser(authUserId) {
  const rows = await supabaseFetch(
    `blankmind_identity_links?auth_user_id=eq.${encodeURIComponent(authUserId)}&select=*`,
    { method: "GET" },
  );
  return rows[0] || null;
}

async function identityForPhone(phoneE164) {
  const phone = normalizePhone(phoneE164);
  if (!phone) return null;
  const rows = await supabaseFetch(
    `blankmind_identity_links?phone_e164=eq.${encodeURIComponent(phone)}&select=*`,
    { method: "GET" },
  );
  return rows[0] || null;
}

async function identityForConnectCode(connectCode) {
  const code = cleanText(connectCode, 32).toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(code)) return null;
  const rows = await supabaseFetch(
    `blankmind_identity_links?assistant_connect_code=eq.${encodeURIComponent(code)}&select=*`,
    { method: "GET" },
  );
  return rows[0] || null;
}

async function identityForAppInstall(appInstallId) {
  const installId = cleanText(appInstallId, 160);
  if (!installId) return null;
  const rows = await supabaseFetch(
    `blankmind_identity_links?app_install_id=eq.${encodeURIComponent(installId)}&select=*`,
    { method: "GET" },
  );
  return rows[0] || null;
}

async function ensureIdentityForAuthUser({ authUserId, phoneE164 = "" }) {
  const userId = cleanText(authUserId, 80);
  if (!userId) throw new Error("missing_auth_user_id");
  const phone = normalizePhone(phoneE164);
  const existing = await identityForAuthUser(userId);

  if (phone) {
    const phoneOwner = await identityForPhone(phone);
    if (phoneOwner && phoneOwner.auth_user_id !== userId) {
      throw new Error("identity_phone_conflict");
    }
  }

  if (existing) {
    if (phone && existing.phone_e164 !== phone) {
      const rows = await supabaseFetch(
        `blankmind_identity_links?auth_user_id=eq.${encodeURIComponent(userId)}&select=*`,
        {
          method: "PATCH",
          headers: { prefer: "return=representation" },
          body: JSON.stringify({ phone_e164: phone, updated_at: new Date().toISOString() }),
        },
      );
      return rows[0] || { ...existing, phone_e164: phone };
    }
    return existing;
  }

  const rows = await supabaseFetch("blankmind_identity_links", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({
      auth_user_id: userId,
      phone_e164: phone || null,
      assistant_connect_code: newConnectCode(),
    }),
  });
  return rows[0] || null;
}

async function linkAppInstall({ authUserId, appInstallId }) {
  const userId = cleanText(authUserId, 80);
  const installId = cleanText(appInstallId, 160);
  if (!userId || !installId) throw new Error("missing_identity_link_input");
  const rowsForInstall = await supabaseFetch(
    `blankmind_identity_links?app_install_id=eq.${encodeURIComponent(installId)}&select=auth_user_id`,
    { method: "GET" },
  );
  if (rowsForInstall[0] && rowsForInstall[0].auth_user_id !== userId) {
    throw new Error("identity_app_install_conflict");
  }
  const rows = await supabaseFetch(
    `blankmind_identity_links?auth_user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({ app_install_id: installId, updated_at: new Date().toISOString() }),
    },
  );
  return rows[0] || (await identityForAuthUser(userId));
}

module.exports = {
  cleanText,
  authUserHasAppleIdentity,
  ensureIdentityForAuthUser,
  identityForAppInstall,
  identityForAuthUser,
  identityForConnectCode,
  identityForPhone,
  linkAppInstall,
  normalizePhone,
};
