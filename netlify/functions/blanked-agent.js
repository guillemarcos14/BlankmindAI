const crypto = require("crypto");
const { json, parseJsonBody, requireMethod } = require("./_membership");
const {
  createRun,
  recordStage,
  finishRun,
  publicMeta,
  planSummary,
} = require("./bm-harness");
const {
  createLoop,
  publicLoop,
  loopSummary,
} = require("./bm-loop");
const { buildAgentContext, deriveAppPresence } = require("./bm-context");
const { advanceSemanticState } = require("./bm-semantic-state");
const { extractWithModel } = require("./bm-semantic-extraction");
const { personalizedRecommendationPlan, scheduleManagementPlan } = require("./bm-schedule-management");
const { naturalizeGroundedPlan, plannerAuthorityViolations } = require("./bm-contextual-response");
const { personalContextView } = require("./bm-personal-context-view");
const { BM_CONVERSATIONAL_TONE } = require("./_bm_tone");
const {
  incompleteBlockingPlan,
  isBlockingActionType,
  publicBlockingData,
  resolveBlockingContract,
} = require("./bm-blocking-contract");

function cleanText(value, maxLength = 240) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function paddedText(value, maxLength = 600) {
  return ` ${cleanText(value, maxLength).toLowerCase()} `;
}

function cleanNumber(value, fallback, min, max) {
  const number = Number(value);
  const resolved = Number.isFinite(number) ? Math.round(number) : fallback;
  return Math.min(max, Math.max(min, resolved));
}

function contains(text, needles) {
  return needles.some((needle) => text.includes(needle));
}

