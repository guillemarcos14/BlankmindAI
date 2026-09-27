"use strict";

const { firstPendingAction } = require("./bm-pending-action");
const { semanticSummary } = require("./bm-semantic-state");
const { supersededAssistantReply } = require("./_assistant_channel");

function clean(value) { return String(value || "").trim().replace(/\s+/g," ").slice(0,1200); }

function actionSummary(action, spanish) {
  let type = action.type;
  if (type === "open_app_picker") type = action.name === "Daily Limit" && Number.isInteger(action.minutes) ? "set_daily_limit"
    : Number.isInteger(action.start_minute) && Number.isInteger(action.end_minute) ? "apply_schedule" : Number.isInteger(action.minutes) ? "start_protection" : type;
  if (type === "start_protection" && Number.isInteger(action.minutes)) return spanish
    ? `Bloqueo${action.hard_mode ? " estricto" : ""} de ${action.minutes} minutos para tus distracciones seleccionadas.`
    : `A ${action.minutes}-minute${action.hard_mode ? " hard" : ""} block for your selected distractions.`;
  if (type === "set_daily_limit" && Number.isInteger(action.minutes)) return spanish
    ? `Límite de ${action.minutes} minutos al día para tus distracciones seleccionadas.`
    : `A limit of ${action.minutes} minutes per day for your selected distractions.`;
  if (["apply_schedule", "update_schedule"].includes(type) && Number.isInteger(action.start_minute) && Number.isInteger(action.end_minute)) {
    const clock = minute => { const safe=Math.max(0,Math.min(1439,minute)); return `${String(Math.floor(safe / 60)).padStart(2,"0")}:${String(safe % 60).padStart(2,"0")}`; };
    // Native actions use Calendar weekdays: Sunday=1, unlike semantic ISO weekdays.
    const names = spanish ? ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"]
      : ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    const weekdays = [...new Set(action.weekdays || [])].filter(day => Number.isInteger(day) && day >= 1 && day <= 7);
    const repeat = weekdays.length === 7 || weekdays.length === 0 ? (spanish ? ", cada día" : ", every day")
      : weekdays.length ? `, ${weekdays.map(day => names[day - 1]).join(", ")}` : "";
    const days = Math.max(1,Math.min(14,Number.isInteger(action.duration_days) ? action.duration_days : 7));
    const horizon = type === "update_schedule" ? (spanish ? ", conservando su vencimiento actual" : ", keeping its existing expiry")
      : (spanish ? `, durante ${days} días` : `, for ${days} days`);
    const strict = action.hard_mode ? (spanish ? " estricto" : " hard") : "";
    return spanish ? `Bloqueo${strict} de tus distracciones seleccionadas de ${clock(action.start_minute)} a ${clock(action.end_minute)}${repeat}${horizon}.`
      : `A${strict} block for your selected distractions from ${clock(action.start_minute)} to ${clock(action.end_minute)}${repeat}${horizon}.`;
  }
  return "";
}

// Delivery claims belong to the transport, never the planner's model text.
// Both providers use the same action/permission distinction and receipt gate.
function assistantReplyText(plan = {}, delivery = null, channel = "whatsapp") {
  if (delivery?.action?.status === "superseded") return supersededAssistantReply(plan);
  const action = firstPendingAction(plan);
  const text = clean(plan.message_text || plan.response_text) || "I can help with that in Blankmind.";
  if (!action) return text;
  const spanish = String(plan.response_language || plan.semantic_state?.language || "").startsWith("es");
  const state = plan.semantic_state;
  let summary = actionSummary(action, spanish);
  if (state?.intent === "block" && state.slots?.start?.value && state.slots?.duration_minutes?.value && state.slots?.recurrence?.value) {
    summary = `${semanticSummary(state)}.`;
  }
  const prefix = summary ? `${summary} ` : "";
  const setup = ["open_app_picker","request_screen_time_permission"].includes(action.type);
  if (plan.review_only_actions === true || (state?.status === "needs_setup" && !setup)) {
    return prefix + (spanish ? "Abre Blankmind para conectar tu dispositivo y continuar. La ejecución no está verificada."
      : "Open Blankmind to connect your device and continue. Execution is not verified.");
  }
  if (!delivery?.action) {
    return prefix + (spanish ? `Aún no he enviado la solicitud. Abre Blankmind para conectar este ${channel === "sms" ? "número" : "WhatsApp"} y vuelve a pedírmelo.`
      : `I haven't sent the request yet. Open Blankmind to connect this ${channel === "sms" ? "number" : "WhatsApp"}, then ask me again.`);
  }
  if (delivery.push?.sent !== true) {
    const status = delivery.push ? (spanish ? "He guardado la solicitud, pero no he podido enviar la notificación. " : "I've saved the request, but couldn't send a notification. ")
      : (spanish ? "La solicitud está guardada. " : "The request is saved. ");
    const step = action.type === "request_screen_time_permission"
      ? (spanish ? "Abre Blankmind, concede el permiso de bloqueo y dime cuando esté listo para continuar." : "Open Blankmind, grant blocking permission, then tell me when it's ready to continue.")
      : action.type === "open_app_picker"
        ? (spanish ? "Abre Blankmind para continuar con la selección de distracciones pendiente." : "Open Blankmind to continue with the pending distraction selection.")
        : (spanish ? "Abre Blankmind para continuar con esta solicitud. La ejecución no está verificada." : "Open Blankmind to continue with this request. Execution is not verified.");
    return prefix + status + step;
  }
  if (action.type === "request_screen_time_permission") return prefix + (spanish
    ? "Pulsa la notificación de Blankmind y concede el permiso de bloqueo, después dime cuando esté listo para continuar."
    : "Tap the Blankmind notification and grant blocking permission, then tell me when it's ready to continue.");
  if (action.type === "open_app_picker" && !actionSummary(action, spanish)) return prefix + (spanish
    ? "Pulsa la notificación de Blankmind para elegir tus distracciones y continuar. Todavía no hay una propuesta de bloqueo completa."
    : "Tap the Blankmind notification to choose your distractions and continue. There is no complete blocking proposal yet.");
  if (action.type === "open_app_picker") return prefix + (spanish
    ? "Pulsa la notificación de Blankmind para elegir tus distracciones y acepta la selección para aplicar esta propuesta. El resultado requiere verificación del dispositivo."
    : "Tap the Blankmind notification to choose your distractions, then confirm the selection to apply this proposal. The result needs verification from your device.");
  return prefix + (spanish
    ? "Pulsa la notificación de Blankmind para aplicar la solicitud. Solo confirmaré el éxito cuando el dispositivo lo verifique."
    : "Tap the Blankmind notification to apply the request. I'll only confirm success after your device verifies it.");
}

module.exports = { assistantReplyText };
