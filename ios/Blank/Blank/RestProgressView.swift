import SwiftUI
import Charts

struct RestProgressContent: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @Environment(\.dynamicTypeSize) private var textSize
    @ObservedObject private var health = RestHealthContext.shared
    @ObservedObject private var sleep = HealthKitStore.shared
    @State private var checkIns: [RestCheckIn] = []
    @State private var metric: RestProgressMetric = .perceived
    @Binding var showContext: Bool
    @State private var checkInExpanded = false
    @State private var checkInError: String?
    private let defaults = BlankSharedState.defaults
    private var ink: Color { BlankColors.cardInk }
    private var secondary: Color { ink.opacity(0.86) }
    private var account: String? { AssistantAppSession.userID }
    private var snapshot: RestProgressSnapshot {
        RestProgressSnapshot.make(nights: progressNights, checkIns: checkIns)
    }
    private var progressNights: [RestNight] {
        if sleep.syntheticSleepEnabled {
            return sleep.summaries.compactMap { day -> RestNight? in
                guard let minutes = day.sleepMinutes, let wake = day.wakeMinute else { return nil }
                let calendar = Calendar.current
                guard let end = calendar.date(bySettingHour: wake / 60, minute: wake % 60, second: 0, of: day.date), end <= Date() else { return nil }
                let start = end.addingTimeInterval(-Double(minutes + (day.awakeMinutes ?? 0)) * 60)
                return RestNight(date: calendar.startOfDay(for: end), start: start, end: end,
                    asleep: [RestInterval(start: end.addingTimeInterval(-Double(minutes) * 60), end: end)],
                    awakeMinutes: day.awakeMinutes.map(Double.init), stageMinutes: [:],
                    inBedMinutes: day.inBedMinutes.map(Double.init), source: "synthetic_qa", manual: false)
            }
        }
        #if DEBUG && targetEnvironment(simulator)
        if AssistantAppPreview.scenario.contains("progress") && !AssistantAppPreview.scenario.contains("empty") { return RestProgressFixture.nights() }
        #endif
        return health.nights
    }
    private var contextMetrics: [RestHealthMetric] {
        #if DEBUG && targetEnvironment(simulator)
        if AssistantAppPreview.scenario.contains("progress") && !AssistantAppPreview.scenario.contains("empty") { return RestProgressFixture.metrics() }
        #endif
        return sleep.syntheticSleepEnabled ? health.metrics.filter { $0.id != "blank.nightHeartRate" && !$0.id.contains("Sleep") } : health.metrics
    }
    private var historyStart: Date? {
        guard let account else { return nil }
        let timestamp = defaults.double(forKey: "blankRestHistoryStart." + account)
        return timestamp > 0 ? Date(timeIntervalSince1970: timestamp) : nil
    }

    private var sourceLabel: String? {
        if sleep.syntheticSleepEnabled { return "sample sleep · QA" }
        #if DEBUG && targetEnvironment(simulator)
        if AssistantAppPreview.scenario.contains("progress") { return "sample data · simulator" }
        #endif
        return nil
    }

    var body: some View {
        Group {
            if showContext { contextContent }
            else { summaryContent }
        }
        .foregroundStyle(ink)
        .onAppear { reload(); health.refresh(); sleep.refresh(days: 35) }
        .onChange(of: sleep.state) { state in
            if state == .connected { health.refresh(force: true) }
        }
        .onReceive(NotificationCenter.default.publisher(for: AssistantAppSession.didChangeNotification)) { _ in
            reload(); health.refresh()
        }
    }
    private var summaryContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                caption("last 7 days")
                Spacer()
                if let label = sourceLabel { caption(label) }
            }
            restCard
            trendCard
            bodyCard
            disconnectionCard
            Button { showContext = true } label: {
                HStack { Text("all health context"); Spacer(); Image(systemName: "chevron.right") }
                    .font(.blankInter(size: 16, relativeTo: .body))
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("progress-all-context")
            .foregroundStyle(ink)
            .padding(16)
            .reportFlatCard()
            caption("\(snapshot.weeklyNights.count) of 7 sleep nights · \(snapshot.weeklyRatings.count) morning check-ins")
            caption("Apple Health + Blank · missing records are not zero")
            if health.loading {
                HStack { ProgressView().tint(ink); caption("Loading your health context…") }
            }
            if let error = health.error {
                caption(error)
                Button("Refresh health data") { health.refresh(force: true) }
                    .font(.blankInter(size: 16, relativeTo: .body)).frame(minHeight: 44)
            }
        }
    }
    private func reload() {
        checkIns = RestCheckInRepository.load(owner: account, defaults: defaults)
        checkInError = nil
        if let account, defaults.object(forKey: "blankRestHistoryStart." + account) == nil {
            defaults.set(Date().timeIntervalSince1970, forKey: "blankRestHistoryStart." + account)
        }
        #if DEBUG && targetEnvironment(simulator)
        if AssistantAppPreview.scenario.contains("progress") && !AssistantAppPreview.scenario.contains("empty") { checkIns = RestProgressFixture.ratings() }
        if AssistantAppPreview.scenario.contains("progress-detail") { showContext = true }
        #endif
    }
    private func caption(_ value: String) -> some View {
        Text(value).font(.blankInter(size: 12, relativeTo: .caption))
            .foregroundStyle(secondary).fixedSize(horizontal: false, vertical: true)
    }
    private func header(_ title: String, icon: String) -> some View {
        HStack(alignment: .top) {
            caption(title)
            Spacer(minLength: 8)
            Image(systemName: icon).font(.system(size: 13, weight: .medium)).foregroundStyle(secondary)
        }
    }
    private var restCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            header("your rest", icon: "waveform.path.ecg")
            Text(snapshot.headline)
                .font(.blankInter(size: 26, relativeTo: .title3))
                .tracking(-0.4).fixedSize(horizontal: false, vertical: true)
            if let change = snapshot.restChange {
                Text(String(format: "%+.1f points in your morning check-in", change))
                    .font(.blankInter(size: 17, relativeTo: .body))
                caption("\(snapshot.weeklyRatings.count) check-ins this week · \(snapshot.baselineRatings.count) in the previous 4 weeks")
            } else {
                caption("A personal comparison needs 3 check-ins this week and 7 in the previous 4 weeks.")
            }
            Divider().overlay(ink.opacity(0.12))
            DisclosureGroup(isExpanded: $checkInExpanded) {
            Text("How rested do you feel after waking?").font(.blankInter(size: 17, relativeTo: .body))
            let layout = textSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
                : AnyLayout(HStackLayout(spacing: 4))
            layout {
                ForEach(1...5, id: \.self) { score in
                    checkInButton(score)
                }
            }
            HStack { caption("1 · not rested"); Spacer(); caption("5 · very rested") }
            } label: {
                HStack {
                    Text(todayRating.map { "Morning check-in · \($0)/5" } ?? "Add morning check-in")
                    Spacer()
                }.font(.blankInter(size: 16, relativeTo: .body)).frame(minHeight: 44)
            }.tint(ink).accessibilityIdentifier("progress-check-in")
            if account == nil { caption("Sign in to save your morning check-in.") }
            if let checkInError { caption(checkInError) }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading).reportFlatCard()
        .accessibilityIdentifier("progress-rest-card")
    }
    private var todayRating: Int? {
        checkIns.first { $0.day == RestCheckInRepository.dayKey(Date()) }?.score
    }
    private func checkInButton(_ score: Int) -> some View {
        Button {
            if RestCheckInRepository.save(score: score, owner: account, defaults: defaults) { reload() }
            else { checkInError = "Your check-in could not be saved. Sign in and try again." }
        } label: {
            Text("\(score)").font(.blankInter(size: 17, relativeTo: .body))
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(ink.opacity(todayRating == score ? 0.14 : 0.04), in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(ink.opacity(todayRating == score ? 0.6 : 0), lineWidth: 1))
        }
        .buttonStyle(.plain).disabled(account == nil)
        .accessibilityLabel("Morning rest \(score) out of 5")
        .accessibilityAddTraits(todayRating == score ? .isSelected : [])
        .accessibilityIdentifier("progress-check-in-\(score)")
    }
    private var chartPoints: [(day: Date, value: Double, segment: Int)] {
        var points: [(Date, Double, Int)] = [], segment = 0
        for day in snapshot.days {
            if let value = snapshot.chartValue(day: day, metric: metric) { points.append((day, value, segment)) }
            else { segment += 1 }
        }
        return points
    }
    private var chartRange: ClosedRange<Double> {
        switch metric {
        case .perceived: return 1...5
        case .duration: return 0...max(12, (chartPoints.map(\.value).max() ?? 0) + 1)
        case .regularity:
            return floor((chartPoints.map(\.value).min() ?? 22) - 1)...ceil((chartPoints.map(\.value).max() ?? 26) + 1)
        case .interruptions: return 0...max(30, (chartPoints.map(\.value).max() ?? 0) + 10)
        }
    }
    private var trendCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            header("rest over time", icon: "chart.bar.fill")
            Menu {
                Picker("Progress metric", selection: $metric) {
                    ForEach(RestProgressMetric.allCases) { value in Text(value.rawValue).tag(value) }
                }
            } label: {
                HStack {
                    Text(metric.rawValue)
                    Spacer()
                    Image(systemName: "chevron.down").font(.system(size: 12))
                }
                .font(.blankInter(size: 16, relativeTo: .body))
                .frame(minHeight: 44).contentShape(Rectangle())
            }
            .tint(ink).buttonStyle(.plain)
            .accessibilityLabel("Progress metric, " + metric.rawValue)
            .accessibilityIdentifier("progress-metric")
            if chartPoints.isEmpty {
                Text("No records for this metric yet.").font(.blankInter(size: 17, relativeTo: .body))
                    .frame(minHeight: 100, alignment: .leading)
                caption(metric == .perceived ? "Your morning check-ins will appear here." : "Connect Apple Health or allow this data type in Health.")
            } else {
                Chart {
                    ForEach(Array(chartPoints.enumerated()), id: \.offset) { _, point in
                        LineMark(x: .value("Day", point.day), y: .value(metric.rawValue, point.value), series: .value("Run", point.segment))
                            .foregroundStyle(ink.opacity(0.82)).lineStyle(StrokeStyle(lineWidth: 1.5))
                        PointMark(x: .value("Day", point.day), y: .value(metric.rawValue, point.value))
                            .foregroundStyle(ink.opacity(0.82)).symbolSize(22)
                    }
                }
                .chartYScale(domain: chartRange)
                .chartXScale(domain: snapshot.days.first!...snapshot.days.last!)
                .chartXAxis { AxisMarks(values: snapshot.days) { value in
                    AxisValueLabel { if let date = value.as(Date.self) { Text(date, format: .dateTime.weekday(.narrow)) } }
                } }
                .chartYAxis { AxisMarks(position: .leading) { value in
                    AxisGridLine().foregroundStyle(ink.opacity(0.1))
                    AxisValueLabel { if let number = value.as(Double.self) {
                        Text(metric == .regularity ? "\(Int(number) % 24):00" : String(format: "%.0f", number))
                    } }
                } }
                .font(.blankInter(size: 12, relativeTo: .caption)).frame(height: 125)
                .accessibilityLabel(metric.caption)
            }
            caption(metric.caption)
            caption("\(chartPoints.count) of 7 days recorded · gaps are missing data")
        }.padding(16).frame(maxWidth: .infinity, alignment: .leading).reportFlatCard()
    }
    private var featuredMetrics: [RestHealthMetric] {
        let ids = ["blank.nightHeartRate", "HKQuantityTypeIdentifierHeartRateVariabilitySDNN", "HKQuantityTypeIdentifierRespiratoryRate", "HKQuantityTypeIdentifierAppleSleepingWristTemperature", "HKQuantityTypeIdentifierOxygenSaturation", "HKQuantityTypeIdentifierTimeInDaylight"]
        return Array(ids.compactMap { id in contextMetrics.first { $0.id == id && !$0.points.isEmpty } }.prefix(3))
    }
    private var bodyCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            header("your body this week", icon: "waveform.path.ecg")
            ForEach(featuredMetrics) { row in metricRow(row) }
            if let minutes = RestProgressSnapshot.mean(snapshot.weeklyNights.map(\.sleepMinutes)) {
                dataRow("sleep per night", value: duration(minutes), detail: sleepDelta)
            }
            if featuredMetrics.isEmpty { caption("Physical signals appear when Apple Health has records you allow.") }
            caption("Changes from your previous 4 weeks · sample coverage varies")
            caption("Pulse and HRV provide context; they do not diagnose stress.")
        }.padding(16).frame(maxWidth: .infinity, alignment: .leading).reportFlatCard()
    }
    private var sleepDelta: String {
        guard snapshot.weeklyNights.count >= 3, snapshot.baselineNights.count >= 7,
              let a = RestProgressSnapshot.mean(snapshot.weeklyNights.map(\.sleepMinutes)),
              let b = RestProgressSnapshot.mean(snapshot.baselineNights.map(\.sleepMinutes)) else { return "\(snapshot.weeklyNights.count) nights · building reference" }
        return String(format: "%+.0f min · %d vs %d nights", a - b, snapshot.weeklyNights.count, snapshot.baselineNights.count)
    }
    private func metricRow(_ metric: RestHealthMetric) -> some View {
        let current = metric.points.filter { $0.date >= snapshot.currentStart && $0.date <= snapshot.now }
        let baseline = metric.points.filter { $0.date >= snapshot.baselineStart && $0.date < snapshot.currentStart }
        let mean = RestProgressSnapshot.mean(current.map(\.value))
        let reference = RestProgressSnapshot.mean(baseline.map(\.value))
        let detail: String
        if current.count >= 3, baseline.count >= 7, let mean, let reference {
            let change = metric.unit == "%" ? (mean - reference) * 100 : mean - reference
            detail = String(format: "%+.1f %@ · %d vs %d days", change, metric.unit, current.count, baseline.count)
        } else { detail = "\(current.count) days · building reference" }
        return dataRow(metric.title, value: mean.map { number($0, unit: metric.unit) } ?? "No recent records", detail: detail)
    }
    private func dataRow(_ title: String, value: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline) { Text(title); Spacer(minLength: 12); Text(value).monospacedDigit() }
                VStack(alignment: .leading, spacing: 4) { Text(title); Text(value).monospacedDigit() }
            }.font(.blankInter(size: 17, relativeTo: .body))
            caption(detail)
        }.accessibilityElement(children: .combine)
    }
    private var disconnectionCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            header("disconnection & rest", icon: "square.stack.3d.up")
            if !sleep.syntheticSleepEnabled, let link = snapshot.association(sessions: ownedSessions, historyStart: historyStart) {
                Text(abs(link.delta) < 0.3 ? "Similar morning rest across both routines" : link.delta > 0 ? "Better morning rest on protected nights" : "Lower morning rest on protected nights")
                    .font(.blankInter(size: 22, relativeTo: .title3)).fixedSize(horizontal: false, vertical: true)
                caption(String(format: "%+.1f check-in points · %d protected nights · %d without recorded protection", link.delta, link.protected, link.other))
                caption("45+ min of protection in the hour before sleep · observed association, not causality")
            } else {
                Text("Discover your own pattern").font(.blankInter(size: 22, relativeTo: .title3))
                caption("A comparison needs at least 5 measured nights with 45+ min of protection and 5 without recorded protection, each with a morning check-in.")
            }
            if let latest = snapshot.weeklyNights.last {
                dataRow("before sleep", value: duration(snapshot.protectedMinutes(night: latest, sessions: ownedSessions, morning: false)), detail: "recorded protection in the hour before sleep")
                dataRow("after waking", value: duration(snapshot.protectedMinutes(night: latest, sessions: ownedSessions, morning: true)), detail: "recorded protection in the first hour awake")
            }
            caption("Protection is recorded blocking, not measured time without your phone.")
        }.padding(16).frame(maxWidth: .infinity, alignment: .leading).reportFlatCard()
    }
    private var ownedSessions: [BlankSession] { account == nil ? [] : sessionStore.brainSessions }
    private func number(_ value: Double, unit: String) -> String {
        let display = unit == "%" ? value * 100 : value
        return String(format: "%.1f %@", display, unit)
    }
    private func duration(_ minutes: Double) -> String {
        let count = max(0, Int(minutes.rounded()))
        return count < 60 ? "\(count) min" : "\(count / 60) h \(count % 60) min"
    }
    private var contextContent: some View {
                VStack(alignment: .leading, spacing: 16) {
                    Text("All health context").font(.blankInter(size: 26, relativeTo: .title3))
                    caption("Last 35 days + available clinical history · stays on this device. No additional data is sent to AI from Progress.")
                    Button("Review Apple Health access") {
                        HealthKitStore.shared.requestAccess()
                    }.font(.blankInter(size: 16, relativeTo: .body)).frame(minHeight: 44)
                    Button("Refresh health data") { health.refresh(force: true) }
                        .font(.blankInter(size: 16, relativeTo: .body)).frame(minHeight: 44)
                    if let error = health.error { caption(error) }
                    if health.loading { ProgressView("Loading health context…").tint(ink) }
                    sleepDetails
                    ForEach(Array(Set(contextMetrics.map(\.family))).sorted(), id: \.self) { family in
                        VStack(alignment: .leading, spacing: 14) {
                            Text(family).font(.blankInter(size: 20, relativeTo: .headline))
                            ForEach(contextMetrics.filter { $0.family == family }) { item in
                                if item.points.isEmpty { dataRow(item.title, value: "No readable records", detail: "Data may be absent or read access may be limited.") }
                                else if item.isCategory {
                                    dataRow(item.title, value: "\(item.points.reduce(0) { $0 + $1.count }) records", detail: "\(item.points.count) days with recorded entries")
                                } else { metricRow(item) }
                                if let last = item.points.last {
                                    caption("Latest: \(number(last.value, unit: item.unit)) · \(last.date.formatted(date: .abbreviated, time: .omitted))")
                                    caption("Source: " + (last.sources.isEmpty ? "Apple Health" : last.sources.joined(separator: ", ")))
                                }
                                caption(item.note)
                                if !item.entries.isEmpty {
                                    DisclosureGroup("Recent entries") {
                                        ForEach(item.entries) { entry in
                                            VStack(alignment: .leading, spacing: 4) {
                                                Text(entry.title).font(.blankInter(size: 16, relativeTo: .body))
                                                caption(entry.detail)
                                                caption(entry.date.formatted(date: .abbreviated, time: .shortened) + " · " + entry.source)
                                            }.padding(.vertical, 6)
                                        }
                                        caption("Latest \(item.entries.count) entries shown")
                                    }.font(.blankInter(size: 16, relativeTo: .body)).tint(ink)
                                }
                                Divider().overlay(ink.opacity(0.1))
                            }
                        }.padding(16).frame(maxWidth: .infinity, alignment: .leading).reportFlatCard()
                    }
                    if contextMetrics.isEmpty { caption("No additional records are available yet. Review Health access and refresh.") }
                    caption("Availability depends on your device, region, records and permissions. Clinical documents and ECG waveforms can be reviewed in Apple Health.")
                    Button("Back to Progress") { showContext = false }
                        .font(.blankInter(size: 16, relativeTo: .body)).frame(minHeight: 44)
                        .accessibilityIdentifier("progress-context-back")
                }.foregroundStyle(ink)
    }
    private var sleepDetails: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Sleep").font(.blankInter(size: 20, relativeTo: .headline))
            caption("\(snapshot.nights.count) main sleep episodes · provider chosen per night to avoid duplicate records")
            if sleep.syntheticSleepEnabled { caption("Synthetic QA sleep. Physical signals, check-ins and protection are real.") }
            ForEach(snapshot.nights.suffix(7).reversed()) { night in
                dataRow(night.date.formatted(date: .abbreviated, time: .omitted), value: duration(night.sleepMinutes),
                    detail: "\(night.start.formatted(date: .omitted, time: .shortened))–\(night.end.formatted(date: .omitted, time: .shortened)) · \(night.source)")
                if let awake = night.awakeMinutes { caption("estimated awake time: " + duration(awake)) }
                if !night.stageMinutes.isEmpty {
                    caption([ (3, "core"), (4, "deep"), (5, "REM") ].compactMap { key, label in
                        night.stageMinutes[key].map { label + ": " + duration($0) }
                    }.joined(separator: " · "))
                }
                if night.manual { caption("Manually recorded sleep") }
            }
            caption("Sleep stages and waking are estimates. Missing waking samples do not mean zero interruptions.")
        }.padding(16).frame(maxWidth: .infinity, alignment: .leading).reportFlatCard()
    }
}