function userFacingText(value, maxLength = 140) {
  return cleanText(value, maxLength)
    .replace(/\bI'?ve set\b/gi, "I can set")
    .replace(/\bI have set\b/gi, "I can set")
    .replace(/\bI created\b/gi, "I can create")
    .replace(/\bI'?ll set\b/gi, "I can set")
    .replace(/\bHe preparado\b/gi, "Puedo preparar")
    .replace(/\bHe creado\b/gi, "Puedo crear")
    .replace(/\bConfiguraré\b/gi, "Puedo configurar")
    .replace(/\bVoy a configurar\b/gi, "Puedo configurar")
    .replace(/\bVoy a preparar\b/gi, "Puedo preparar")
    .replace(/\bask the user\b/gi, "tell me")
    .replace(/\bask user\b/gi, "tell me")
    .replace(/\bthe user\b/gi, "you")
    .replace(/\buser's\b/gi, "your")
    .replace(/\buser\b/gi, "you");
}

function naturalChannelText(value, maxLength = 320) {
  return userFacingText(value, maxLength)
    .replace(/\b(Read|Pattern|Move|Signal|Feedback|Protection|Lectura|Patrón|Movimiento|Señal|Protección):\s*/gi, "")
    .replace(/\bAction:\s*/gi, "")
    .replace(/;/g, ",")
    .replace(/\s*[—–]\s*/g, " - ")
    .replace(/\bI will not use the old app as context\.?\s*/gi, "")
    .replace(/\bI will not use that app as context\.?\s*/gi, "")
    .replace(/\*\*/g, "")
    .replace(/\b\d+\.\s+/g, "")
    .replace(/\bI prepared a Blanked link\b/gi, "I left a Blanked link")
    .replace(/\bI[’']ll give you one concrete Blanked action for it\.?/gi, "I can help with that.")
    .replace(/\bone concrete Blanked action\b/gi, "a simple next step in Blanked")
    .trim();
}

function completeNaturalText(value, maxLength = 420) {
  const text = naturalChannelText(value, maxLength);
  if (!text || /[.!?¿]$/.test(text)) return text;
  const punctuationIndex = Math.max(text.lastIndexOf("."), text.lastIndexOf("!"), text.lastIndexOf("?"));
  if (punctuationIndex >= 80) return text.slice(0, punctuationIndex + 1).trim();
  const lastSpace = text.lastIndexOf(" ");
  return `${text.slice(0, lastSpace > 40 ? lastSpace : text.length).trim()}.`;
}

function responseLanguage(prompt, context = {}) {
  const text = cleanText(prompt, 600).toLowerCase();
  if (/\b(?:in english|en ingl[eé]s)\b/.test(text)) return "en";
  if (/\b(?:in spanish|en espa[nñ]ol|en castellano)\b/.test(text)) return "es";
  const previousLanguage = context.semantic_state?.language
    || context.memory?.conversation_state?.semantic_state?.language;
  const explicit = cleanText(previousLanguage || context.language || context.locale || "", 20).toLowerCase();
  const spanishScore = [
    "¿", "á", "é", "í", "ó", "ú", "ñ",
    "como puedo", "cómo puedo", "que deberia", "qué debería", "quiero", "bloquear", "bloquea",
    "despues", "después", "comer", "cenar", "despertar", "trabajar", "estudiar",
    "movil", "móvil", "no uso", "lo necesito", "para siempre", "consejo", "ayudame", "ayúdame",
    "bienestar digital", "redes", "redes sociales", "perdiendo mucho tiempo", "por la noche", "estoy", "me quedo",
    "scrolleando", "dormir", "fatal", "concentrarme", "asistente personal", "controlar mi móvil", "controlar mi movil", "hazme",
    "recuérdame", "recuerdame", "esta tarde", "esta noche", "reanuda", "reanudar", "reactiva", "reactivar", "quita la pausa", "pausa las reglas",
  ].reduce((score, token) => score + (text.includes(token) ? 1 : 0), 0);
  const englishScore = [
    "how can i", "what should i", "block", "after", "phone", "sleep", "work", "study",
    "scroll", "focus", "advice", "help me", "minutes", "hours", "instead", "only once",
  ].reduce((score, token) => score + (text.includes(token) ? 1 : 0), 0);
  const shortSpanish = /\b(?:vale|minutos|hora|horas|solo|mejor|diario|diariamente|siempre|cada|confirma|confirmo|s[ií]|hoy|ahora)\b/.test(text) ? 2 : 0;
  if (spanishScore + shortSpanish > englishScore) return "es";
  if (englishScore > 0) return "en";
  return explicit.startsWith("es") ? "es" : "en";
}

function isWebPreview(context = {}) {
  const channel = cleanText(context.channel || "", 30).toLowerCase();
  const assistantChannel = cleanText(context.assistant_channel || "", 30).toLowerCase();
  return context.web_preview === true || channel === "web_preview" || assistantChannel === "web";
}

function asksAboutBlankedDataOrPrediction(prompt) {
  const text = paddedText(prompt, 700);
  const product = contains(text, [" blanked ", " bai ", " you ", " vuestra ", " vosotros ", " puedes ", " podéis ", " podeis "]);
  const prediction = contains(text, [" predict", " prediction", " forecast", " know that", " know if", " tomorrow", " tired", " cansado", " cansada", " mañana", " manana", " predec", " saber que", " saber si", " comportamiento", " behavior"]);
  const signals = contains(text, [" data", " datos", " wearable", " wearables", " health", " screen time", " screentime", " sueño", " sueno", " sleep", " recovery", " hrv", " heart rate", " actividad", " activity"]);
  return (product && (prediction || signals)) || (prediction && signals);
}

function isDigitalWellnessScope(prompt) {
  return isPhoneControlConversionPrompt(prompt) || isProductivityPrompt(prompt) || asksAboutBlankedDataOrPrediction(prompt);
}

function isOutOfWellnessScope(prompt) {
  const text = paddedText(prompt, 700);
  if (isDigitalWellnessScope(prompt)) return false;
  if (isGeneralWellnessPrompt(prompt)) return true;
  return contains(text, [
    " israel", " palestine", " palestina", " gaza", " hamas", " netanyahu", " trump", " biden",
    " election", " elecciones", " politics", " politica", " política", " war ", " guerra",
    " stock", " crypto", " bitcoin", " recipe", " receta", " movie", " pelicula", " película",
    " history", " historia", " religion", " religión", " game", " football", " futbol", " fútbol",
  ]);
}

function isPhoneControlConversionPrompt(prompt) {
  const text = paddedText(prompt, 700);
  if (isConversationalOnly(prompt)) return false;
  return contains(text, [
    " scroll", " scrolling", " doomscroll", " scrollear", " scrolleando",
    " phone", " móvil", " movil", " teléfono", " telefono", " screen time", " screentime",
    " distract", " distraccion", " distracción", " redes", " social media", " social apps",
    " instagram", " tiktok", " tik tok", " youtube", " shorts", " reels", " reddit", " twitter", " snapchat",
    " block", " bloquear", " bloquea", " limit", " límite", " limite", " protect", " proteger",
    " focus", " foco", " concentrate", " concentrarme", " study", " estudiar",
    " app ", " apps ", " aplicación", " aplicaciones",
  ]);
}

function isProductivityPrompt(prompt) {
  const text = paddedText(prompt, 700);
  return contains(text, [
    " productivity", " productive", " focus", " deep work", " concentrate", " concentration",
    " procrastinat", " distractions", " distract", " get work done", " trabajo profundo",
    " productividad", " productivo", " productiva", " concentrarme", " concentracion", " concentración",
    " procrastin", " distraccion", " distracción", " distracciones",
  ]);
}

function webConversionNote(language = "en", prompt = "") {
  if (isProductivityPrompt(prompt)) {
    return language === "es"
      ? "En Blankmind, esto puede convertirse en un bloque de trabajo que cierre redes y apps de scroll."
      : "In Blankmind, this can become a work block that closes social and scroll apps.";
  }
  return language === "es"
    ? "Desde la web puedo planearlo, pero solo Blankmind puede pedir permisos y bloquear apps automáticamente."
    : "I can plan it here, but only Blankmind can ask for permissions and block apps automatically.";
}

function appendWebConversionNote(plan, prompt, context = {}, language = "en") {
  if (!isWebPreview(context) || (!isPhoneControlConversionPrompt(prompt) && !isProductivityPrompt(prompt))) return plan;
  const note = webConversionNote(language, prompt);
  const current = naturalChannelText(plan.message_text || plan.response_text || "", 420);
  if (/from the web|desde la web|cannot block|no puedo bloquear|permissions|permisos/i.test(current)) return plan;
  const append = (value, maxLength) => {
    const base = naturalChannelText(value || current, maxLength);
    if (!base) return note.slice(0, maxLength);
    if (/from the web|desde la web|cannot block|no puedo bloquear|permissions|permisos/i.test(base)) return base;
    const availableForBase = Math.max(80, maxLength - note.length - 1);
    let trimmedBase = base;
    if (base.length > availableForBase) {
      const candidate = base.slice(0, availableForBase).trim();
      const punctuationIndex = Math.max(candidate.lastIndexOf("."), candidate.lastIndexOf("!"), candidate.lastIndexOf("?"));
      if (punctuationIndex >= 80) {
        trimmedBase = candidate.slice(0, punctuationIndex + 1).trim();
      } else {
        const lastSpace = candidate.lastIndexOf(" ");
        trimmedBase = `${candidate.slice(0, lastSpace > 80 ? lastSpace : availableForBase - 1).trim()}…`;
      }
    }
    return `${trimmedBase} ${note}`.slice(0, maxLength);
  };
  return {
    ...plan,
    response_text: append(plan.response_text, 320),
    message_text: append(plan.message_text || plan.response_text, 320),
    speech_text: append(plan.speech_text || plan.message_text || plan.response_text, 420),
  };
}

function messagingChannel(context = {}) {
  const channel = cleanText(context.channel || context.assistant_channel, 30).toLowerCase();
  return channel === "whatsapp" || channel === "sms" ? channel : "";
}

function shouldOfferAppPresenceGuidance(prompt, plan, context = {}) {
  if (!messagingChannel(context) || isWebPreview(context) || isConversationalOnly(prompt)) return false;
  const actions = Array.isArray(plan?.actions)
    ? plan.actions.filter((item) => item && item.type && item.type !== "none")
    : [];
  const blockingContract = resolveBlockingContract(prompt, context);
  if (blockingContract.user_request && !blockingContract.ready) return false;
  return actions.length > 0 || blockingContract.user_request;
}

function claimsAppInstalled(prompt) {
  return /^(?:i have (?:it|the app)|already have (?:it|the app)|it(?:'s| is) installed|the app is installed|ya la tengo(?: instalada)?|la app está instalada|la app esta instalada)[.!\s]*$/i.test(cleanText(prompt, 120));
}

function recentScrollWindow(context = {}) {
  const messages = recentMessages(context);
  let start = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const app = namedApp(message.content);
    if (app === "the app") continue;
    const minute = looseSingleTime(message.content);
    if (minute == null) continue;
    start = { app, startMinute: minute, index };
    break;
  }
  if (!start) return null;
  for (let index = messages.length - 1; index > start.index; index -= 1) {
    const message = messages[index];
    if (message.role !== "user" || namedApp(message.content) !== "the app") continue;
    const endMinute = looseSingleTime(message.content, start.startMinute);
    if (endMinute == null) continue;
    return { app: start.app, startMinute: start.startMinute, endMinute };
  }
  return null;
}

function hasConfirmedWindowContext(context = {}) {
  const messages = recentMessages(context);
  const recentText = messages.map((message) => message.content).join(" ").toLowerCase();
  const assistantText = messages
    .filter((message) => message.role === "assistant")
    .map((message) => message.content)
    .join(" ")
    .toLowerCase();
  return Boolean(
    recentScrollWindow(context) &&
    /want me to use|confirm(?: window| the window)?|confirmar(?: la franja)?|usar esa franja/i.test(assistantText) &&
    /\b(?:yes|yeah|yep|correct|do it|go ahead|confirm|sí|si|vale|adelante|hazlo)\b/i.test(recentText),
  );
}

function isConfirmedPlanContinuation(prompt, plan, context = {}) {
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  if (!actions.some((item) => item && item.type === "apply_schedule")) return false;
  const value = cleanText(prompt, 80);
  const affirmative = /^(?:yes|yeah|yep|correct|do it|go ahead|confirm|confirm window|sí|si|vale|adelante|hazlo|confirmar(?: la franja)?)[.!\s]*$/i.test(value);
  const latestAssistant = [...recentMessages(context)].reverse().find((message) => message.role === "assistant");
  const immediateConfirmation = affirmative && Boolean(latestAssistant && /want me to use|confirm(?: window| the window)?|confirmar(?: la franja)?|usar esa franja/i.test(latestAssistant.content));
  return immediateConfirmation || (claimsAppInstalled(prompt) && hasConfirmedWindowContext(context));
}

function truncateForTail(value, maxLength) {
  const text = naturalChannelText(value, maxLength);
  if (text.length <= maxLength) return text;
  const candidate = text.slice(0, Math.max(0, maxLength - 1)).trim();
  const lastSpace = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, lastSpace > 40 ? lastSpace : candidate.length).trim()}…`;
}

function appendAppPresenceGuidance(plan, prompt, context = {}, language = "en") {
  if (!shouldOfferAppPresenceGuidance(prompt, plan, context)) return plan;
  const presence = deriveAppPresence(context.app_presence);
  if (presence.state === "recently_seen") return plan;

  if (isConfirmedPlanContinuation(prompt, plan, context)) {
    const schedule = Array.isArray(plan.actions)
      ? plan.actions.find((item) => item && item.type === "apply_schedule")
      : null;
    const recentWindow = recentScrollWindow(context);
    const appLabel = recentWindow?.app || recentAppTiming(context)?.app || (language === "es" ? "las apps seleccionadas" : "the selected apps");
    const startMinute = Number.isFinite(schedule?.start_minute) ? schedule.start_minute : recentWindow?.startMinute ?? 0;
    const endMinute = Number.isFinite(schedule?.end_minute) ? schedule.end_minute : recentWindow?.endMinute ?? startMinute;
    const startText = minuteText(startMinute);
    const endText = minuteText(endMinute);
    const message = language === "es"
      ? `Confirmado: el plan protegería ${appLabel} de ${localizeMinuteText(startText, language)} a ${localizeMinuteText(endText, language)}. Abre Blankmind para revisarlo y elige ${appLabel} allí solo si la app te lo pide.`
      : `Confirmed: the plan will protect ${appLabel} from ${startText} to ${endText}. Open Blankmind to review it, and choose ${appLabel} there only if the app asks you to.`;
    return {
      ...plan,
      response_text: message,
      message_text: message,
      speech_text: message,
      followup_text: "",
      requires_selected_apps: true,
      requires_screen_time_authorization: true,
    };
  }

  const guidance = language === "es"
    ? "El plan queda preparado. Abre Blankmind para revisarlo y aplicarlo."
    : "The plan is ready. Open Blankmind to review and apply it.";
  const current = naturalChannelText(plan.message_text || plan.response_text || "", 320)
    .replace(/\bBlanked App\b/gi, "Blankmind")
    .replace(/\bBlanked\b/gi, "Blankmind");
  const baseBudget = Math.max(60, 318 - guidance.length);
  const base = truncateForTail(current, baseBudget);
  const message = `${base ? `${base} ` : ""}${guidance}`.slice(0, 320);
  return {
    ...plan,
    response_text: message,
    message_text: message,
    speech_text: `${base ? `${base} ` : ""}${guidance}`.slice(0, 420),
    followup_text: "",
    actions: [],
    requires_selected_apps: false,
    requires_screen_time_authorization: false,
  };
}

function localizeMinuteText(text, language) {
  if (language !== "es") return text;
  return String(text)
    .replace(/\bAM\b/g, "a. m.")
    .replace(/\bPM\b/g, "p. m.")
    .replace(/\b to \b/g, " a ")
    .replace(/m\.\./g, "m.");
}

function localizeText(value, language, maxLength = 420) {
  const text = cleanText(value, maxLength);
  if (language !== "es" || !text) return text;
  const scheduleMatch = text.match(/^I read this as a specific protection window: (.+) to (.+)\.$/i);
  if (scheduleMatch) return localizeMinuteText(`Vale. Protegería esa franja de ${scheduleMatch[1]} a ${scheduleMatch[2]}.`, language);
  const exact = {
    "Context Corrected": "Contexto corregido",
    "Bounded Protection": "Protección limitada",
    "Bedtime Scroll Read": "Lectura de noche",
    "Scroll Pattern": "Patrón de scroll",
    "Contextual Boundary": "Límite contextual",
    "Work App Conflict": "Conflicto con app de trabajo",
    "Choose Apps": "Elegir apps",
    "Choose App": "Elegir app",
    "App Privacy": "Privacidad de apps",
    "Digital Wellness Read": "Lectura digital",
    "Scheduled Protection": "Protección programada",
    "Focus Protection": "Protección de foco",
    "Strict Focus Protection": "Protección estricta",
    "24h Study Protection": "Protección de estudio",
    "Bedtime Boundary": "Límite de sueño",
    "Sleep Boundary": "Límite de sueño",
    "Bedtime Scroll Loop": "Scroll de noche",
    "Loss Of Control": "Pérdida de control",
    "Allow Only": "Solo esenciales",
    "Resume Rules": "Reactivar reglas",
    "Pause Rules": "Pausar reglas",
    "Weekly Read": "Lectura semanal",
    "Urge Protection": "Protección ante impulso",
    "Scroll Loop": "Bucle de scroll",
    "Lunch Context": "Contexto de comida",
    "Plan Context": "Contexto del plan",
    "Noted": "Anotado",
    "Tell pattern": "Contar patrón",
    "Tell target": "Contar objetivo",
    "Tell bedtime": "Contar hora",
    "Tell app": "Contar app",
    "Tell time": "Contar hora",
    "Tell window": "Contar franja",
    "Choose apps": "Elegir apps",
    "Choose app": "Elegir app",
    "Allow Screen Time": "Permitir Screen Time",
    "Got it": "Entendido",
    "Set up": "Configurar",
    "Apply window": "Aplicar franja",
    "Start now": "Empezar ahora",
    "Apply study plan": "Aplicar plan",
    "Stay protected": "Mantener protección",
    "Start hard block": "Bloqueo fuerte",
    "Enable Allow Only": "Activar esenciales",
    "Pause 7 days": "Pausar 7 días",
    "Advanced": "Avanzado",
    "Apply adaptive plan": "Aplicar plan",
    "Open report": "Abrir informe",
    "Enable protection": "Activar protección",
    "Apply protection": "Aplicar protección",
    "Tell goal": "Contar objetivo",
    "Not now": "Ahora no",
    "I can help make access harder, but I will only create bounded rules with a clear target and exit path. Tell me the app or moment to protect first.": "Puedo hacer el acceso más difícil, pero solo crearé reglas limitadas con un objetivo claro y una salida. Dime primero la app o el momento que quieres proteger.",
    "Got it. Which app, moment or habit should we focus on instead?": "Entendido. ¿En qué app, momento o hábito deberíamos centrarnos?",
    "That usually starts before bedtime. What time do you want to be asleep?": "Eso suele empezar antes de irte a dormir. ¿A qué hora quieres estar dormido?",
    "If you want to be asleep from 11:00 PM to 7:00 AM, the phone should get harder to use before 11:00 PM.": "Si quieres dormir de 11:00 PM a 7:00 AM, el móvil debería ser más difícil de usar antes de las 11:00 PM.",
    "Got it. Which app pulls you in most, and when does it usually happen?": "Entendido. ¿Qué app te atrapa más y cuándo suele pasar?",
    "Most people do best starting 10-15 minutes after lunch. What time do you usually finish eating?": "Suele funcionar mejor empezar 10-15 minutos después de comer. ¿A qué hora sueles terminar de comer?",
    "What time do you usually finish eating?": "¿A qué hora sueles terminar de comer?",
    "Lunch is probably the right moment to protect, but I need two details before setting anything: which apps count as social media for you, and what time do you usually finish eating?": "Comer probablemente es el momento a proteger, pero necesito dos datos antes de configurar nada: ¿qué apps cuentan como redes sociales para ti y a qué hora sueles terminar de comer?",
    "What time do you usually finish dinner?": "¿A qué hora sueles terminar de cenar?",
    "What time do you usually wake up?": "¿A qué hora sueles despertarte?",
    "What time do you usually finish work?": "¿A qué hora sueles terminar de trabajar?",
    "Choose the social apps in Blankmind first, then I can apply the block.": "Elige primero las apps sociales en Blankmind y después puedo aplicar el bloqueo.",
    "I can use counts and context you choose to share, but I do not need your exact app list to reason about the pattern.": "Puedo usar conteos y contexto que decidas compartir, pero no necesito tu lista exacta de apps para razonar sobre el patrón.",
    "This is an execution moment, so the useful move is immediate friction.": "Este es un momento de ejecución: lo útil ahora es añadir fricción inmediata.",
    "I read this as a study window, so the useful move is a short plan with friction already in place.": "Lo leo como una franja de estudio: lo útil es un plan corto con fricción ya preparada.",
    "That late scroll is probably leaking into sleep, not just adding screen time.": "Ese scroll tarde probablemente se está metiendo en tu descanso, no solo sumando tiempo de pantalla.",
    "You are already protected; changing settings now would weaken the boundary.": "Ya estás protegido; cambiar ajustes ahora debilitaría el límite.",
    "This is a high-risk moment. Reduce choice immediately.": "Este es un momento de alto riesgo. Reduce opciones de inmediato.",
    "This is about reducing decisions: keep essentials available and remove the rest.": "Esto va de reducir decisiones: deja lo esencial disponible y quita el resto.",
    "Your rules are paused; I can bring the structure back.": "Tus reglas están pausadas; puedo recuperar la estructura.",
    "Pausing is fine when the context changes, as long as it has an end.": "Pausar está bien cuando cambia el contexto, siempre que tenga final.",
    "The useful question is whether the current protection is preventing breaks, not whether the plan sounds good.": "La pregunta útil es si la protección actual evita rupturas, no si el plan suena bien.",
    "This is a cue-control problem: make access harder before the urge peaks.": "Esto es un problema de control de señales: haz el acceso más difícil antes de que el impulso suba.",
    "Tell me the app, moment, or habit you want to change first.": "Dime primero qué app, momento o hábito quieres cambiar.",
    "Start by identifying the moment when the phone becomes automatic. Then make that moment slightly harder before adding strict blocks.": "Empieza identificando el momento en que el móvil se vuelve automático. Después haz ese momento un poco más difícil antes de añadir bloqueos estrictos.",
    "I'm here. Tell me what's going on, and I'll help from there.": "Estoy aquí. Cuéntame qué pasa y te ayudo desde ahí.",
    "Read: you are asking for guidance, not a blocking plan yet.": "Lectura: estás pidiendo guía, no un plan de bloqueo todavía.",
    "Pattern: the trigger usually matters more than total screen time.": "Patrón: el disparador suele importar más que el tiempo total de pantalla.",
    "Move: name the app and the moment it usually takes over.": "Movimiento: dime la app y el momento en que suele tomar el control.",
    "Read: there is no clear action request yet.": "Lectura: todavía no hay una petición de acción clara.",
    "Pattern: Blanked should not turn every message into a blocking plan.": "Patrón: Blanked no debe convertir cada mensaje en un plan de bloqueo.",
    "Move: tell me whether you want advice or a plan.": "Movimiento: dime si quieres consejo o un plan.",
    "Greeting": "Saludo",
    "Hey, what's up?": "Hey, ¿qué tal?",
    "Read: this is just a greeting.": "Lectura: esto es solo un saludo.",
    "Pattern: answer naturally before offering help.": "Patrón: responder natural antes de ofrecer ayuda.",
    "Move: ask whether they need anything.": "Movimiento: preguntar si necesita algo.",
    "Personal Assistant": "Asistente personal",
    "Reminder Context": "Contexto de recordatorio",
    "Plan Timing": "Horario del plan",
    "Automation Setup": "Configuración automática",
    "I can read your phone-habit patterns, explain what is changing, and turn that into blocks, schedules, limits, reports or setup steps when it helps.": "Puedo leer tus patrones de uso del móvil, explicar qué está cambiando y convertirlo en bloqueos, horarios, límites, informes o pasos de configuración cuando ayude.",
    "I can help prevent that moment, but this action should become either a notification setup or a block window. What time should I protect?": "Puedo ayudarte a prevenir ese momento, pero esto debe convertirse en una notificación o en una franja de bloqueo. ¿A qué hora debería protegerte?",
    "I can plan this, but I need the time window before I start anything now.": "Puedo planificarlo, pero necesito la franja horaria antes de iniciar nada ahora.",
    "I can help automate protection, but first I need the pattern to optimize: app, weak moment, goal or risk window.": "Puedo ayudarte a automatizar la protección, pero primero necesito el patrón a optimizar: app, momento débil, objetivo o franja de riesgo.",
    "Read: I can respond when you ask and also use signals when your pattern changes.": "Lectura: puedo responder cuando me escribes y también usar señales cuando cambia tu patrón.",
    "Pattern: the useful move depends on your apps, weak hours, plan history and permissions.": "Patrón: el movimiento útil depende de tus apps, franjas débiles, historial del plan y permisos.",
    "Move: tell me the moment you want to improve, or ask me to review your current pattern.": "Movimiento: dime el momento que quieres mejorar o pídeme revisar tu patrón actual.",
    "Read: you want proactive help before the scroll starts.": "Lectura: quieres ayuda proactiva antes de que empiece el scroll.",
    "Pattern: the useful solution needs a clear time or risk window.": "Patrón: la solución útil necesita una hora o franja de riesgo clara.",
    "Move: tell me the time, then I can suggest the right protection.": "Movimiento: dime la hora y podré sugerir la protección adecuada.",
    "Read: this is about future focus, not an immediate block.": "Lectura: esto va de foco futuro, no de un bloqueo inmediato.",
    "Pattern: scheduled protection works better when the start time is clear.": "Patrón: la protección programada funciona mejor con hora de inicio clara.",
    "Move: tell me the time window, then I can set the plan.": "Movimiento: dime la franja horaria y podré preparar el plan.",
    "Read: you want BM to act with more initiative.": "Lectura: quieres que BM actúe con más iniciativa.",
    "Pattern: automatic changes need a clear rule and a safe exit.": "Patrón: los cambios automáticos necesitan una regla clara y una salida segura.",
    "Move: tell me what to protect first, then I can recommend the right automation.": "Movimiento: dime qué proteger primero y podré recomendar la automatización adecuada.",
  };
  if (exact[text]) return exact[text];
  let translated = text
    .replace(/^Read:/i, "Lectura:")
    .replace(/^Pattern:/i, "Patrón:")
    .replace(/^Move:/i, "Movimiento:")
    .replace(/^Signal:/i, "Señal:")
    .replace(/^Feedback:/i, "Feedback:")
    .replace(/^Protection:/i, "Protección:")
    .replace(/\bscreen habit loop\b/gi, "bucle de hábito digital")
    .replace(/\banxiety scroll\b/gi, "scroll por ansiedad")
    .replace(/\bboredom scroll\b/gi, "scroll por aburrimiento")
    .replace(/\bbedtime scroll\b/gi, "scroll de noche")
    .replace(/\bsocial comparison\b/gi, "comparación social")
    .replace(/\bavoidance loop\b/gi, "bucle de evitación")
    .replace(/\bcompulsive checking\b/gi, "revisión compulsiva")
    .replace(/\blow-energy scroll\b/gi, "scroll por baja energía")
    .replace(/\bthe app\b/gi, "la app")
    .replace(/\byour phone\b/gi, "tu móvil")
    .replace(/\bphone\b/gi, "móvil")
    .replace(/\bapp\b/gi, "app")
    .replace(/\bapps\b/gi, "apps")
    .replace(/\bhabit\b/gi, "hábito")
    .replace(/\bhabits\b/gi, "hábitos")
    .replace(/\btrigger\b/gi, "disparador")
    .replace(/\btriggers\b/gi, "disparadores")
    .replace(/\bpattern\b/gi, "patrón")
    .replace(/\bpatterns\b/gi, "patrones")
    .replace(/\bprotection\b/gi, "protección")
    .replace(/\bprotect\b/gi, "proteger")
    .replace(/\bblock\b/gi, "bloquear")
    .replace(/\bboundary\b/gi, "límite")
    .replace(/\bboundaries\b/gi, "límites")
    .replace(/\brisk window\b/gi, "franja de riesgo")
    .replace(/\bwillpower\b/gi, "fuerza de voluntad")
    .replace(/\btell me\b/gi, "dime")
    .replace(/\busual\b/gi, "habitual")
    .replace(/\bsleep target\b/gi, "hora objetivo para dormir")
    .replace(/\bbedtime\b/gi, "hora de dormir")
    .replace(/\bwork\b/gi, "trabajo")
    .replace(/\bstudy\b/gi, "estudio")
    .replace(/\bnon-work use\b/gi, "uso no laboral")
    .replace(/\bnot a generic focus issue\b/gi, "no es un problema genérico de foco");
  translated = translated
    .replace(/\bscreen-hábito\b/gi, "hábitos digitales")
    .replace(/\bprotección plan\b/gi, "plan de protección")
    .replace(/\bif you want a go further\b/gi, "si quieres ir más allá")
    .replace(/\bif you want to go further\b/gi, "si quieres ir más allá")
    .replace(/\bI can help with hábitos digitales advice, a diagnosis or a plan de protección si quieres ir más allá\./gi, "Puedo ayudarte con consejo sobre hábitos digitales, una lectura del patrón o un plan de protección si quieres ir más allá.")
    .replace(/\bhábitos digitales advice\b/gi, "consejo sobre hábitos digitales")
    .replace(/\ba diagnosis\b/gi, "una lectura del patrón")
    .replace(/\bdime whether\b/gi, "dime si")
    .replace(/\bdime si you want advice or a plan\b/gi, "Dime si quieres consejo o un plan")
    .replace(/\bconsejo or a plan\b/gi, "consejo o un plan")
    .replace(/^Lectura: you want protection after lunch\.$/i, "Lectura: quieres protección después de comer.")
    .replace(/^Lectura: you want protection after dinner\.$/i, "Lectura: quieres protección después de cenar.")
    .replace(/^Lectura: you want protection after waking up\.$/i, "Lectura: quieres proteger la primera revisión del móvil.")
    .replace(/^Lectura: you want protection after work\.$/i, "Lectura: quieres protección después de trabajar.")
    .replace(/^Movimiento: dime when you usually finish lunch, then I can place the límite without guessing\.$/i, "Movimiento: dime cuándo sueles terminar de comer y colocaré el límite sin adivinar.")
    .replace(/^Movimiento: dime when dinner usually ends, then I can set the límite around the real risk moment\.$/i, "Movimiento: dime cuándo suele terminar la cena y ajustaré el límite al momento real de riesgo.")
    .replace(/^Movimiento: dime your habitual wake-up time, then I can proteger the first móvil check\.$/i, "Movimiento: dime tu hora habitual de despertar y protegeré la primera revisión del móvil.")
    .replace(/^Movimiento: dime when trabajo usually ends, then I can proteger the decompression window\.$/i, "Movimiento: dime cuándo sueles terminar de trabajar y protegeré la franja de desconexión.");
  return localizeMinuteText(translated, language);
}

function localizePlan(plan, language) {
  if (language !== "es") return plan;
  return {
    ...plan,
    title: localizeText(plan.title, language).slice(0, 70),
    message_text: localizeText(plan.message_text, language).slice(0, 320),
    speech_text: localizeText(plan.speech_text, language).slice(0, 420),
    followup_text: localizeText(plan.followup_text, language).slice(0, 240),
    response_text: localizeText(plan.response_text, language).slice(0, 320),
    bullets: Array.isArray(plan.bullets) ? plan.bullets.map((item) => localizeText(item, language).slice(0, 140)) : [],
    primary_label: localizeText(plan.primary_label, language).slice(0, 32),
    secondary_label: localizeText(plan.secondary_label, language).slice(0, 32),
  };
}

function hasSpanishLanguageLeak(plan) {
  const text = [
    plan.title,
    plan.response_text,
    plan.message_text,
    plan.speech_text,
    plan.followup_text,
    plan.primary_label,
    plan.secondary_label,
    ...(Array.isArray(plan.bullets) ? plan.bullets : []),
  ].filter(Boolean).join(" ");
  return /\b(?:let me|brief|session|support|right now|distracting|start|block|apps and|focus|help you|you want|depends on|when you|then I can|use, then|the same app|full block|could break|work instead|got it|what time|what(?:'s| is)?|your|you|the|from|every|minutes?|days?|selected|will|would|can|should|once|recurring|notification|open|choose|protection|details|confirm|sending)\b/i.test(text);
}

function stripBulletPrefix(value) {
  return cleanText(value, 180)
    .replace(/^(Read|Pattern|Move|Signal|Feedback|Protection|Lectura|Patrón|Movimiento|Señal|Protección):\s*/i, "")
    .replace(/\.$/, "");
}

function appTargetFromPrompt(prompt = "") {
  const app = namedApp(prompt);
  if (app && app !== "the app") return app;
  const category = requestedAppCategory(prompt);
  if (category && category !== "social apps") return category;
  return category || "selected apps";
}

function appTargetFromPlan(plan = {}) {
  const blockingApps = plan.blocking_data && Array.isArray(plan.blocking_data.apps)
    ? plan.blocking_data.apps.filter((app) => app && app !== "selected_apps" && !String(app).startsWith("mode:"))
    : [];
  if (blockingApps.length) return blockingApps.join(" and ");
  const text = cleanText(plan.response_text || plan.message_text, 240);
  const match = text.match(/\bprotect\s+([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*){0,2})\s+(?:after|from|around|when|before)\b/);
  return match ? cleanText(match[1], 50) : "";
}

function actionMessage(plan, prompt = "", language = "en") {
  const actions = Array.isArray(plan.actions) ? plan.actions.filter((item) => item && item.type && item.type !== "none") : [];
  if (!actions.length) return "";
  const first = actions[0];
  const promptTarget = appTargetFromPrompt(prompt);
  const target = appTargetFromPlan(plan) || promptTarget;
  if (first.type === "apply_schedule") {
    const start = minuteText(first.start_minute);
    const end = minuteText(first.end_minute);
    return language === "es"
      ? `Protegería ${target} de ${localizeMinuteText(start, language)} a ${localizeMinuteText(end, language)}.`
      : `Protect ${target} from ${start} to ${end}, before the scroll has momentum.`;
  }
  if (first.type === "start_protection") {
    const minutes = first.minutes == null ? null : cleanNumber(first.minutes, 25, 5, 240);
    return language === "es"
      ? (minutes == null ? "Empezaría el bloqueo ahora y mantendría tu selección actual de apps." : `Empezaría un bloqueo de ${minutes} minutos.`)
      : (minutes == null ? "I’d start protection now and leave your current app list as it is." : `I’d start a ${minutes}-minute block now and leave your current app list as it is.`);
  }
  if (first.type === "set_daily_limit") {
    const minutes = first.minutes == null ? null : cleanNumber(first.minutes, 25, 5, 240);
    return language === "es"
      ? (minutes == null ? "¿Cuántos minutos al día quieres permitir?" : `Pondría un límite diario de ${minutes} minutos.`)
      : (minutes == null ? "How many minutes per day do you want to allow?" : `Set a ${minutes}-minute daily limit and review it after a day.`);
  }
  if (first.type === "enable_allow_only") return language === "es" ? "Activaría Allow Only para dejar solo lo esencial." : "Turn on Allow Only and leave only the essentials available.";
  if (first.type === "enable_adult_filter") return language === "es" ? "Activaría protección web para contenido adulto." : "Turn on adult web protection before the urge peaks.";
  if (first.type === "pause_rules") return language === "es" ? "Pausaría las reglas con una fecha de vuelta." : "Pause the rules with a clear return point.";
  if (first.type === "disable_pause") return language === "es" ? "Reactivaría tus reglas y volvería a activar tu protección." : "I’d resume your rules and bring your protection back.";
  if (first.type === "open_app_picker" || first.type === "request_screen_time_permission") {
    if (first.type === "open_app_picker" && first.start_minute != null && first.end_minute != null) {
      return language === "es"
        ? `Primero elige ${target} en Blankmind y después podré programar ${localizeMinuteText(minuteText(first.start_minute), language)} a ${localizeMinuteText(minuteText(first.end_minute), language)}.`
        : `Choose ${target} in Blankmind first, then I can schedule ${minuteText(first.start_minute)} to ${minuteText(first.end_minute)}.`;
    }
    return language === "es" ? `Primero elige ${target} en Blankmind.` : `Choose ${target} in Blankmind first.`;
  }
  if (first.type === "apply_ai_plan") return language === "es" ? "Aplicaría el siguiente ajuste recomendado." : "Apply the next recommended adjustment and review the result later.";
  return "";
}

function conversationalMessage(plan, language = "en", prompt = "") {
  const response = cleanText(plan.response_text, 220);
  const bullets = Array.isArray(plan.bullets) ? plan.bullets.map(stripBulletPrefix).filter(Boolean) : [];
  const actions = Array.isArray(plan.actions) ? plan.actions.filter((item) => item && item.type && item.type !== "none") : [];
  const hasQuestion = /[?¿]\s*$/.test(response);
  const move = bullets.find((item) => /tell me|what time|which app|dime|qué app|que app|a qué hora|cuando|cuándo/i.test(item));

  if (!actions.length && hasQuestion) return response;
  if (!actions.length && /\bsleep target\b|hora objetivo para dormir/i.test(response)) return response;
  if (!actions.length && /turn it into a Blankmind plan|want a Blankmind plan|quieres un plan de Blankmind|convertirlo en un plan de Blankmind/i.test(response)) return response.slice(0, 320);
  if (!actions.length && move && /tell me|dime|what time|which app|a qu[eé] hora|cu[aá]ndo|app or moment/i.test(response)) return response;
  if (!actions.length && move && !response.toLowerCase().includes(move.toLowerCase())) {
    const normalizedMove = move.charAt(0).toUpperCase() + move.slice(1);
    return `${response} ${normalizedMove.endsWith("?") || normalizedMove.endsWith("¿") ? normalizedMove : normalizedMove + "."}`.slice(0, 320);
  }

  if (actions.length) {
    const actionLine = actionMessage(plan, prompt, language);
    return (actionLine || response).slice(0, 320);
  }

  return response || (language === "es" ? "Puedo ayudarte con eso en Blankmind." : "I can help with that in Blankmind.");
}

function fallbackSpeechText(plan, language = "en") {
  const message = naturalChannelText(plan.message_text || plan.response_text, 420);
  if (!message) return language === "es" ? "Puedo ayudarte con eso en Blankmind." : "I can help with that in Blankmind.";
  return message;
}

function fallbackFollowupText(plan, language = "en") {
  const actions = Array.isArray(plan.actions) ? plan.actions.filter((item) => item && item.type && item.type !== "none") : [];
  if (!actions.length) return "";
  const first = actions[0];
  if (language === "es") {
    if (first.type === "apply_schedule") return "Abre Blankmind para revisar y aplicar la franja.";
    if (first.type === "start_protection") return "Abre Blankmind para empezar el bloqueo.";
    if (first.type === "open_app_picker" || first.type === "request_screen_time_permission") return "Abre Blankmind para terminar la configuración.";
    return "Abre Blankmind para revisar el siguiente paso.";
  }
  if (first.type === "apply_schedule") return "Open Blankmind to review and apply the window.";
  if (first.type === "start_protection") return "Open Blankmind to review and confirm the block.";
  if (first.type === "open_app_picker" || first.type === "request_screen_time_permission") return "Open Blankmind to finish setup.";
  return "Open Blankmind to review the next step.";
}

function completeBlockingPlan(contract, language = "en", prompt = "") {
  if (!contract || !contract.user_request || !contract.ready || !contract.data) return null;
  const data = contract.data;
  const apps = Array.isArray(data.apps) ? data.apps : [];
  const namedApps = apps.filter((app) => app !== "selected_apps");
  const appLabel = namedApps.length ? namedApps.join(" and ") : "the selected distractions";
  const requestedIntent = classify(prompt, {});
  const blockingIntent = requestedIntent === "general" ? "social" : requestedIntent;
  const recurrenceDays = data.recurrence && Array.isArray(data.recurrence.value) ? data.recurrence.value : [0];
  const durationMinutes = data.end && data.end.type === "duration" ? data.end.value : null;
  const hardMode = wantsHardMode(prompt);
  let plannedAction = null;
  let title = "Immediate Protection";
  let responseText = "";
  let bullets = [];

  if (data.action === "daily_limit") {
    plannedAction = action("set_daily_limit", { minutes: durationMinutes });
    title = "Daily Limit";
    responseText = language === "es"
      ? `Puedo limitar ${appLabel} a ${durationMinutes} minutos al día.`
      : `I can limit ${appLabel} to ${durationMinutes} minutes per day.`;
    bullets = language === "es"
      ? [`Aplicaciones: ${appLabel}.`, `Límite: ${durationMinutes} minutos al día.`, "Revisa la configuración antes de activarla."]
      : [`Apps: ${appLabel}.`, `Limit: ${durationMinutes} minutes per day.`, "Review the setting before activating it."];
  } else if (data.start.type === "now") {
    plannedAction = action("start_protection", { minutes: durationMinutes, hard_mode: hardMode });
    const durationText = durationMinutes == null
      ? (language === "es" ? "sin fecha de fin" : "indefinitely")
      : `${durationMinutes} ${language === "es" ? "minutos" : "minutes"}`;
    responseText = language === "es"
      ? `Puedo bloquear ${appLabel} ahora ${durationText}.`
      : `I can block ${appLabel} now ${durationText}.`;
    bullets = language === "es"
      ? [`Aplicaciones: ${appLabel}.`, "Inicio: ahora.", `Duración: ${durationText}.`]
      : [`Apps: ${appLabel}.`, "Start: now.", `Duration: ${durationText}.`];
  } else {
    const startMinute = Number(data.start.value);
    const endMinute = data.end.type === "duration"
      ? (startMinute + Number(data.end.value)) % (24 * 60)
      : Number(data.end.value);
    if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute) || startMinute === endMinute) return null;
    const scheduleAction = action("apply_schedule", {
      name: "Protection",
      start_minute: startMinute,
      end_minute: endMinute,
      weekdays: recurrenceDays[0] === 0 ? [1, 2, 3, 4, 5, 6, 7] : recurrenceDays,
      duration_days: recurrenceDays[0] === 0 ? 1 : 7,
    });
    plannedAction = scheduleAction;
    title = "Scheduled Protection";
    responseText = language === "es"
      ? `Puedo bloquear ${appLabel} de ${minuteText(startMinute)} a ${minuteText(endMinute)}.`
      : `I can block ${appLabel} from ${minuteText(startMinute)} to ${minuteText(endMinute)}.`;
    bullets = language === "es"
      ? [`Aplicaciones: ${appLabel}.`, `Horario: ${minuteText(startMinute)} a ${minuteText(endMinute)}.`, `Repetición: ${recurrenceDays[0] === 0 ? "una vez" : "los días elegidos"}.`]
      : [`Apps: ${appLabel}.`, `Window: ${minuteText(startMinute)} to ${minuteText(endMinute)}.`, `Repeat: ${recurrenceDays[0] === 0 ? "one time" : "the selected days"}.`];
  }

  return {
    intent: blockingIntent,
    title,
    response_text: responseText,
    bullets,
    primary_label: language === "es" ? "Revisar bloqueo" : "Review block",
    secondary_label: language === "es" ? "Ahora no" : "Not now",
    actions: Array.isArray(plannedAction) ? plannedAction : plannedAction ? [plannedAction] : [],
    requires_selected_apps: contract.app_source === "conversation",
    requires_screen_time_authorization: true,
    blocking_ready: true,
    blocking_user_request: true,
    blocking_missing_fields: [],
    blocking_data: publicBlockingData(data),
  };
}

function hasExplicitBlockRequest(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  return contains(text, ["block", "bloquea", "bloquear", "shield", "protect", "schedule", "limit"]) ||
    /\bset\s+(a|an|up|rule|block|limit|schedule|protection)\b/i.test(text) ||
    /\bfrom\s+\d{1,2}(:\d{2})?\s*(am|pm)?\s+to\s+\d{1,2}(:\d{2})?\s*(am|pm)?\b/i.test(text);
}

function asksForDailyLimit(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  return contains(text, ["daily limit", "per day", "each day", "every day", "límite diario", "limite diario", "por día", "por dia"])
    || (/\b(limit|límite|limite|cap|tope)\b/i.test(text) && /\b\d+\s*(minutes?|mins?|minutos?)\b/i.test(text));
}

function asksForImmediateBlock(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  if (!hasExplicitBlockRequest(prompt) || asksForAdvice(prompt) || asksForPlan(prompt) || asksForDailyLimit(prompt)) return false;
  if (explicitTimeWindow(prompt, {}) || promptHasFutureTiming(prompt)) return false;
  return contains(text, ["now", "right now", "immediately", "ahora", "ya", "en este momento", "at the moment"])
    || contains(text, ["block", "bloquea", "bloquear", "shield"]);
}

function claimsSelectedApps(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  return contains(text, [
    "already selected",
    "already chose",
    "selected the app",
    "selected apps",
    "ya he seleccionado",
    "ya seleccioné",
    "ya seleccione",
    "ya elegí",
    "ya elegi",
  ]);
}

function isGeneralWellnessPrompt(prompt) {
  const text = paddedText(prompt, 700);
  const digitalMoment = contains(text, [
    " lose control", " losing control", " can't stop", " cannot stop", " no puedo parar",
    " scroll", " scrolling", " doomscroll", " check my phone", " checking my phone",
    " open instagram", " open tiktok", " open youtube", " open reddit", " notifications",
    " app ", " apps ", " screen", " phone", " móvil", " movil", " pantallas",
  ]);
  if (digitalMoment) return false;
  return contains(text, [
    " sleep", " dormir", " descanso", " run", " running", " correr", " workout", " training", " entren",
    " exercise", " ejercicio", " energy", " energia", " energía", " tired", " cansado", " cansada",
    " stress", " estrés", " estres", " anxiety", " ansiedad", " recovery", " recuperacion", " recuperación",
    " wellness", " wellbeing", " bienestar", " habit", " hábito", " habito", " nutrition", " diet ", " dieta ",
    " eating better", " comer mejor", " alimentación", " alimentacion",
    " productivity", " productive", " productividad", " productivo", " productiva",
  ]);
}

function asksForAdvice(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  return contains(text, [
    "how can i",
    "what can i do",
    "what should i",
    "help me understand",
    "help me improve",
    "recommend",
    "advice",
    "advise",
    "tips",
    "why do i",
    "review",
    "diagnose",
    "analyze",
    "analyse",
    "como puedo",
    "qué debería",
    "que deberia",
    "aconseja",
    "consejo",
    "ayudame",
    "ayúdame",
    "mejorar",
    "bienestar digital",
  ]);
}

function asksForPlan(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  return contains(text, [
    " plan",
    "plan ",
    "make me a plan",
    "create a plan",
    "build a plan",
    "give me a plan",
    "set up a plan",
    "focus plan",
    "protection plan",
    "quiero un plan",
    "hazme un plan",
  ]);
}

function asksForDigitalDetoxPlan(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  return contains(text, [
    "digital detox",
    "detox digital",
    "detox plan",
    "plan de detox",
    "plan detox",
  ]);
}

function isSimpleGreeting(prompt) {
  const text = cleanText(prompt, 120).toLowerCase().replace(/[!?.¡¿,]/g, "").trim();
  return /^(hey|hi|hello|yo|hola|buenas|buenos dias|buenos días|buenas tardes|buenas noches)(\s+blanked|\s+bai|\s+bm)?$/.test(text);
}

function isConversationalOnly(prompt) {
  const text = cleanText(prompt, 180).toLowerCase().replace(/[!?.¡¿,]/g, "").trim();
  if (!text) return false;
  if (hasExplicitBlockRequest(prompt) || asksForAdvice(prompt) || asksForPlan(prompt) || asksAboutAssistantCapabilities(prompt)) return false;
  return /^(hey|hi|hello|yo|hola|buenas|good morning|good afternoon|good evening|gm|buenos dias|buenos días|buenas tardes|buenas noches)(\s+blanked|\s+bai|\s+bm)?$/.test(text) ||
    /^(how are you|how are u|how you doing|how's it going|hows it going|what's up|whats up|qué tal|que tal|cómo estás|como estas)(\s+blanked|\s+bai|\s+bm)?$/.test(text) ||
    /^(thanks|thank you|thx|gracias|ok|okay|vale|perfect|perfecto|cool|nice|great|genial)$/.test(text);
}

function conversationalOnlyPlan(prompt, language = "en") {
  const text = cleanText(prompt, 180).toLowerCase().replace(/[!?.¡¿,]/g, "").trim();
  const spanish = language === "es";
  let response = spanish ? "Hey, ¿qué tal?" : "Hey, what's up?";
  if (/good morning|gm|buenos dias|buenos días/.test(text)) {
    response = spanish ? "Buenos días. ¿Cómo va la mañana?" : "Good morning. How's your morning going?";
  } else if (/good afternoon|buenas tardes/.test(text)) {
    response = spanish ? "Buenas tardes. ¿Cómo va el día?" : "Good afternoon. How's your day going?";
  } else if (/good evening|buenas noches/.test(text)) {
    response = spanish ? "Buenas noches. ¿Cómo va todo?" : "Good evening. How's everything going?";
  } else if (/how are you|how are u|how you doing|how's it going|hows it going|qué tal|que tal|cómo estás|como estas/.test(text)) {
    response = spanish ? "Bien, por aquí. ¿Tú qué tal?" : "I'm good. How are you doing?";
  } else if (/thanks|thank you|thx|gracias/.test(text)) {
    response = spanish ? "De nada." : "Anytime.";
  } else if (/ok|okay|vale|perfect|perfecto|cool|nice|great|genial/.test(text)) {
    response = spanish ? "Vale." : "Got it.";
  }
  return {
    intent: "general",
    title: "Conversation",
    response_text: response,
    bullets: [
      "Read: this is conversation, not a product action.",
      "Pattern: answer the human turn before guiding anywhere.",
      "Move: keep talking unless a real Blanked solution helps."
    ],
    primary_label: "Reply",
    secondary_label: "Not now",
    actions: [],
    requires_selected_apps: false,
    requires_screen_time_authorization: false,
    message_text: response,
    speech_text: response,
    followup_text: "",
  };
}

function asksWhereToStart(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  return contains(text, [
    "where to start",
    "where should i start",
    "how to start",
    "don't know where to start",
    "do not know where to start",
    "no se por donde empezar",
    "no sé por dónde empezar",
  ]);
}

function lastConversationTopic(context = {}) {
  const memory = context.memory && typeof context.memory === "object" ? context.memory : {};
  return cleanText(memory.last_topic || memory.last_intent || memory.last_bm_topic || memory.last_bai_topic, 40).toLowerCase();
}

function hasSleepConversationContext(context = {}) {
  const memory = context.memory && typeof context.memory === "object" ? context.memory : {};
  return ["sleep", "bedtime", "night"].includes(lastConversationTopic(context)) ||
    cleanText(memory.pattern_cluster, 80).toLowerCase().includes("bedtime") ||
    Number.isFinite(Number(memory.bedtime_minute));
}

function asksForPermanentLockout(prompt) {
  const text = paddedText(prompt, 600);
  return contains(text, ["forever", "permanently", "para siempre", "ever again", "impossible to use", "delete my distractions"]) &&
    contains(text, ["block", "blok", "bloquea", "bloquear", "everything", "todo", "phone", "distractions"]);
}

function asksForRulesAction(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  return contains(text, [
    "pause my rules", "pause rules", "pause scheduled protection", "resume my rules", "resume rules",
    "remove pause", "disable pause", "pausa mis reglas", "pausar reglas", "reanuda mis reglas", "reanudar reglas",
    "quita la pausa", "quitar la pausa", "reactiva mis reglas", "reactivar reglas",
  ]);
}

function asksAboutAssistantCapabilities(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  return contains(text, [
    "what can you do",
    "how can you help",
    "can you help me with",
    "que puedes hacer",
    "qué puedes hacer",
    "como me puedes ayudar",
    "cómo me puedes ayudar",
    "asistente personal",
  ]);
}

function asksForUnsupportedReminder(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  return contains(text, ["remind me", "reminder", "notify me", "ping me", "recuérdame", "recuerdame", "avísame", "avisame"]) &&
    !contains(text, ["block", "bloquea", "bloquear", "protect", "proteger"]);
}

function asksForBroadAutomation(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  return contains(text, ["automatically", "manage my phone", "control my phone", "auto", "automático", "automatico", "controlar mi móvil", "controlar mi movil"]) &&
    !contains(text, ["from", "at ", "after", "de ", "desde", "a las", "después", "despues", "now", "ahora"]);
}

function relativeMoment(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  if (contains(text, ["breakfast", "desayuno", "desayunar", "after breakfast", "right after breakfast", "despues de desayunar", "después de desayunar"])) {
    return {
      key: "breakfast",
      label: "after breakfast",
      question: "What time do you usually finish breakfast?",
      move: "tell me when you usually finish breakfast, then I can place the boundary without guessing.",
    };
  }
  if (contains(text, ["lunch", "comida", "comer", "almuerzo", "after lunch", "right after lunch", "despues de comer", "después de comer", "despues de lunch", "después de lunch"])) {
    return {
      key: "lunch",
      label: "around lunch",
      question: "Lunch is probably the right moment to protect, but I need two details before setting anything: which apps count as social media for you, and what time do you usually finish eating?",
      move: "tell me the apps and when you usually finish lunch, then I can place the boundary without guessing.",
    };
  }
  if (contains(text, ["after dinner", "right after dinner", "despues de cenar", "después de cenar", "despues de dinner", "después de dinner"])) {
    return {
      key: "dinner",
      label: "after dinner",
      question: "What time do you usually finish dinner?",
      move: "tell me when dinner usually ends, then I can set the boundary around the real risk moment.",
    };
  }
  if (contains(text, ["when i wake up", "after waking", "wake up", "al despertar", "cuando me despierto"])) {
    return {
      key: "wake",
      label: "after waking up",
      question: "What time do you usually wake up?",
      move: "tell me your usual wake-up time, then I can protect the first phone check.",
    };
  }
  if (contains(text, ["after work", "right after work", "despues de trabajar", "después de trabajar", "despues de work", "después de work"])) {
    return {
      key: "work_end",
      label: "after work",
      question: "What time do you usually finish work?",
      move: "tell me when work usually ends, then I can protect the decompression window.",
    };
  }
  return null;
}

function hasExplicitRelativeMomentContext(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  const moment = relativeMoment(prompt);
  if (!moment) return false;
  return contains(text, [
    "scroll", "doomscroll", "social", "apps", "instagram", "tiktok", "tik tok", "youtube", "reels", "shorts", "feed",
    "too much", "demasiado", "tired", "low energy", "cansado", "cansada",
    "not bedtime", "not bed", "not night", "no por la noche", "no de noche",
  ]) || /^(no|nope|nah|not|after|right after|despues|después)\b/i.test(text);
}

function promptHasFutureTiming(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  return contains(text, ["tomorrow", "mañana", "later", "tonight", "esta noche", "this evening", "esta tarde"]);
}

function routineAnchorMinute(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  const match = text.match(/(?:at|around|a las|sobre)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return null;
  const rawHour = Number(match[1]);
  const meridiem = match[3] || (rawHour >= 1 && rawHour <= 7 ? "pm" : null);
  return minuteOfDay(rawHour, Number(match[2] || 0), meridiem);
}

function hasBedtime(prompt, context = {}) {
  const text = cleanText(prompt, 600).toLowerCase();
  if (scrollUntilSleepTime(prompt)) return false;
  if (explicitSingleTime(prompt) != null) return true;
  const memory = context.memory && typeof context.memory === "object" ? context.memory : {};
  return Boolean(memory.bedtime_minute != null || contains(text, ["my bedtime", "go to sleep at", "me duermo a", "me voy a dormir a"]));
}

function hasKnownMainApp(context = {}) {
  const memory = context.memory && typeof context.memory === "object" ? context.memory : {};
  return Array.isArray(memory.main_apps) && memory.main_apps.length > 0;
}

function hasKnownWeakHour(context = {}) {
  const memory = context.memory && typeof context.memory === "object" ? context.memory : {};
  return Array.isArray(memory.weak_hours) && memory.weak_hours.some((hour) => Number.isFinite(Number(hour)));
}

function namedApp(prompt) {
  const text = paddedText(prompt, 600);
  const apps = [
    ["tiktok", "TikTok"],
    ["tik tok", "TikTok"],
    ["instagram", "Instagram"],
    ["insta", "Instagram"],
    [" ig ", "Instagram"],
    ["youtube shorts", "YouTube Shorts"],
    ["youtube", "YouTube"],
    ["yt", "YouTube"],
    ["reels", "Reels"],
    ["reddit", "Reddit"],
    ["twitter", "Twitter"],
    [" x ", "Twitter"],
    ["facebook", "Facebook"],
    ["snapchat", "Snapchat"],
  ];
  const match = apps.find(([key]) => text.includes(key));
  return match ? match[1] : "the app";
}

function requestedAppCategory(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  if (contains(text, ["social media", "social apps", "social networks", "redes sociales"])) return "social apps";
  return "";
}

function appCorrection(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  const negatesUse = contains(text, [
    "i don't use",
    "i dont use",
    "i do not use",
    "i never use",
    "dont use",
    "don't use",
    "do not use",
    "no uso",
    "yo no uso",
  ]);
  if (!negatesUse) return "";
  const apps = ["tiktok", "tik tok", "instagram", "insta", "ig", "youtube", "yt", "reddit", "twitter", "facebook", "snapchat"];
  return apps.find((app) => text.includes(app)) || "";
}

function correctedAppContext(prompt) {
  const text = cleanText(prompt, 600);
  const match = text.match(/\b(?:it is|it's|its|es|son)\s+(.+)$/i);
  const fragment = match ? match[1] : "";
  const app = fragment ? namedApp(fragment) : "the app";
  const moment = relativeMoment(fragment) || relativeMoment(prompt);
  return { app: app === "the app" ? "" : app, moment };
}

function requestedUnknownApp(prompt) {
  const text = cleanText(prompt, 600);
  const match = text.match(/\b(?:block|limit|bloquea|bloquear)\s+([a-z][a-z0-9._+-]{1,30})\b/i);
  if (!match) return "";
  const raw = match[1];
  const lowered = raw.toLowerCase();
  const blockedWords = new Set(["everything", "all", "todos", "todas", "adult", "websites", "apps", "app", "social", "media", "networks", "redes", "my", "me", "it", "this", "that", "now", "for", "from", "during", "strict", "hard", "distractions", "distracciones"]);
  if (blockedWords.has(lowered)) return "";
  if (namedApp(raw) !== "the app") return "";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function hasExplicitModeActionRequest(prompt) {
  return /\b(?:start|activate|switch\s+to|use|inicia|activa|cambia\s+a|usa)\b[^.!?]{0,60}\b(?:mode|modo)\b/i.test(cleanText(prompt, 600));
}

function hasWorkAppConflict(prompt) {
  const text = paddedText(prompt, 600);
  return contains(text, ["but i need", "but need", "need it", "need this app", "except i need", "for work", "for studying", "for study", "work tutorials", "para trabajar", "para estudiar", "lo necesito", "la necesito"]) &&
    contains(text, ["block", "blok", "bloquea", "bloquear", "limit", "distract", "tiktok", "tik tok", "instagram", "insta", " ig ", "youtube", "yt", "reddit", "twitter", " x ", "facebook", "snapchat"]);
}

function asksAboutExactAppList(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  return contains(text, ["exact app list", "my app list", "which apps", "see my apps", "selected apps", "all my apps", "access all my apps", "lista exacta de apps", "mis apps"]) &&
    contains(text, ["see", "know", "access", "visible", "can you", "puedes ver", "sabes", "acceder"]);
}

function needsContextBeforeAction(prompt, intent, context = {}) {
  const text = cleanText(prompt, 600).toLowerCase();
  const moment = relativeMoment(prompt);
  const memory = context.memory && typeof context.memory === "object" ? context.memory : {};
  const rememberedApps = Array.isArray(memory.main_apps) ? memory.main_apps.map((app) => cleanText(app, 40).toLowerCase()) : [];
  const promptApp = namedApp(prompt).toLowerCase();
  const sameRememberedApp = promptApp !== "the app" && rememberedApps.includes(promptApp);
  const appCategory = requestedAppCategory(prompt);
  const hasApps = promptApp !== "the app" || Boolean(appCategory) || rememberedApps.length > 0;
  const momentEndMinute = moment ? memory[`${moment.key}_end_minute`] : null;
  const hasMomentTime = Number.isFinite(Number(momentEndMinute)) || Boolean(explicitTimeWindow(prompt, context) || anchorWindow(prompt));
  const momentContextSatisfied = Boolean(moment && hasApps && hasMomentTime);
  if (moment && !momentContextSatisfied && !explicitTimeWindow(prompt, context) && (!hasKnownWeakHour(context) || !sameRememberedApp) && (hasExplicitBlockRequest(prompt) || intent === "social")) {
    return moment.key;
  }
  if (intent === "sleep" && !explicitTimeWindow(prompt, context) && !hasBedtime(prompt, context) && !hasExplicitBlockRequest(prompt) && !hasExplicitModeActionRequest(prompt)) {
    return "bedtime";
  }
  if (intent === "sleep" && scrollUntilSleepTime(prompt) && !hasBedtime(prompt, context)) {
    return "bedtime";
  }
  if (intent === "social" &&
      contains(text, ["scroll", "doomscroll", "checking my phone", "check my phone", "opening my phone", "use my phone", "notification", "notifications"]) &&
      !explicitTimeWindow(prompt, context) &&
      !hasKnownMainApp(context) &&
      !contains(text, ["tiktok", "instagram", "youtube", "app"])) {
    return "apps";
  }
  return null;
}

function classify(prompt, context = {}) {
  const text = paddedText(prompt, 600);
  if (asksForRulesAction(prompt)) return "vacation";
  if (hasSleepConversationContext(context) && explicitTimeWindow(prompt, context)) return "sleep";
  if (hasExplicitRelativeMomentContext(prompt)) return "social";
  if (asksWhereToStart(prompt)) return "general";
  if (asksForPlan(prompt) && !hasExplicitBlockRequest(prompt) && !contains(text, ["after", "when", "from", "at ", "tonight", "now", "ahora"])) return "general";
  if (contains(text, ["screen time is bad", "use my phone too much", "too much with my phone", "demasiado con el movil", "demasiado con el móvil", "phone is killing my focus"])) return "general";
  if (explicitDurationMinutes(prompt) && contains(text, ["hard block", "hard blok", "hard bloquear", "block distractions", "blok everything", "bloquear everything", "bloquea distracciones", "bloquear distractions", "bloquear distracciones"])) return "focus";
  if (contains(text, ["porn", "porno", "adult", "xxx"])) return "adultContent";
  if (contains(text, ["losing control", "perdiendo el control", "urge", "emergency", "reca", "relapse", "broke the block", "break the block", "can't stop", "no puedo parar", "terrible today", "fatal hoy", "no consigo concentrarme"])) return "emergency";
  if (contains(text, ["sleep", "night", "tonight", "this evening", "bed", "dormir", "duermo", "acuesto", "noche", "esta noche", "scrolleando hasta", "scrolling until", "tired", "cansado"])) return "sleep";
  if (contains(text, ["exam", "study", "estudio", "estudiar", "examen", "opos"])) return "study";
  if (contains(text, ["allow only", "whatsapp", "maps", "solo", "only"])) return "allowOnly";
  if (contains(text, ["vacation", "holiday", "vacaciones", "pause", "pausa", "resume my rules", "resume rules", "reanuda", "reanudar", "quita la pausa", "quitar la pausa", "disable pause", "remove pause"])) return "vacation";
  if (contains(text, ["week", "semana", "analy", "diagn", "report", "review"])) return "weeklyReview";
  if (contains(text, ["social media", "social apps", "social networks", "redes sociales", "tiktok", "tik tok", "instagram", "insta", " ig ", "youtube", " yt ", "reddit", "twitter", " x ", "facebook", "snapchat", "gaming", "game", "dopamine", "scroll", "doomscroll", "notification", "notifications", "reels", "shorts", "feed", "for you page"])) return "social";
  if (requestedUnknownApp(prompt)) return "social";
  if (contains(text, ["anxious", "anxiety", "ansiedad", "bored", "boring", "aburr", "lonely", "stress", "guilt", "culpa"])) return "social";
  if (contains(text, ["focus", "productiv", "foco", "deep work", "now"])) return "focus";
  if (contains(text, ["work", "trabaj"]) && contains(text, ["focus", "block", "bloquea", "bloquear", "protect", "proteger"])) return "focus";
  return "general";
}

function behaviorCluster(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  if (contains(text, ["anxious", "anxiety", "ansiedad", "stress", "stressed"])) return "anxiety scroll";
  if (contains(text, ["bored", "boring", "aburr"])) return "boredom scroll";
  if (contains(text, ["revenge", "late", "night", "bed", "sleep", "dormir", "noche"])) return "bedtime scroll";
  if (contains(text, ["compare", "comparison", "instagram", "social", "twitter", "facebook", "snapchat"])) return "social comparison";
  if (contains(text, ["avoid", "procrast", "work", "study", "exam"])) return "avoidance loop";
  if (contains(text, ["check", "whatsapp", "notification", "notif"])) return "compulsive checking";
  if (contains(text, ["relapse", "reca", "failed", "broke"])) return "relapse pattern";
  if (contains(text, ["tired", "low energy", "cansado"])) return "low-energy scroll";
  return "screen habit loop";
}

function minuteOfDay(hour, minute, meridiem) {
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "am") return (hour === 12 ? 0 : hour) * 60 + minute;
    if (meridiem === "pm") return (hour === 12 ? 12 : hour + 12) * 60 + minute;
    return null;
  }
  if (hour < 0 || hour > 23) return null;
  return hour * 60 + minute;
}

function explicitTimeWindow(prompt, context = {}) {
  const text = cleanText(prompt, 600).toLowerCase();
  const match = text.match(/(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to|until|a)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return null;
  const startHour = Number(match[1]);
  const endHour = Number(match[4]);
  const looksNightly =
    hasSleepConversationContext(context) ||
    contains(text, ["night", "sleep", "bed", "dormir", "noche"]) ||
    (contains(text, ["block", "bloquea", "bloquear", "instagram", "tiktok", "youtube", "scroll"]) && startHour >= 9 && startHour <= 11 && endHour >= 1 && endHour <= 9);
  const crossesMidnight = looksNightly && !match[3] && !match[6] && endHour <= startHour;
  const endMeridiem = match[6] || (crossesMidnight ? "am" : (looksNightly ? "pm" : null));
  const startMeridiem = match[3] || (looksNightly ? "pm" : endMeridiem);
  const start = minuteOfDay(startHour, Number(match[2] || 0), startMeridiem);
  const end = minuteOfDay(endHour, Number(match[5] || 0), endMeridiem);
  if (start == null || end == null || start === end) return null;
  return { start, end };
}

function sleepGoalWindow(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  if (!contains(text, ["sleep", "dormir", "duermo"])) return null;
  if (contains(text, ["block", "bloquea", "bloquear", "shield", "protect", "protege", "proteger", "schedule", "limit", "limita", "limitar"])) return null;
  if (!contains(text, ["sleep well", "sleep good", "sleep better", "sleep properly", "dormir bien", "dormir mejor"])) return null;
  return explicitTimeWindow(prompt);
}

function anchorWindow(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  if (contains(text, ["sleep", "bed", "bedtime", "dormir", "duermo", "acuesto"])) return null;
  const minute = routineAnchorMinute(prompt);
  if (minute == null) return null;
  const lunchContext = contains(text, ["lunch", "comer", "comida", "almuerzo"]);
  const offset = contains(text, ["after", "despues", "después"]) || (!lunchContext && contains(text, ["termine", "termino", "finish"])) ? 10 : 0;
  const start = (minute + offset) % (24 * 60);
  const duration = contains(text, ["lunch", "comer", "dinner", "cenar", "work", "trabaj"]) ? 60 : 45;
  return { start, end: (start + duration) % (24 * 60) };
}

function rememberedRoutineWindow(prompt, context = {}) {
  const moment = relativeMoment(prompt);
  const text = cleanText(prompt, 600).toLowerCase();
  const memory = context.memory && typeof context.memory === "object" ? context.memory : {};
  if (!moment || !contains(text, ["after", "right after", "despues", "después"])) return null;
  const rememberedEnd = Number(memory[`${moment.key}_end_minute`]);
  if (!Number.isFinite(rememberedEnd) || rememberedEnd < 0 || rememberedEnd >= 24 * 60) return null;
  const duration = moment.key === "breakfast" ? 60 : moment.key === "lunch" ? 60 : moment.key === "dinner" ? 90 : 60;
  return {
    start: rememberedEnd,
    end: (rememberedEnd + duration) % (24 * 60),
  };
}

function explicitSingleTime(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  if (scrollUntilSleepTime(prompt)) return null;
  if (contains(text, ["sleep", "bed", "dormir", "duermo", "acuesto", "bedtime"]) && /\bmidnight\b/i.test(text)) return 0;
  const match = text.match(/(?:sleep|bed|dormir|duermo|acuesto|bedtime)[^\d]*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return null;
  const rawHour = Number(match[1]);
  const meridiem = match[3] || (rawHour >= 6 && rawHour <= 11 ? "pm" : rawHour === 12 ? "am" : null);
  return minuteOfDay(rawHour, Number(match[2] || 0), meridiem);
}

function scrollUntilSleepTime(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  return contains(text, ["scroll", "doomscroll", "reels", "shorts", "feed"]) &&
    contains(text, ["bed", "night", "noche"]) &&
    /\buntil\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i.test(text);
}

function looseSingleTime(prompt, referenceMinute = null) {
  const text = cleanText(prompt, 600).toLowerCase();
  if (/\b(?:hours?|hrs?|h|minutes?|mins?|m)\b/i.test(text)) return null;
  const match = text.match(/\b(?:usually|normalmente|sobre|around|at|a las)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!match) return null;
  const rawHour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (!match[3] && rawHour === 12 && Number.isFinite(referenceMinute)) {
    const referenceHour = Math.floor(referenceMinute / 60);
    if (referenceHour >= 6 && referenceHour < 12) return 12 * 60 + minute;
  }
  const meridiem = match[3] || (rawHour >= 6 && rawHour <= 11 ? "pm" : rawHour === 12 ? "am" : null);
  return minuteOfDay(rawHour, minute, meridiem);
}

function recentMessages(context = {}) {
  const messages = Array.isArray(context.recent_messages) ? context.recent_messages : Array.isArray(context.conversation) ? context.conversation : [];
  return messages
    .map((message) => ({
      role: cleanText(message && message.role, 20).toLowerCase(),
      content: cleanText(message && (message.content || message.text || message.message), 800),
    }))
    .filter((message) => message.content);
}

function recentRelativeTimeQuestion(context = {}) {
  const messages = recentMessages(context);
  const recentAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  if (!recentAssistant) return null;
  const text = recentAssistant.content.toLowerCase();
  let moment = null;
  if (contains(text, ["what time do you want to be asleep", "when do you want to be asleep", "when you want to be asleep", "usual bedtime", "hora quieres dormir", "hora habitual de dormir"])) {
    moment = { key: "bedtime", label: "before bed", startOffset: -30, duration: 30, name: "Bedtime Boundary" };
  } else if (contains(text, ["finish dinner", "terminar de cenar", "terminas de cenar"])) {
    moment = { key: "dinner", label: "after dinner", startOffset: 10, duration: 90, name: "Dinner Boundary" };
  } else if (contains(text, ["finish eating", "finish lunch", "terminar de comer", "terminas de comer"])) {
    moment = { key: "lunch", label: "after lunch", startOffset: 10, duration: 60, name: "Lunch Boundary" };
  } else if (contains(text, ["wake up", "despertarte", "despiertas"])) {
    moment = { key: "wake", label: "after waking up", startOffset: 0, duration: 30, name: "Morning Boundary" };
  } else if (contains(text, ["finish work", "terminar de trabajar", "terminas de trabajar"])) {
    moment = { key: "work", label: "after work", startOffset: 10, duration: 60, name: "Work Boundary" };
  }
  if (!moment) return null;
  const recentUser = [...messages].reverse().find((message) => message.role === "user" && namedApp(message.content) !== "the app");
  const app = recentUser ? namedApp(recentUser.content) : "";
  return { ...moment, app };
}

function recentAppTiming(context = {}) {
  const messages = recentMessages(context);
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") continue;
    const app = namedApp(message.content);
    if (app === "the app") continue;
    const match = message.content.match(/\b(?:usually|around|at|sobre|a las)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
    if (!match) continue;
    const timeText = `${match[1]}:${String(match[2] || "00").padStart(2, "0")}${match[3] ? ` ${match[3].toUpperCase()}` : ""}`;
    const rawHour = Number(match[1]);
    const meridiem = match[3] || (rawHour >= 6 && rawHour <= 11 ? "pm" : rawHour === 12 ? "am" : null);
    return { app, timeText, minute: minuteOfDay(rawHour, Number(match[2] || 0), meridiem) };
  }
  return null;
}

function ambiguousDigitalMomentPlan(prompt, language = "en") {
  const text = cleanText(prompt, 700).toLowerCase();
  const moment = relativeMoment(prompt);
  if (!moment || !contains(text, ["lose control", "losing control", "perdiendo el control", "can't stop", "cannot stop", "no puedo parar"])) return null;
  if (namedApp(prompt) !== "the app" || explicitTimeWindow(prompt) || /\b(?:usually|around|at|sobre|a las)\s*\d{1,2}/i.test(text)) return null;
  const question = moment.key === "lunch"
    ? language === "es"
      ? "¿Qué haces con el móvil después de comer: te pones a hacer scroll, revisas mensajes o abres una app concreta?"
      : "What happens with your phone after lunch: do you get stuck scrolling, keep checking messages, or open a specific app?"
    : moment.key === "dinner"
      ? language === "es"
        ? "¿Qué haces con el móvil después de cenar: scroll, mensajes o una app concreta?"
        : "What happens with your phone after dinner: scrolling, messages, or a specific app?"
      : moment.key === "work_end"
        ? language === "es"
          ? "¿Qué pasa con el móvil después de trabajar: scroll, mensajes o una app concreta?"
          : "What happens with your phone after work: scrolling, messages, or a specific app?"
        : language === "es"
          ? "¿Qué haces con el móvil al despertarte: scroll, mensajes o una app concreta?"
          : "What happens with your phone when you wake up: scrolling, messages, or a specific app?";
  return {
    intent: "social",
    title: "Digital Context",
    response_text: question,
    bullets: [
      "Read: the weak moment is clear, but the digital behavior is not.",
      "Pattern: the app or phone behavior comes before choosing a boundary.",
      "Move: ask one clear question before suggesting protection.",
    ],
    primary_label: "Tell me",
    secondary_label: "Not now",
    actions: [],
    requires_selected_apps: false,
    requires_screen_time_authorization: false,
    message_text: question,
    speech_text: question,
    followup_text: "",
  };
}

function conversationalFollowupPlan(prompt, context = {}, language = "en") {
  const messages = recentMessages(context);
  const recentText = messages.map((message) => message.content).join(" ").toLowerCase();
  const recentAssistantMessages = messages.filter((message) => message.role === "assistant");
  const recentAssistantText = recentAssistantMessages.map((message) => message.content).join(" ").toLowerCase();
  const latestAssistantText = recentAssistantMessages.length
    ? recentAssistantMessages[recentAssistantMessages.length - 1].content.toLowerCase()
    : "";
  const app = namedApp(prompt);
  const timeMatch = cleanText(prompt, 120).match(/\b(?:around|at|sobre|a las)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  const timeText = timeMatch ? `${timeMatch[1]}:${String(timeMatch[2] || "00").padStart(2, "0")}${timeMatch[3] ? ` ${timeMatch[3].toUpperCase()}` : ""}` : "";
  const hasRecentAmbiguousLoss = /lose control|what do you lose control|do you mean|a qué te refieres|qué quieres decir/i.test(recentText);
  const hasRecentScrollContextQuestion = /where the scrolling usually starts|where .*scrolling .*starts|app, moment, or time of day|app, momento o hora del día|which app pulls you in most.*when does it usually happen|which app.*when does it usually happen|what app.*when.*happen|what app.*what time|which app.*what time|app.*when.*usually happen|app.*time.*usually start/i.test(recentAssistantText);
  const recentTiming = recentAppTiming(context);
  const recentRelative = recentRelativeTimeQuestion(context);
  const relativeMinute = recentRelative ? looseSingleTime(prompt) : null;
  const hasRecentScrollWindowEndQuestion = /what time should (?:the )?(?:protection|boundary|block) end|what time should it become available again|need end time|what time should the protection end|a qué hora debería terminar la protección|hora final/i.test(recentAssistantText);
  const confirmationWindow = explicitTimeWindow(latestAssistantText, context);
  const confirmsRecentScrollWindow = /^(?:yes|yeah|yep|correct|do it|go ahead|confirm|confirm window|sí|si|vale|adelante|hazlo|confirmar(?: la franja)?)[.!\s]*$/i.test(cleanText(prompt, 80)) && /confirm(?: window| the window)?|want me to use|use that .*window|confirmar(?: la franja)?|usar esa franja/i.test(latestAssistantText);
  const recentWindow = recentScrollWindow(context);
  if (claimsAppInstalled(prompt) && hasConfirmedWindowContext(context) && recentWindow) {
    const startText = minuteText(recentWindow.startMinute);
    const endText = minuteText(recentWindow.endMinute);
    const message = language === "es"
      ? `Perfecto. El plan ya está preparado para proteger ${recentWindow.app} de ${localizeMinuteText(startText, language)} a ${localizeMinuteText(endText, language)}. Abre Blankmind para revisarlo y elige ${recentWindow.app} allí solo si la app te lo pide.`
      : `Perfect. The plan is ready to protect ${recentWindow.app} from ${startText} to ${endText}. Open Blankmind to review it, and choose ${recentWindow.app} there only if the app asks you to.`;
    return {
      intent: "social",
      title: "Morning Protection",
      response_text: message,
      bullets: [
        language === "es" ? `Lectura: ${recentWindow.app} de ${startText} a ${endText}.` : `Read: ${recentWindow.app} from ${startText} to ${endText}.`,
        language === "es" ? "Patrón: el plan ya está creado y solo necesita revisión en la app." : "Pattern: the plan is already created and only needs review in the app.",
        language === "es" ? "Movimiento: selecciona la app únicamente si Blankmind te lo solicita." : "Move: select the app only if Blankmind asks you to.",
      ],
      primary_label: language === "es" ? "Revisar plan" : "Review plan",
      secondary_label: language === "es" ? "Ahora no" : "Not now",
      actions: [action("apply_schedule", {
        name: language === "es" ? "Protección de mañana" : "Morning Protection",
        start_minute: recentWindow.startMinute,
        end_minute: recentWindow.endMinute,
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        duration_days: 7,
      })],
      requires_selected_apps: true,
      requires_screen_time_authorization: true,
      message_text: message,
      speech_text: message,
      followup_text: "",
    };
  }
  if (recentRelative && relativeMinute != null && recentRelative.key === "bedtime") {
    const start = ((relativeMinute + recentRelative.startOffset) % (24 * 60) + (24 * 60)) % (24 * 60);
    const end = (start + recentRelative.duration) % (24 * 60);
    const appLabel = recentRelative.app || (language === "es" ? "las apps de scroll" : "scroll apps");
    const message = language === "es"
      ? `Si quieres estar dormido a las ${minuteText(relativeMinute)}, haría más difíciles las ${appLabel} de ${minuteText(start)} a ${minuteText(end)}.`
      : `If you want to be asleep by ${minuteText(relativeMinute)}, I’d make ${appLabel} harder to use from ${minuteText(start)} to ${minuteText(end)}.`;
    return {
      intent: "sleep",
      title: "Bedtime Boundary",
      response_text: message,
      bullets: [
        `Read: ${minuteText(relativeMinute)} is the current bedtime target.`,
        "Pattern: the boundary needs to start before the final scroll.",
        `Move: protect ${appLabel} from ${minuteText(start)} to ${minuteText(end)}.`
      ],
      primary_label: "Plan boundary",
      secondary_label: "Not now",
      actions: [],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
      message_text: message,
      speech_text: message,
      followup_text: "",
    };
  }
  const followupWindow = recentTiming && recentTiming.minute != null ? explicitTimeWindow(prompt, context) : null;
  const followupDurationMinutes = recentTiming && recentTiming.minute != null ? conversationalDurationMinutes(prompt) : null;
  const followupEndMinute = recentTiming && recentTiming.minute != null
    ? followupWindow?.end ?? (followupDurationMinutes != null
      ? (recentTiming.minute + followupDurationMinutes) % (24 * 60)
      : looseSingleTime(prompt, recentTiming.minute))
    : null;
  if (recentTiming && recentTiming.minute != null && hasRecentScrollWindowEndQuestion && followupEndMinute != null) {
    const endMinute = followupEndMinute;
    const startText = minuteText(followupWindow?.start ?? recentTiming.minute);
    const endText = minuteText(endMinute);
    const message = language === "es"
      ? `Entendido: proteger ${recentTiming.app} de ${startText} a ${endText}. ¿Quieres que use esa franja como protección de la mañana?`
      : `Got it: protect ${recentTiming.app} from ${startText} to ${endText}. Do you want me to use that as the morning protection window?`;
    return {
      intent: "social",
      title: "Scroll Window",
      response_text: message,
      bullets: [
        language === "es" ? `Lectura: ${recentTiming.app} de ${startText} a ${endText}.` : `Read: ${recentTiming.app} from ${startText} to ${endText}.`,
        language === "es" ? "Patrón: la franja ya está completa y falta confirmar antes de actuar." : "Pattern: the window is complete and needs confirmation before any action.",
        language === "es" ? "Movimiento: confirma la franja si quieres convertirla en protección." : "Move: confirm the window if you want to turn it into protection.",
      ],
      primary_label: language === "es" ? "Confirmar franja" : "Confirm window",
      secondary_label: language === "es" ? "Ahora no" : "Not now",
      actions: [],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
      message_text: message,
      speech_text: message,
      followup_text: "",
    };
  }
  if (recentTiming && recentTiming.minute != null && confirmationWindow && confirmsRecentScrollWindow) {
    const startText = minuteText(confirmationWindow.start);
    const endText = minuteText(confirmationWindow.end);
    const name = language === "es" ? "Protección de mañana" : "Morning Protection";
    const message = language === "es"
      ? `Confirmado: el plan protegería ${recentTiming.app} de ${startText} a ${endText}. Abre Blankmind para revisarlo y elige la app solo si te lo pide.`
      : `Confirmed: the plan will protect ${recentTiming.app} from ${startText} to ${endText}. Open Blankmind to review it, and choose the app only if it asks you to.`;
    return {
      intent: "social",
      title: name,
      response_text: message,
      bullets: [
        language === "es" ? `Lectura: ${recentTiming.app} de ${startText} a ${endText}.` : `Read: ${recentTiming.app} from ${startText} to ${endText}.`,
        language === "es" ? "Patrón: has confirmado una franja concreta, no un límite diario inventado." : "Pattern: you confirmed a specific window, not an invented daily limit.",
        language === "es" ? "Movimiento: revisar el plan y elegir la app solo si Blankmind lo solicita." : "Move: review the plan and choose the app only if Blankmind asks you to.",
      ],
      primary_label: language === "es" ? "Aplicar franja" : "Apply window",
      secondary_label: language === "es" ? "Ahora no" : "Not now",
      actions: [action("apply_schedule", {
        name,
        start_minute: confirmationWindow.start,
        end_minute: confirmationWindow.end,
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        duration_days: 7,
      })],
      requires_selected_apps: true,
      requires_screen_time_authorization: true,
      message_text: message,
      speech_text: message,
      followup_text: "",
    };
  }
  if (recentTiming && asksForAdvice(prompt) && /what should i do|what do i do|how would you handle|qué hago|qué debería hacer/i.test(cleanText(prompt, 120))) {
    const message = language === "es"
      ? `Protegería ${recentTiming.app} justo antes de las ${recentTiming.timeText}, para cortar el bucle antes de que empiece. Blankmind puede aplicar esa franja.`
      : `I’d protect ${recentTiming.app} just before ${recentTiming.timeText}, so the loop is interrupted before it starts. Blankmind can apply that window.`;
    return {
      intent: "social",
      title: "App Timing",
      response_text: message,
      bullets: [
        `Read: ${recentTiming.app} around ${recentTiming.timeText} is the current target.`,
        "Pattern: the boundary belongs before the automatic opening.",
        "Move: use one short recurring block and measure whether the loop weakens.",
      ],
      primary_label: "Plan block",
      secondary_label: "Not now",
      actions: [],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
      message_text: message,
      speech_text: message,
      followup_text: "",
    };
  }
  if (app !== "the app" && timeText && hasRecentScrollContextQuestion) {
    const message = language === "es"
      ? `Entendido: ${app} es la app y las ${timeText} es cuando empieza. ¿A qué hora debería terminar la protección?`
      : `Got it: ${app} is the app and ${timeText} is when it starts. What time should the protection end?`;
    return {
      intent: "social",
      title: "Scroll Window",
      response_text: message,
      bullets: [
        language === "es" ? `Lectura: ${app} y las ${timeText} son el punto de partida.` : `Read: ${app} and ${timeText} are the starting point.`,
        language === "es" ? "Patrón: todavía falta la hora final para definir una franja útil." : "Pattern: the end time is still needed for a useful window.",
        language === "es" ? "Movimiento: dime cuándo termina la franja y la convierto en una protección concreta." : "Move: tell me when the window ends and I can turn it into a concrete boundary.",
      ],
      primary_label: language === "es" ? "Decir hora final" : "Tell me end time",
      secondary_label: language === "es" ? "Ahora no" : "Not now",
      actions: [],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
      message_text: message,
      speech_text: message,
      followup_text: "",
    };
  }
  if (app !== "the app" && timeText && hasRecentAmbiguousLoss) {
    const message = language === "es"
      ? `Entendido: ${app} sobre las ${timeText}. Yo lo convertiría en una franja de bloqueo en Blankmind justo antes de ese momento. Desde la web puedo planearlo, pero solo Blankmind puede pedir permisos y bloquear apps automáticamente.`
      : `Got it: ${app} around ${timeText}. I’d turn that into a Blankmind block just before that moment. I can plan it here, but only Blankmind can ask for permissions and block apps automatically.`;
    return {
      intent: "social",
      title: "App Timing",
      response_text: message,
      bullets: [
        `Read: ${app} is the app and ${timeText} is the risk time.`,
        "Pattern: this is specific enough to propose a Blankmind block.",
        "Move: plan the block before the usual pull starts."
      ],
      primary_label: "Plan block",
      secondary_label: "Not now",
      actions: [],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
      message_text: message,
      speech_text: message,
      followup_text: "",
    };
  }
  if (/^exactly\b|^yes\b|^yeah\b|^yep\b|^correct\b/i.test(cleanText(prompt, 80)) && /thing to solve|what time do you usually|after waking|after work|after lunch|after dinner/i.test(recentText)) {
    const appMatches = [...recentText.matchAll(/\b(instagram|tiktok|tik tok|youtube shorts|youtube|reddit|reels)\b/gi)];
    const appMatch = appMatches.length ? appMatches[appMatches.length - 1] : null;
    const appLabel = appMatch ? namedApp(appMatch[1]) : "that app";
    const moment = /wake|waking|morning/i.test(recentText) ? "after waking" :
      /after work/i.test(recentText) ? "after work" :
      /after lunch|around lunch/i.test(recentText) ? "after lunch" :
      /after dinner/i.test(recentText) ? "after dinner" : "at that moment";
    const message = language === "es"
      ? `Lo resolvería con una franja de bloqueo para ${appLabel} en Blankmind ${moment}. La idea es quitar la decisión antes de que empiece el impulso, no confiar en fuerza de voluntad.`
      : `I’d solve it with a Blankmind block for ${appLabel} ${moment}. The point is to remove the decision before the pull starts, not rely on willpower.`;
    return {
      intent: "social",
      title: "Blankmind Block",
      response_text: message,
      bullets: [
        `Read: ${appLabel} ${moment} is the target.`,
        "Pattern: a block should happen before the automatic opening.",
        "Move: recommend a Blankmind block."
      ],
      primary_label: "Plan block",
      secondary_label: "Not now",
      actions: [],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
      message_text: message,
      speech_text: message,
      followup_text: "",
    };
  }
  return null;
}

function explicitDurationMinutes(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  const match = text.match(/(\d{1,3})\s*[-–]?\s*(?:min|mins|minute|minutes|minutos?)/i);
  if (!match) return null;
  return cleanNumber(match[1], 30, 5, 240);
}

function conversationalDurationMinutes(prompt) {
  const text = cleanText(prompt, 120).toLowerCase();
  if (!text) return null;
  if (/^half\s+(?:an?\s+)?hours?[.!?\s]*$/i.test(text)) return 30;
  const unitPattern = /\b(\d{1,3}|a|an|one)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/gi;
  const parts = [...text.matchAll(unitPattern)];
  if (!parts.length) return null;
  const remainder = text
    .replace(unitPattern, "")
    .replace(/\b(?:for|about|around|roughly|and|plus)\b/gi, "")
    .replace(/[.!?,+]/g, " ")
    .trim();
  if (remainder) return null;
  const total = parts.reduce((sum, match) => {
    const amount = /^(?:a|an|one)$/i.test(match[1]) ? 1 : Number(match[1]);
    const minutes = /hour|hr|\bh\b/i.test(match[2]) ? amount * 60 : amount;
    return sum + minutes;
  }, 0);
  return Number.isFinite(total) && total > 0 ? Math.min(240, Math.max(1, Math.round(total))) : null;
}

function wantsHardMode(prompt) {
  const text = cleanText(prompt, 600).toLowerCase();
  return contains(text, ["hard mode", "strict", "hard block", "no exit", "no unlock", "intense"]);
}

function minuteText(minuteOfDayValue) {
  const hour = Math.max(0, Math.min(23, Math.floor(minuteOfDayValue / 60)));
  const minute = Math.max(0, Math.min(59, minuteOfDayValue % 60));
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  const meridiem = hour < 12 ? "AM" : "PM";
  return `${displayHour}:${String(minute).padStart(2, "0")} ${meridiem}`;
}

function hourWindow(hourValue) {
  const hour = ((Math.round(Number(hourValue)) % 24) + 24) % 24;
  return `${minuteText(hour * 60)} to ${minuteText(((hour + 1) % 24) * 60)}`;
}

function action(type, values = {}) {
  return {
    type,
    window_id: values.window_id ?? null,
    minutes: values.minutes ?? null,
    hard_mode: values.hard_mode ?? null,
    name: values.name ?? null,
    start_minute: values.start_minute ?? null,
    end_minute: values.end_minute ?? null,
    weekdays: values.weekdays ?? null,
    duration_days: values.duration_days ?? null,
    hours: values.hours ?? null,
  };
}

function proactiveTrigger(prompt, context = {}) {
  const marker = cleanText(context.trigger || context.mode || "", 40).toLowerCase();
  if (marker === "proactive" || marker === "signal") return true;
  return cleanText(prompt, 600).toLowerCase().startsWith("proactive signal:");
}

function proactiveSignals(context = {}, prompt = "") {
  const source = {
    ...context,
    ...((context.metrics && typeof context.metrics === "object") ? context.metrics : {}),
    ...((context.signals && typeof context.signals === "object") ? context.signals : {}),
  };
  const text = cleanText(prompt, 600).toLowerCase();
  const memory = context.memory && typeof context.memory === "object" ? context.memory : {};
  const weakHours = Array.isArray(memory.weak_hours) ? memory.weak_hours : [];
  const textDelta = text.match(/(\d{1,3})\s*%\s*(?:above|over|higher|more|por encima|mas|más)/i);
  const socialDelta = cleanNumber(source.social_use_delta_percent ?? source.app_use_delta_percent ?? source.screen_time_delta_percent ?? (textDelta ? textDelta[1] : null), 0, -100, 500);
  const breakCount = cleanNumber(source.break_count_today ?? source.relapse_count_today ?? source.unlock_count_today ?? source.weekly_break_count, 0, 0, 50);
  const selectedHour = source.weak_hour ?? source.risk_hour ?? weakHours[0];
  const riskHour = Number.isFinite(Number(selectedHour)) ? cleanNumber(selectedHour, 21, 0, 23) : null;
  const riskWindow = riskHour == null ? cleanText(source.risk_window || context.risk_window, 60) : hourWindow(riskHour);
  const category = cleanText(source.category || source.dominant_category || namedApp(prompt), 40);
  const healthSleepDelta = cleanNumber(source.sleep_delta_minutes ?? source.sleep_deficit_minutes, 0, -720, 720);
  const signalType = cleanText(source.signal_type, 60);
  const thresholdMinutes = cleanNumber(source.threshold_minutes, 0, 0, 1440);
  const sleepMinutes = cleanNumber(source.sleep_minutes, 0, -1, 1440);
  const relapseRiskScore = cleanNumber(source.relapse_risk_score, 0, 0, 100);
  return { socialDelta, breakCount, riskHour, riskWindow, category, healthSleepDelta, signalType, thresholdMinutes, sleepMinutes, relapseRiskScore };
}

function proactivePlan(prompt, context = {}, language = "en") {
  if (!proactiveTrigger(prompt, context)) return null;
  const signal = proactiveSignals(context, prompt);
  const selected = context.has_selected_apps === true;
  const authorized = context.screen_time_authorized === true;
  const base = {
    intent: "general",
    title: "Proactive Signal",
    response_text: "I am only interrupting because today's pattern changed enough to justify a small protection move.",
    bullets: [
      "Read: today's phone pattern is above your usual baseline.",
      "Pattern: a short boundary works better before the loop becomes automatic.",
      "Move: apply one limited protection window, then review whether it helped."
    ],
    primary_label: "Apply protection",
    secondary_label: "Not now",
    actions: [],
    requires_selected_apps: true,
    requires_screen_time_authorization: true,
  };
  if (language === "es") {
    base.title = "Señal proactiva";
    base.response_text = "Solo interrumpo porque el patrón de hoy ha cambiado lo suficiente como para justificar una protección pequeña.";
    base.bullets = [
      "Lectura: el uso de hoy está por encima de tu patrón habitual.",
      "Patrón: una franja corta funciona mejor antes de que el bucle se vuelva automático.",
      "Movimiento: aplica una protección limitada y revisa después si ayudó."
    ];
    base.primary_label = "Aplicar protección";
    base.secondary_label = "Ahora no";
  }
  if (!selected || !authorized) return { ...base, actions: [action("apply_schedule", { name: "Proactive Protection", start_minute: 21 * 60, end_minute: 22 * 60, weekdays: [1, 2, 3, 4, 5, 6, 7], duration_days: 3 })] };

  if (signal.signalType === "daily_limit_reached") {
    const minutes = signal.thresholdMinutes > 0 ? signal.thresholdMinutes : 25;
    return {
      ...base,
      intent: "social",
      title: language === "es" ? "Límite alcanzado" : "Limit Reached",
      response_text: language === "es" ? `Interrumpo porque tus apps de distracción ya han llegado a ${minutes} minutos hoy; ahora conviene mantener el bloqueo y cerrar el bucle.` : `I am interrupting because your distracting apps reached ${minutes} minutes today; the useful move is to keep protection on and close the loop.`,
      bullets: language === "es" ? [
        `Lectura: el límite de ${minutes} minutos se ha alcanzado.`,
        "Patrón: cuando el límite salta, añadir más elección suele empeorar el impulso.",
        "Movimiento: mantén la protección activa y revisa esta franja después."
      ] : [
        `Read: the ${minutes} minute limit was reached.`,
        "Pattern: once the limit fires, more choice usually feeds the urge.",
        "Move: keep protection active and review this window later."
      ],
      primary_label: language === "es" ? "Mantener bloqueo" : "Keep blocking",
      actions: [],
      requires_selected_apps: true,
      requires_screen_time_authorization: true,
    };
  }

  if (signal.breakCount >= 2 || signal.signalType === "repeated_relapses") {
    return {
      ...base,
      intent: "emergency",
      title: language === "es" ? "Señal de recaída" : "Break Signal",
      response_text: language === "es" ? "Interrumpo porque hoy ya hay varias rupturas; ahora conviene reducir elección, no rehacer todo el plan." : "I am interrupting because there are multiple break signals today; the useful move is less choice, not a full redesign.",
      bullets: language === "es" ? [
        `Lectura: ${signal.breakCount} rupturas detectadas hoy.`,
        "Patrón: después de varias rupturas, una franja dura corta protege mejor que más ajustes.",
        "Movimiento: empieza un bloqueo fuerte de 25 minutos y revisa el disparador después."
      ] : [
        `Read: ${signal.breakCount} break signals detected today.`,
        "Pattern: after repeated breaks, a short hard block protects better than more settings.",
        "Move: start 25 minutes of hard protection and review the trigger later."
      ],
      primary_label: language === "es" ? "Bloqueo fuerte" : "Start hard block",
      actions: [action("start_protection", { minutes: 25, hard_mode: true })],
      requires_selected_apps: true,
      requires_screen_time_authorization: true,
    };
  }

  if (signal.signalType === "weak_window_near") {
    const start = signal.riskHour != null ? (signal.riskHour * 60 + 10) % (24 * 60) : 21 * 60;
    const end = (start + 50) % (24 * 60);
    return {
      ...base,
      intent: "social",
      title: language === "es" ? "Franja débil cerca" : "Weak Window Near",
      response_text: language === "es" ? `Interrumpo porque ${signal.riskWindow || "tu franja débil"} está cerca y el riesgo ya es alto.` : `I am interrupting because ${signal.riskWindow || "your weak window"} is close and the risk is already high.`,
      bullets: language === "es" ? [
        `Lectura: riesgo ${signal.relapseRiskScore || "alto"} antes de la franja débil.`,
        "Patrón: bloquear antes funciona mejor que resistir cuando el scroll ya empezó.",
        "Movimiento: aplica una protección corta ahora."
      ] : [
        `Read: risk is ${signal.relapseRiskScore || "high"} before the weak window.`,
        "Pattern: blocking before works better than resisting after scrolling starts.",
        "Move: apply a short protection window now."
      ],
      actions: [action("apply_schedule", { name: "Weak Window", start_minute: start, end_minute: end, weekdays: [1, 2, 3, 4, 5, 6, 7], duration_days: 3 })],
      requires_selected_apps: true,
      requires_screen_time_authorization: true,
    };
  }

  if (signal.riskHour != null && (signal.socialDelta >= 25 || /above baseline|por encima|changed/i.test(prompt))) {
    const start = (signal.riskHour * 60 + 10) % (24 * 60);
    const end = (start + 50) % (24 * 60);
    const categoryText = signal.category && signal.category !== "the app" ? signal.category : "social apps";
    return {
      ...base,
      intent: signal.riskHour >= 20 || signal.riskHour <= 2 ? "sleep" : "social",
      title: language === "es" ? "Señal de uso" : "Use Spike",
      response_text: language === "es" ? `Interrumpo porque el uso está ${signal.socialDelta}% por encima de tu patrón habitual cerca de ${localizeMinuteText(minuteText(signal.riskHour * 60), language)}.` : `I am interrupting because ${categoryText} use is ${signal.socialDelta}% above your usual pattern around ${minuteText(signal.riskHour * 60)}.`,
      bullets: language === "es" ? [
        `Lectura: el uso está ${signal.socialDelta}% por encima de tu baseline.`,
        `Patrón: la franja de riesgo apunta a ${localizeMinuteText(hourWindow(signal.riskHour), language)}.`,
        "Movimiento: aplica una protección corta durante 3 días y mide si baja la ruptura."
      ] : [
        `Read: use is ${signal.socialDelta}% above baseline.`,
        `Pattern: the risk window points to ${hourWindow(signal.riskHour)}.`,
        "Move: apply a short 3-day protection window and check whether breaks drop."
      ],
      actions: [action("apply_schedule", { name: "Proactive Protection", start_minute: start, end_minute: end, weekdays: [1, 2, 3, 4, 5, 6, 7], duration_days: 3 })],
      requires_selected_apps: true,
      requires_screen_time_authorization: true,
    };
  }

  if (signal.healthSleepDelta <= -45 || signal.signalType === "low_recovery" || (signal.sleepMinutes > 0 && signal.sleepMinutes < 360)) {
    return {
      ...base,
      intent: "sleep",
      title: language === "es" ? "Señal de descanso" : "Recovery Signal",
      response_text: language === "es" ? "Interrumpo porque el descanso parece más bajo de lo habitual y una noche con menos móvil puede proteger la recuperación." : "I am interrupting because recovery looks lower than usual, and a lighter phone night can protect sleep.",
      actions: [action("apply_schedule", { name: "Recovery Boundary", start_minute: 21 * 60 + 30, end_minute: 23 * 60, weekdays: [1, 2, 3, 4, 5, 6, 7], duration_days: 1 })],
      requires_selected_apps: true,
      requires_screen_time_authorization: true,
    };
  }

  return {
    ...base,
    response_text: language === "es" ? "He visto una señal, pero no es lo bastante clara para interrumpirte con un cambio automático." : "I see a signal, but it is not clear enough to interrupt you with an automatic change.",
    bullets: language === "es" ? [
      "Lectura: la señal todavía es débil.",
      "Patrón: Blanked debe interrumpir solo cuando el cambio sea accionable.",
      "Movimiento: espera más datos o pide una revisión cuando quieras."
    ] : [
      "Read: the signal is still weak.",
      "Pattern: Blanked should interrupt only when the change is actionable.",
      "Move: wait for more data or ask for a review when you want it."
    ],
    primary_label: language === "es" ? "Abrir informe" : "Open report",
    actions: [],
    requires_selected_apps: false,
    requires_screen_time_authorization: false,
  };
}

function fallbackPlan(prompt, context = {}) {
  if (appCorrection(prompt)) {
    const corrected = correctedAppContext(prompt);
    const appLabel = corrected.app || "that app";
    const momentLabel = corrected.moment ? corrected.moment.label : "that moment";
    const question = corrected.moment && corrected.app && corrected.moment.key === "lunch"
      ? "what time do you usually finish eating?"
      : corrected.moment ? corrected.moment.question : "when does it usually pull you in?";
    const responseText = corrected.app || corrected.moment
      ? `Got it. Then ${appLabel} ${momentLabel} is the thing to solve. ${question.charAt(0).toUpperCase()}${question.slice(1)}`
      : "Got it. Which app, moment or habit should we focus on instead?";
    return {
      intent: corrected.app || corrected.moment ? "social" : "general",
      title: "Context Corrected",
      response_text: responseText,
      bullets: [
        "Read: the previous app context was wrong.",
        `Pattern: the real target is ${appLabel}${corrected.moment ? ` ${momentLabel}` : ""}.`,
        "Move: ask only for the missing timing before creating a boundary."
      ],
      primary_label: corrected.app || corrected.moment ? "Tell time" : "Tell pattern",
      secondary_label: "Not now",
      actions: [],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
      message_text: responseText,
      speech_text: responseText,
      followup_text: "",
    };
  }
  const intent = classify(prompt, context);
  const language = responseLanguage(prompt, context);
  const blockingContract = resolveBlockingContract(prompt, context);
  const incompleteBlock = incompleteBlockingPlan(blockingContract, language, prompt, context);
  if (incompleteBlock) return incompleteBlock;
  const completeBlock = completeBlockingPlan(blockingContract, language, prompt);
  if (completeBlock) return completeBlock;
  const proactive = proactivePlan(prompt, context, language);
  if (proactive) return proactive;
  if (isConversationalOnly(prompt)) return conversationalOnlyPlan(prompt, language);
  const deterministicContext = ambiguousDigitalMomentPlan(prompt, language);
  if (deterministicContext) return deterministicContext;
  const contextualFollowup = conversationalFollowupPlan(prompt, context, language);
  if (contextualFollowup) return contextualFollowup;
  const promptText = cleanText(prompt, 600).toLowerCase();
  const selected = context.has_selected_apps === true;
  const authorized = context.screen_time_authorized === true;
  const duration = cleanNumber(context.recommended_duration_minutes, 30, 5, 240);
  const riskWindow = cleanText(context.risk_window, 60) || "your next risk window";
  const cluster = behaviorCluster(prompt);
  const targetSleepWindow = sleepGoalWindow(prompt);
  const timeWindow = targetSleepWindow
    ? null
    : explicitTimeWindow(prompt, context) || anchorWindow(prompt) || rememberedRoutineWindow(prompt, context);
  const memory = context.memory && typeof context.memory === "object" ? context.memory : {};
  const lastOutcome = cleanText(memory.last_plan_outcome, 40);
  const memoryApp = Array.isArray(memory.main_apps) && memory.main_apps.length > 0 ? cleanText(memory.main_apps[0], 40) : "";
  const promptApp = namedApp(prompt);
  const activeApp = promptApp !== "the app" ? promptApp : memoryApp;
  const requestedDailyLimitMinutes = explicitDurationMinutes(prompt);
  if (asksForDailyLimit(prompt) && requestedDailyLimitMinutes == null) {
    const target = activeApp !== "the app" ? activeApp : "that app";
    return {
      intent: "social",
      title: "Daily Limit",
      response_text: language === "es"
        ? `¿Cuántos minutos al día quieres permitir para ${target}?`
        : `How many minutes per day do you want to allow for ${target}?`,
      bullets: language === "es"
        ? [
          "El límite necesita una cantidad concreta antes de poder aplicarse.",
          "No voy a inventar una duración por defecto.",
          "Dime los minutos y lo revisarás antes de activarlo."
        ]
        : [
          "A daily limit needs a concrete amount before it can be applied.",
          "I will not invent a default duration.",
          "Tell me the minutes and you can review it before activation."
        ],
      primary_label: language === "es" ? "Decir minutos" : "Tell me the minutes",
      secondary_label: language === "es" ? "Ahora no" : "Not now",
      actions: [],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
    };
  }
  const appCategory = requestedAppCategory(prompt);
  const weakHours = Array.isArray(memory.weak_hours) ? memory.weak_hours.filter((hour) => Number.isFinite(Number(hour))).slice(0, 3) : [];
  const rememberedRisk = weakHours.length > 0 ? weakHours.map((hour) => hourWindow(Number(hour))).filter(Boolean)[0] : "";
  const missingContext = needsContextBeforeAction(prompt, intent, context);
  const setupLine = selected && authorized ? "Protection can run with your current setup." : "Setup comes first: choose apps and allow permissions in Blankmind.";
  const outcomeLine = lastOutcome === "broke"
    ? "Feedback: the last plan broke, so the next move should be easier and earlier."
    : lastOutcome === "held"
      ? "Feedback: the last plan held, so repeat before increasing difficulty."
      : setupLine;

  const relativeTimeAnswer = recentRelativeTimeQuestion(context);
  const relativeMinute = relativeTimeAnswer ? looseSingleTime(prompt) : null;
  if (relativeTimeAnswer && relativeMinute == null && contains(promptText, ["keep it simple", "simple", "short", "breve", "simplemente"])) {
    return {
      intent: "social",
      title: "Contextual Boundary",
      response_text: `One detail: what time should I treat as ${relativeTimeAnswer.label}?`,
      bullets: [
        `Read: ${relativeTimeAnswer.label} is the risk moment.`,
        "Pattern: the boundary needs a real clock time.",
        "Move: ask for only the missing time."
      ],
      primary_label: "Tell time",
      secondary_label: "Not now",
      actions: [],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
    };
  }
  if (relativeTimeAnswer && relativeMinute != null && !hasExplicitBlockRequest(prompt)) {
    const start = ((relativeMinute + relativeTimeAnswer.startOffset) % (24 * 60) + (24 * 60)) % (24 * 60);
    const end = (start + relativeTimeAnswer.duration) % (24 * 60);
    const appLabel = relativeTimeAnswer.app || activeApp;
    if (!appLabel) {
      const message = language === "es"
        ? `Entendido: tu hora objetivo es ${minuteText(relativeMinute)}. Protegería las apps de scroll de ${minuteText(start)} a ${minuteText(end)}. ¿Qué apps quieres incluir?`
        : `Got it: your target time is ${minuteText(relativeMinute)}. I’d protect scroll apps from ${minuteText(start)} to ${minuteText(end)}. Which apps should I include?`;
      return {
        intent: "sleep",
        title: "Bedtime Boundary",
        response_text: message,
        bullets: [
          `Read: ${minuteText(relativeMinute)} is the current bedtime target.`,
          "Pattern: the boundary needs to start before the final scroll.",
          "Move: choose the exact apps before creating the schedule.",
        ],
        primary_label: language === "es" ? "Decir apps" : "Tell apps",
        secondary_label: language === "es" ? "Ahora no" : "Not now",
        actions: [],
        requires_selected_apps: false,
        requires_screen_time_authorization: false,
      };
    }
    return {
      intent: "social",
      title: relativeTimeAnswer.name,
      response_text: `Got it. I’d protect ${appLabel} ${relativeTimeAnswer.label} from ${minuteText(start)} to ${minuteText(end)}.`,
      bullets: [
        `Read: ${relativeTimeAnswer.label} is the risk moment.`,
        `Pattern: ${minuteText(relativeMinute)} gives enough timing to place the boundary.`,
        `Move: protect ${appLabel} from ${minuteText(start)} to ${minuteText(end)}.`
      ],
      primary_label: "Apply boundary",
      secondary_label: "Not now",
      actions: [action("apply_schedule", { name: relativeTimeAnswer.name, start_minute: start, end_minute: end, weekdays: [1, 2, 3, 4, 5, 6, 7], duration_days: 7 })],
      requires_selected_apps: true,
      requires_screen_time_authorization: true,
    };
  }

  if (isSimpleGreeting(prompt)) {
    return {
      intent: "general",
      title: "Greeting",
      response_text: language === "es" ? "Hey, ¿qué tal?" : "Hey, what's up?",
      bullets: [
        "Read: this is just a greeting.",
        "Pattern: answer naturally before offering help.",
        "Move: ask whether they need anything."
      ],
      primary_label: "Tell me",
      secondary_label: "Open Blankmind",
      actions: [],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
    };
  }

  if (asksAboutAssistantCapabilities(prompt)) {
    return {
      intent: "general",
      title: "Personal Assistant",
      response_text: language === "es"
        ? "Estoy para ayudarte con lo que se te va del móvil: scroll, notificaciones, concentración y noches. Podemos hablarlo, montar un plan o bloquear tus distracciones. ¿Qué te cuesta más últimamente?"
        : "I help with the parts of phone use that run away from you: scrolling, notifications, focus and bedtime. We can talk, make a plan, or block your distractions. What's been hardest lately?",
      bullets: [
        "Read: I can respond when you ask and also use signals when your pattern changes.",
        "Pattern: the useful move depends on your apps, weak hours, plan history and permissions.",
        "Move: tell me the moment you want to improve, or ask me to review your current pattern."
      ],
      primary_label: "Tell pattern",
      secondary_label: "Open report",
      actions: [],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
    };
  }

  if (asksForBroadAutomation(prompt)) {
    return {
      intent: "general",
      title: "Automation Setup",
      response_text: "I can help automate protection, but first I need the pattern to optimize: app, weak moment, goal or risk window.",
      bullets: [
        "Read: you want BM to act with more initiative.",
        "Pattern: automatic changes need a clear rule and a safe exit.",
        "Move: tell me what to protect first, then I can recommend the right automation."
      ],
      primary_label: "Tell pattern",
      secondary_label: "Open report",
      actions: [],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
    };
  }

  if (asksForUnsupportedReminder(prompt)) {
    return {
      intent: "general",
      title: "Reminder Context",
      response_text: "I can help prevent that moment, but this action should become either a notification setup or a block window. What time should I protect?",
      bullets: [
        "Read: you want proactive help before the scroll starts.",
        "Pattern: the useful solution needs a clear time or risk window.",
        "Move: tell me the time, then I can suggest the right protection."
      ],
      primary_label: "Tell time",
      secondary_label: "Not now",
      actions: [],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
    };
  }

  if (asksForPermanentLockout(prompt)) {
    return {
      intent: "general",
      title: "Bounded Protection",
      response_text: "I can help make access harder, but I will only create bounded rules with a clear target and exit path. Tell me the app or moment to protect first.",
      bullets: [
        "Read: you want a very strong boundary.",
        "Pattern: absolute blocks need a clear target and an exit rule.",
        "Move: tell me the app or moment, then I can create a bounded protection plan."
      ],
      primary_label: "Tell target",
      secondary_label: "Not now",
      actions: [],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
    };
  }

  if (missingContext === "bedtime") {
    if (language === "es") {
      return {
        intent: "sleep",
        title: "Lectura de noche",
        response_text: asksForAdvice(prompt)
          ? "Yo empezaría un poco antes de meterte en la cama, no cuando ya estás cansado: deja el móvil cargando lejos y ten una alternativa fácil preparada. Si quieres, dime a qué hora quieres dormir y lo ajusto a eso."
          : "Esto suena a bucle de scroll de noche. Antes de bloquear nada, necesito tu hora objetivo para dormir.",
        bullets: [
          "Lectura: quieres que las noches se sientan menos automáticas.",
          "Patrón: la franja de riesgo depende de cuándo quieres dormir realmente.",
          "Movimiento: dime tu hora habitual de dormir y podré sugerir el límite adecuado."
        ],
        primary_label: "Decir hora",
        secondary_label: "Ahora no",
        actions: [],
        requires_selected_apps: false,
        requires_screen_time_authorization: false,
      };
    }
    return {
      intent: "sleep",
      title: "Bedtime Scroll Read",
      response_text: asksForAdvice(prompt)
        ? "I'd start before you get into bed, not once you're already tired: charge the phone away and keep one easy offline option ready. If you tell me when you want to be asleep, I'll shape it around that."
        : "That usually starts before bedtime. What time do you want to be asleep?",
      bullets: [
        "Read: you want nights to feel less automatic.",
        "Pattern: the risky window depends on when you actually go to sleep.",
        "Move: tell me your usual bedtime, then I can suggest the right boundary."
      ],
      primary_label: "Tell bedtime",
      secondary_label: "Not now",
      actions: [],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
    };
  }

  if (missingContext === "apps") {
    return {
      intent: "social",
      title: "Scroll Pattern",
      response_text: "Got it. Which app pulls you in most, and when does it usually happen?",
      bullets: [
        "Read: this is a scroll habit, not a generic focus issue.",
        "Pattern: the useful protection depends on the app and time window.",
        "Move: tell me the main app or the time of day it usually starts."
      ],
      primary_label: "Tell app",
      secondary_label: "Open report",
      actions: [],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
    };
  }

  const moment = relativeMoment(prompt);
  if (missingContext === "apps_and_lunch_time") {
    return {
      intent: "social",
      title: "Lunch Context",
      response_text: moment?.question || "I can help with lunch scrolling, but I need the apps and your usual lunch time before setting anything.",
      bullets: [
        "Read: lunch is the risk moment, but the target is still incomplete.",
        "Pattern: Blanked should not assume which apps or clock time you mean.",
        "Move: tell me the apps and when lunch usually ends."
      ],
      primary_label: "Tell details",
      secondary_label: "Not now",
      actions: [],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
    };
  }

  if (missingContext && moment && missingContext === moment.key) {
    const momentQuestion = namedApp(prompt) !== "the app" && moment.key === "lunch"
      ? "What time do you usually finish eating?"
      : moment.question;
    return {
      intent: "social",
      title: "Contextual Boundary",
      response_text: momentQuestion,
      bullets: [
        `Read: you want protection ${moment.label}.`,
        "Pattern: the useful boundary should match your real routine, not a generic clock time.",
        `Move: ${moment.move}`
      ],
      primary_label: "Tell time",
      secondary_label: "Not now",
      actions: [],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
    };
  }

  if ((intent === "social" || intent === "study" || intent === "focus") && hasWorkAppConflict(prompt)) {
    const app = namedApp(prompt);
    if (language === "es") {
      return {
        intent: "social",
        title: "Conflicto con app de trabajo",
        response_text: `Dime cuándo ${app} deja de ser uso de trabajo y puedo preparar ese límite.`,
        bullets: [
          "Lectura: la misma app tiene contextos útiles y contextos de riesgo.",
          "Patrón: un bloqueo completo podría romper tu trabajo en vez de mejorar el control.",
          `Movimiento: dime la franja de uso no laboral de ${app} y podré ajustar el límite.`
        ],
        primary_label: "Decir franja",
        secondary_label: "Ahora no",
        actions: [],
        requires_selected_apps: false,
        requires_screen_time_authorization: false,
      };
    }
    return {
      intent: "social",
      title: "Work App Conflict",
      response_text: `Tell me when ${app} becomes non-work use, then I can set the boundary.`,
      bullets: [
        "Read: the same app has useful and risky contexts.",
        "Pattern: a full block could break work instead of improving control.",
        `Move: tell me when ${app} becomes non-work use, then I can set the boundary.`
      ],
      primary_label: "Tell window",
      secondary_label: "Not now",
      actions: [],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
    };
  }

  const unknownApp = requestedUnknownApp(prompt);
  const appSelectionClaimed = claimsSelectedApps(prompt);
  const effectiveSelected = selected || appSelectionClaimed;
  if (intent === "social" && appCategory && hasExplicitBlockRequest(prompt) && (!effectiveSelected || !authorized)) {
    const setupAction = !effectiveSelected ? "open_app_picker" : "request_screen_time_permission";
    return {
      intent: "social",
      title: "Choose Apps",
      response_text: `Choose the social apps in Blankmind first, then I can apply the block.`,
      bullets: [
        "Read: this is a category of apps, not one exact app.",
        "Pattern: iOS needs you to choose the apps before Blanked can shield them.",
        "Move: choose the social apps now, then apply the boundary."
      ],
      primary_label: !selected ? "Choose apps" : "Allow Screen Time",
      secondary_label: "Not now",
      actions: [action(setupAction)],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
    };
  }
  if (intent === "social" && unknownApp) {
    return {
      intent: "social",
      title: "Choose App",
      response_text: `I can help block ${unknownApp}, but first you need to choose it in Blankmind.`,
      bullets: [
        `Read: ${unknownApp} is the app you want to control.`,
        "Pattern: iOS requires the exact app selection before Blanked can shield it.",
        "Move: choose the app now, then apply the boundary."
      ],
      primary_label: "Choose app",
      secondary_label: "Not now",
      actions: [action("open_app_picker")],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
    };
  }

  if (intent === "social" && promptApp !== "the app" && hasExplicitBlockRequest(prompt) && (!effectiveSelected || !authorized)) {
    const setupAction = !effectiveSelected ? "open_app_picker" : "request_screen_time_permission";
    return {
      intent: "social",
      title: "Choose App",
      response_text: `Choose ${promptApp} in Blankmind first, then I can apply the block.`,
      bullets: [
        `Read: ${promptApp} is the app you want to control.`,
        "Pattern: iOS needs that app inside your authorized selection before Blanked can shield it.",
        "Move: choose the app now, then apply the boundary."
      ],
      primary_label: !selected ? "Choose app" : "Allow Screen Time",
      secondary_label: "Not now",
      actions: [action(setupAction)],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
    };
  }

  if (intent === "social" && asksForImmediateBlock(prompt) && !timeWindow && (promptApp !== "the app" || appCategory || appSelectionClaimed)) {
    const requestedDuration = explicitDurationMinutes(prompt);
    const target = promptApp !== "the app" ? promptApp : "your selected apps";
    return {
      intent: "social",
      title: "Immediate Protection",
      response_text: language === "es"
        ? (requestedDuration == null ? `Bloquearía ${target} ahora, sin inventar una duración que no has pedido.` : `Bloquearía ${target} ahora durante ${requestedDuration} minutos.`)
        : (requestedDuration == null ? `I’d block ${target} now without inventing a duration you did not ask for.` : `I’d block ${target} now for ${requestedDuration} minutes.`),
      bullets: language === "es"
        ? [
          requestedDuration == null ? `Movimiento: bloquear ${target} ahora y dejar la duración abierta.` : `Movimiento: bloquear ${target} ahora durante ${requestedDuration} minutos.`,
          "Mantener la selección actual de apps protegidas.",
          "Resultado: comprobar el bloqueo y revisar el resultado al terminar."
        ]
        : [
          requestedDuration == null ? `Move: block ${target} now and leave the duration open.` : `Move: block ${target} now for ${requestedDuration} minutes.`,
          "Keep the current protected app selection.",
          "Result: verify the block and review the outcome when it ends."
        ],
      primary_label: language === "es" ? "Bloquear ahora" : "Start now",
      secondary_label: language === "es" ? "Elegir apps" : "Choose apps",
      actions: [action("start_protection", { minutes: requestedDuration, hard_mode: wantsHardMode(prompt) })],
      requires_selected_apps: true,
      requires_screen_time_authorization: true,
    };
  }

  if (intent === "social" &&
      promptApp === "the app" &&
      !appCategory &&
      !timeWindow &&
      !["broke", "held"].includes(lastOutcome) &&
      contains(promptText, ["scroll", "doomscroll", "scrolling", "checking my phone", "check my phone"])) {
    return {
      intent: "social",
      title: "Scroll Context",
      response_text: "Got it. Before making a block, tell me where the scrolling usually starts: app, moment, or time of day.",
      bullets: [
        "Read: you want to stop scrolling, but the target is still broad.",
        "Pattern: useful protection needs the app, trigger or time window.",
        "Move: tell me the app or moment, then I can set the right boundary."
      ],
      primary_label: "Tell pattern",
      secondary_label: "Not now",
      actions: [],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
    };
  }

  if (asksAboutExactAppList(prompt)) {
    return {
      intent: "general",
      title: "App Privacy",
      response_text: "I can use counts and context you choose to share, but I do not need your exact app list to reason about the pattern.",
      bullets: [
        "Read: app privacy matters for this feature.",
        "Pattern: Blanked can work from selected counts, weak hours and your own description.",
        "Move: tell me the app only when it helps create a better boundary."
      ],
      primary_label: "Got it",
      secondary_label: "Not now",
      actions: [],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
    };
  }

  if (intent === "general" && cleanText(memory.pattern_cluster, 80).includes("bedtime")) {
    const followupBedtime = looseSingleTime(prompt);
    if (followupBedtime != null) {
      const start = (followupBedtime + 24 * 60 - 30) % (24 * 60);
      return {
        intent: "sleep",
        title: "Bedtime Boundary",
        response_text: `If ${minuteText(followupBedtime)} is your usual bedtime, the boundary should start before the final scroll begins.`,
        bullets: [
          `Read: your bedtime target is ${minuteText(followupBedtime)}.`,
          "Pattern: this continues the bedtime scroll loop we were already discussing.",
          `Move: protect distracting apps from ${minuteText(start)} to ${minuteText(followupBedtime)} first.`
        ],
        primary_label: "Apply boundary",
        secondary_label: "Not now",
        actions: [action("apply_schedule", { name: "Sleep Boundary", start_minute: start, end_minute: followupBedtime, weekdays: [1, 2, 3, 4, 5, 6, 7], duration_days: 7 })],
        requires_selected_apps: true,
        requires_screen_time_authorization: true,
      };
    }
  }

  if (intent === "general" && memoryApp && weakHours.length > 0 && contains(promptText, ["again", "evening", "worse", "same"])) {
    return {
      intent: "social",
      title: "Remembered Scroll Pattern",
      response_text: `Looks like ${activeApp || "that app"} is pulling you back at the same time again. I'd use that instead of starting from scratch.`,
      bullets: [
        `Pattern: ${activeApp || "that app"} has been risky around ${rememberedRisk || riskWindow}.`,
        `Move: protect earlier than ${rememberedRisk || riskWindow}, especially because the last plan ${lastOutcome || "needs review"}.`,
        outcomeLine,
      ],
      primary_label: "Apply protection",
      secondary_label: "Open report",
      actions: selected && authorized ? [
        action("apply_schedule", { name: "Scroll Control", start_minute: weakHours[0] * 60, end_minute: ((weakHours[0] + 1) % 24) * 60, weekdays: [1, 2, 3, 4, 5, 6, 7], duration_days: 7 })
      ] : [action(selected ? "request_screen_time_permission" : "open_app_picker")],
      requires_selected_apps: !selected,
      requires_screen_time_authorization: !authorized,
    };
  }

  const base = {
    intent,
    title: "Digital Wellness Read",
    response_text: `This looks like a ${cluster}, not just a willpower problem.`,
    bullets: [
      `Pattern: your phone is becoming the default response around ${riskWindow}.`,
      `Move: add friction before ${rememberedRisk || riskWindow}, not after you are already scrolling.`,
      outcomeLine,
    ],
    primary_label: selected && authorized ? "Apply protection" : "Set up",
    secondary_label: "Open report",
    actions: selected && authorized ? [action("apply_ai_plan")] : [action(selected ? "request_screen_time_permission" : "open_app_picker")],
    requires_selected_apps: !selected,
    requires_screen_time_authorization: !authorized,
  };

  if (targetSleepWindow && intent === "sleep") {
    const boundaryStart = (targetSleepWindow.start + 24 * 60 - 15) % (24 * 60);
    const bedtime = minuteText(targetSleepWindow.start);
    const wakeTime = minuteText(targetSleepWindow.end);
    const start = minuteText(boundaryStart);
    return {
      ...base,
      intent: "sleep",
      title: "Sleep Boundary",
      response_text: `If you want to be asleep from ${bedtime} to ${wakeTime}, the phone should get harder to use before ${bedtime}.`,
      bullets: [
        `Read: ${bedtime} is the sleep target, not the moment to start deciding.`,
        "Pattern: the last 15 minutes before bed need friction, not another choice.",
        `Move: protect distracting apps from ${start} to ${bedtime} first.`,
      ],
      primary_label: "Apply boundary",
      secondary_label: "Choose apps",
      actions: [action("apply_schedule", { name: "Sleep Boundary", start_minute: boundaryStart, end_minute: targetSleepWindow.start, weekdays: [1, 2, 3, 4, 5, 6, 7], duration_days: 7 })],
      requires_selected_apps: true,
      requires_screen_time_authorization: true,
    };
  }

  const relativeRoutineWindow = Boolean(relativeMoment(prompt) && !explicitTimeWindow(prompt, context));
  const knownRoutineApp = namedApp(prompt) !== "the app" || (Array.isArray(memory.main_apps) && memory.main_apps.length > 0);
  if (timeWindow && ["sleep", "focus", "social", "general"].includes(intent) && (!relativeRoutineWindow || knownRoutineApp)) {
    const start = minuteText(timeWindow.start);
    const end = minuteText(timeWindow.end);
    const planIntent = intent === "general" ? "social" : intent;
    return {
      ...base,
      intent: planIntent,
      title: planIntent === "sleep" ? "Sleep Protection" : "Scheduled Protection",
      response_text: planIntent === "sleep"
        ? `Got it. For sleep, I’d treat that as ${start} to ${end}.`
        : `Got it. I’d protect that window from ${start} to ${end}.`,
      bullets: [
        "Pattern: the risky moment is already clear, so guessing is unnecessary.",
        `Move: shield distracting apps from ${start} to ${end}.`,
        selected ? "Use your current app selection." : "Choose the apps Blankmind should control first.",
      ],
      primary_label: "Apply window",
      secondary_label: "Choose apps",
      actions: [action("apply_schedule", { name: planIntent === "sleep" ? "Sleep Protection" : "Scroll Control", start_minute: timeWindow.start, end_minute: timeWindow.end, weekdays: [1, 2, 3, 4, 5, 6, 7], duration_days: 7 })],
      requires_selected_apps: true,
      requires_screen_time_authorization: true,
    };
  }

  if (intent === "focus" && promptHasFutureTiming(prompt) && !timeWindow) {
    return {
      ...base,
      title: "Plan Timing",
      response_text: "I can plan this, but I need the time window before I start anything now.",
      bullets: [
        "Read: this is about future focus, not an immediate block.",
        "Pattern: scheduled protection works better when the start time is clear.",
        "Move: tell me the time window, then I can set the plan."
      ],
      primary_label: "Tell time",
      actions: [],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
    };
  }

  if (intent === "focus") {
    const requestedDuration = explicitDurationMinutes(prompt);
    const hardMode = wantsHardMode(prompt);
    const responseText = requestedDuration == null
      ? "I’d start protection now and keep your current app list as it is."
      : `I’d start a ${hardMode ? "strict " : ""}${requestedDuration}-minute block now and keep your current app list as it is.`;
    return { ...base, title: hardMode ? "Strict Focus Protection" : "Focus Protection", response_text: responseText, bullets: [requestedDuration == null ? "Move: start protection now without adding an unrequested time limit." : `Move: start ${requestedDuration} minutes now.`, "Keep the protected app list unchanged.", `Signal: ${riskWindow}.`], primary_label: "Start now", actions: [action("start_protection", { minutes: requestedDuration, hard_mode: hardMode })], requires_selected_apps: true, requires_screen_time_authorization: true };
  }

  if (intent === "study") {
    return {
      ...base,
      title: "24h Study Protection",
      response_text: "I read this as a study window, so the useful move is a short plan with friction already in place.",
      bullets: [
        "Read: studying needs fewer escape routes, not more motivation.",
        "Pattern: YouTube or social apps become fallback when effort rises.",
        "Move: block distractions during the next key study window and cap fallback scrolling."
      ],
      primary_label: "Apply study plan",
      secondary_label: "Choose apps",
      actions: [
        action("apply_schedule", { name: "Study Protection", start_minute: 9 * 60, end_minute: 12 * 60, weekdays: [1, 2, 3, 4, 5, 6, 7], duration_days: 1 }),
        action("set_daily_limit", { minutes: 30 })
      ],
      requires_selected_apps: true,
      requires_screen_time_authorization: true,
    };
  }

  if (intent === "sleep") {
    const bedtime = explicitSingleTime(prompt);
    const rememberedBedtime = memory.bedtime_minute == null ? null : cleanNumber(memory.bedtime_minute, 23 * 60, 0, 1439);
    const targetBedtime = bedtime ?? rememberedBedtime;
    if (targetBedtime != null) {
      const start = (targetBedtime + 24 * 60 - 30) % (24 * 60);
      return { ...base, title: "Bedtime Boundary", response_text: `If you want to be asleep by ${minuteText(targetBedtime)}, the phone should get harder to use before then.`, bullets: [`Read: your target bedtime is ${minuteText(targetBedtime)}.`, "Pattern: the phone needs to become less available before the final scroll starts.", `Move: protect distracting apps from ${minuteText(start)} to ${minuteText(targetBedtime)} first.`], primary_label: "Apply boundary", actions: [action("apply_schedule", { name: "Sleep Boundary", start_minute: start, end_minute: targetBedtime, weekdays: [1, 2, 3, 4, 5, 6, 7], duration_days: 7 })] };
    }
    return { ...base, title: "Bedtime Scroll Loop", response_text: "That late scroll is probably leaking into sleep, not just adding screen time. What time do you want to be asleep?", bullets: ["Read: nights are the risky context.", "Pattern: the phone extends the day when your body needs shutdown.", "Move: tell me your usual bedtime before I suggest a block."], primary_label: "Tell bedtime", actions: [] };
  }

  if (intent === "emergency") {
    return {
      ...base,
      title: "Loss Of Control",
      response_text: context.is_blank_active ? "You are already protected; changing settings now would weaken the boundary." : "This is a high-risk moment. Reduce choice immediately.",
      bullets: context.is_blank_active ? [
        "Read: the urge is happening while protection is already on.",
        "Pattern: changing settings now would make the boundary weaker.",
        "Move: stay protected and review the trigger after the urge passes."
      ] : [
        `Read: emergency unlocks left today: ${cleanNumber(context.emergency_unlocks_remaining, 0, 0, 3)}.`,
        "Pattern: this is the wrong moment to redesign the whole plan.",
        "Move: use a short hard block, then review what triggered it."
      ],
      primary_label: context.is_blank_active ? "Stay protected" : "Start hard block",
      actions: context.is_blank_active ? [] : [action("start_protection", { minutes: null, hard_mode: true })]
    };
  }

  if (intent === "allowOnly") {
    return { ...base, title: "Allow Only", response_text: "This is about reducing decisions: keep essentials available and remove the rest.", bullets: ["Move: allow only essential apps while protected.", "Use it when you need your phone but not the feed.", "Choose essentials like WhatsApp, Maps or calendar."], primary_label: "Enable Allow Only", secondary_label: "Choose apps", actions: [action("enable_allow_only"), action("open_app_picker")], requires_selected_apps: false };
  }

  if (intent === "vacation") {
    const rulesText = cleanText(prompt, 600).toLowerCase();
    const wantsResume = contains(rulesText, ["resume", "reanuda", "reanudar", "remove pause", "disable pause", "quita la pausa", "quitar la pausa", "reactiva", "reactivar"]);
    const wantsPause = contains(rulesText, ["pause", "pausa", "pausar"]);
    const active = wantsResume ? true : wantsPause ? false : context.vacation_mode_active === true;
    return { ...base, title: active ? "Resume Rules" : "Pause Rules", response_text: active ? "Your rules are paused; I can bring the structure back." : "Pausing is fine when the context changes, as long as it has an end.", bullets: active ? ["Read: the break is over.", "Pattern: structure should return without changing your selected apps.", "Move: resume schedules now."] : ["Read: your context changed for a short period.", "Pattern: open-ended pauses become accidental relapse.", "Move: pause scheduled protection for 7 days and keep manual blocks available."], primary_label: active ? "Resume rules" : "Pause 7 days", secondary_label: "Advanced", actions: active ? [action("disable_pause")] : [action("pause_rules", { hours: 168 })], requires_selected_apps: false, requires_screen_time_authorization: false };
  }

  if (intent === "weeklyReview") {
    return { ...base, title: "Weekly Read", response_text: "The useful question is whether the current protection is preventing breaks, not whether the plan sounds good.", bullets: [`Read: ${cleanNumber(context.weekly_protected_minutes, 0, 0, 10080)} protected minutes this week.`, `Pattern: ${cleanNumber(context.weekly_break_count, 0, 0, 100)} break signals detected.`, `Move: adapt the next plan around ${riskWindow}.`], primary_label: "Apply adaptive plan", secondary_label: "Open report", actions: [action("apply_ai_plan")] };
  }

  if (intent === "adultContent") {
    return { ...base, title: "Urge Protection", response_text: "This is a cue-control problem: make access harder before the urge peaks.", bullets: ["Read: this is an urge pattern, not a moral failure.", "Pattern: easy access keeps the loop available at the worst moment.", "Move: enable adult web filtering and keep distracting apps protected."], primary_label: "Enable protection", actions: [action("enable_adult_filter")], requires_selected_apps: false };
  }

  if (intent === "social") {
    const relative = relativeMoment(prompt);
    const meal = relative && ["breakfast", "lunch", "dinner"].includes(relative.key) ? relative.key : "";
    const mealEnd = meal && memory[`${meal}_end_minute`] != null
      ? cleanNumber(memory[`${meal}_end_minute`], 13 * 60, 0, 1439)
      : null;
    const rememberedMealStart = mealEnd == null && weakHours.length > 0 ? weakHours[0] * 60 : null;
    const resolvedMealStart = mealEnd ?? rememberedMealStart;
    const mealDefault = meal === "breakfast" ? 8 * 60 : meal === "dinner" ? 20 * 60 : 13 * 60;
    const mealDuration = meal === "dinner" ? 90 : 60;
    const momentText = meal ? `after ${meal}` : rememberedRisk || "before the usual scroll window";
    const startMinute = resolvedMealStart ?? (meal ? mealDefault : (weakHours.length > 0 ? weakHours[0] * 60 : null));
    const hasKnownAppTarget = namedApp(prompt) !== "the app" || (Array.isArray(memory.main_apps) && memory.main_apps.length > 0);
    const scheduleAction = startMinute == null || !hasKnownAppTarget
      ? null
      : action("apply_schedule", {
        name: meal ? `${meal.charAt(0).toUpperCase()}${meal.slice(1)} Protection` : "Scroll Control",
        start_minute: startMinute,
        end_minute: (startMinute + (meal ? mealDuration : (weakHours.length > 0 ? 60 : 150))) % (24 * 60),
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        duration_days: 7,
      });
    const requestedLimit = explicitDurationMinutes(prompt);
    const limitAction = requestedLimit == null ? null : action("set_daily_limit", { minutes: requestedLimit });
    const outcomeMove = lastOutcome === "broke"
      ? "Move: start the boundary earlier and review what broke the last attempt."
      : lastOutcome === "held"
        ? "Move: repeat the boundary that held before making it harder."
        : "Move: add friction before the scroll has momentum and review whether the window holds.";
    return {
      ...base,
      title: "Scroll Loop",
      response_text: meal
        ? resolvedMealStart != null
          ? `I’d protect the ${meal} reset window from ${minuteText(startMinute)} to ${minuteText((startMinute + mealDuration) % (24 * 60))}, when social apps are most likely to become automatic.`
          : `${meal.charAt(0).toUpperCase()}${meal.slice(1)} can be a weak spot, but I need the usual finish time before setting a boundary.`
        : `That sounds less like free time and more like automatic scrolling.`,
      bullets: [
        "Pattern: the trigger matters more than total screen time.",
        `Move: add friction ${momentText}, before the scroll has momentum.`,
        outcomeMove,
      ],
      actions: [limitAction, scheduleAction].filter(Boolean),
    };
  }

  if (intent === "general" && (asksForAdvice(prompt) || asksForPlan(prompt) || asksWhereToStart(prompt)) && !hasExplicitBlockRequest(prompt)) {
    if (asksForDigitalDetoxPlan(prompt)) {
      const responseText = language === "es"
        ? "Sí. Yo lo haría de forma práctica: elegiría las apps que más te arrastran, protegería una sola franja de riesgo al día y dejaría tranquilo el resto del móvil, para no intentar arreglarlo todo de golpe. Empezaría por el momento en que más se te va de las manos y solo lo haría más estricto si hace falta. ¿Cuándo suele empezar?"
        : "Yes. I’d keep it practical: choose the apps that pull you in, protect one high-risk window each day, and leave the rest of the phone alone so you’re not fighting everything at once. Start with the moment you lose control most often, then make the boundary stronger only if you need to. When does it usually start?";
      return {
        ...base,
        title: "Digital Detox",
        response_text: responseText,
        bullets: [
          "Read: the goal is a lighter phone, not a punishment.",
          "Pattern: one repeated risk moment is easier to change than the whole day.",
          "Move: choose the distractions and tell me when the pull is strongest.",
        ],
        primary_label: language === "es" ? "Decir momento" : "Tell me the moment",
        actions: [],
        requires_selected_apps: false,
        requires_screen_time_authorization: false,
      };
    }
    if (asksForPlan(prompt)) {
      return {
        ...base,
        title: "Plan Context",
        response_text: "Tell me the app, moment, or habit you want to change first.",
        bullets: [
          "Read: you want a plan, but the target is still too broad.",
          "Pattern: useful protection starts from one repeated trigger.",
          "Move: tell me the app, moment or habit that takes over most often."
        ],
        primary_label: "Tell pattern",
        actions: [],
        requires_selected_apps: false,
        requires_screen_time_authorization: false,
      };
    }
    return {
      ...base,
      title: "Digital Wellness Read",
      response_text: "Start by identifying the moment when the phone becomes automatic. Then make that moment slightly harder before adding strict blocks.",
      bullets: [
        "Read: you are asking for guidance, not a blocking plan yet.",
        "Pattern: the trigger usually matters more than total screen time.",
        "Move: name the app and the moment it usually takes over."
      ],
      primary_label: "Tell pattern",
      actions: [],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
    };
  }

  if (intent === "general" && !asksForAdvice(prompt)) {
    return {
      ...base,
      title: "Noted",
      response_text: "What’s going on?",
      bullets: [
        "Read: there is no clear action request yet.",
        "Pattern: Blanked should not turn every message into a blocking plan.",
        "Move: answer naturally and wait for the real need."
      ],
      primary_label: "Tell goal",
      actions: [],
      requires_selected_apps: false,
      requires_screen_time_authorization: false,
    };
  }

  return { ...base, primary_label: "Got it", actions: [], requires_selected_apps: false, requires_screen_time_authorization: false };
}

const actionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["type", "window_id", "minutes", "hard_mode", "name", "start_minute", "end_minute", "weekdays", "duration_days", "hours"],
  properties: {
    type: { type: "string", enum: ["start_protection", "apply_schedule", "update_schedule", "delete_schedule", "delete_all_schedules", "enable_allow_only", "enable_adult_filter", "set_daily_limit", "pause_rules", "disable_pause", "open_app_picker", "request_screen_time_permission", "apply_ai_plan", "none"] },
    window_id: { type: ["string", "null"], maxLength: 80 },
    minutes: { type: ["integer", "null"], minimum: 5, maximum: 240 },
    hard_mode: { type: ["boolean", "null"] },
    name: { type: ["string", "null"], maxLength: 40 },
    start_minute: { type: ["integer", "null"], minimum: 0, maximum: 1439 },
    end_minute: { type: ["integer", "null"], minimum: 0, maximum: 1439 },
    weekdays: { type: ["array", "null"], items: { type: "integer", minimum: 1, maximum: 7 }, maxItems: 7 },
    duration_days: { type: ["integer", "null"], minimum: 1, maximum: 14 },
    hours: { type: ["integer", "null"], minimum: 1, maximum: 168 },
  },
};

const agentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["interpretation", "behavior_pattern", "next_move", "plan"],
  properties: {
    interpretation: { type: "string", maxLength: 160 },
    behavior_pattern: { type: "string", maxLength: 160 },
    next_move: { type: "string", maxLength: 160 },
    plan: {
      type: "object",
      additionalProperties: false,
      required: ["intent", "title", "response_text", "speech_text", "followup_text", "bullets", "primary_label", "secondary_label", "actions", "requires_selected_apps", "requires_screen_time_authorization"],
      properties: {
        intent: { type: "string", enum: ["sleep", "focus", "study", "emergency", "allowOnly", "vacation", "weeklyReview", "adultContent", "social", "general"] },
        title: { type: "string", maxLength: 70 },
        response_text: { type: "string", maxLength: 180 },
        speech_text: { type: "string", maxLength: 420 },
        followup_text: { type: "string", maxLength: 240 },
        bullets: { type: "array", minItems: 2, maxItems: 4, items: { type: "string", maxLength: 140 } },
        primary_label: { type: "string", maxLength: 32 },
        secondary_label: { type: "string", maxLength: 32 },
        requires_selected_apps: { type: "boolean" },
        requires_screen_time_authorization: { type: "boolean" },
        actions: { type: "array", maxItems: 4, items: actionSchema },
      },
    },
  },
};

