"use strict";

// Emission is scoped to the current authorized proposal, never to its transport
// or native outcome. A picker carries the executable plan and can apply it
// on dismissal; review-only delivery can also reach the device before presence
// is refreshed. Neither may be sent again merely because setup became ready.
const FINGERPRINT = /^[a-f0-9]{24}$/;
const STAGES = ["permission", "selection", "execution"];

function normalizeSemanticDelivery(input, fingerprint) {
  if (!input || input.version !== 1 || !FINGERPRINT.test(fingerprint || "") || input.proposal_fingerprint !== fingerprint) return null;
  if (!Array.isArray(input.sent) || !input.sent.length || input.sent.some(stage => !STAGES.includes(stage))) return null;
  return { version:1, proposal_fingerprint:fingerprint, sent:STAGES.filter(stage => input.sent.includes(stage)) };
}

function deliveryStage(action) {
  if (action?.type === "request_screen_time_permission") return "permission";
  if (["start_protection", "set_daily_limit", "apply_schedule"].includes(action?.type)) return "execution";
  if (action?.type === "open_app_picker") {
    // These are the payloads the native picker can apply without another turn.
    const duration = Number.isInteger(action.minutes) && action.minutes >= 5 && action.minutes <= 240;
    const schedule = Number.isInteger(action.start_minute) && Number.isInteger(action.end_minute)
      && Array.isArray(action.weekdays) && action.weekdays.length > 0;
    return duration || schedule ? "execution" : "selection";
  }
  return null;
}

function applySemanticDelivery({ delivery, fingerprint, actions = [], legacyActionFingerprint } = {}) {
  let record = normalizeSemanticDelivery(delivery, fingerprint);
  // Preserve pre-marker ready deliveries during rolling upgrades. A legacy
  // fingerprint proves an emitted plan, not a verified device outcome.
  if (!record && FINGERPRINT.test(fingerprint || "") && legacyActionFingerprint === fingerprint) {
    record = { version:1, proposal_fingerprint:fingerprint, sent:["execution"] };
  }
  const sent = new Set(record?.sent || []);
  let suppressed = false;
  const retained = actions.filter(action => {
    const stage = deliveryStage(action);
    if (!stage || !FINGERPRINT.test(fingerprint || "")) return true;
    // The executable envelope owns native permission/selection preflight too.
    // Replacing it with a new setup id could discard a pending plan, or later
    // recreate a plan that the device already applied before its receipt arrived.
    if (sent.has(stage) || sent.has("execution")) { suppressed = true; return false; }
    sent.add(stage);
    return true;
  });
  if (sent.size) record = { version:1, proposal_fingerprint:fingerprint, sent:STAGES.filter(stage => sent.has(stage)) };
  return { actions:retained, delivery:record, suppressed };
}

function renderSuppressedDelivery(language = "en", delivery = null) {
  // Native receipts use a transport action id that does not exist yet in this
  // pure reducer. Do not associate an unrelated last outcome with this marker,
  // or claim pending/success/failure from an acknowledgement such as "Ready".
  const record = normalizeSemanticDelivery(delivery, delivery?.proposal_fingerprint);
  if (record?.sent.includes("permission") && !record.sent.includes("execution")) return language === "es"
    ? "La solicitud de permiso ya se preparó. Abre Blankmind, concede el permiso de bloqueo y dime cuando esté listo para continuar. No repetiré la solicitud de permiso con esta respuesta."
    : "The permission request was already prepared. Open Blankmind, grant blocking permission, then tell me when it's ready to continue. I won't repeat the permission request from this reply.";
  return language === "es"
    ? "Esta solicitud ya se preparó. No la repetiré con esta respuesta. Consulta su resultado en Blankmind. Para intentarlo de nuevo, envía una nueva petición con los ajustes que quieras."
    : "This request was already prepared. I won't repeat it from this reply. Check its result in Blankmind. To try again, make a new request with the settings you want.";
}

module.exports = { normalizeSemanticDelivery, deliveryStage, applySemanticDelivery, renderSuppressedDelivery };
