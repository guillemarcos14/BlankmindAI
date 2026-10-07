"use strict";

function onboardingReady(context = {}, memory = {}, channel, now = Date.now()) {
  // Versioned opt-in preserves the old clients and external channel contract.
  if (channel === "app" && Number(context.onboarding_version) === 6) {
    const checked = Date.parse(context.sleep_data_checked_at || "");
    return context.screen_time_authorized === true && context.sleep_data_available === true
      && Number.isFinite(checked) && checked <= now + 30_000 && now - checked <= 10 * 60_000;
  }
  return context.has_selected_apps === true && Number(context.selection_count) > 0
    && context.screen_time_authorized === true && context.notification_authorized === true
    && Boolean(memory.assistant_device_push?.token);
}

module.exports = { onboardingReady };