function appCapabilities(context = {}) {
  return {
    actions: [
      "start_protection",
      "apply_schedule",
      "update_schedule",
      "delete_schedule",
      "delete_all_schedules",
      "set_daily_limit",
      "enable_allow_only",
      "enable_adult_filter",
      "pause_rules",
      "disable_pause",
      "open_app_picker",
      "request_screen_time_permission",
      "apply_ai_plan",
    ],
    channels: ["app", "whatsapp", "sms", "push"],
    can_start_now: context.is_blank_active !== true,
    has_selected_apps: context.has_selected_apps === true,
    screen_time_authorized: context.screen_time_authorized === true,
    app_presence_state: context.app_presence_state || "never_seen",
    app_presence_recent: context.app_presence_recent === true,
    app_ready: context.app_ready === true,
    limits: {
      max_start_minutes: 240,
      max_schedule_days: 14,
      max_pause_hours: 168,
      proactive_max_per_day: 1,
    },
  };
}

function shouldUseAppLayer(prompt, context = {}) {
  if (resolveBlockingContract(prompt, context).user_request) return true;
  if (appCorrection(prompt)) return false;
  if (asksForRulesAction(prompt)) return true;
  const intent = classify(prompt, context);
  const memory = context.memory && typeof context.memory === "object" ? context.memory : {};
  const hasRememberedScrollPattern = Array.isArray(memory.main_apps) && memory.main_apps.length > 0 &&
    Array.isArray(memory.weak_hours) && memory.weak_hours.some((hour) => Number.isFinite(Number(hour)));
  if (proactiveTrigger(prompt, context)) return true;
  if (isWebPreview(context)) return false;
  if (isWebPreview(context) && asksAboutBlankedDataOrPrediction(prompt)) return false;
  if (isWebPreview(context) && !hasExplicitBlockRequest(prompt) && !explicitTimeWindow(prompt, context) && !explicitDurationMinutes(prompt)) {
    if (isGeneralWellnessPrompt(prompt)) return false;
    if (asksForAdvice(prompt) || asksForPlan(prompt) || asksWhereToStart(prompt) || asksAboutAssistantCapabilities(prompt)) return false;
  }
  if (intent !== "general") return true;
  if (hasSleepConversationContext(context) && looseSingleTime(prompt) != null) return true;
  if (recentRelativeTimeQuestion(context) && looseSingleTime(prompt) != null) return true;
  if (hasRememberedScrollPattern && contains(cleanText(prompt, 600).toLowerCase(), ["again", "evening", "worse", "same"])) return true;
  if (hasExplicitBlockRequest(prompt) || asksForAdvice(prompt) || asksForPlan(prompt)) return true;
  if (asksWhereToStart(prompt) || asksAboutAssistantCapabilities(prompt)) return true;
  if (asksForUnsupportedReminder(prompt) || asksForBroadAutomation(prompt) || asksForPermanentLockout(prompt)) return true;
  if (asksAboutExactAppList(prompt)) return true;
  if (namedApp(prompt) !== "the app" || requestedAppCategory(prompt) || requestedUnknownApp(prompt)) return true;
  if (explicitTimeWindow(prompt, context) || explicitDurationMinutes(prompt) || relativeMoment(prompt)) return true;
  return false;
}

