const crypto = require("crypto");

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-allow-methods": "POST, OPTIONS",
};

const PLAN_CONFIG = {
  trial: { status: "trial_active", maxDevices: 1, trialDays: 30 },
  monthly: { status: "active", maxDevices: 1, periodDays: 30 },
  annual: { status: "active", maxDevices: 1, periodDays: 365 },
  family: { status: "active", maxDevices: 5, periodDays: 365 },
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  };
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function codeHash(code) {
  return crypto.createHash("sha256").update(normalizeCode(code)).digest("hex");
}

function generateActivationCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(8);
  let raw = "";
  for (const byte of bytes) {
    raw += alphabet[byte % alphabet.length];
  }
  return `BLANK-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function entitlementFromRecord(record) {
  const trialEndsAt = record.trial_ends_at;
  const periodEndsAt = record.current_period_ends_at;
  const validUntil = trialEndsAt || periodEndsAt;
  const expired = ["trial_active", "active"].includes(record.status)
    && validUntil
    && new Date(validUntil).getTime() <= Date.now();

  return {
    status: expired ? "expired" : record.status,
    plan: record.plan,
    max_devices: record.max_devices,
    trial_ends_at: trialEndsAt,
    current_period_ends_at: periodEndsAt,
  };
}

function recordGrantsAccess(record) {
  return ["trial_active", "active"].includes(entitlementFromRecord(record).status);
}

function getRawBody(event) {
  if (!event.body) return "";
  return event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
}

function timingSafeEqual(left, right) {
  const leftBuffer = Buffer.from(left || "");
  const rightBuffer = Buffer.from(right || "");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyShopifyWebhook(event) {
  const token = process.env.SHOPIFY_WEBHOOK_TOKEN;
  const requestToken = event.queryStringParameters?.token;
  if (token && timingSafeEqual(token, requestToken)) {
    return;
  }

  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("Shopify webhook authentication is not configured");
  }

  const header = event.headers["x-shopify-hmac-sha256"] || event.headers["X-Shopify-Hmac-Sha256"];
  const digest = crypto.createHmac("sha256", secret).update(getRawBody(event), "utf8").digest("base64");
  if (!timingSafeEqual(digest, header)) {
    throw new Error("Invalid Shopify webhook signature");
  }
}

function requireMethod(event, method) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: JSON_HEADERS,
      body: "",
    };
  }
  if (event.httpMethod !== method) {
    return json(405, { error: "method_not_allowed" });
  }
  return null;
}

function parseJsonBody(event) {
  const raw = getRawBody(event);
  if (!raw) return {};
  return JSON.parse(raw);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

async function supabaseFetch(path, options = {}) {
  return require("./bm-turn-timing").span("database", () => supabaseRequest(path, options));
}

async function supabaseRequest(path, options = {}) {
  const url = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...options.headers,
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const detail = data?.message || data?.hint || response.statusText;
    throw new Error(`Supabase request failed: ${detail}`);
  }
  return data;
}

function bearerToken(event) {
  const headers = event?.headers || {};
  const value = headers.authorization || headers.Authorization || "";
  return /^Bearer\s+(.+)$/i.exec(value)?.[1]?.trim() || null;
}

async function supabaseAuthFetch(path, options = {}) {
  const url = requireEnv("SUPABASE_URL").replace(/\/$/, "");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${url}/auth/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...options.headers,
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const detail = data?.msg || data?.message || response.statusText;
    throw new Error(`Supabase auth request failed: ${detail}`);
  }
  return data;
}

async function getSupabaseUser(event) {
  const token = bearerToken(event);
  if (!token) return null;
  try {
    return await supabaseAuthFetch("user", {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (_) {
    return null;
  }
}

async function findMembershipByCode(code) {
  const hash = codeHash(code);
  const rows = await supabaseFetch(
    `membership_codes?code_hash=eq.${encodeURIComponent(hash)}&select=*`,
    { method: "GET" }
  );
  return rows[0] || null;
}

async function findMembershipByOrder(orderId) {
  const rows = await supabaseFetch(
    `membership_codes?shopify_order_id=eq.${encodeURIComponent(orderId)}&select=*`,
    { method: "GET" }
  );
  return rows[0] || null;
}

async function createMembership(record) {
  const rows = await supabaseFetch("membership_codes?select=*", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(record),
  });
  return rows[0];
}

async function patchMembership(id, updates) {
  const rows = await supabaseFetch(`membership_codes?id=eq.${encodeURIComponent(id)}&select=*`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(updates),
  });
  return rows[0];
}

async function listDevices(membershipId) {
  return supabaseFetch(
    `membership_devices?membership_id=eq.${encodeURIComponent(membershipId)}&revoked_at=is.null&select=*`,
    { method: "GET" }
  );
}

async function touchDevice(membershipId, appInstallId, platform) {
  const existing = await supabaseFetch(
    `membership_devices?membership_id=eq.${encodeURIComponent(membershipId)}&app_install_id=eq.${encodeURIComponent(appInstallId)}&select=*`,
    { method: "GET" }
  );

  if (existing[0]) {
    return supabaseFetch(`membership_devices?id=eq.${encodeURIComponent(existing[0].id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        platform: platform || existing[0].platform,
        last_seen_at: new Date().toISOString(),
        revoked_at: null,
      }),
    });
  }

  return supabaseFetch("membership_devices", {
    method: "POST",
    body: JSON.stringify({
      membership_id: membershipId,
      app_install_id: appInstallId,
      platform: platform || "ios",
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    }),
  });
}

