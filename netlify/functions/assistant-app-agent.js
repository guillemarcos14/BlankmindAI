"use strict";
const {supabaseFetch}=require("./_membership");
const {getAssistantMemory,recordAssistantMemory}=require("./_assistant_memory");
const {freshConversationState}=require("./bm-context");
const {semanticPersistenceRequired}=require("./_bm_semantic_store");
const {enrichAssistantContext}=require("./_bm_user_context");
const {pendingActionFromPlan:buildPendingActionFromPlan,isActivePendingAction}=require("./bm-pending-action");
function cleanText(value,maxLength=600){return String(value||"").trim().replace(/\s+/g," ").slice(0,maxLength);}
function detectedLanguage(text) {
  const value = cleanText(text, 800).toLowerCase();
  return /[¿áéíóúñ]|\b(quiero|bloquea|bloquear|despues|después|comer|cenar|dormir|ayudame|ayúdame|consejo|redes sociales|hola|buenas|gracias|puedes|s[ií])\b/i.test(value)
    ? "es"
    : "en";
}
function messageLanguage(text, savedLanguage = "") {
  const value = cleanText(text, 120).toLowerCase();
  if (/^(?:sí|si|vale|perfecto?|gracias)\.?$/i.test(value)) return "es";
  if (/^(?:yes|yeah|yep|sure|thanks?)\.?$/i.test(value)) return "en";
  const neutralFollowup = /^(?:ok|okay|\d{1,2}(?::\d{2})?\s*(?:am|pm)?|usually\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|sobre\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\.?$/i.test(value);
  if (neutralFollowup && /^(?:es|en)/i.test(savedLanguage)) return savedLanguage.toLowerCase().startsWith("es") ? "es" : "en";
  return detectedLanguage(text);
}
function pendingActionFromPlan(plan,prompt,idPrefix){return buildPendingActionFromPlan(plan,{idPrefix});}
function deliverPendingAssistantAction(connection,pending){return {action:pending,duplicate:true};}

async function agentContext(from, prompt, linkedConnection = null, { identity } = {}) {
  const channel = "app";
  let savedMemory = {};
  try {
    savedMemory = await getAssistantMemory(channel, from, { requireSemantic: linkedConnection?.canonicalMemoryRequired === true });
  } catch (error) {
    if (linkedConnection?.canonicalMemoryRequired === true || semanticPersistenceRequired()) throw error;
    savedMemory = {};
  }
  const newFacts = {};
  const language = messageLanguage(prompt, savedMemory.language || savedMemory.conversation_state?.semantic_state?.language);
  const conversationState = freshConversationState(savedMemory.conversation_state);
  const memory = {
    ...savedMemory,
    ...newFacts,
    language,
    main_apps: newFacts.main_apps || savedMemory.main_apps,
    weak_hours: newFacts.weak_hours || savedMemory.weak_hours,
    conversation_state: conversationState,
  };
  const storedUserContext = savedMemory.user_context && typeof savedMemory.user_context === "object"
    ? savedMemory.user_context
    : {};
  const userContext = await enrichAssistantContext(
    storedUserContext,
    linkedConnection?.connectCode || savedMemory.assistant_connect_code,
    channel === "app" ? { identity, includeLegacySources: false } : {},
  );
    if (Object.keys(newFacts).length || savedMemory.language !== language) {
      try {
        await recordAssistantMemory({ channel, channelUser: from, memory: { ...newFacts, language }, source: prompt });
    } catch (_) {
      // Memory must never block a reply.
    }
  }
  return {
    ...userContext,
    channel,
    assistant_channel: channel,
    language,
    allow_spanish_response: true,
    is_blank_active: userContext.is_blank_active === undefined ? false : userContext.is_blank_active,
    has_selected_apps: userContext.has_selected_apps === true,
    selection_count: Number.isFinite(userContext.selection_count) ? userContext.selection_count : 0,
    screen_time_authorized: userContext.screen_time_authorized === true,
    emergency_unlocks_remaining: Number.isFinite(userContext.emergency_unlocks_remaining) ? userContext.emergency_unlocks_remaining : 3,
    vacation_mode_active: userContext.vacation_mode_active === undefined ? false : userContext.vacation_mode_active,
    risk_window: userContext.risk_window || "the usual risk window",
    recommended_duration_minutes: Number.isFinite(userContext.recommended_duration_minutes) ? userContext.recommended_duration_minutes : 30,
    user_context: userContext,
    memory,
    recent_messages: conversationState?.recent_messages || [],

  };
}
async function queuePendingAssistantAction(connection, plan, prompt = "", idPrefix = "app", preparedAction = null, expectedVersion) {
  if (!connection?.connectCode) return null;
  const pending = preparedAction || pendingActionFromPlan(plan, prompt, idPrefix);
  if (!pending) return null;
  let memory = {};
  try {
    memory = await getAssistantMemory(connection.channel, connection.channelUser, { requireSemantic: Boolean(preparedAction) });
  } catch (error) {
    if (preparedAction || semanticPersistenceRequired()) throw error;
  }
  const existing = memory.pending_assistant_action;
  // App retries resume the exact durable action, including its original expiry.
  // A newer app turn or a terminal receipt must never resurrect it.
  if (preparedAction) {
    const outcome = memory.last_assistant_action_outcome;
    if (outcome?.id === pending.id) return { action: { ...pending, status: outcome.status }, duplicate: true };
    if (existing?.id === pending.id && !isActivePendingAction(existing)) return { action: existing, duplicate: true };
    if (memory.semantic_store_version !== pending.semantic_version) {
      return { action: { ...pending, status: "superseded" }, duplicate: true };
    }
    if (existing?.id === pending.id) {
      return deliverPendingAssistantAction(connection, existing, memory);
    }
    if (Date.parse(pending.expires_at || "") <= Date.now()) {
      return { action: { ...pending, status: "expired" }, duplicate: true };
    }
    const result = await supabaseFetch("rpc/enqueue_assistant_app_action", {
      method: "POST", body: JSON.stringify({ p_auth_user_id: connection.authUserId,
        p_turn_id: pending.id.slice(4), p_lease_owner: connection.turnLeaseOwner }),
    });
    const committed = Array.isArray(result) ? result[0] : result;
    if (!committed?.action) throw new Error("assistant_app_enqueue_failed");
    if (!committed.enqueued) return { action: committed.action, duplicate: true };
    return deliverPendingAssistantAction(connection, committed.action, memory);
  }

  throw new Error("assistant_app_prepared_action_required");
}
async function callBlankedAgent(prompt,from,connection,{onDraft,identity}={}){
  if(identity?.auth_user_id!==from||identity?.assistant_connect_code!==connection?.connectCode)throw Error("assistant_identity_mismatch");
  const context=await require("./bm-turn-timing").span("context",()=>agentContext(from,prompt,connection,{identity}));
  context.funnel_access=await require("./funnel-access").access(from);
  context.funnel_diagnosis=(await require("./funnel-access").state(from)).diagnosis || null;
  return require("./bmb-brain").plan({prompt,context,userId:from,identity,onDraft});
}
module.exports={callBlankedAgent,queuePendingAssistantAction};