function conversationFallbackPlan(prompt, language = "en") {
  const text = cleanText(prompt, 180);
  const lower = cleanText(prompt, 700).toLowerCase();
  if (isConversationalOnly(prompt)) return conversationalOnlyPlan(prompt, language);
  let fallbackText = language === "es" ? "Cuéntame qué pasa." : "What’s going on?";
  if (asksForDigitalDetoxPlan(prompt)) {
    fallbackText = language === "es"
      ? "Sí. Yo lo haría de forma práctica: elige las apps que más te arrastran, protege una sola franja de riesgo al día y no intentes arreglar todo el móvil de golpe. Empezaría por el momento en que más se te va de las manos. ¿Cuándo suele empezar?"
      : "Yes. I’d keep it practical: choose the apps that pull you in, protect one high-risk window each day, and don’t try to fix the whole phone at once. I’d start with the moment you lose control most often. When does it usually start?";
  } else if (contains(lower, ["scroll", "scrolling", "doomscroll", "night", "bedtime", "at night", "noche", "cama"])) {
    fallbackText = language === "es"
      ? "Empezaría antes de meterte en la cama, no cuando ya estás cansado. Dime a qué hora quieres estar dormido y ajustaré el límite a ese momento."
      : "I’d start before you get into bed, not once you’re already tired. Tell me when you want to be asleep and I’ll shape the boundary around that.";
  } else if (isOutOfWellnessScope(prompt)) {
    if (contains(lower, ["sleep", "dormir", "descanso"])) {
      fallbackText = language === "es"
        ? "Puedo ayudarte desde el ángulo de bienestar digital: reducir móvil en la cama, cortar scroll nocturno o crear una barrera antes de dormir. ¿Qué parte del sueño te está rompiendo el móvil?"
        : "I can help from the digital wellness angle: less phone in bed, less night scrolling, or a pre-sleep app boundary. What part of your sleep is your phone affecting?";
    } else if (contains(lower, ["run", "running", "correr", "training", "entren"])) {
      fallbackText = language === "es"
        ? "No haría un plan de entrenamiento, pero sí puedo ayudarte con la parte digital: quitar distracciones antes de salir, proteger la franja de entreno o evitar que el móvil corte la constancia. ¿Dónde te interfiere el móvil?"
        : "I would not make a training plan, but I can help with the digital part: removing distractions before you go, protecting the training window, or stopping your phone from breaking consistency. Where does your phone get in the way?";
    } else if (contains(lower, ["energy", "energia", "energía", "tired", "cansado", "cansada", "stress", "estrés", "estres", "anxiety", "ansiedad"])) {
      fallbackText = language === "es"
        ? "Puedo ayudarte si lo miramos como bienestar digital: qué momentos de móvil, scroll o notificaciones te drenan energía o aumentan estrés. ¿En qué momento notas que la pantalla lo empeora?"
        : "I can help if we frame it as digital wellness: which phone, scroll, or notification moments drain your energy or raise stress. When do screens make it worse?";
    } else {
      fallbackText = language === "es"
        ? "Solo puedo ayudarte con bienestar digital: móvil, pantallas, apps, foco y hábitos de uso. Si hay una parte digital en el problema, cuéntame esa parte."
        : "I can only help with digital wellness: your phone, screens, apps, focus, and usage habits. If there is a digital part of the problem, tell me that part.";
    }
  } else if (asksAboutBlankedDataOrPrediction(prompt)) {
    fallbackText = language === "es"
      ? "No lo adivinamos de la nada. Blankmind estima ventanas de riesgo combinando sueño, recuperación, actividad, presión de desbloqueos, cadenas de apps por categoría, check-ins rápidos, resultados de planes y tu baseline personal. La predicción es probabilística y explica el porqué; no es diagnóstico médico ni vigilancia exacta."
      : "We do not guess it from thin air. Blankmind estimates risk windows from sleep, recovery, activity, pickup pressure, app-category chains, quick check-ins, plan outcomes and your personal baseline. The forecast is probabilistic and explains why; it is not a medical diagnosis or exact surveillance.";
  } else if (isProductivityPrompt(prompt)) {
    fallbackText = language === "es"
      ? "Para producir más, elige una sola prioridad para el siguiente bloque y reduce decisiones antes de empezar. Trabaja 25-50 minutos, descansa poco y quita notificaciones. Este sí es un buen caso para Blankmind: en la app podrías bloquear redes y apps de scroll durante ese bloque."
      : "To boost productivity, choose one priority for the next work block and remove decisions before you start. Work for 25-50 minutes, take a short break, and turn off nonessential notifications. This is a good Blankmind use case: in the app, you could block social and scroll apps during that block.";
  }
  return {
    intent: "general",
    title: "Conversation",
    response_text: fallbackText,
    bullets: [],
    primary_label: "Reply",
    secondary_label: "Not now",
    actions: [],
    requires_selected_apps: false,
    requires_screen_time_authorization: false,
    message_text: fallbackText,
    speech_text: fallbackText,
    followup_text: "",
  };
}