#if DEBUG && targetEnvironment(simulator)
// Explicit visual-test fixtures only; never persist them or fill a live account.
enum RestProgressFixture {
    static func nights(now: Date = Date(), calendar: Calendar = .current) -> [RestNight] {
        (0..<35).compactMap { offset in
            let day = calendar.date(byAdding: .day, value: -offset, to: calendar.startOfDay(for: now))!
            let end = calendar.date(bySettingHour: 7, minute: 30, second: 0, of: day)!
            guard end <= now else { return nil }
            let minutes = Double(420 + (offset % 4) * 12)
            let start = end.addingTimeInterval(-(minutes + 20) * 60)
            return RestNight(date: day, start: start, end: end,
                asleep: [RestInterval(start: start, end: end.addingTimeInterval(-20 * 60))], awakeMinutes: 20,
                stageMinutes: [3: minutes - 170, 4: 70, 5: 100], inBedMinutes: minutes + 30, source: "Simulator fixture", manual: false)
        }.sorted { $0.date < $1.date }
    }
    static func ratings() -> [RestCheckIn] {
        nights().map { night in
            RestCheckIn(day: RestCheckInRepository.dayKey(night.date), recordedAt: night.end,
                score: Calendar.current.dateComponents([.day], from: night.date, to: Date()).day! < 7 ? 4 : 3)
        }
    }
    static func metrics() -> [RestHealthMetric] {
        [("blank.nightHeartRate", "night-time heart rate", "bpm", 58.0),
         ("HKQuantityTypeIdentifierHeartRateVariabilitySDNN", "heart rate variability", "ms", 46.0)].map { id, name, unit, value in
            RestHealthMetric(id: id, title: name, family: "Physical signals", unit: unit,
                points: nights().map { RestHealthPoint(date: $0.date, value: value, count: 10, sources: ["Simulator fixture"]) },
                note: "Illustrative simulator data only")
        }
    }
}
#endif
