import SwiftUI

struct ReportView: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @EnvironmentObject private var screenTimeBlocker: ScreenTimeBlocker
    @Environment(\.blankSectionHorizontalPadding) private var sectionHorizontalPadding
    var usesMainBackground = false
    var onClose: (() -> Void)? = nil
    @StateObject private var healthKitStore = HealthKitStore()
    @State private var isSubmittingWellnessFeatures = false
    @State private var wellnessSyncMessage: String?
    @AppStorage("blankDigitalWellnessFeatureConsent", store: BlankSharedState.defaults) private var wellnessFeatureConsent = false
    @AppStorage("blankOnboardingAnonymousUserId", store: BlankSharedState.defaults) private var onboardingAnonymousUserId = ""
    @AppStorage("blankRemoteWellnessSummary", store: BlankSharedState.defaults) private var remoteWellnessSummary = ""
    @AppStorage("blankRemoteWellnessNextStep", store: BlankSharedState.defaults) private var remoteWellnessNextStep = ""
    @AppStorage("blankRemoteWellnessRecommendations", store: BlankSharedState.defaults) private var remoteWellnessRecommendations = ""
    @AppStorage("blankRemotePlanTitle", store: BlankSharedState.defaults) private var remotePlanTitle = ""
    @AppStorage("blankRemotePlanEvidence", store: BlankSharedState.defaults) private var remotePlanEvidence = ""
    @AppStorage("blankRemotePlanStartMinute", store: BlankSharedState.defaults) private var remotePlanStartMinute = -1
    @AppStorage("blankRemotePlanEndMinute", store: BlankSharedState.defaults) private var remotePlanEndMinute = -1
    @AppStorage("blankRemotePlanDurationDays", store: BlankSharedState.defaults) private var remotePlanDurationDays = 5
    @AppStorage("blankRemotePlanActionLabel", store: BlankSharedState.defaults) private var remotePlanActionLabel = "Apply preventive block"
    @AppStorage("blankRemoteRecommendationId", store: BlankSharedState.defaults) private var remoteRecommendationId = ""
    @AppStorage("blankRemoteWellnessLastSyncAt", store: BlankSharedState.defaults) private var remoteWellnessLastSyncAt = 0.0

    private var reportPrimary: Color { sessionStore.isBlankActive ? BlankColors.pureWhite : BlankColors.ink }
    private var reportSecondary: Color { sessionStore.isBlankActive ? BlankColors.pureWhite.opacity(0.70) : BlankColors.mutedInk }
    private var accentBlue: Color { BlankColors.premiumBlue }
    private var recoveryGreen: Color { BlankColors.seafoam }

    private var report: BlankProgressReport {
        BlankProgressAggregator.aggregate(
            sessions: sessionStore.sessions
        )
    }

    var body: some View {
        let progress = report
        let weekly = progress.weeklyReport
        let now = Date()
        let todayStart = Calendar.current.startOfDay(for: now)
        let todayFocusTime = focusTime(sessions: sessionStore.sessions, from: todayStart, to: now)
        let todaySessionCount = sessionCount(sessions: sessionStore.sessions, from: todayStart, to: now)
        let todaySavedTime = cappedSavedTime(totalFocusTime: todayFocusTime, sessionCount: todaySessionCount)
        let totalFocusTime = focusTime(sessions: sessionStore.sessions, from: .distantPast, to: Date())
        let totalSessionCount = sessionCount(sessions: sessionStore.sessions, from: .distantPast, to: Date())
        let savedTime = cappedSavedTime(totalFocusTime: totalFocusTime, sessionCount: totalSessionCount)
        let diagnosis = DigitalWellnessAI.currentDiagnosis(
            events: sessionStore.usageEvents,
            sessions: sessionStore.sessions,
            selectionCount: sessionStore.selectionCount
        )
        let healthContext = healthRecoveryContext(summaries: healthKitStore.summaries)
        let controlForecast = healthControlForecast(
            context: healthContext,
            events: sessionStore.usageEvents,
            sessions: sessionStore.sessions,
            diagnosis: diagnosis
        )
        let content = AnyView(
            newLookReport(
                progress: progress,
                weekly: weekly,
                todayFocusTime: todayFocusTime,
                todaySavedTime: todaySavedTime,
                totalFocusTime: totalFocusTime,
                totalSessionCount: totalSessionCount,
                savedTime: savedTime,
                forecast: controlForecast,
                emergencyUnlocksRemaining: sessionStore.emergencyUnlocksRemaining
            )
        )

        Group {
            if usesMainBackground {
                GeometryReader { proxy in
                    let viewportWidth = proxy.size.width
                    let contentWidth = max(0, viewportWidth - (sectionHorizontalPadding * 2))

                    ScrollView(.vertical, showsIndicators: false) {
                        HStack(alignment: .top, spacing: 0) {
                            Spacer(minLength: 0)

                            content
                                .padding(.bottom, 34)
                                .frame(width: contentWidth, alignment: .top)

                            Spacer(minLength: 0)
                        }
                        .frame(width: viewportWidth, alignment: .center)
                    }
                    .frame(width: viewportWidth, height: proxy.size.height, alignment: .top)
                }
            } else {
                List {
                    content
                        .padding(.horizontal, 22)
                        .padding(.top, 24)
                        .padding(.bottom, 34)
                        .listRowInsets(EdgeInsets())
                        .listRowSeparator(.hidden)
                        .listRowBackground(Color.clear)
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
        .background(reportBackground)
        .foregroundStyle(reportPrimary)
        .preferredColorScheme(sessionStore.isBlankActive ? .dark : .light)
        .onAppear {
            healthKitStore.refresh()
            refreshDailyAIIfNeeded()
        }
    }

    private func newLookReport(
        progress: BlankProgressReport,
        weekly: BlankWeeklyReport,
        todayFocusTime: TimeInterval,
        todaySavedTime: TimeInterval,
        totalFocusTime: TimeInterval,
        totalSessionCount: Int,
        savedTime: TimeInterval,
        forecast: ControlForecast,
        emergencyUnlocksRemaining: Int
    ) -> some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 10) {
                newLookProgressHeader()

                // Risk is deliberately the first card: it turns the report into a daily decision.
                newLookRiskCard(forecast: forecast)

                newLookRecoveredCard(savedTime: savedTime, totalFocusTime: totalFocusTime)

                HStack(alignment: .top, spacing: 12) {
                    newLookMetricCard(
                        label: "this week",
                        value: formatDuration(weekly.totalFocusTime),
                        detail: weekly.completedSessionCount == 1 ? "1 session" : "\(weekly.completedSessionCount) sessions",
                        icon: "clock"
                    )

                    newLookMetricCard(
                        label: "sessions",
                        value: "\(weekly.completedSessionCount)",
                        detail: "\(formatDuration(weekly.averageSessionDuration)) average",
                        icon: "square.stack.3d.up"
                    )
                }

                newLookRhythmCard(weekly: weekly)
                newLookPatternsCard(
                    weekly: weekly,
                    progress: progress,
                    emergencyUnlocksRemaining: emergencyUnlocksRemaining
                )
                newLookTimeDetailsCard(
                    todayFocusTime: todayFocusTime,
                    todaySavedTime: todaySavedTime,
                    totalFocusTime: totalFocusTime,
                    totalSessionCount: totalSessionCount
                )

                if !progress.protectionActivity.isEmpty {
                    newLookProtectionCard(progress: progress)
                }

                if totalSessionCount == 0 && todayFocusTime == 0 {
                    Text("start blank to build your first signal.")
                        .font(.blankInter(size: 17, weight: .bold, relativeTo: .headline))
                        .foregroundStyle(reportSecondary)
                        .padding(.top, 8)
                }

            }
            .padding(.horizontal, 0)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func newLookProgressHeader() -> some View {
        Group {
            if let onClose {
                SectionHeader(
                    title: "progress",
                    subtitle: "your time, rhythm and patterns.",
                    action: onClose,
                    titleColor: reportPrimary,
                    subtitleColor: reportSecondary
                )
                .padding(.bottom, 24)
            } else {
                TopSheetHeader(
                    title: "progress",
                    subtitle: "your time, rhythm and patterns.",
                    titleColor: reportPrimary,
                    subtitleColor: reportSecondary
                )
                .padding(.top, 16)
                .padding(.bottom, 24)
            }
        }
    }

    private func newLookCardHeader(label: String, icon: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(label.lowercased())
                .font(.blankInter(size: 11, weight: .medium, relativeTo: .caption))
                .foregroundStyle(reportSecondary)

            Spacer(minLength: 8)

            Image(systemName: icon)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(reportSecondary)
                .frame(width: 18, height: 18)
        }
    }

    private func newLookRiskCard(forecast: ControlForecast) -> some View {
        let riskColor = newLookRiskColor(forecast.level)

        return VStack(alignment: .leading, spacing: 0) {
            newLookCardHeader(label: "risk signal", icon: "waveform.path.ecg")

            Spacer(minLength: 18)

            HStack(alignment: .lastTextBaseline, spacing: 10) {
                Text("\(forecast.riskPercent)%")
                    .font(.blankInter(size: 38, weight: .bold, relativeTo: .largeTitle))
                    .monospacedDigit()
                    .tracking(-1.1)
                    .foregroundStyle(riskColor)

                VStack(alignment: .leading, spacing: 2) {
                    Text(forecast.riskLabel.lowercased())
                        .font(.blankInter(size: 18, weight: .bold, relativeTo: .headline))
                        .foregroundStyle(reportPrimary)

                    Text(forecast.windowText.lowercased())
                        .font(.blankInter(size: 12, weight: .medium, relativeTo: .caption))
                        .foregroundStyle(reportSecondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.74)
                }
            }

            HStack(alignment: .center, spacing: 8) {
                Text("based on recent patterns")
                    .font(.blankInter(size: 11, weight: .medium, relativeTo: .caption))
                    .foregroundStyle(reportSecondary)

                Spacer(minLength: 8)

                if sessionStore.isBlankActive {
                    Text("protected")
                        .font(.blankInter(size: 12, weight: .semibold, relativeTo: .caption))
                        .foregroundStyle(recoveryGreen)
                } else {
                    Button {
                        scheduleForecastBlock(forecast, source: "new_look_risk_today")
                    } label: {
                        Text("protect")
                            .font(.blankInter(size: 12, weight: .semibold, relativeTo: .caption))
                            .foregroundStyle(accentBlue)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.top, 10)
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 156, alignment: .leading)
        .reportFlatCard(cornerRadius: 18)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "risk signal, \(forecast.riskPercent) percent, \(forecast.riskLabel.lowercased()), \(forecast.windowText.lowercased())."
        )
    }

    private func newLookRecoveredCard(savedTime: TimeInterval, totalFocusTime: TimeInterval) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            newLookCardHeader(label: "recovered time", icon: "arrow.clockwise")

            Spacer(minLength: 18)

            Text(formatDuration(savedTime))
                .font(.blankInter(size: 32, weight: .semibold, relativeTo: .largeTitle))
                .tracking(-1.5)
                .foregroundStyle(reportPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.60)

            Text("all time · estimated from \(formatDuration(totalFocusTime)) blanked")
                .font(.blankInter(size: 12, weight: .medium, relativeTo: .caption))
                .foregroundStyle(reportSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
                .padding(.top, 3)
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 142, alignment: .leading)
        .reportFlatCard(cornerRadius: 18)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("recovered \(formatDuration(savedTime)) all time, estimated from \(formatDuration(totalFocusTime)) blanked.")
    }

    private func newLookMetricCard(label: String, value: String, detail: String, icon: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            newLookCardHeader(label: label, icon: icon)

            Spacer(minLength: 16)

            Text(value)
                .font(.blankInter(size: 25, weight: .bold, relativeTo: .title3))
                .monospacedDigit()
                .tracking(-0.4)
                .foregroundStyle(reportPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.70)

            Text(detail.lowercased())
                .font(.blankInter(size: 12, weight: .medium, relativeTo: .caption))
                .foregroundStyle(reportSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
                .padding(.top, 3)
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 120, alignment: .leading)
        .reportFlatCard(cornerRadius: 18)
    }

    private func newLookRhythmCard(weekly: BlankWeeklyReport) -> some View {
        let durations = weekly.dailyDurations
        let maxDuration = max(durations.max() ?? 0, 1)
        let bestIndex = durations.indices.max(by: { durations[$0] < durations[$1] })
        let dayLabels = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

        return VStack(alignment: .leading, spacing: 0) {
            newLookCardHeader(label: "rhythm", icon: "chart.bar.fill")

            Spacer(minLength: 14)

            HStack(alignment: .bottom, spacing: 8) {
                ForEach(0..<min(7, durations.count), id: \.self) { index in
                    VStack(spacing: 8) {
                        ZStack(alignment: .bottom) {
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .fill(reportPrimary.opacity(0.08))
                                .frame(maxWidth: .infinity, minHeight: 70, maxHeight: 70)

                            if durations[index] > 0 {
                                RoundedRectangle(cornerRadius: 4, style: .continuous)
                                    .fill(index == bestIndex ? recoveryGreen : reportPrimary.opacity(0.72))
                                    .frame(
                                        maxWidth: .infinity,
                                        minHeight: max(8, 70 * CGFloat(durations[index] / maxDuration)),
                                        maxHeight: max(8, 70 * CGFloat(durations[index] / maxDuration))
                                    )
                            }
                        }

                        Text(dayLabels[index])
                            .font(.blankInter(size: 11, weight: .medium, relativeTo: .caption))
                            .foregroundStyle(reportSecondary)
                    }
                    .frame(maxWidth: .infinity)
                }
            }

            Text("last seven days · height shows protected time")
                .font(.blankInter(size: 11, weight: .medium, relativeTo: .caption))
                .foregroundStyle(reportSecondary)
                .lineLimit(2)
                .padding(.top, 10)
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 164, alignment: .leading)
        .reportFlatCard(cornerRadius: 18)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("rhythm for the last seven days. height shows protected time.")
    }

    private func newLookPatternsCard(
        weekly: BlankWeeklyReport,
        progress: BlankProgressReport,
        emergencyUnlocksRemaining: Int
    ) -> some View {
        let bestDay = bestDayText(report: weekly).lowercased()

        return VStack(alignment: .leading, spacing: 0) {
            newLookCardHeader(label: "patterns", icon: "chart.bar.xaxis")

            Spacer(minLength: 16)

            HStack(alignment: .top, spacing: 16) {
                newLookPatternMetric(label: "current streak", value: "\(progress.currentStreakDays) days")

                Rectangle()
                    .fill(reportPrimary.opacity(0.10))
                    .frame(width: 1, height: 48)

                newLookPatternMetric(label: "best day this week", value: bestDay)
            }

            Rectangle()
                .fill(reportPrimary.opacity(0.08))
                .frame(height: 1)
                .padding(.vertical, 14)

            HStack(spacing: 16) {
                newLookSecondaryPatternMetric(label: "longest streak", value: "\(progress.longestStreakDays) days")
                newLookSecondaryPatternMetric(label: "unlocks left", value: "\(emergencyUnlocksRemaining)")
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 172, alignment: .leading)
        .reportFlatCard(cornerRadius: 18)
    }

    private func newLookPatternMetric(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label.lowercased())
                .font(.blankInter(size: 11, weight: .bold, relativeTo: .caption))
                .tracking(0.7)
                .foregroundStyle(reportSecondary)

            Text(value)
                .font(.blankInter(size: 20, weight: .bold, relativeTo: .title3))
                .tracking(-0.3)
                .foregroundStyle(reportPrimary)
                .lineLimit(2)
                .minimumScaleFactor(0.78)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func newLookSecondaryPatternMetric(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.lowercased())
                .font(.blankInter(size: 10, weight: .bold, relativeTo: .caption))
                .tracking(0.65)
                .foregroundStyle(reportSecondary)

            Text(value)
                .font(.blankInter(size: 15, weight: .bold, relativeTo: .subheadline))
                .monospacedDigit()
                .foregroundStyle(reportPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func newLookTimeDetailsCard(
        todayFocusTime: TimeInterval,
        todaySavedTime: TimeInterval,
        totalFocusTime: TimeInterval,
        totalSessionCount: Int
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            newLookCardHeader(label: "time", icon: "clock.arrow.circlepath")

            Spacer(minLength: 8)

            newLookDetailRow(title: "today", value: formatDuration(todayFocusTime), detail: "\(formatDuration(todaySavedTime)) recovered")
            newLookDetailRow(title: "all time", value: formatDuration(totalFocusTime), detail: "\(totalSessionCount) sessions")
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 164, alignment: .leading)
        .reportFlatCard(cornerRadius: 18)
    }

    private func newLookDetailRow(title: String, value: String, detail: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(title.lowercased())
                .font(.blankInter(size: 17, weight: .bold, relativeTo: .headline))
                .foregroundStyle(reportPrimary)

            Spacer(minLength: 8)

            VStack(alignment: .trailing, spacing: 2) {
                Text(value)
                    .font(.blankInter(size: 16, weight: .bold, relativeTo: .headline))
                    .monospacedDigit()
                    .foregroundStyle(reportPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)

                Text(detail.lowercased())
                    .font(.blankInter(size: 12, weight: .medium, relativeTo: .caption))
                    .foregroundStyle(reportSecondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)
    }

    private func newLookProtectionCard(progress: BlankProgressReport) -> some View {
        let visibleActivities = Array(progress.protectionActivity.prefix(3))

        return VStack(alignment: .leading, spacing: 0) {
            newLookCardHeader(label: "protection", icon: "shield.fill")

            Text("time protected across your distraction list")
                .font(.blankInter(size: 11, weight: .medium, relativeTo: .caption))
                .foregroundStyle(reportSecondary)
                .padding(.top, 3)
                .padding(.bottom, 4)

            ForEach(visibleActivities) { activity in
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(activity.name.lowercased())
                        .font(.blankInter(size: 17, weight: .bold, relativeTo: .headline))
                        .foregroundStyle(reportPrimary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)

                    Spacer(minLength: 8)

                    VStack(alignment: .trailing, spacing: 2) {
                        Text(formatDuration(activity.totalFocusTime))
                            .font(.blankInter(size: 16, weight: .bold, relativeTo: .headline))
                            .monospacedDigit()
                            .foregroundStyle(reportPrimary)
                        Text(activity.sessionCount == 1 ? "1 session" : "\(activity.sessionCount) sessions")
                            .font(.blankInter(size: 12, weight: .medium, relativeTo: .caption))
                            .foregroundStyle(reportSecondary)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 54, alignment: .leading)

                if activity.id != visibleActivities.last?.id {
                    Rectangle()
                        .fill(reportPrimary.opacity(0.08))
                        .frame(height: 1)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .reportFlatCard(cornerRadius: 18)
    }

    private func newLookRiskColor(_ level: ControlForecast.Level) -> Color {
        switch level {
        case .low:
            return BlankColors.seafoam
        case .medium:
            return BlankColors.paleSteelBlue
        case .high:
            return BlankColors.red
        }
    }

    private var reportBackground: some View {
        (sessionStore.isBlankActive ? BlankColors.newLookDarkBackground : BlankColors.minimalBackground)
            .ignoresSafeArea()
    }

    private func startBlank(durationMinutes: Int? = nil) {
        _ = sessionStore.activateBlank(durationMinutes: durationMinutes)
        screenTimeBlocker.apply(isBlankActive: sessionStore.isBlankActive)
    }

    private func scheduleForecastBlock(_ forecast: ControlForecast, source: String) {
        let startMinute = forecast.windowStartMinute
        let endMinute = forecast.windowEndMinute
        sessionStore.applyAdaptivePlan(startMinute: startMinute, endMinute: endMinute, durationDays: 1, activateCurrentWindow: false)
        screenTimeBlocker.apply(isBlankActive: sessionStore.isBlankActive)
        Task {
            await BlankFunnelAnalytics.track(
                "ai_plan_applied",
                properties: [
                    "source": source,
                    "start_minute": startMinute,
                    "end_minute": endMinute,
                    "duration_days": 1
                ]
            )
        }
    }

    private func cappedSavedTime(totalFocusTime: TimeInterval, sessionCount: Int) -> TimeInterval {
        min(totalFocusTime, TimeInterval(sessionCount * 7 * 60) + totalFocusTime * 0.10)
    }

    private func healthSourceStatus(context: HealthRecoveryContext) -> String {
        guard case .connected = healthKitStore.state else {
            if case .failed(_) = healthKitStore.state { return "Partial" }
            return "Off"
        }
        if healthKitStore.summaries.isEmpty { return "No data" }
        if let latest = healthKitStore.summaries.map(\.date).max(),
           Date().timeIntervalSince(latest) > 72 * 60 * 60 {
            return "Stale"
        }
        if context.signalCoveragePercent < 45 { return "Partial" }
        return "Connected"
    }

    private func healthRecoveryContext(summaries: [HealthDaySummary]) -> HealthRecoveryContext {
        let recent = Array(summaries.suffix(7))
        let sleepValues = recent.compactMap(\.sleepMinutes)
        let stepsValues = recent.compactMap(\.steps)
        let workoutValues = recent.compactMap(\.workoutMinutes)
        let hrvValues = recent.compactMap(\.hrvSDNN)
        let restingHeartRateValues = recent.compactMap(\.restingHeartRate)
        let respiratoryValues = recent.compactMap(\.respiratoryRate)
        let oxygenValues = recent.compactMap(\.oxygenSaturation)
        let vo2Values = recent.compactMap(\.vo2Max)
        let bedtimeValues = recent.compactMap(\.bedtimeMinute)
        let wakeValues = recent.compactMap(\.wakeMinute)

        let averageSleep = average(sleepValues)
        let averageSteps = average(stepsValues)
        let averageWorkoutMinutes = average(workoutValues)
        let averageHRV = average(hrvValues)
        let averageRestingHeartRate = average(restingHeartRateValues)
        let averageRespiratoryRate = average(respiratoryValues)
        let averageOxygenSaturation = average(oxygenValues)
        let averageVO2Max = average(vo2Values)
        let bedtimeDrift = circularMinuteDrift(bedtimeValues)
        let wakeDrift = circularMinuteDrift(wakeValues)
        let daysWithHealth = recent.filter(\.hasSignals).count
        let signalCoverage = min(100, recent.reduce(0) { $0 + min(12, $1.signalCount) * 100 / 12 } / max(1, recent.count))

        var scoreParts: [Int] = []
        if let averageSleep {
            scoreParts.append(min(100, max(0, Int(Double(averageSleep) / (8 * 60) * 100))))
        }
        if let averageSteps {
            scoreParts.append(min(100, max(0, Int(Double(averageSteps) / 8000 * 100))))
        }
        if let averageWorkoutMinutes {
            scoreParts.append(min(100, max(0, Int(Double(averageWorkoutMinutes) / 30 * 100))))
        }
        if let bedtimeDrift {
            scoreParts.append(max(0, 100 - min(100, bedtimeDrift)))
        }
        if averageHRV != nil || averageRestingHeartRate != nil {
            scoreParts.append(70)
        }
        if let averageRespiratoryRate {
            scoreParts.append(max(0, 100 - abs(averageRespiratoryRate - 15) * 8))
        }
        if let averageOxygenSaturation {
            scoreParts.append(max(0, min(100, (averageOxygenSaturation - 90) * 10)))
        }

        return HealthRecoveryContext(
            averageSleepMinutes: averageSleep,
            averageSteps: averageSteps,
            averageWorkoutMinutes: averageWorkoutMinutes,
            averageHRV: averageHRV,
            averageRestingHeartRate: averageRestingHeartRate,
            averageRespiratoryRate: averageRespiratoryRate,
            averageOxygenSaturation: averageOxygenSaturation,
            averageVO2Max: averageVO2Max,
            bedtimeDriftMinutes: bedtimeDrift,
            wakeDriftMinutes: wakeDrift,
            daysWithHealth: daysWithHealth,
            signalCoveragePercent: signalCoverage,
            recoveryScore: average(scoreParts)
        )
    }

    private func healthControlForecast(
        context: HealthRecoveryContext,
        events: [BlankUsageEvent],
        sessions: [BlankSession],
        diagnosis: DigitalWellnessDiagnosis
    ) -> ControlForecast {
        let calendar = Calendar.current
        let now = Date()
        let weekAgo = calendar.date(byAdding: .day, value: -7, to: now) ?? now
        let recentEvents = events.filter {
            $0.occurredAt >= weekAgo
        }
        let manualUnblanks = recentEvents.filter { $0.endedReason == .manual }.count
        let emergencyBreaks = recentEvents.filter { $0.kind == .blockBroken || $0.endedReason == .emergency }.count
        let shortManualUnblanks = recentEvents.filter { event in
            event.endedReason == .manual && (event.duration ?? .greatestFiniteMagnitude) < 20 * 60
        }.count
        let pickupPressure = min(100, manualUnblanks * 18 + shortManualUnblanks * 18 + emergencyBreaks * 16)
        let weakHour = DigitalWellnessAI.weakHour(events: events, sessions: sessions, now: now) ?? diagnosis.recommendedHour
        let minutesToWeakWindow = minutesUntilNextHour(weakHour, now: now)

        var risk = 28
        var reasons: [String] = []
        var plan: [String] = []

        if let score = context.recoveryScore {
            if score < 45 {
                risk += 24
            reasons.append("Recovery looks light, so Blankmind should reduce friction before the weak window.")
            } else if score >= 75 {
                risk -= 10
                reasons.append("Recovery looks strong enough to hold protection through a longer window.")
            }
        } else {
            risk += 8
            reasons.append("Blankmind needs more Health samples to separate low-energy days from normal days.")
        }

        if let sleep = context.averageSleepMinutes {
            if sleep < 6 * 60 {
                risk += 18
                reasons.append("Recent sleep is short, which often makes automatic scrolling harder to resist.")
            } else if sleep >= 7 * 60 + 15 {
                risk -= 6
            }
        }

        if let drift = context.bedtimeDriftMinutes, drift >= 75 {
            risk += 12
            reasons.append("Sleep timing is drifting, so late-phone protection matters more tonight.")
        }

        if let steps = context.averageSteps, steps < 3500 {
            risk += 8
            reasons.append("Activity is low, so the plan should be simple: activate and stay protected.")
        } else if let workout = context.averageWorkoutMinutes, workout >= 25 {
            risk -= 5
        }

        if manualUnblanks > 0 {
            risk += min(28, manualUnblanks * 9)
            reasons.append("Recent hold-to-unblank exits are the main relapse signal Blankmind is learning from.")
        }

        if shortManualUnblanks > 0 {
            risk += min(12, shortManualUnblanks * 6)
            reasons.append("Some exits happened early, which suggests the protection started too hard or too late.")
        }

        if pickupPressure >= 50 {
            risk += min(14, pickupPressure / 7)
            reasons.append("Pickup pressure is \(pickupPressure)/100, so Blankmind should act before repeated quick checks become a scroll loop.")
        }

        if emergencyBreaks > 0 {
            risk += min(16, emergencyBreaks * 6)
            reasons.append("Emergency exits add a stronger warning signal on top of manual unblanks.")
        }

        if minutesToWeakWindow <= 90 {
            risk += 14
            reasons.append("\(DigitalWellnessAI.hourRangeText(weakHour)) is close to your current high-risk window.")
        }

        let riskPercent = min(92, max(12, risk))
        let level: ControlForecast.Level
        let riskLabel: String
        if riskPercent >= 70 {
            level = .high
            riskLabel = "High risk"
        } else if riskPercent >= 45 {
            level = .medium
            riskLabel = "Medium risk"
        } else {
            level = .low
            riskLabel = "Low risk"
        }

        let duration: Int
        switch level {
        case .high:
            duration = 25
            plan.append("Activate Blankmind before the weak window and keep it on through that window.")
            plan.append("Use the \(duration)-min block only if indefinite protection feels too heavy today.")
        case .medium:
            duration = max(30, min(45, diagnosis.initialBlockMinutes))
            plan.append("Protect the same window again so Blankmind can learn whether it prevents manual unblanking.")
            plan.append("Optional: test a \(duration)-min block as a lighter version of full protection.")
        case .low:
            duration = max(45, diagnosis.initialBlockMinutes)
            plan.append("Use this as a strong control day: activate Blankmind during your best window.")
            plan.append("Optional: try a \(duration)-min block to compare timed and open-ended protection.")
        }

        let actionText: String
        if minutesToWeakWindow <= 90 {
            actionText = "Activate Blankmind at \(activationTimeText(before: weakHour)) and stay protected through the window."
        } else {
            actionText = "Protect \(DigitalWellnessAI.hourRangeText(weakHour)) with Blankmind. Timed block: \(duration) min optional."
        }

        let headline: String
        switch level {
        case .high:
            headline = "Tonight may be harder than usual. Blankmind should protect you before the urge arrives."
        case .medium:
            headline = "Risk is manageable. The best move is consistency, not a bigger challenge."
        case .low:
            headline = "This looks like a strong control day. Use it to reinforce your best window."
        }

        if reasons.isEmpty {
            reasons.append("Blankmind is combining Health context with your block history to find your control pattern.")
        }
        let experiment = forecastExperiment(
            pickupPressure: pickupPressure,
            manualUnblanks: manualUnblanks,
            emergencyBreaks: emergencyBreaks,
            recoveryLow: (context.recoveryScore ?? 100) < 45
        )

        return ControlForecast(
            level: level,
            riskPercent: riskPercent,
            riskLabel: riskLabel,
            headline: headline,
            windowText: DigitalWellnessAI.hourRangeText(weakHour),
            weakHour: weakHour,
            actionText: actionText,
            durationMinutes: duration,
            reasons: Array(reasons.prefix(3)),
            plan: Array(plan.prefix(2)),
            experimentName: experiment.name,
            experimentHypothesis: experiment.hypothesis,
            experimentMetric: experiment.metric
        )
    }

    private func forecastExperiment(
        pickupPressure: Int,
        manualUnblanks: Int,
        emergencyBreaks: Int,
        recoveryLow: Bool
    ) -> (name: String, hypothesis: String, metric: String) {
        if pickupPressure >= 65 {
            return (
                "Chain Intercept",
                "Stop the second quick check before it becomes a longer scroll loop.",
                "Fewer exits in the same risk window."
            )
        }
        if manualUnblanks >= 2 || emergencyBreaks >= 2 || recoveryLow {
            return (
                "Lighter Earlier Block",
                "A shorter earlier block should hold better than strict late friction.",
                "Completed block without manual or emergency exit."
            )
        }
        return (
            "Stable Repeat",
            "Repeat the same window to build a clean baseline.",
            "Three completed sessions with no relapse."
        )
    }

    private func focusTime(sessions: [BlankSession], from start: Date, to end: Date) -> TimeInterval {
        sessions.reduce(0) { total, session in
            let sessionEnd = session.endedAt ?? end
            let overlapStart = max(session.startedAt, start)
            let overlapEnd = min(sessionEnd, end)
            guard overlapStart < overlapEnd else { return total }
            return total + overlapEnd.timeIntervalSince(overlapStart)
        }
    }

    private func sessionCount(sessions: [BlankSession], from start: Date, to end: Date) -> Int {
        sessions.filter { session in
            let sessionEnd = session.endedAt ?? end
            return session.startedAt < end && sessionEnd > start
        }.count
    }

    private func bestDayText(report: BlankWeeklyReport) -> String {
        guard let bestIndex = report.dailyDurations.indices.max(by: {
            report.dailyDurations[$0] < report.dailyDurations[$1]
        }), report.dailyDurations[bestIndex] > 0 else {
            return "No data"
        }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        let symbols = formatter.weekdaySymbols ?? []
        guard !symbols.isEmpty else {
            return "No data"
        }
        let calendarStartIndex = Calendar.current.firstWeekday - 1
        let symbolIndex = (calendarStartIndex + bestIndex) % symbols.count
        return symbols[symbolIndex].capitalized(with: Locale(identifier: "en_US"))
    }

    private func minuteOfDay(from date: Date) -> Int {
        let components = Calendar.current.dateComponents([.hour, .minute], from: date)
        return (components.hour ?? 0) * 60 + (components.minute ?? 0)
    }

    private func hourRangeText(_ hour: Int) -> String {
        "\(clockTimeText(hour: hour)) to \(clockTimeText(hour: (hour + 1) % 24))"
    }

    private func activationTimeText(before hour: Int) -> String {
        clockTimeText(hour: (hour + 23) % 24, minute: 50)
    }

    private func minutesUntilNextHour(_ hour: Int, now: Date) -> Int {
        let calendar = Calendar.current
        let currentHour = calendar.component(.hour, from: now)
        let currentMinute = calendar.component(.minute, from: now)
        if currentHour == hour {
            return 0
        }
        let hoursUntil = (hour - currentHour + 24) % 24
        return max(0, hoursUntil * 60 - currentMinute)
    }

    private func mostCommonValue<T: Hashable>(_ values: [T]) -> T? {
        let counts = values.reduce(into: [T: Int]()) { counts, value in
            counts[value, default: 0] += 1
        }
        return counts.max { lhs, rhs in lhs.value < rhs.value }?.key
    }

    private func average(_ values: [Int]) -> Int? {
        values.isEmpty ? nil : values.reduce(0, +) / values.count
    }

    private func circularMinuteDrift(_ minutes: [Int]) -> Int? {
        guard minutes.count >= 2 else { return nil }
        let normalized = minutes.map { $0 < 12 * 60 ? $0 + 24 * 60 : $0 }
        guard let minValue = normalized.min(), let maxValue = normalized.max() else { return nil }
        return maxValue - minValue
    }

    private func formatDuration(_ duration: TimeInterval) -> String {
        let totalMinutes = max(0, Int(duration / 60))
        let hours = totalMinutes / 60
        let minutes = totalMinutes % 60

        if hours == 0 {
            return "\(minutes) min"
        }

        if minutes == 0 {
            return "\(hours) h"
        }

        return "\(hours) h \(minutes) min"
    }

    private func refreshDailyAIIfNeeded() {
        guard wellnessFeatureConsent, !isSubmittingWellnessFeatures else { return }
        let elapsed = Date().timeIntervalSince1970 - remoteWellnessLastSyncAt
        guard elapsed > 20 * 60 * 60 else { return }
        isSubmittingWellnessFeatures = true
        syncDigitalWellnessFeatures(showSuccessMessage: false)
    }

    private func syncDigitalWellnessFeatures(showSuccessMessage: Bool) {
        let payload = sessionStore.digitalWellnessFeaturePayload(healthSummaries: healthKitStore.summaries)
        let anonymousUserId = currentAnonymousUserId()

        Task {
            do {
                await BlankFunnelAnalytics.track(
                    "ai_insight_requested",
                    properties: [
                        "health_days": healthKitStore.summaries.count,
                        "usage_events": sessionStore.usageEvents.count,
                        "selection_count": sessionStore.selectionCount
                    ]
                )
                trackHealthDataState(payload: payload)
                let insight = try await DigitalWellnessFeaturesClient().submit(
                    payload: payload,
                    anonymousUserId: anonymousUserId,
                    consentText: "Personalize my plan"
                )
                await BlankFunnelAnalytics.track(
                    "ai_insight_received",
                    properties: [
                        "source": insight.source ?? "unknown",
                        "health_days": healthKitStore.summaries.count,
                        "usage_events": sessionStore.usageEvents.count
                    ]
                )
                await MainActor.run {
                    applyRemoteInsight(insight)
                    wellnessSyncMessage = showSuccessMessage ? "AI plan updated." : nil
                    isSubmittingWellnessFeatures = false
                }
            } catch {
                await MainActor.run {
                    wellnessSyncMessage = showSuccessMessage ? "AI plan update failed. Please try again." : nil
                    isSubmittingWellnessFeatures = false
                }
            }
        }
    }

    private func trackHealthDataState(payload: DigitalWellnessFeaturePayload) {
        let context = healthRecoveryContext(summaries: healthKitStore.summaries)
        let status = healthSourceStatus(context: context)
        guard status == "Connected" || status == "Partial" || status == "Stale" else { return }
        Task {
            await BlankFunnelAnalytics.track(
                status == "Stale" ? "stale_health_data" : "health_data_available",
                properties: [
                    "source": "apple_health",
                    "status": status.lowercased(),
                    "health_days": payload.weekly.health_days_count,
                    "signal_coverage_percent": payload.weekly.health_signal_coverage_percent,
                    "raw_health_samples_sent": false
                ]
            )
            await BlankFunnelAnalytics.track(
                status == "Stale" ? "wearable_data_stale" : "wearable_data_available",
                properties: [
                    "provider": "apple_health",
                    "status": status.lowercased(),
                    "health_days": payload.weekly.health_days_count,
                    "signal_coverage_percent": payload.weekly.health_signal_coverage_percent,
                    "raw_health_samples_sent": false
                ]
            )
        }
    }

    private func applyRemoteInsight(_ insight: DigitalWellnessRemoteInsight) {
        wellnessFeatureConsent = true
        remoteWellnessLastSyncAt = Date().timeIntervalSince1970
        remoteWellnessSummary = insight.summary
        remoteWellnessNextStep = insight.next_step
        remoteWellnessRecommendations = insight.recommendations.joined(separator: "\n")
        remoteRecommendationId = insight.recommendation_id ?? ""

        guard let plan = insight.plan_update else { return }
        remotePlanTitle = plan.title
        remotePlanEvidence = plan.evidence
        remotePlanStartMinute = plan.proposed_start_minute
        remotePlanEndMinute = plan.proposed_end_minute
        remotePlanDurationDays = plan.duration_days
        remotePlanActionLabel = plan.action_label
    }

    private func minuteText(_ minute: Int) -> String {
        let safeMinute = max(0, min(1439, minute))
        let hour = safeMinute / 60
        let minutes = safeMinute % 60
        return clockTimeText(hour: hour, minute: minutes)
    }

    private func clockTimeText(hour: Int, minute: Int = 0) -> String {
        let safeHour = ((hour % 24) + 24) % 24
        let safeMinute = max(0, min(59, minute))
        let displayHour = safeHour % 12 == 0 ? 12 : safeHour % 12
        let meridiem = safeHour < 12 ? "AM" : "PM"
        return "\(displayHour):\(String(format: "%02d", safeMinute)) \(meridiem)"
    }

    private func currentAnonymousUserId() -> String {
        if !onboardingAnonymousUserId.isEmpty {
            return onboardingAnonymousUserId
        }
        let created = UUID().uuidString
        onboardingAnonymousUserId = created
        return created
    }
}

private struct HealthRecoveryContext {
    let averageSleepMinutes: Int?
    let averageSteps: Int?
    let averageWorkoutMinutes: Int?
    let averageHRV: Int?
    let averageRestingHeartRate: Int?
    let averageRespiratoryRate: Int?
    let averageOxygenSaturation: Int?
    let averageVO2Max: Int?
    let bedtimeDriftMinutes: Int?
    let wakeDriftMinutes: Int?
    let daysWithHealth: Int
    let signalCoveragePercent: Int
    let recoveryScore: Int?
}

private struct ControlForecast {
    enum Level {
        case low
        case medium
        case high
    }

    let level: Level
    let riskPercent: Int
    let riskLabel: String
    let headline: String
    let windowText: String
    let weakHour: Int
    let actionText: String
    let durationMinutes: Int
    let reasons: [String]
    let plan: [String]
    let experimentName: String
    let experimentHypothesis: String
    let experimentMetric: String

    var activationStartMinute: Int {
        ((max(0, min(23, weakHour)) * 60) + (24 * 60 - 10)) % (24 * 60)
    }

    var activationEndMinute: Int {
        ((max(0, min(23, weakHour)) + 1) * 60) % (24 * 60)
    }

    var windowStartMinute: Int {
        max(0, min(23, weakHour)) * 60
    }

    var windowEndMinute: Int {
        ((max(0, min(23, weakHour)) + 1) * 60) % (24 * 60)
    }
}

private extension View {
    func reportFlatCard(cornerRadius: CGFloat = 18) -> some View {
        modifier(ReportFlatCardModifier(cornerRadius: cornerRadius))
    }
}

private struct ReportFlatCardModifier: ViewModifier {
    let cornerRadius: CGFloat
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .background {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(colorScheme == .dark ? BlankColors.pureWhite.opacity(0.12) : BlankColors.pureWhite)
            }
    }
}

private extension Array {
    subscript(safe index: Index) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