function parseVariantId(lineItem) {
  return [
    lineItem.variant_id,
    lineItem.variant_admin_graphql_api_id,
    lineItem.admin_graphql_api_id,
    lineItem.sku,
  ]
    .filter(Boolean)
    .map(String);
}

function parseSellingPlanIds(lineItem) {
  const allocation = lineItem.selling_plan_allocation || {};
  const sellingPlan = allocation.selling_plan || lineItem.selling_plan || {};
  return [
    lineItem.selling_plan_id,
    lineItem.selling_plan_gid,
    lineItem.selling_plan_name,
    sellingPlan.id,
    sellingPlan.admin_graphql_api_id,
    sellingPlan.name,
    allocation.selling_plan_id,
    allocation.selling_plan_name,
  ]
    .filter(Boolean)
    .map(String);
}

function planTextFromLineItem(lineItem) {
  const allocation = lineItem.selling_plan_allocation || {};
  const sellingPlan = allocation.selling_plan || lineItem.selling_plan || {};
  const properties = Array.isArray(lineItem.properties)
    ? lineItem.properties.map((property) => `${property.name || ""} ${property.value || ""}`).join(" ")
    : "";

  return [
    lineItem.title,
    lineItem.name,
    lineItem.variant_title,
    lineItem.sku,
    lineItem.selling_plan_name,
    allocation.selling_plan_name,
    sellingPlan.name,
    sellingPlan.description,
    properties,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function planFromText(text) {
  if (!text) return null;
  if (text.includes("familiar") || text.includes("family")) return "family";
  if (text.includes("mensual") || text.includes("monthly") || text.includes("/mes")) return "monthly";
  if (text.includes("prueba") || text.includes("trial") || text.includes("30 dias gratis") || text.includes("30 días gratis")) return "trial";
  if (text.includes("anual") || text.includes("annual") || text.includes("/ano") || text.includes("/año")) return "annual";
  return null;
}

function planFromOrder(order) {
  const sellingPlanMappings = [
    ["trial", process.env.SHOPIFY_TRIAL_SELLING_PLAN_IDS],
    ["monthly", process.env.SHOPIFY_MONTHLY_SELLING_PLAN_IDS],
    ["annual", process.env.SHOPIFY_ANNUAL_SELLING_PLAN_IDS],
    ["family", process.env.SHOPIFY_FAMILY_SELLING_PLAN_IDS],
  ].map(([plan, value]) => [
    plan,
    new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean)),
  ]);

  for (const item of order.line_items || []) {
    const ids = parseSellingPlanIds(item);
    for (const [plan, allowedIds] of sellingPlanMappings) {
      if (ids.some((id) => allowedIds.has(id))) {
        return plan;
      }
    }
  }

  for (const item of order.line_items || []) {
    const plan = planFromText(planTextFromLineItem(item));
    if (plan) return plan;
  }

  const variantMappings = [
    ["trial", process.env.SHOPIFY_TRIAL_VARIANT_IDS],
    ["monthly", process.env.SHOPIFY_MONTHLY_VARIANT_IDS],
    ["annual", process.env.SHOPIFY_ANNUAL_VARIANT_IDS],
    ["family", process.env.SHOPIFY_FAMILY_VARIANT_IDS],
  ].map(([plan, value]) => [
    plan,
    new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean)),
  ]);

  for (const item of order.line_items || []) {
    const ids = parseVariantId(item);
    for (const [plan, allowedIds] of variantMappings) {
      if (ids.some((id) => allowedIds.has(id))) {
        return plan;
      }
    }
  }

  return null;
}

function buildMembershipRecord({ order, plan, code }) {
  const config = PLAN_CONFIG[plan] || PLAN_CONFIG.annual;
  const email = order.email || order.contact_email || order.customer?.email || null;
  const now = new Date().toISOString();

  return {
    activation_code: code,
    code_hash: codeHash(code),
    status: config.status,
    plan,
    max_devices: config.maxDevices,
    shopify_order_id: String(order.id || order.admin_graphql_api_id || order.name),
    shopify_order_name: order.name || null,
    shopify_confirmation_number: order.confirmation_number ? String(order.confirmation_number) : null,
    shopify_customer_id: order.customer?.id ? String(order.customer.id) : null,
    shopify_subscription_id: null,
    customer_email: email,
    trial_ends_at: config.trialDays ? daysFromNow(config.trialDays) : null,
    current_period_ends_at: config.periodDays ? daysFromNow(config.periodDays) : null,
    created_at: now,
    updated_at: now,
  };
}

async function sendActivationEmail({ to, code, plan }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const replyTo = process.env.RESEND_REPLY_TO_EMAIL;
  if (!apiKey || !from || !to) return { skipped: true };

  const subject = "Tu codigo de activacion de Blank";
  const text = [
    "Tu membresia Blank esta lista.",
    "",
    `Codigo de activacion: ${code}`,
    "",
    "Abre la app Blank e introduce este codigo para activar tu acceso.",
    "",
    `Plan: ${plan}`,
  ].join("\n");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Resend request failed: ${detail}`);
  }
  return response.json();
}

module.exports = {
  PLAN_CONFIG,
  buildMembershipRecord,
  codeHash,
  createMembership,
  entitlementFromRecord,
  findMembershipByCode,
  findMembershipByOrder,
  generateActivationCode,
  json,
  listDevices,
  normalizeCode,
  parseJsonBody,
  patchMembership,
  planFromOrder,
  recordGrantsAccess,
  bearerToken,
  getSupabaseUser,
  requireMethod,
  sendActivationEmail,
  supabaseFetch,
  supabaseAuthFetch,
  timingSafeEqual,
  touchDevice,
  verifyShopifyWebhook,
};