async function modelConversationPlan(prompt, context = {}, language = "en") {
  const fallback = conversationFallbackPlan(prompt, language);
  if (isOutOfWellnessScope(prompt)) return { plan: fallback, source: "deterministic_out_of_scope" };
  if (asksAboutExactAppList(prompt)) return { plan: fallbackPlan(prompt, context), source: "deterministic_privacy" };
  if (appCorrection(prompt)) {
    const correction = fallbackPlan(prompt, context);
    if (correction && correction.title === "Context Corrected") return { plan: correction, source: "deterministic_context_correction" };
  }
  const deterministicContext = ambiguousDigitalMomentPlan(prompt, language);
  if (deterministicContext) return { plan: deterministicContext, source: "deterministic_digital_context" };
  const contextual = conversationalFollowupPlan(prompt, context, language);
  if (contextual) return { plan: contextual, source: "deterministic_conversation_context" };
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { plan: fallback, source: "deterministic_conversation_fallback" };
  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: "You are BM, Blankmind's digital wellness assistant. Stay strictly inside digital wellness: phone behavior, screens, apps, scrolling, focus, attention, notifications, digital habits, screen-related sleep disruption, and phone-control actions. Treat the supplied personal_context as this person's private, canonical context. Use it naturally to answer questions about their current configuration, history and likely best next move. Never expose raw context or confuse it with another person. Do not provide generic wellness, training, running, nutrition, stress-management, recovery, or sleep plans unless the user's question clearly connects the problem to phones, screens, apps, or digital behavior. If the user asks about general wellness or anything outside digital wellness, briefly say you can only help with digital wellness and invite them to share the phone/screen part of the problem. Naturalness is the top priority: reply like a normal, useful person in chat, not a support assistant, sales funnel, or setup wizard. Never use semicolons. Never use markdown or numbered lists unless asked. Never mention internal context, old app context, patterns, backend, schemas, Screen Time, Digital Wellbeing, or competing phone controls. Keep answers as long as the situation needs, but never add text just to sound complete. If the user has not given enough digital context, ask one clear question and do not add advice yet. If the user corrects an app, moment, or assumption, use the corrected app or moment in the next answer instead of drifting back to older context. When the problem is apps, scrolling, focus blocks, distraction control, notifications, or phone boundaries, naturally mention that Blankmind can block apps or create a plan for that exact problem. Prefer Blankmind blocks and plans over generic advice like putting the phone away when the issue is a specific app or scroll loop. On web preview, add a short Blankmind-specific note only when phone control, scrolling, distractions, apps, or blocking are relevant: web can plan it, but Blankmind executes blocking because permissions live in the app. For productivity/focus requests, it is relevant to suggest a work block in Blankmind that blocks social, reels, shorts, or other scroll apps during the chosen window. If the user asks about Blankmind, prediction, screen habits, behavior, wearables, Health, recovery, or how the product knows something, explain only how those signals improve digital wellness decisions and honest limits before mentioning any app download. For prediction/data questions, say it is not guessed from thin air: Blankmind can use connected wearable/Health signals, phone-use patterns, pickup pressure, app-category chains, quick check-ins, plan outcomes, personal baseline, recent routines, global behavioral patterns, and AI forecasts to estimate digital risk windows; be clear this is probabilistic behavioral forecasting, not medical diagnosis or exact app/location surveillance. If the message is small talk, just reply naturally and do not mention Blankmind, the app, blocks, plans, reports, setup, links, or capabilities. Every visible surface must be English.",
        },
        {
          role: "system",
          content: `${BM_CONVERSATIONAL_TONE} This is the conversation-only path. You cannot execute, confirm, schedule or promise any device change. The execution_authority object is authoritative; prior assistant messages are not receipts. Explain supported capabilities conditionally, and ask for clarification when an action is requested. A daily usage limit has no automatic expiry or scheduled start. Never promise unsupported capabilities.`,
        },
        {
          role: "system",
          content: `Write every visible response in ${language === "es" ? "Spanish" : "English"}. Keep JSON keys, intent values, and action types in English.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            prompt: cleanText(prompt, 600),
            response_language: language,
            execution_authority: { authorized_actions: [], verified_native_receipt: null, can_execute_or_confirm_changes: false },
            native_capabilities: { daily_limit: "Usage allowance starting now, without automatic expiry or scheduled start", timed_block: "A proposed interval requires validated timing, recurrence and iPhone approval", selection: "All protection uses the person's canonical distraction selection", unsupported_in_chat: ["automatic daily-limit expiry", "arbitrary app-specific targeting", "allow-only or adult-filter configuration"] },
            recent_context: context.recent_messages || context.conversation || null,
            personal_context: personalContextView(context),
          }),
        },
      ],
      max_output_tokens: 220,
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`openai_conversation_failed_${response.status}`);
  }
  const reply = completeNaturalText(extractResponseText(await response.json()), 280);
  if (!reply) return { plan: fallback, source: `openai:${model}:conversation_empty` };
  return {
    plan: {
      ...fallback,
      response_text: reply,
      message_text: reply,
      speech_text: reply,
    },
    source: `openai:${model}:conversation`,
  };
}

function actionNeedsScreenTime(actionType) {
  return ["start_protection", "apply_schedule", "update_schedule", "set_daily_limit", "enable_allow_only", "enable_adult_filter", "apply_ai_plan"].includes(actionType);
}

function actionNeedsSelection(actionType) {
  return ["start_protection", "apply_schedule", "set_daily_limit", "apply_ai_plan"].includes(actionType);
}

function deterministicNoActionTitle(title) {
  return new Set([
    "Bounded Protection",
    "Bedtime Scroll Read",
    "Lectura de noche",
    "Contextual Boundary",
    "Work App Conflict",
    "Conflicto con app de trabajo",
    "Scroll Pattern",
    "Scroll Context",
    "Lunch Context",
    "Context Corrected",
    "App Privacy",
    "Digital Wellness Read",
    "Plan Context",
    "Digital Detox",
    "Plan Timing",
    "Scroll Window",
    "Personal Assistant",
    "Automation Setup",
    "Reminder Context",
    "Daily Limit",
    "Detalles del bloqueo",
    "Blocking details",
    "Conversation",
    "Noted",
    "Greeting",
    "Loss Of Control",
    "Proactive Signal",
    "Señal proactiva",
  ]).has(title);
}

function deterministicActionTitle(title) {
  return new Set([
    "Bedtime Boundary",
    "Sleep Boundary",
    "Scheduled Protection",
    "Sleep Protection",
    "Dinner Boundary",
    "Lunch Boundary",
    "Morning Boundary",
    "Work Boundary",
    "Remembered Scroll Pattern",
    "Choose App",
    "Choose Apps",
    "24h Study Protection",
    "Loss Of Control",
    "Urge Protection",
    "Allow Only",
    "Focus Protection",
    "Strict Focus Protection",
    "Immediate Protection",
    "Pause Rules",
    "Resume Rules",
    "Weekly Read",
    "Use Spike",
    "Señal de uso",
    "Break Signal",
    "Señal de recaída",
    "Recovery Signal",
    "Señal de descanso",
  ]).has(title);
}

function blockingPickerAction(contract) {
  const data = contract && contract.data ? contract.data : {};
  const values = {
    minutes: data.end && data.end.type === "duration" ? data.end.value : null,
    hard_mode: false,
    name: data.action === "daily_limit" ? "Daily Limit" : "Immediate Protection",
  };
  if (data.start && data.start.type === "time") {
    const startMinute = Number(data.start.value);
    const endMinute = data.end && data.end.type === "duration"
      ? (startMinute + Number(data.end.value)) % (24 * 60)
      : Number(data.end && data.end.value);
    const days = data.recurrence && Array.isArray(data.recurrence.value) ? data.recurrence.value : [0];
    if (Number.isFinite(startMinute) && Number.isFinite(endMinute)) {
      values.name = `Block ${Array.isArray(data.apps) ? data.apps.join(" + ") : "selected apps"}`;
      values.start_minute = startMinute;
      values.end_minute = endMinute;
      values.weekdays = days[0] === 0 ? [1, 2, 3, 4, 5, 6, 7] : days;
      values.duration_days = days[0] === 0 ? 1 : 7;
    }
  }
  return action("open_app_picker", values);
}

function actionGate(plan, fallback, context = {}, prompt = "") {
  const proposed = Array.isArray(plan.actions) ? plan.actions.slice(0, 4).map((item) => normalizeActionForPrompt(item, prompt)).map((item) => normalizeSingleBlockAction(item, context)).filter(Boolean) : [];
  const blockingContract = resolveBlockingContract(prompt, context, plan);
  const blockingCandidate = blockingContract.user_request || proposed.some((item) => isBlockingActionType(item.type));
  const missingOnlyApps = blockingContract.user_request
    && blockingContract.missing_fields.length === 1
    && blockingContract.missing_fields[0] === "apps"
    && blockingContract.data
    && blockingContract.data.start
    && blockingContract.data.end
    && context.app_presence_recent === true;
  if (missingOnlyApps && !["mode", "device_selection"].includes(blockingContract.app_source) && !claimsSelectedApps(prompt)) {
    return [blockingPickerAction(blockingContract)];
  }
  // A user-declared block must remain inert until its contract is complete.
  // A model/fallback recommendation without an explicit block request still
  // needs to pass through the normal setup and permission gates below.
  if (blockingContract.user_request && !blockingContract.ready) return [];
  if (blockingContract.user_request && blockingContract.ready && !["mode", "device_selection"].includes(blockingContract.app_source) && !claimsSelectedApps(prompt)) {
    return [blockingPickerAction(blockingContract)];
  }
  const hasClearFutureWindow = Boolean(explicitTimeWindow(prompt, context) || anchorWindow(prompt));
  let fallbackActions = Array.isArray(fallback.actions) ? fallback.actions.filter((item) => item && item.type !== "none").map((item) => normalizeActionForPrompt(item, prompt)).map((item) => normalizeSingleBlockAction(item, context)).filter(Boolean) : [];
  if (asksForDailyLimit(prompt) && explicitDurationMinutes(prompt) == null) {
    fallbackActions = fallbackActions.filter((item) => item.type !== "set_daily_limit");
  }
  const selected = context.has_selected_apps === true || claimsSelectedApps(prompt);
  const authorized = context.screen_time_authorized === true;
  const promptIntent = classify(prompt, context);
  const adviceOnly = asksForAdvice(prompt) && ["sleep", "social", "general"].includes(promptIntent) && !hasExplicitBlockRequest(prompt) && !proactiveTrigger(prompt, context);
  if (isConversationalOnly(prompt)) return [];
  if (proactiveTrigger(prompt, context)) return fallbackActions.slice(0, 4);
  if (adviceOnly) return [];
  if (fallbackActions.length === 0 && deterministicNoActionTitle(fallback.title)) return [];
  const fallbackNeedsSetup = fallbackActions.some((item) => (actionNeedsSelection(item.type) && !selected) || (actionNeedsScreenTime(item.type) && !authorized));
  if (fallback.title === "Scroll Loop" && fallbackActions.length > 0 && !fallbackNeedsSetup) return fallbackActions.slice(0, 4);
  if (fallbackActions.length > 0 && deterministicActionTitle(fallback.title) && !fallbackNeedsSetup) return fallbackActions.slice(0, 4);
  if (hasClearFutureWindow && fallbackActions.some((item) => item.type === "apply_schedule")) return fallbackActions.slice(0, 4);
  if (asksForPermanentLockout(prompt) || asksAboutAssistantCapabilities(prompt) || asksForUnsupportedReminder(prompt) || asksForBroadAutomation(prompt)) return [];
  if (promptHasFutureTiming(prompt) && !hasClearFutureWindow && !contains(cleanText(prompt, 600).toLowerCase(), ["now", "ahora"])) return [];
  if (context.is_blank_active === true && proposed.some((item) => item.type === "start_protection")) return [];

  const setupActions = [];
  const gated = [];

  for (const item of proposed) {
    if (!item || item.type === "none") continue;
    if (actionNeedsSelection(item.type) && !selected) {
      setupActions.push(action("open_app_picker"));
      continue;
    }
    if (actionNeedsScreenTime(item.type) && !authorized) {
      setupActions.push(action("request_screen_time_permission"));
      continue;
    }
    if (item.type === "apply_schedule" && (item.start_minute == null || item.end_minute == null || item.start_minute === item.end_minute)) continue;
    if (item.type === "set_daily_limit" && asksForDailyLimit(prompt) && explicitDurationMinutes(prompt) == null) continue;
    if (item.type === "start_protection" && promptHasFutureTiming(prompt) && !contains(cleanText(prompt, 600).toLowerCase(), ["now", "ahora"])) continue;
    gated.push(item);
  }

  const uniqueSetup = setupActions.filter((item, index, items) => items.findIndex((candidate) => candidate.type === item.type) === index);
  if (uniqueSetup.length > 0) return uniqueSetup.slice(0, 2);

  if (!selected && fallbackActions.some((item) => actionNeedsSelection(item.type))) {
    return [action("open_app_picker")];
  }
  if (!authorized && fallbackActions.some((item) => actionNeedsScreenTime(item.type))) {
    return [action("request_screen_time_permission")];
  }

  if (gated.length > 0) return gated;

  if (fallbackActions.length > 0 && !adviceOnly && !promptHasFutureTiming(prompt)) return fallbackActions.slice(0, 4).map((item) => normalizeActionForPrompt(item, prompt)).filter(Boolean);
  return [];
}

function normalizeSingleBlockAction(item, context = {}) {
  if (!item) return item;
  if (item.type === "apply_schedule") return action("apply_schedule", {
    name:"Protection",
    start_minute:item.start_minute,
    end_minute:item.end_minute,
    weekdays:item.weekdays,
    duration_days:item.duration_days,
  });
  if (item.type === "open_app_picker") return action("open_app_picker", {
    minutes:item.minutes,
    hard_mode:item.hard_mode,
    name:"Distractions",
    start_minute:item.start_minute,
    end_minute:item.end_minute,
    weekdays:item.weekdays,
    duration_days:item.duration_days,
  });
  return item;
}

function normalizeActionForPrompt(candidate, prompt = "") {
  const normalized = normalizeAction(candidate);
  if (!normalized) return null;
  if (explicitDurationMinutes(prompt) == null && (normalized.type === "start_protection" || (normalized.type === "set_daily_limit" && asksForDailyLimit(prompt)))) {
    normalized.minutes = null;
  }
  return normalized;
}

function normalizePlan(parsed, fallback, context = {}, prompt = "", language = "en") {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const plan = source.plan && typeof source.plan === "object" ? source.plan : source;
  const validIntents = new Set(["sleep", "focus", "study", "emergency", "allowOnly", "vacation", "weeklyReview", "adultContent", "social", "general"]);
  const planIntent = validIntents.has(plan.intent) ? plan.intent : fallback.intent;
  const bullets = Array.isArray(plan.bullets) ? plan.bullets.map((item) => userFacingText(item, 140)).filter(Boolean).slice(0, 4) : [];
  const interpretation = userFacingText(source.interpretation, 160);
  const behavior = userFacingText(source.behavior_pattern, 160);
  const nextMove = userFacingText(source.next_move, 160);
  const fallbackBullets = fallback.bullets;
  const blockingContract = resolveBlockingContract(prompt, context, plan);
  const hasUserBlockingContract = blockingContract.user_request;
  const incompleteBlocking = hasUserBlockingContract && !blockingContract.ready;
  const actions = actionGate(plan, fallback, context, prompt);
  const hasExecutableActions = actions.some((item) => item && item.type !== "none");
  const modelProposedAction = Array.isArray(plan.actions) && plan.actions.some((item) => item && item.type && item.type !== "none");
  const preservesScrollLoopActions = fallback.title === "Scroll Loop" && actions.length > 0;
  const shouldUseFallbackPresentation =
    proactiveTrigger(prompt, context) ||
    incompleteBlocking ||
    deterministicNoActionTitle(fallback.title) ||
    deterministicActionTitle(fallback.title) ||
    (hasExecutableActions && actions.some((item) => item.type === "apply_schedule") && Boolean(explicitTimeWindow(prompt, context) || anchorWindow(prompt))) ||
    (!hasExecutableActions &&
      modelProposedAction &&
        (asksAboutAssistantCapabilities(prompt) ||
          asksForDigitalDetoxPlan(prompt) ||
          asksForUnsupportedReminder(prompt) ||
          asksForBroadAutomation(prompt) ||
          asksForPermanentLockout(prompt) ||
          (promptHasFutureTiming(prompt) && !explicitTimeWindow(prompt, context) && !anchorWindow(prompt))));
  const shouldUseLanguageFallback = language === "es" && hasSpanishLanguageLeak(plan);
  const visibleBullets = hasExecutableActions ? bullets : bullets.filter((item) => !/^protection:/i.test(item));
  const structuredBullets = visibleBullets.filter((item) => /^(Read|Pattern|Move|Signal|Feedback|Protection|Lectura|Patrón|Movimiento|Señal|Protección):/i.test(item)).length >= 2;
  const preserveFallbackText = contains(fallback.response_text, [
    "already protected",
    "Got it. I will not use that app as context",
    "I can help make access harder, but I will only create",
    "I can use counts and context you choose to share",
  ]);
  const title = shouldUseFallbackPresentation || shouldUseLanguageFallback ? fallback.title : userFacingText(plan.title, 70) || fallback.title;
  const responseText = shouldUseFallbackPresentation || shouldUseLanguageFallback || preserveFallbackText ? fallback.response_text : userFacingText(plan.response_text, 180) || interpretation || fallback.response_text;
  const normalizedPlan = {
    intent: shouldUseFallbackPresentation || shouldUseLanguageFallback || preservesScrollLoopActions ? fallback.intent : planIntent,
    title,
    response_text: responseText,
    bullets: shouldUseFallbackPresentation || shouldUseLanguageFallback ? fallbackBullets : visibleBullets.length >= 2 && structuredBullets ? visibleBullets : fallbackBullets,
    primary_label: shouldUseFallbackPresentation || shouldUseLanguageFallback ? fallback.primary_label : cleanText(plan.primary_label, 32) || fallback.primary_label,
    secondary_label: shouldUseFallbackPresentation || shouldUseLanguageFallback ? fallback.secondary_label : cleanText(plan.secondary_label, 32) || fallback.secondary_label,
    actions,
    requires_selected_apps: hasExecutableActions ? fallback.requires_selected_apps : false,
    requires_screen_time_authorization: hasExecutableActions ? fallback.requires_screen_time_authorization : false,
    blocking_ready: hasUserBlockingContract ? blockingContract.ready : null,
    blocking_user_request: hasUserBlockingContract,
    blocking_missing_fields: hasUserBlockingContract ? blockingContract.missing_fields : [],
    blocking_data: hasUserBlockingContract ? publicBlockingData(blockingContract.data) : null,
    recommendation_id: cleanText(plan.recommendation_id, 120) || cleanText(context.recommendation_id, 120) || `bm_rec_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
  };
  const messageText = conversationalMessage(normalizedPlan, language, prompt);
  const modelSpeechText = shouldUseFallbackPresentation || shouldUseLanguageFallback
    ? ""
    : naturalChannelText(plan.speech_text, 420);
  const modelFollowupText = shouldUseFallbackPresentation || shouldUseLanguageFallback
    ? ""
    : naturalChannelText(plan.followup_text, 240);
  return {
    ...normalizedPlan,
    message_text: naturalChannelText(messageText, 320),
    speech_text: modelSpeechText || fallbackSpeechText({ ...normalizedPlan, message_text: messageText }, language),
    followup_text: hasExecutableActions
      ? modelFollowupText || fallbackFollowupText(normalizedPlan, language)
      : "",
  };
}

