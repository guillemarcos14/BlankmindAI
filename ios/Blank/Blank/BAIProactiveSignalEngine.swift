import Foundation
import UserNotifications

struct BAIProactiveSignalEngine {
    static func evaluate(
        system: DigitalWellnessV3System,
        healthSummaries: [HealthDaySummary],
        selectionCount: Int,
        screenTimeAuthorized: Bool,
        isBlankActive: Bool,
        now: Date = Date(),
        defaults: UserDefaults = BlankSharedState.defaults
    ) async {
        guard !isBlankActive, screenTimeAuthorized, selectionCount > 0 else { return }

        guard let signal = strongestSignal(system: system, healthSummaries: healthSummaries, now: now),
              shouldSend(signal: signal, now: now, defaults: defaults) else {
            return
        }

        let message = await resolveBAIMessage(signal: signal, system: system, selectionCount: selectionCount) ?? signal.fallbackMessage
        saveLatestAlert(body: message, signal: signal, defaults: defaults)
        await notify(body: message, signal: signal)
        if signal.kind == "low_recovery" {
            await BlankFunnelAnalytics.track(
                "proactive_health_alert",
                properties: [
                    "signal_type": signal.kind,
                    "priority": signal.priority,
                    "selection_count": selectionCount,
                    "relapse_risk_score": system.profile.relapseRiskScore
                ],
                defaults: defaults
            )
        }
        await BlankFunnelAnalytics.track(
            "bai_proactive_signal_sent",
            properties: [
                "signal_type": signal.kind,
                "priority": signal.priority,
                "selection_count": selectionCount,
                "relapse_risk_score": system.profile.relapseRiskScore,
                "weekly_break_count": system.profile.weeklyBreakCount
            ],
            defaults: defaults
        )
        defaults.set(now.timeIntervalSince1970, forKey: cooldownKey(signal.kind))
    }

    private static func strongestSignal(
        system: DigitalWellnessV3System,
        healthSummaries: [HealthDaySummary],
        now: Date
    ) -> BAIProactiveSignal? {
        var signals: [BAIProactiveSignal] = []
        let profile = system.profile

        if profile.weeklyBreakCount >= 2 {
            signals.append(BAIProactiveSignal(
                kind: "repeated_relapses",
                priority: 95,
                prompt: "proactive signal: repeated breaks today",
                fallbackMessage: "BM noticed repeated breaks. Use a shorter protected block now and review your escape rule before the next weak window.",
                context: [
                    "weekly_break_count": profile.weeklyBreakCount,
                    "relapse_risk_score": profile.relapseRiskScore,
                    "adherence_score": profile.adherenceScore
                ]
            ))
        }

        if system.forecast.minutesUntilRisk > 0 && system.forecast.minutesUntilRisk <= 90 && system.forecast.riskScore >= 55 {
            signals.append(BAIProactiveSignal(
                kind: "weak_window_near",
                priority: 80 + system.forecast.riskScore / 5,
                prompt: "proactive signal: weak window is approaching",
                fallbackMessage: "BM sees your weak window approaching. Start a short block before the pattern starts.",
                context: [
                    "risk_window": system.forecast.riskWindow,
                    "risk_score": system.forecast.riskScore,
                    "minutes_until_risk": system.forecast.minutesUntilRisk
                ]
            ))
        }

        if let recoverySignal = healthSignal(healthSummaries: healthSummaries, now: now, system: system) {
            signals.append(recoverySignal)
        }

        return signals.sorted { first, second in
            first.priority == second.priority ? first.kind < second.kind : first.priority > second.priority
        }.first
    }

    private static func healthSignal(
        healthSummaries: [HealthDaySummary],
        now: Date,
        system: DigitalWellnessV3System
    ) -> BAIProactiveSignal? {
        guard let today = latestSummary(healthSummaries, now: now) else { return nil }
        var reasons: [String] = []
        var priority = 0

        if let sleep = today.sleepMinutes, sleep < 6 * 60 {
            reasons.append("short_sleep")
            priority += 38
        }
        if let hrv = today.hrvSDNN, hrv < 35 {
            reasons.append("low_hrv")
            priority += 24
        }
        if let resting = today.restingHeartRate, resting >= 68 {
            reasons.append("higher_resting_hr")
            priority += 14
        }
        if let respiratory = today.respiratoryRate, respiratory >= 19 {
            reasons.append("higher_respiratory_rate")
            priority += 10
        }
        if let oxygen = today.oxygenSaturation, oxygen < 95 {
            reasons.append("lower_oxygen_saturation")
            priority += 10
        }
        if let steps = today.steps, steps < 2500 {
            reasons.append("low_movement")
            priority += 10
        }

        guard priority >= 38 else { return nil }
        return BAIProactiveSignal(
            kind: "low_recovery",
            priority: priority + min(20, system.profile.relapseRiskScore / 5),
            prompt: "proactive signal: low recovery increases phone risk today",
                fallbackMessage: "BM sees lower recovery today. Keep your next block short and earlier, before scrolling becomes harder to stop.",
            context: [
                "health_signal_reasons": reasons.joined(separator: "|"),
                "sleep_minutes": today.sleepMinutes ?? -1,
                "hrv_avg": today.hrvSDNN ?? -1,
                "resting_hr": today.restingHeartRate ?? -1,
                "respiratory_rate": today.respiratoryRate ?? -1,
                "oxygen_saturation": today.oxygenSaturation ?? -1,
                "vo2_max": today.vo2Max ?? -1,
                "steps": today.steps ?? -1,
                "relapse_risk_score": system.profile.relapseRiskScore
            ]
        )
    }

