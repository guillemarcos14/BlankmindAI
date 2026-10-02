"use strict";

const { ACTION_TYPES, clean } = require("./bm-contracts");

const RISK_BY_ACTION = Object.freeze({
  none: "none",
  open_app_picker: "setup",
  request_screen_time_permission: "setup",
  start_protection: "protective",
  apply_schedule: "protective",
  update_schedule: "protective",
  delete_schedule: "protective",
  delete_all_schedules: "protective",
  enable_allow_only: "high_protective",
  enable_adult_filter: "protective",
  disable_allow_only: "high_protective",
  disable_adult_filter: "high_protective",
  disable_daily_limit: "high_protective",
  set_daily_limit: "protective",
  pause_rules: "protective",
  disable_pause: "protective",
  apply_ai_plan: "high_protective",
});

function authorizedActionTypes(context = {}) {
  const values = Array.isArray(context.authorized_action_types)
    ? context.authorized_action_types
    : Array.isArray(context.autonomy_grant?.action_types)
      ? context.autonomy_grant.action_types
      : [];
  return new Set(values.map((item) => clean(item, 64)).filter((item) => ACTION_TYPES.includes(item)));
}

function policyForAction(action, context = {}) {
  const type = clean(action?.type, 64) || "none";
  const risk = RISK_BY_ACTION[type] || "unknown";
  const autonomousConsent = context.autonomy_consent === true || context.autonomy_grant?.active === true;
  const grant = authorizedActionTypes(context);
  const autonomousAllowed = type !== "none"
    && autonomousConsent
    && grant.has(type)
    && context.device_execution_ready === true;

  return {
    type,
    risk,
    known: ACTION_TYPES.includes(type),
    autonomous_allowed: autonomousAllowed,
    requires_confirmation: type !== "none" && !autonomousAllowed,
    reason: autonomousAllowed
      ? "pre_authorized_reversible_routine"
      : type === "none"
        ? "no_device_action"
        : "explicit_confirmation_required",
  };
}

function policyForPlan(plan, context = {}) {
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  const actionsPolicy = actions.map((action) => policyForAction(action, context));
  const unknown = actionsPolicy.filter((item) => !item.known);
  const requiresConfirmation = actionsPolicy.some((item) => item.requires_confirmation);
  const autonomous = actionsPolicy.length > 0 && actionsPolicy.every((item) => item.autonomous_allowed || item.type === "none");
  const blocked = unknown.length > 0 || actionsPolicy.some((item) => item.risk === "unknown");
  return {
    decision: blocked ? "blocked" : autonomous ? "autonomous_execution" : requiresConfirmation ? "confirmation_required" : "no_action",
    actions: actionsPolicy,
    unknown_action_types: unknown.map((item) => item.type),
    requires_confirmation: requiresConfirmation,
    autonomous_allowed: autonomous && !blocked,
    blocked,
  };
}

module.exports = {
  RISK_BY_ACTION,
  policyForAction,
  policyForPlan,
};