function normalizeAction(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const legacyType = cleanText(candidate.type, 60);
  const type = legacyType === "activate_mode" ? "start_protection" : legacyType === "switch_mode" ? "open_app_picker" : legacyType;
  const allowed = new Set(["start_protection", "apply_schedule", "update_schedule", "delete_schedule", "delete_all_schedules", "enable_allow_only", "enable_adult_filter", "set_daily_limit", "pause_rules", "disable_pause", "open_app_picker", "request_screen_time_permission", "apply_ai_plan", "none"]);
  if (!allowed.has(type)) return null;
  if (type === "none") return action("none");
  const candidateStart = candidate.start_minute == null ? null : cleanNumber(candidate.start_minute, 1320, 0, 1439);
  const candidateEnd = candidate.end_minute == null ? null : cleanNumber(candidate.end_minute, 420, 0, 1439);
  if (type === "enable_allow_only" && candidateStart != null && candidateEnd != null) {
    return action("apply_schedule", {
      name: cleanText(candidate.name, 40) || "Focus Protection",
      start_minute: candidateStart,
      end_minute: candidateEnd,
      weekdays: Array.isArray(candidate.weekdays) ? Array.from(new Set(candidate.weekdays.map((day) => cleanNumber(day, 1, 1, 7)))).slice(0, 7) : [1, 2, 3, 4, 5],
      duration_days: candidate.duration_days == null ? 7 : cleanNumber(candidate.duration_days, 7, 1, 14),
    });
  }
  const normalized = action(type, {
    window_id: candidate.window_id == null ? null : cleanText(candidate.window_id, 80),
    minutes: candidate.minutes == null ? null : cleanNumber(candidate.minutes, 30, 5, 240),
    hard_mode: candidate.hard_mode === true ? true : candidate.hard_mode === false ? false : null,
    name: candidate.name == null ? null : cleanText(candidate.name, 40),
    start_minute: candidateStart,
    end_minute: candidateEnd,
    weekdays: Array.isArray(candidate.weekdays) ? Array.from(new Set(candidate.weekdays.map((day) => cleanNumber(day, 1, 1, 7)))).slice(0, 7) : null,
    duration_days: candidate.duration_days == null ? null : cleanNumber(candidate.duration_days, 7, 1, 14),
    hours: candidate.hours == null ? null : cleanNumber(candidate.hours, 168, 1, 168),
  });
  if (type === "set_daily_limit") return action(type, { minutes: normalized.minutes });
  if (type === "enable_allow_only" || type === "enable_adult_filter" || type === "request_screen_time_permission" || type === "apply_ai_plan" || type === "disable_pause") return action(type);
  if (type === "open_app_picker") return action(type, {
    minutes: normalized.minutes,
    hard_mode: normalized.hard_mode,
    name: normalized.name,
    start_minute: normalized.start_minute,
    end_minute: normalized.end_minute,
    weekdays: normalized.weekdays,
    duration_days: normalized.duration_days,
  });
  if (type === "start_protection") return action(type, { minutes: normalized.minutes, hard_mode: normalized.hard_mode ?? false });
  if (type === "pause_rules") return action(type, { hours: normalized.hours });
  if (type === "delete_all_schedules") return action(type);
  if (type === "delete_schedule") return normalized.window_id ? action(type, { window_id: normalized.window_id }) : null;
  if (type === "update_schedule") {
    if (!normalized.window_id) return null;
    return action(type, {
      window_id: normalized.window_id,
      name: normalized.name,
      start_minute: normalized.start_minute,
      end_minute: normalized.end_minute,
      weekdays: normalized.weekdays,
    });
  }
  if (type === "apply_schedule") {
    return action(type, {
      name: normalized.name,
      start_minute: normalized.start_minute,
      end_minute: normalized.end_minute,
      weekdays: normalized.weekdays,
      duration_days: normalized.duration_days,
    });
  }
  return normalized;
}