    private static func latestSummary(_ summaries: [HealthDaySummary], now: Date) -> HealthDaySummary? {
        let today = Calendar.current.startOfDay(for: now)
        return summaries
            .filter { $0.date <= today }
            .sorted { $0.date > $1.date }
            .first
    }

    private static func shouldSend(signal: BAIProactiveSignal, now: Date, defaults: UserDefaults) -> Bool {
        let lastSent = defaults.double(forKey: cooldownKey(signal.kind))
        guard lastSent > 0 else { return true }
        return now.timeIntervalSince1970 - lastSent >= signal.cooldown
    }

    private static func resolveBAIMessage(
        signal: BAIProactiveSignal,
        system: DigitalWellnessV3System,
        selectionCount: Int
    ) async -> String? {
        guard let baseURL = configuredBaseURL() else { return nil }
        var request = URLRequest(url: baseURL.appendingPathComponent("blanked-agent"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 8

        var context: [String: Any] = [
            "trigger": "proactive",
            "mode": "proactive",
            "signal_type": signal.kind,
            "has_selected_apps": selectionCount > 0,
            "selection_count": selectionCount,
            "screen_time_authorized": true,
            "adherence_score": system.profile.adherenceScore,
            "weekly_break_count": system.profile.weeklyBreakCount,
            "relapse_risk_score": system.profile.relapseRiskScore,
            "risk_window": system.forecast.riskWindow,
            "recommended_duration_minutes": system.plan.recommendedDurationMinutes,
            "weak_hours": system.weakWindows.map(\.hour)
        ]
        for (key, value) in signal.context {
            context[key] = value
        }

        let payload: [String: Any] = [
            "prompt": signal.prompt,
            "locale": Locale.current.identifier,
            "context": context
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200..<300).contains(httpResponse.statusCode),
                  let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let plan = object["plan"] as? [String: Any] else {
                return nil
            }
            let text = (plan["message_text"] as? String) ?? (plan["response_text"] as? String)
            return cleanNotificationText(text)
        } catch {
            return nil
        }
    }

    private static func saveLatestAlert(body: String, signal: BAIProactiveSignal, defaults: UserDefaults) {
        let id = UUID().uuidString
        defaults.set(id, forKey: "blankBAIProactiveAlertId")
        defaults.set(body, forKey: "blankBAIProactiveAlertBody")
        defaults.set(signal.kind, forKey: "blankBAIProactiveAlertSignalType")
        defaults.set(Date().timeIntervalSince1970, forKey: "blankBAIProactiveAlertCreatedAt")
        defaults.synchronize()
    }

    private static func notify(body: String, signal: BAIProactiveSignal) async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }

        let content = UNMutableNotificationContent()
        content.title = "BM"
        content.body = body
        content.sound = .default
        content.userInfo = ["blank_url": "blank://bai-alert", "signal_type": signal.kind]
        let request = UNNotificationRequest(
            identifier: "blank-bai-\(signal.kind)-\(Int(Date().timeIntervalSince1970))",
            content: content,
            trigger: nil
        )
        try? await UNUserNotificationCenter.current().add(request)
    }

    private static func cleanNotificationText(_ value: String?) -> String? {
        let text = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        return String(text.prefix(220))
    }

    private static func configuredBaseURL() -> URL? {
        guard let rawValue = Bundle.main.object(forInfoDictionaryKey: "BlankMembershipAPIBaseURL") as? String else {
            return nil
        }
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("$(") else { return nil }
        return URL(string: trimmed)
    }

    private static func cooldownKey(_ kind: String) -> String {
        "blankBAIProactiveSignalLastSentAt.\(kind)"
    }
}

private struct BAIProactiveSignal {
    var kind: String
    var priority: Int
    var prompt: String
    var fallbackMessage: String
    var context: [String: Any]
    var cooldown: TimeInterval = 8 * 60 * 60
}