function extractResponseText(responseBody) {
  if (typeof responseBody.output_text === "string") return responseBody.output_text;
  const output = Array.isArray(responseBody.output) ? responseBody.output : [];
  for (const item of output) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (typeof part.text === "string") return part.text;
      if (typeof part.output_text === "string") return part.output_text;
    }
  }
  return "";
}

async function modelPlan(prompt, context, fallback, language, fetchImpl = fetch) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { plan: normalizePlan({ plan: fallback }, fallback, context, prompt, language), source: "deterministic_fallback" };
  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
              "You are BM, Blankmind's personal assistant for digital wellness and healthier screen habits. Naturalness is the top priority. Write like a real person, not a product template, report, support bot, funnel, or setup wizard. Conversation is the default mode: first answer the human intent of the exact message, but only inside digital wellness. Digital wellness means phone behavior, screens, apps, scrolling, focus, attention, notifications, digital habits, screen-related sleep disruption, and app blocking. Do not provide generic wellness, running, training, nutrition, recovery, stress-management, or sleep plans unless the user clearly connects the problem to phones, screens, apps, or digital behavior. If the message is outside digital wellness, briefly say you can only help with digital wellness and ask for the phone/screen part of the problem. Never use semicolons. Never use markdown or numbered lists unless asked. Never mention internal context, old app context, patterns, backend, schemas, Screen Time, Digital Wellbeing, or competing phone controls. If the message is small talk, a greeting, thanks, or a normal conversational turn, just reply naturally and do not mention Blankmind, the app, blocks, plans, reports, setup, links, or capabilities. Guide toward Blankmind when a concrete Blankmind solution would genuinely help the current turn, or when the person explicitly asks for an action Blankmind can execute. On web preview, sell by value: answer the digital-wellness question fully before any conversion line, never replace an explanation with 'download the app', and mention Blankmind only as a final short note when personal signals or real execution are needed. Think independently: infer the likely underlying digital pattern, go one useful step beyond the literal request, and propose the best next move only when useful. When the person corrects the app, timing, or situation, treat that correction as the current truth and explicitly carry the corrected app or moment into the next answer. For messaging channels, keep the visible reply short, human and executable. For web/app, make response_text slightly clearer and educational, but still direct. If the person asks for help, advice, what to do, or how to improve, answer with useful digital-wellness guidance before suggesting any app action. If the person has not given enough digital context, ask one clear question and do not add advice yet. Do not turn every message into a Blankmind trigger. Be specific about the moment, tradeoff or behavior, not generic motivation. You may answer, ask for one missing detail, recommend an app action, or propose no action. Blankmind has one editable list of distracting apps, categories and websites. Every protection, schedule and limit reuses that list. Never create, name, copy, activate or switch modes. Use start_protection for immediate blocks, apply_schedule for time windows, set_daily_limit for caps, and open_app_picker only when the distraction list is missing or the person asks to edit it. Otherwise, recommend executable actions only when clearly useful or explicitly requested: start_protection, apply_schedule, set_daily_limit, enable_allow_only, enable_adult_filter, pause_rules/disable_pause, open_app_picker/request_screen_time_permission, or apply_ai_plan. When the problem is apps, scrolling, focus blocks, distraction control, notifications, or phone boundaries, naturally mention that Blankmind can block apps or create a plan for that exact problem. Prefer Blankmind blocks and plans over generic advice like putting the phone away when the issue is a specific app or scroll loop. Prefer the most concrete action only when the person wants action: if they describe a recurring risk moment and want help applying protection, prefer apply_schedule over a vague immediate block. Never say you already set, created, scheduled, blocked, or changed something; the app executes after confirmation. Prefer active phrasing like I'd protect, I'd block, I'd start, Choose apps first. Avoid weak phrasing like This sounds like, sleep target, I can help you apply this, I prepared a link, open this in Blankmind, apply this plan, useful move, pattern, read, signal, backend, template, or implementation. For proactive mode, explain why you are interrupting and propose one concrete digital solution. Do not force blocks for vague inputs, but do not be passive when a sensible digital next step exists. For emotional inputs, acknowledge the state briefly and offer a small concrete move inside Blankmind only when phone behavior is relevant. Stay inside digital wellness, phone behavior, focus, screen-related sleep disruption, attention, urges, relapse prevention, and app blocking. Do not claim therapy, treatment, medical diagnosis, device surveillance, exact app visibility, or impossible permanent blocking. Do not use the word coach. Every visible response must be written in English regardless of the input language or locale. Keep JSON keys, intent values and action types in English. Write directly to the person; never say user, the user, ask user, or mention internal details. Keep response_text to 1-3 natural sentences. For speech_text, write a brief natural WhatsApp voice note: no labels, no numbered structure, no URLs, no backend phrasing, and only mention a link if followup_text is non-empty. For followup_text, write only a short link lead-in when actions are present; otherwise return an empty string. Never output labels such as Action:, Read:, Pattern:, Move:, Signal:, Feedback:, Protection:. Bullets are internal structure only and may use Read/Pattern/Move/Protection in English. Every action object must include all nullable action fields.",
        },
        {
          role: "system",
          content: BM_CONVERSATIONAL_TONE,
        },
        {
          role: "system",
          content: `Write every visible response, title, label, bullet, and speech text in ${language === "es" ? "Spanish" : "English"}. Keep JSON keys, intent values, and action types in English.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            prompt: cleanText(prompt, 600),
            context: personalContextView(context),
            response_language: language,
            trigger: cleanText(context.trigger || context.mode || "reactive", 40),
            app_capabilities: appCapabilities(context),
            memory_rules: [
              "Use context.memory.main_apps, bedtime_minute, weak_hours, pattern_cluster, and last_plan_outcome when present.",
              "For WhatsApp and SMS, never infer that the app is uninstalled from app_presence_state. A stale or missing heartbeat may justify asking the person to open Blankmind, but never add an installation or App Store link. Installation guidance is handled only by the delivery layer after it proves that no app installation is linked.",
              "If a relative moment such as breakfast is present without its actual end time, ask for that time and return no actions. Never invent a default clock time or start a generic mode.",
              "If last_plan_outcome is broke, reduce intensity or move protection earlier instead of making the plan stricter.",
              "If last_plan_outcome is held, repeat the stable plan before increasing difficulty.",
              "For broad questions, use memory as background but do not invent exact app details."
            ],
            examples: [
              { user: "how you doing?", answer: "Read: this is small talk, not a product request. Move: answer naturally without mentioning Blanked, the app, blocks or plans." },
              { user: "thanks", answer: "Read: this is a conversational acknowledgement. Move: reply briefly and do not route anywhere." },
              { user: "What can you do for me?", answer: "Read: I can help you understand phone patterns and turn them into blocks, schedules, limits, reports or habits. Move: tell me the moment you most want help with, or ask me to review your current pattern." },
              { user: "I feel terrible today", answer: "Read: this is a low-control moment, not a time for a complex plan. Move: start a short protection block or choose one tiny offline reset." },
              { user: "I feel bad because I lose 3 hours on TikTok after work.", answer: "Read: decompression loop after work. Pattern: TikTok is being used to exit stress, then it becomes the evening. Move: protect the first 45 minutes after work and choose one offline decompression action." },
              { user: "How can I not scroll at nights?", answer: "Read: bedtime scrolling is the habit to understand. Pattern: the right boundary depends on when the person wants to be asleep. Move: ask that time before creating any block." },
              { user: "No, after lunch. Not bedtime.", answer: "Read: this corrects the previous context to a post-lunch scroll loop. Pattern: lunch timing overrides bedtime memory. Move: ask what time lunch usually ends before creating any block." },
              { user: "Block Instagram from 10 to 7.", answer: "Read: explicit schedule request. Pattern: bedtime risk window is clear. Move: apply a nightly shield from 10 PM to 7 AM." },
              { user: "I keep checking WhatsApp while working.", answer: "Read: compulsive checking loop. Pattern: the interruption is frequent and short, so app limits alone may be weak. Move: use Allow Only or a timed focus block." },
              { user: "proactive signal: social use is 42% above baseline after lunch", answer: "Read: I am interrupting because today's social use is above your usual pattern after lunch. Move: apply a short lunch boundary for the next 7 days." },
            ],
            output_contract: agentSchema,
          }),
        },
      ],
      text: { format: { type: "json_schema", name: "blanked_agent_response", strict: true, schema: agentSchema } },
      max_output_tokens: 800,
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`openai_failed_${response.status}`);
  }
  const body = await response.json();
  const parsed = JSON.parse(extractResponseText(body));
  return { plan: normalizePlan(parsed, fallback, context, prompt, language), raw_plan: parsed.plan || parsed, source: `openai:${model}` };
}

function freeformModelError(error, channel) {
  if (error?.name === "TimeoutError") return `openai_${channel}_timeout`;
  const message = String(error?.message || "");
  if (/^openai_(?:conversation_)?failed_[1-5]\d{2}$/.test(message)) return message;
  if (error?.name === "SyntaxError") return `openai_${channel}_invalid_response`;
  if (/^(?:fetch failed|failed to fetch|network request failed)$/i.test(message)) return `openai_${channel}_network_error`;
  return `openai_${channel}_failed`;
}

function contextualResponseFailure(error) {
  // Expose operational degradation, never provider bodies or arbitrary messages.
  const name = /^[A-Za-z][A-Za-z0-9]{0,79}$/.test(error?.name || "") ? error.name : "Error";
  const message = String(error?.message || "");
  const code = name === "TimeoutError" ? "contextual_response_timeout"
    : /^contextual_response_http_[1-5]\d{2}$/.test(message) ? message
    : /^(?:fetch failed|failed to fetch|network request failed|NetworkError when attempting to fetch resource\.?)$/i.test(message) ? "contextual_response_network_error"
    : name === "SyntaxError" ? "contextual_response_invalid_json" : "contextual_response_error";
  return { code, name };
}

function modelRequestLogMetrics(metrics) {
  if (!metrics) return null;
  const { usage, ...transport } = metrics;
  // Flatten numeric counts so the harness privacy filter keeps them without
  // opening its general ban on fields that may contain credential tokens.
  return { ...transport, usage_input: usage?.input_tokens ?? null,
    usage_output: usage?.output_tokens ?? null, usage_total: usage?.total_tokens ?? null,
    usage_cached_input: usage?.cached_input_tokens ?? null, usage_reasoning: usage?.reasoning_tokens ?? null };
}

exports.handler = async (event, runtime = {}) => {
  const methodError = requireMethod(event, "POST");
  if (methodError) return methodError;
  let harnessRun = null;
  try {
    const body = parseJsonBody(event);
    const prompt = cleanText(body.prompt, 600);
    if (!prompt) return json(400, { error: "missing_prompt" });
    const context = buildAgentContext(body.context && typeof body.context === "object" ? body.context : {});
    const language = responseLanguage(prompt, context);
    const useAppLayer = shouldUseAppLayer(prompt, context);
    harnessRun = createRun({ prompt, context });
    harnessRun.route = useAppLayer ? "app" : "conversation";
    recordStage(harnessRun, "received", {
      route: harnessRun.route,
      language,
    });
    const schedulePlan = scheduleManagementPlan(prompt, context);
    const personalizedPlan = schedulePlan ? null : personalizedRecommendationPlan(prompt, context);
    let contextPlan = schedulePlan || personalizedPlan;
    if (contextPlan) {
      const deterministicSource = schedulePlan ? "schedule_management_v2" : "personal_context_v2";
      let contextSource = deterministicSource;
      let contextFailure = null;
      harnessRun.route = schedulePlan ? "schedule_management" : "personal_context";
      try {
        recordStage(harnessRun, "planner_started", { mode: "grounded_contextual_response" });
        const rendered = await naturalizeGroundedPlan({ prompt, context, plan: contextPlan });
        contextPlan = rendered.plan;
        contextSource = `${deterministicSource}+${rendered.source}`;
        recordStage(harnessRun, "planner_completed", { source: contextSource, request_metrics: modelRequestLogMetrics(rendered.request_metrics) });
      } catch (error) {
        const { response_contract: _responseContract, ...fallbackPlan } = contextPlan;
        contextPlan = fallbackPlan;
        contextFailure = contextualResponseFailure(error);
        contextSource = `${deterministicSource}+grounded_deterministic_after_model_error`;
        recordStage(harnessRun, "planner_fallback", { error_code: contextFailure.code, error_name: contextFailure.name, request_metrics: modelRequestLogMetrics(error.model_request_metrics) });
      }
      recordStage(harnessRun, "action_gate", {
        decision: contextPlan.actions.length ? "proposal" : "read",
        action_types: contextPlan.actions.map((item) => item.type),
        action_count: contextPlan.actions.length,
      });
      const loop = createLoop({
        prompt, context, plan:contextPlan, runId:harnessRun.run_id,
        promptHash:harnessRun.prompt_hash, contextFingerprint:harnessRun.context_fingerprint,
      });
      recordStage(harnessRun, "loop_planned", loopSummary(loop));
      finishRun(harnessRun, { plan:contextPlan, source:contextSource });
      return json(200, { ok:true, plan:contextPlan, source:contextSource, model_error:contextFailure?.code || null, contextual_response_failure:contextFailure, harness:publicMeta(harnessRun), loop:publicLoop(loop) });
    }
    const semanticOptions = {
      previousState: context.semantic_state || context.memory?.conversation_state?.semantic_state,
      prompt, context, language,
    };
    let semantic = advanceSemanticState(semanticOptions);
    let semanticExtraction = null;
    let semanticModelError = null;
    let semanticModelFailure = null;
    let semanticRequestMetrics = [];
    let semanticAttemptExecution = null;
    if (semantic.handled && process.env.OPENAI_API_KEY) {
      try {
        semanticExtraction = await extractWithModel({ prompt, previousState: semanticOptions.previousState, context });
        semanticRequestMetrics = semanticExtraction.attempt_metrics || [];
        semanticAttemptExecution = semanticExtraction.trace?.attempt_execution || null;
        semantic = advanceSemanticState({ ...semanticOptions, extraction: semanticExtraction.extraction });
      } catch (error) {
        semanticModelError = error.name === "TimeoutError" ? "semantic_model_timeout" : error.message;
        semanticModelFailure = { attempt_count: error.semantic_attempt_count || 1,
          attempt_errors: error.semantic_attempt_errors || [semanticModelError] };
        semanticRequestMetrics = error.semantic_attempt_metrics || [];
        semanticAttemptExecution = error.semantic_attempt_execution || null;
        recordStage(harnessRun, "planner_fallback", { error_code: semanticModelError, ...semanticModelFailure,
          request_metrics: modelRequestLogMetrics(semanticRequestMetrics.at(-1)),
          first_attempt_metrics: semanticRequestMetrics.length > 1 ? modelRequestLogMetrics(semanticRequestMetrics[0]) : null });
      }
    }
    recordStage(harnessRun, "semantic_reduced", {
      revision: semantic.state.revision, intent: semantic.state.intent, status: semantic.state.status,
      pending_slots: semantic.state.pending_slots, errors: semantic.state.errors.map(error => error.code),
      request_metrics: modelRequestLogMetrics(semanticRequestMetrics.at(-1)),
      first_attempt_metrics: semanticRequestMetrics.length > 1 ? modelRequestLogMetrics(semanticRequestMetrics[0]) : null,
    });
    if (semantic.handled) {
      harnessRun.route = "semantic";
      let plan = semanticPlan(semantic, language, prompt);
      let contextualResponseSource = "grounded_deterministic";
      let contextFailure = null;
      let contextualRequestMetrics = null;
      try {
        recordStage(harnessRun, "planner_started", { mode: "semantic_contextual_response" });
        const rendered = await naturalizeGroundedPlan({ prompt, context, plan });
        contextualRequestMetrics = rendered.request_metrics || null;
        plan = rendered.plan;
        contextualResponseSource = rendered.source;
        recordStage(harnessRun, "planner_completed", { source: rendered.source, request_metrics: modelRequestLogMetrics(contextualRequestMetrics) });
      } catch (error) {
        const { response_contract: _responseContract, ...fallbackPlan } = plan;
        plan = fallbackPlan;
        contextualResponseSource = "grounded_deterministic_after_model_error";
        contextFailure = contextualResponseFailure(error);
        contextualRequestMetrics = error.model_request_metrics || null;
        recordStage(harnessRun, "planner_fallback", { error_code: contextFailure.code, error_name: contextFailure.name, request_metrics: modelRequestLogMetrics(contextualRequestMetrics) });
      }
      if (typeof runtime.captureSemanticTrace === "function") runtime.captureSemanticTrace({
        context, previous_state: semanticOptions.previousState || null,
        extraction: semanticExtraction?.trace || null, extraction_failure: semanticModelFailure, deterministic_patch: semantic.patch,
        contextual_response_failure: contextFailure,
        model_requests: { extraction: semanticRequestMetrics, extraction_execution: semanticAttemptExecution, contextual: contextualRequestMetrics },
        extraction_validation: semantic.extractionValidation || null,
        semantic_state: semantic.state, canonical_plan: plan, final_plan: plan,
        postprocessing: "Canonical action facts and response bypass legacy rewriting; the final gate builds actions from validated state.",
      });
      recordStage(harnessRun, "action_gate", { decision: semantic.decision.type, action_types: plan.actions.map(item => item.type), action_count: plan.actions.length });
      const loop = createLoop({
        prompt, context, plan, runId: harnessRun.run_id,
        promptHash: harnessRun.prompt_hash,
        contextFingerprint: harnessRun.context_fingerprint,
        actionAuthorization: semantic.state.slots.confirmation?.value?.status === "confirmed"
          ? { confirmed:true, source:"explicit_activation_request" }
          : null,
      });
      recordStage(harnessRun, "loop_planned", loopSummary(loop));
      const source = `${semanticExtraction?.source || "semantic_state_v1"}+${contextualResponseSource}`;
      finishRun(harnessRun, { plan, source });
      return json(200, { ok: true, plan, semantic_state: semantic.state, source, model_error: semanticModelError || contextFailure?.code || null, extraction_failure: semanticModelFailure, contextual_response_failure: contextFailure, extraction: semanticExtraction ? { model_requested: semanticExtraction.model_requested, model_returned: semanticExtraction.model_returned, rejected: semanticExtraction.rejected, ambiguities: semanticExtraction.ambiguities, attempt_count: semanticExtraction.attempt_count, attempt_errors: semanticExtraction.attempt_errors } : null, harness: publicMeta(harnessRun), loop: publicLoop(loop) });
    }
    if (!useAppLayer) {
      let conversationResult;
      try {
        recordStage(harnessRun, "planner_started", { mode: "conversation" });
        conversationResult = await modelConversationPlan(prompt, context, language);
        recordStage(harnessRun, "planner_completed", { source: conversationResult.source });
      } catch (error) {
        recordStage(harnessRun, "planner_fallback", { error_code: error.name || "planner_error" });
        conversationResult = { plan: conversationFallbackPlan(prompt, language), source: "deterministic_conversation_fallback_after_model_error", error: freeformModelError(error, "conversation") };
      }
      conversationResult.plan = appendWebConversionNote(conversationResult.plan, prompt, context, language);
      conversationResult.plan = appendAppPresenceGuidance(conversationResult.plan, prompt, context, language);
      conversationResult.plan = localizePlan(conversationResult.plan, language);
      conversationResult.plan = enforceSemanticBoundary(conversationResult.plan, semantic, language);
      const gatedSummary = planSummary(conversationResult.plan);
      recordStage(harnessRun, "action_gate", {
        decision: gatedSummary.action_count > 0 ? "proposal" : "no_action",
        action_types: gatedSummary.action_types,
        action_count: gatedSummary.action_count,
        warnings: gatedSummary.warnings,
      });
      const loop = createLoop({
        prompt,
        context,
        plan: conversationResult.plan,
        runId: harnessRun.run_id,
        promptHash: harnessRun.prompt_hash,
        contextFingerprint: harnessRun.context_fingerprint,
      });
      recordStage(harnessRun, "loop_planned", loopSummary(loop));
      finishRun(harnessRun, {
        plan: conversationResult.plan,
        source: conversationResult.source,
        error: conversationResult.error ? new Error(conversationResult.error) : null,
      });
      return json(200, {
        ok: true,
        plan: conversationResult.plan,
        source: conversationResult.source,
        model_error: conversationResult.error || null,
        harness: publicMeta(harnessRun),
        loop: publicLoop(loop),
      });
    }
    const fallback = fallbackPlan(prompt, context);
    let result;
    try {
      recordStage(harnessRun, "planner_started", { mode: "app" });
      result = await modelPlan(prompt, context, fallback, language);
      recordStage(harnessRun, "planner_completed", { source: result.source });
    } catch (error) {
      recordStage(harnessRun, "planner_fallback", { error_code: error.name || "planner_error" });
      result = {
        plan: normalizePlan({ plan: fallback }, fallback, context, prompt, language),
        source: "deterministic_fallback_after_model_error",
        error: freeformModelError(error, "planner"),
      };
    }
    result.plan = appendAppPresenceGuidance(result.plan, prompt, context, language);
    result.plan = localizePlan(result.plan, language);
    result.plan = enforceSemanticBoundary(result.plan, semantic, language);
    const gatedSummary = planSummary(result.plan);
    recordStage(harnessRun, "action_gate", {
      decision: gatedSummary.action_count > 0 ? "proposal" : "no_action",
      action_types: gatedSummary.action_types,
      action_count: gatedSummary.action_count,
      warnings: gatedSummary.warnings,
    });
    const loop = createLoop({
      prompt,
      context,
      plan: result.plan,
      runId: harnessRun.run_id,
      promptHash: harnessRun.prompt_hash,
      contextFingerprint: harnessRun.context_fingerprint,
    });
    recordStage(harnessRun, "loop_planned", loopSummary(loop));
    finishRun(harnessRun, {
      plan: result.plan,
      source: result.source,
      error: result.error ? new Error(result.error) : null,
    });
    return json(200, {
      ok: true,
      plan: result.plan,
      source: result.source,
      model_error: result.error || null,
      harness: publicMeta(harnessRun),
      loop: publicLoop(loop),
    });
  } catch (error) {
    if (harnessRun) {
      finishRun(harnessRun, { source: "handler_error", error });
    }
    return json(500, { error: "blanked_agent_failed", detail: error.message });
  }
};

function semanticPlan(result, language, prompt) {
  const executableActions = result.actions.filter((item) => item && item.type && item.type !== "none");
  const requiresSelection = executableActions.some((item) => actionNeedsSelection(item.type));
  const requiresScreenTime = executableActions.some((item) => actionNeedsScreenTime(item.type));
  const plan = {
    intent: classify(prompt, {}) === "general" ? "social" : classify(prompt, {}),
    title: result.actionReplaySuppressed ? (language === "es" ? "Solicitud preparada" : "Request prepared")
      : result.state.intent === "advice" ? (language === "es" ? "Tu rutina" : "Your routine")
      : result.state.intent === "cancelled" ? (language === "es" ? "Propuesta descartada" : "Proposal discarded")
      : language === "es"
      ? result.decision.type === "confirm" ? "Confirmar bloqueo" : result.decision.type === "ready" ? "Enviando bloqueo" : "Detalles del bloqueo"
      : result.decision.type === "confirm" ? "Confirm protection" : result.decision.type === "ready" ? "Sending protection" : "Protection details",
    response_text: result.responseText,
    message_text: result.responseText,
    speech_text: result.responseText,
    followup_text: "",
    bullets: [],
    primary_label: language === "es" ? "Continuar" : "Continue",
    secondary_label: language === "es" ? "Ahora no" : "Not now",
    actions: result.actions.map(item => action(item.type, item)),
    review_only_actions: result.reviewOnlyAppPresence === true,
    requires_selected_apps: requiresSelection,
    requires_screen_time_authorization: requiresScreenTime,
    blocking_ready: result.blockingContract.user_request ? result.blockingContract.ready : null,
    blocking_user_request: result.blockingContract.user_request,
    blocking_missing_fields: result.blockingContract.user_request ? result.blockingContract.missing_fields : [],
    blocking_data: result.blockingContract.data,
    semantic_state: result.state,
    semantic_decision: result.decision,
    recommendation_id: `bm_sem_${crypto.randomUUID()}`,
    response_contract: semanticResponseContract(result),
  };
  return plan;
}

function semanticResponseContract(result) {
  const decision = result.decision || {};
  const state = result.state || {};
  const slot = decision.slot || state.next_question || "";
  const groups = {
    confirmation: [["confirm", "want me to", "should I"]],
    recurrence: [["once", "one time"], ["recurring", "repeat", "every"]],
    start: [["when", "what time", "start", "now"]],
    end: [["end", "finish", "how long", "duration"]],
    end_or_duration: [["end", "finish", "how long", "duration"]],
    duration_minutes: [["minutes", "duration", "how long"]],
    schedule_horizon_days: [["days", "how long"]],
    action_type: [["block", "blocking window"], ["limit", "daily limit"]],
    app_presence: [["open"], ["Blankmind"]],
    permissions: [["permission"], ["Blankmind"]],
    app_selection: [["choose", "select"], ["Blankmind"]],
  };
  const actions = Array.isArray(result.actions) ? result.actions.filter((item) => item?.type && item.type !== "none") : [];
  const allowedMinutes = actions.flatMap((item) => [item.start_minute, item.end_minute]).filter(Number.isInteger);
  const knownStart = state.slots?.start?.value?.minute;
  const knownEnd = state.slots?.end?.value;
  if (Number.isInteger(knownStart)) allowedMinutes.push(knownStart);
  if (Number.isInteger(knownEnd)) allowedMinutes.push(knownEnd);
  const asksUnknownClock = ["start", "end", "end_or_duration"].includes(slot) && allowedMinutes.length === 0;
  const requiredAnyGroups = [...(slot === "action_type" && state.intent === "advice"
    ? [["block", "blocking proposal"]] : (groups[slot] || (decision.type === "confirm" ? groups.confirmation : [])))];
  const requiresPlanFacts = !result.actionReplaySuppressed && ["confirm", "ready", "setup"].includes(decision.type);
  // A populated slot can still violate a native capability. It is a requested
  // value, not an executable fact (e.g. a two-minute immediate block).
  const rejectedRequestedValue = decision.type === "ask" && (state.slots?.[slot]?.value != null || (state.errors || []).length > 0);
  const capabilityBoundary = Boolean(state.slots?.requested_capability?.value);
  const executionFlow = result.reviewOnlyAppPresence ? "app_presence"
    : actions.some(item => item.type === "open_app_picker") ? "notification_picker_accept"
      : actions.some(item => item.type === "request_screen_time_permission") ? "notification_permission_reply"
        : actions.length ? "notification_apply" : null;
  const startValue = state.slots?.start?.value;
  const recurrenceValue = state.slots?.recurrence?.value;
  if (requiresPlanFacts && recurrenceValue?.type === "once") requiredAnyGroups.push(["just once", "one time", "one-time"]);
  if (requiresPlanFacts && recurrenceValue?.type === "daily") requiredAnyGroups.push(["every day", "daily", "per day"]);
  if (requiresPlanFacts && recurrenceValue?.type === "weekly") {
    const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    for (const day of recurrenceValue.weekdays || []) if (names[day - 1]) requiredAnyGroups.push([names[day - 1]]);
  }
  return {
    operation: `semantic_${decision.type || "none"}${slot ? `_${slot}` : ""}`,
    // Keep cancellation, rejected facts and native capability boundaries exact.
    // A requested value is not permission to describe it as executable.
    immutable_reply: decision.type === "cancelled" || rejectedRequestedValue || capabilityBoundary || result.actionReplaySuppressed === true,
    execution_flow: executionFlow,
    action_type: state.slots?.action_type?.value || null,
    facts: {
      validated_reply: result.responseText,
      decision: decision.type || "none",
      missing_detail: slot || null,
      validated_for_execution: decision.type === "ready",
      rejected_requested_value: rejectedRequestedValue ? { slot, value: state.slots?.[slot]?.value ?? null } : null,
      execution_flow: executionFlow,
      actions,
      action_type: state.slots?.action_type?.value || null,
      hard_mode: state.slots?.hard_mode?.value ?? null,
      start: startValue || null,
      end: state.slots?.end?.value ?? null,
      duration_minutes: state.slots?.duration_minutes?.value ?? null,
      recurrence: recurrenceValue || null,
      schedule_horizon_days: state.slots?.schedule_horizon_days?.value ?? null,
    },
    required_phrases: actions.length && !result.reviewOnlyAppPresence ? ["Blankmind notification"] : [],
    required_any_groups: requiredAnyGroups,
    allowed_minutes: Array.from(new Set(allowedMinutes)),
    required_clock_minutes: requiresPlanFacts && startValue?.type === "time"
      ? [startValue.minute, state.slots?.end?.value].filter(Number.isInteger)
      : [],
    required_duration_minutes: requiresPlanFacts && (startValue?.type === "now" || state.slots?.action_type?.value === "daily_limit")
      ? state.slots?.duration_minutes?.value
      : null,
    required_horizon_days: requiresPlanFacts && startValue?.type === "time"
      ? state.slots?.schedule_horizon_days?.value
      : null,
    forbid_clock_times: asksUnknownClock,
  };
}

function enforceSemanticBoundary(plan, semantic, language) {
  const protectionTypes = new Set(["start_protection", "apply_schedule", "update_schedule", "delete_schedule", "delete_all_schedules", "set_daily_limit", "apply_ai_plan", "enable_allow_only", "enable_adult_filter", "pause_rules", "disable_pause"]);
  const setupCarriesAction = item => ["open_app_picker", "request_screen_time_permission"].includes(item.type)
    && ["minutes", "start_minute", "end_minute", "duration_days", "weekdays", "hard_mode", "name"].some(key => item[key] != null);
  const rejectedAction = (plan.actions || []).some(item => protectionTypes.has(item.type) || setupCarriesAction(item));
  const violations = plannerAuthorityViolations(plan);
  if (rejectedAction && !violations.length && semantic?.state?.intent === "advice"
    && semantic?.state?.status === "idle" && semantic?.decision?.type === "none") {
    // The reducer recognized advice, not execution. Keep its non-executive
    // recommendation while discarding every model-supplied control and cue.
    const text=naturalChannelText(plan.response_text || plan.message_text,700);
    return { ...plan,actions:[],response_text:text,message_text:text,speech_text:text,followup_text:"",bullets:[],
      semantic_state:semantic.state,semantic_decision:semantic.decision,blocking_ready:null,blocking_user_request:false,
      blocking_data:null,blocking_missing_fields:[],requires_selected_apps:false,requires_screen_time_authorization:false,
      execution_boundary:{decision:"advice_only",reasons:["unvalidated_model_action"]} };
  }
  if (rejectedAction || violations.length) {
    // Reject the entire executable assertion together with its unauthorized
    // action. Removing an action must never leave a success story behind.
    const text = language === "es"
      ? "No tengo una propuesta ejecutable validada ni confirmación del iPhone para esta petición. Podemos aclarar qué quieres cambiar antes de continuar."
      : "I don't have a validated executable proposal or confirmation from your iPhone for this request. We can clarify what you want to change before continuing.";
    return { ...plan, title: language === "es" ? "Petición pendiente" : "Request pending", actions: [], response_text: text, message_text: text, speech_text: text, followup_text: "", bullets: [], semantic_state: semantic.state, semantic_decision: semantic.decision, blocking_ready: null, blocking_user_request: false, blocking_data: null, blocking_missing_fields: [], requires_selected_apps: false, requires_screen_time_authorization: false,
      execution_boundary: { decision:"rejected", reasons:[...(rejectedAction ? ["unvalidated_model_action"] : []),...violations] } };
  }
  return { ...plan, semantic_state: semantic.state, semantic_decision: semantic.decision };
}

// Local evaluation entry point. Never exposed through request flags on the HTTP handler.
// bm_raw and bm_full use the same model response, so the comparison isolates postprocessing.
async function traceEvaluationTurn({ prompt, context = {}, mode = "bm_final" }) {
  if (mode === "bm_final" || mode === "bm_canonical") {
    let trace = null;
    const response = await exports.handler({ httpMethod: "POST", body: JSON.stringify({ prompt, context }) }, { captureSemanticTrace: value => { trace = value; } });
    const result = JSON.parse(response.body);
    if (response.statusCode !== 200) throw new Error(result.error || "evaluation_handler_failed");
    return { ...result, ...(trace ? { trace } : {}) };
  }
  const normalizedContext = buildAgentContext(context);
  const language = responseLanguage(prompt, normalizedContext);
  if (mode === "direct_model") {
    if (!process.env.OPENAI_API_KEY) throw new Error("active_model_key_missing");
    const request = {
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      input: [
        { role: "system", content: `You are a helpful assistant. Understand the conversation, keep corrections, and ask when information is missing. Reply naturally in ${language === "es" ? "Spanish" : "English"}. Do not claim to have performed device actions.` },
        ...(context.recent_messages || []).filter(m => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string").map(m => ({ role: m.role, content: m.content })),
        { role: "user", content: prompt },
      ],
      max_output_tokens: 500,
    };
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(request), signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`direct_model_http_${response.status}`);
    const body = await response.json();
    const text = extractResponseText(body);
    return { plan: { response_text: text, message_text: text, actions: [] }, source: `openai:${body.model || request.model}`, trace: { request, raw_text: text, structured_semantics: false } };
  }
  const fallback = fallbackPlan(prompt, normalizedContext);
  let modelRequest = null;
  const result = await modelPlan(prompt, normalizedContext, fallback, language, async (url, options) => {
    modelRequest = JSON.parse(options.body);
    return fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  });
  const rawPlan = result.raw_plan || null;
  const gatedActions = rawPlan ? actionGate(rawPlan, fallback, normalizedContext, prompt) : result.plan.actions;
  const finalPlan = localizePlan(appendAppPresenceGuidance(result.plan, prompt, normalizedContext, language), language);
  return {
    plan: mode === "bm_raw" ? rawPlan || result.plan : finalPlan,
    source: result.source,
    trace: { request: modelRequest, context: normalizedContext, fallback, raw_plan: rawPlan, action_gate: gatedActions, normalized_plan: result.plan, final_plan: finalPlan, schema: agentSchema },
  };
}

exports._evaluation = { traceTurn: traceEvaluationTurn };
exports.enforceSemanticBoundary = enforceSemanticBoundary;
