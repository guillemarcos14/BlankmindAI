import Foundation
import Combine
import HealthKit

private struct HealthSleepSummary {
    var inBedMinutes: Int?
    var sleepMinutes: Int?
    var deepSleepMinutes: Int?
    var remSleepMinutes: Int?
    var coreSleepMinutes: Int?
    var awakeMinutes: Int?
    var bedtimeMinute: Int?
    var wakeMinute: Int?
}

enum HealthKitConnectionState: Equatable {
    case unavailable
    case notRequested
    case requesting
    case connected
    case failed(String)
}

final class HealthKitStore: ObservableObject {
    static let shared = HealthKitStore()
    @Published private(set) var syntheticSleepEnabled = false
    private var sourceOwner: String?
    private var refreshRequestID = UUID()
    private(set) var sourceGeneration = UUID()
    private var identityObserver: NSObjectProtocol?

    var canUseSyntheticSleep: Bool { SyntheticSleepSource.allowed && AssistantAppSession.userID != nil }
    var sleepDataAvailable: Bool { syntheticSleepEnabled || sleepAccess.hasData }
    var onboardingSleepAccess: SleepAccessStatus { syntheticSleepEnabled ? .available : sleepAccess }
    var sleepSource: String { syntheticSleepEnabled ? "synthetic_qa" : "apple_health" }
    var sleepProvenance: String {
        syntheticSleepEnabled ? "Sleep is synthetic QA data; activity, permissions and protection are real. Do not treat sleep as measured health evidence." : "Sleep source: Apple Health; read permission is opaque."
    }

    func sleepContextProfile(now: Date = Date()) -> [String: Any] {
        reconcileSleepSource()
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = Calendar.current.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        let nights: [[String: Any]] = summaries.filter { $0.sleepMinutes != nil }.suffix(14).map { day in
            var row: [String: Any] = ["date": formatter.string(from: day.date), "source": sleepSource]
            for (key, value) in [("sleep_minutes", day.sleepMinutes), ("deep_minutes", day.deepSleepMinutes),
                ("rem_minutes", day.remSleepMinutes), ("core_minutes", day.coreSleepMinutes),
                ("awake_minutes", day.awakeMinutes), ("in_bed_minutes", day.inBedMinutes),
                ("bedtime_minute", day.bedtimeMinute), ("wake_minute", day.wakeMinute)] {
                if let value { row[key] = value }
            }
            return row
        }
        return ["sleep_source": sleepSource, "sleep_is_synthetic": syntheticSleepEnabled,
            "sleep_provenance": sleepProvenance, "sleep_nights": nights,
            "sleep_date": nights.last?["date"] as? String ?? ""]
    }

    func setSyntheticSleepEnabled(_ enabled: Bool) {
        guard canUseSyntheticSleep else { return }
        SyntheticSleepSource.setEnabled(enabled, owner: AssistantAppSession.userID, defaults: defaults)
        reconcileSleepSource(force: true)
        refresh()
    }

    func reconcileSleepSource(force: Bool = false) {
        let owner = AssistantAppSession.userID
        let enabled = SyntheticSleepSource.enabled(owner: owner, defaults: defaults)
        guard force || owner != sourceOwner || enabled != syntheticSleepEnabled else { return }
        let retained = owner == sourceOwner ? summaries : []
        sourceOwner = owner
        refreshRequestID = UUID()
        sourceGeneration = UUID()
        sleepRequestID = nil
        sleepCheckInFlight = false
        sleepAccess = .unchecked
        sleepNightCount = 0
        watchNightCount = 0
        syntheticSleepEnabled = enabled
        summaries = enabled ? SyntheticSleepSource.applying(to: retained) : SyntheticSleepSource.removingSleep(from: retained)
        state = HKHealthStore.isHealthDataAvailable() ? .notRequested : .unavailable
    }

    deinit { if let identityObserver { NotificationCenter.default.removeObserver(identityObserver) } }

    @Published private(set) var state: HealthKitConnectionState
    @Published private(set) var summaries: [HealthDaySummary] = []

    @Published private(set) var sleepAccess: SleepAccessStatus = .unchecked
    @Published private(set) var sleepCheckInFlight = false
    @Published private(set) var sleepNightCount = 0
    @Published private(set) var watchNightCount = 0
    private var sleepRequestID: UUID?

    private let healthStore = HKHealthStore()
    private let defaults: UserDefaults
    private let requestedKey = "blankHealthKitRequested"

    init(defaults: UserDefaults = BlankSharedState.defaults) {
        self.defaults = defaults
        if !HKHealthStore.isHealthDataAvailable() {
            state = .unavailable
        } else {
            state = .notRequested
        }
        reconcileSleepSource()
        identityObserver = NotificationCenter.default.addObserver(forName: AssistantAppSession.didChangeNotification,
            object: nil, queue: .main) { [weak self] _ in
                guard let self else { return }
                self.reconcileSleepSource()
                self.refresh()
            }
    }

    #if DEBUG && targetEnvironment(simulator)
    func setPreviewSleepAccess(_ status: SleepAccessStatus) {
        sleepAccess = status
        state = status.hasData ? .connected : .notRequested
    }
    #endif

    func requestAccess() {
        reconcileSleepSource()
        let owner = sourceOwner
        let generation = sourceGeneration
        guard HKHealthStore.isHealthDataAvailable() else {
            state = .unavailable
            return
        }
        let types = readTypes
        guard !types.isEmpty else {
            state = .failed("Health data types are not available on this device.")
            return
        }

        state = .requesting
        healthStore.requestAuthorization(toShare: [], read: types) { [weak self] success, error in
            DispatchQueue.main.async {
                guard let self, owner == AssistantAppSession.userID, self.sourceGeneration == generation else { return }
                self.defaults.set(true, forKey: self.requestedKey)
                if success {
                    self.verifySleepAccess()
                    self.refresh()
                } else {
                    self.state = .failed(error?.localizedDescription ?? "Could not request Health access.")
                }
                // Completing the sheet does not prove any read permission.
                if !success { self.sleepAccess = .failed(error?.localizedDescription ?? "Could not check Apple Health.") }
            }
        }
    }

    func verifySleepAccess() {
        reconcileSleepSource()
        let owner = sourceOwner
        guard HKHealthStore.isHealthDataAvailable() else {
            sleepAccess = .failed("Apple Health is unavailable on this device.")
            return
        }
        guard defaults.bool(forKey: requestedKey), !sleepCheckInFlight,
              let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else { return }
        sleepCheckInFlight = true
        if !sleepAccess.hasData { sleepAccess = .checking }
        let requestID = UUID()
        sleepRequestID = requestID
        let now = Date()
        let predicate = HKQuery.predicateForSamples(withStart: now.addingTimeInterval(-28 * 86400), end: now)
        let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { [weak self] _, samples, error in
            let observations = (samples as? [HKCategorySample] ?? []).map { sample in
                SleepAccessObservation(start: sample.startDate, end: sample.endDate,
                    source: sample.sourceRevision.source.bundleIdentifier,
                    isAppleWatch: sample.device?.model?.lowercased().contains("watch") == true
                        || sample.sourceRevision.productType?.hasPrefix("Watch") == true,
                    isAsleep: Self.isAsleepValue(sample.value),
                    manuallyEntered: sample.metadata?[HKMetadataKeyWasUserEntered] as? Bool == true)
            }
            let usable = SleepAccessPolicy.usable(observations, now: now)
            let calendar = Calendar.current
            let nights = Set(usable.map { calendar.startOfDay(for: $0.end) }).count
            let watchNights = Set(usable.filter(\.isAppleWatch).map { calendar.startOfDay(for: $0.end) }).count
            DispatchQueue.main.async {
                guard let self, owner == AssistantAppSession.userID, self.sleepRequestID == requestID else { return }
                self.sleepCheckInFlight = false
                self.sleepNightCount = nights
                self.watchNightCount = watchNights
                if let error {
                    self.sleepAccess = .failed(error.localizedDescription)
                } else {
                    self.sleepAccess = usable.isEmpty ? .noData : .available
                }
                self.state = self.sleepAccess.hasData ? .connected : .notRequested
            }
        }
        healthStore.execute(query)
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
            guard let self, owner == AssistantAppSession.userID, self.sleepRequestID == requestID, self.sleepCheckInFlight else { return }
            self.healthStore.stop(query)
            self.sleepRequestID = nil
            self.sleepCheckInFlight = false
            self.sleepAccess = .failed("Apple Health did not respond. Try again.")
        }
    }

    func refresh(days: Int = 35) {
        reconcileSleepSource()
        let owner = sourceOwner
        let requestID = UUID()
        refreshRequestID = requestID
        if syntheticSleepEnabled { summaries = SyntheticSleepSource.applying(to: summaries, days: days) }
        verifySleepAccess()
        guard HKHealthStore.isHealthDataAvailable() else {
            state = .unavailable
            return
        }
        guard defaults.bool(forKey: requestedKey) else { return }

        let calendar = Calendar.current
        let now = Date()
        let end = calendar.startOfDay(for: calendar.date(byAdding: .day, value: 1, to: now) ?? now)
        guard let start = calendar.date(byAdding: .day, value: -(days - 1), to: calendar.startOfDay(for: now)) else {
            return
        }

        let group = DispatchGroup()
        var sleepByDay: [Date: HealthSleepSummary] = [:]
        var stepsByDay: [Date: Int] = [:]
        var distanceByDay: [Date: Int] = [:]
        var activeEnergyByDay: [Date: Int] = [:]
        var basalEnergyByDay: [Date: Int] = [:]
        var workoutMinutesByDay: [Date: Int] = [:]
        var mindfulMinutesByDay: [Date: Int] = [:]
        var heartRateByDay: [Date: Int] = [:]
        var restingHeartRateByDay: [Date: Int] = [:]
        var hrvByDay: [Date: Int] = [:]
        var respiratoryRateByDay: [Date: Int] = [:]
        var oxygenSaturationByDay: [Date: Int] = [:]
        var vo2MaxByDay: [Date: Int] = [:]
        var flightsClimbedByDay: [Date: Int] = [:]

        group.enter()
        readSleepMinutes(start: start, end: end, calendar: calendar) { values in
            sleepByDay = values
            group.leave()
        }

        if let type = HKQuantityType.quantityType(forIdentifier: .stepCount) {
            group.enter()
            readDailySum(type: type, unit: .count(), start: start, end: end, calendar: calendar) { values in
                stepsByDay = values
                group.leave()
            }
        }

        if let type = HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning) {
            group.enter()
            readDailySum(type: type, unit: .meter(), start: start, end: end, calendar: calendar) { values in
                distanceByDay = values
                group.leave()
            }
        }

        if let type = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) {
            group.enter()
            readDailySum(type: type, unit: .kilocalorie(), start: start, end: end, calendar: calendar) { values in
                activeEnergyByDay = values
                group.leave()
            }
        }

        if let type = HKQuantityType.quantityType(forIdentifier: .basalEnergyBurned) {
            group.enter()
            readDailySum(type: type, unit: .kilocalorie(), start: start, end: end, calendar: calendar) { values in
                basalEnergyByDay = values
                group.leave()
            }
        }

        group.enter()
        readWorkoutMinutes(start: start, end: end, calendar: calendar) { values in
            workoutMinutesByDay = values
            group.leave()
        }

        if let type = HKObjectType.categoryType(forIdentifier: .mindfulSession) {
            group.enter()
            readCategoryMinutes(type: type, acceptedValues: nil, start: start, end: end, calendar: calendar) { values in
                mindfulMinutesByDay = values
                group.leave()
            }
        }

        if let type = HKQuantityType.quantityType(forIdentifier: .heartRate) {
            group.enter()
            readDailyAverage(type: type, unit: HKUnit.count().unitDivided(by: .minute()), start: start, end: end, calendar: calendar) { values in
                heartRateByDay = values
                group.leave()
            }
        }

        if let type = HKQuantityType.quantityType(forIdentifier: .restingHeartRate) {
            group.enter()
            readDailyAverage(type: type, unit: HKUnit.count().unitDivided(by: .minute()), start: start, end: end, calendar: calendar) { values in
                restingHeartRateByDay = values
                group.leave()
            }
        }

        if let type = HKQuantityType.quantityType(forIdentifier: .heartRateVariabilitySDNN) {
            group.enter()
            readDailyAverage(type: type, unit: .secondUnit(with: .milli), start: start, end: end, calendar: calendar) { values in
                hrvByDay = values
                group.leave()
            }
        }

        if let type = HKQuantityType.quantityType(forIdentifier: .respiratoryRate) {
            group.enter()
            readDailyAverage(type: type, unit: HKUnit.count().unitDivided(by: .minute()), start: start, end: end, calendar: calendar) { values in
                respiratoryRateByDay = values
                group.leave()
            }
        }

        if let type = HKQuantityType.quantityType(forIdentifier: .oxygenSaturation) {
            group.enter()
            readDailyAverageDouble(type: type, unit: .percent(), start: start, end: end, calendar: calendar) { values in
                oxygenSaturationByDay = values.mapValues { Int(($0 * 100).rounded()) }
                group.leave()
            }
        }

        if let type = HKQuantityType.quantityType(forIdentifier: .vo2Max) {
            group.enter()
            readDailyAverage(type: type, unit: HKUnit.literUnit(with: .milli).unitDivided(by: .gramUnit(with: .kilo)).unitDivided(by: .minute()), start: start, end: end, calendar: calendar) { values in
                vo2MaxByDay = values
                group.leave()
            }
        }

        if let type = HKQuantityType.quantityType(forIdentifier: .flightsClimbed) {
            group.enter()
            readDailySum(type: type, unit: .count(), start: start, end: end, calendar: calendar) { values in
                flightsClimbedByDay = values
                group.leave()
            }
        }

        group.notify(queue: .main) { [weak self] in
            guard let self, self.refreshRequestID == requestID, owner == AssistantAppSession.userID else { return }
            let loadedSummaries = (0..<days).compactMap { offset -> HealthDaySummary? in
                guard let date = calendar.date(byAdding: .day, value: offset, to: start) else { return nil }
                let day = calendar.startOfDay(for: date)
                return HealthDaySummary(
                    date: day,
                    inBedMinutes: sleepByDay[day]?.inBedMinutes,
                    sleepMinutes: sleepByDay[day]?.sleepMinutes,
                    deepSleepMinutes: sleepByDay[day]?.deepSleepMinutes,
                    remSleepMinutes: sleepByDay[day]?.remSleepMinutes,
                    coreSleepMinutes: sleepByDay[day]?.coreSleepMinutes,
                    awakeMinutes: sleepByDay[day]?.awakeMinutes,
                    bedtimeMinute: sleepByDay[day]?.bedtimeMinute,
                    wakeMinute: sleepByDay[day]?.wakeMinute,
                    steps: stepsByDay[day],
                    distanceMeters: distanceByDay[day],
                    activeEnergyKcal: activeEnergyByDay[day],
                    basalEnergyKcal: basalEnergyByDay[day],
                    workoutMinutes: workoutMinutesByDay[day],
                    mindfulMinutes: mindfulMinutesByDay[day],
                    averageHeartRate: heartRateByDay[day],
                    restingHeartRate: restingHeartRateByDay[day],
                    hrvSDNN: hrvByDay[day],
                    respiratoryRate: respiratoryRateByDay[day],
                    oxygenSaturation: oxygenSaturationByDay[day],
                    vo2Max: vo2MaxByDay[day],
                    flightsClimbed: flightsClimbedByDay[day],
                    signalCount: Self.signalCount(
                        sleep: sleepByDay[day],
                        steps: stepsByDay[day],
                        distance: distanceByDay[day],
                        activeEnergy: activeEnergyByDay[day],
                        basalEnergy: basalEnergyByDay[day],
                        workout: workoutMinutesByDay[day],
                        mindful: mindfulMinutesByDay[day],
                        heartRate: heartRateByDay[day],
                        restingHeartRate: restingHeartRateByDay[day],
                        hrv: hrvByDay[day],
                        respiratoryRate: respiratoryRateByDay[day],
                        oxygenSaturation: oxygenSaturationByDay[day],
                        vo2Max: vo2MaxByDay[day],
                        flights: flightsClimbedByDay[day]
                    )
                )
            }
            self.summaries = self.syntheticSleepEnabled
                ? SyntheticSleepSource.applying(to: loadedSummaries, days: days)
                : loadedSummaries.filter(\.hasSignals)
            if self.sleepAccess.hasData { self.state = .connected }
        }
    }

    private var readTypes: Set<HKObjectType> {
        var types = Set<HKObjectType>()
        [
            HKObjectType.categoryType(forIdentifier: .sleepAnalysis),
            HKQuantityType.quantityType(forIdentifier: .stepCount),
            HKQuantityType.quantityType(forIdentifier: .distanceWalkingRunning),
            HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned),
            HKQuantityType.quantityType(forIdentifier: .basalEnergyBurned),
            HKObjectType.workoutType(),
            HKObjectType.categoryType(forIdentifier: .mindfulSession),
            HKQuantityType.quantityType(forIdentifier: .heartRate),
            HKQuantityType.quantityType(forIdentifier: .restingHeartRate),
            HKQuantityType.quantityType(forIdentifier: .heartRateVariabilitySDNN),
            HKQuantityType.quantityType(forIdentifier: .respiratoryRate),
            HKQuantityType.quantityType(forIdentifier: .oxygenSaturation),
            HKQuantityType.quantityType(forIdentifier: .vo2Max),
            HKQuantityType.quantityType(forIdentifier: .flightsClimbed)
        ].forEach { type in
            if let type {
                types.insert(type)
            }
        }
        return types.union(RestHealthCatalog.readTypes)
    }

    private func readSleepMinutes(
        start: Date,
        end: Date,
        calendar: Calendar,
        completion: @escaping ([Date: HealthSleepSummary]) -> Void
    ) {
        guard let type = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else {
            completion([:])
            return
        }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
            let nights = RestNight.build((samples as? [HKCategorySample] ?? []).map {
                RestSleepObservation(start: $0.startDate, end: $0.endDate, value: $0.value,
                    source: $0.sourceRevision.source.bundleIdentifier,
                    manual: $0.metadata?[HKMetadataKeyWasUserEntered] as? Bool == true)
            }, now: min(end, Date()), calendar: calendar)
            let summaries = Dictionary(uniqueKeysWithValues: nights.map { night in
                (night.date, HealthSleepSummary(
                    inBedMinutes: night.inBedMinutes.map { Int($0.rounded()) },
                    sleepMinutes: Int(night.sleepMinutes.rounded()),
                    deepSleepMinutes: night.stageMinutes[4].map { Int($0.rounded()) },
                    remSleepMinutes: night.stageMinutes[5].map { Int($0.rounded()) },
                    coreSleepMinutes: night.stageMinutes[3].map { Int($0.rounded()) },
                    awakeMinutes: night.awakeMinutes.map { Int($0.rounded()) },
                    bedtimeMinute: Self.minuteOfDay(night.start, calendar: calendar),
                    wakeMinute: Self.minuteOfDay(night.end, calendar: calendar)))
            })
            completion(summaries)
        }
        healthStore.execute(query)
    }

    private func readCategoryMinutes(
        type: HKCategoryType,
        acceptedValues: Set<Int>?,
        start: Date,
        end: Date,
        calendar: Calendar,
        completion: @escaping ([Date: Int]) -> Void
    ) {
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
            var totals: [Date: TimeInterval] = [:]
            for sample in samples as? [HKCategorySample] ?? [] {
                if let acceptedValues = acceptedValues, !acceptedValues.contains(sample.value) { continue }
                let day = calendar.startOfDay(for: sample.startDate)
                totals[day, default: 0] += sample.endDate.timeIntervalSince(sample.startDate)
            }
            completion(totals.mapValues { Int(($0 / 60).rounded()) })
        }
        healthStore.execute(query)
    }

    private func readWorkoutMinutes(
        start: Date,
        end: Date,
        calendar: Calendar,
        completion: @escaping ([Date: Int]) -> Void
    ) {
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
            var totals: [Date: TimeInterval] = [:]
            for workout in samples as? [HKWorkout] ?? [] {
                let day = calendar.startOfDay(for: workout.startDate)
                totals[day, default: 0] += workout.duration
            }
            completion(totals.mapValues { Int(($0 / 60).rounded()) })
        }
        healthStore.execute(query)
    }

    private func readDailySum(
        type: HKQuantityType,
        unit: HKUnit,
        start: Date,
        end: Date,
        calendar: Calendar,
        completion: @escaping ([Date: Int]) -> Void
    ) {
        readQuantitySamples(type: type, start: start, end: end, calendar: calendar) { samples in
            var totals: [Date: Double] = [:]
            for sample in samples {
                let day = calendar.startOfDay(for: sample.startDate)
                totals[day, default: 0] += sample.quantity.doubleValue(for: unit)
            }
            completion(totals.mapValues { Int($0.rounded()) })
        }
    }

    private func readDailyAverage(
        type: HKQuantityType,
        unit: HKUnit,
        start: Date,
        end: Date,
        calendar: Calendar,
        completion: @escaping ([Date: Int]) -> Void
    ) {
        readQuantitySamples(type: type, start: start, end: end, calendar: calendar) { samples in
            var values: [Date: [Double]] = [:]
            for sample in samples {
                let day = calendar.startOfDay(for: sample.startDate)
                values[day, default: []].append(sample.quantity.doubleValue(for: unit))
            }
            completion(values.mapValues { Int(($0.reduce(0, +) / Double(max(1, $0.count))).rounded()) })
        }
    }

    private func readDailyAverageDouble(
        type: HKQuantityType,
        unit: HKUnit,
        start: Date,
        end: Date,
        calendar: Calendar,
        completion: @escaping ([Date: Double]) -> Void
    ) {
        readQuantitySamples(type: type, start: start, end: end, calendar: calendar) { samples in
            var values: [Date: [Double]] = [:]
            for sample in samples {
                let day = calendar.startOfDay(for: sample.startDate)
                values[day, default: []].append(sample.quantity.doubleValue(for: unit))
            }
            completion(values.mapValues { $0.reduce(0, +) / Double(max(1, $0.count)) })
        }
    }

    private func readQuantitySamples(
        type: HKQuantityType,
        start: Date,
        end: Date,
        calendar: Calendar,
        completion: @escaping ([HKQuantitySample]) -> Void
    ) {
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
            completion(samples as? [HKQuantitySample] ?? [])
        }
        healthStore.execute(query)
    }

    private static func isAsleepValue(_ value: Int) -> Bool {
        value != HKCategoryValueSleepAnalysis.inBed.rawValue &&
        value != HKCategoryValueSleepAnalysis.awake.rawValue
    }

    private static func minuteOfDay(_ date: Date, calendar: Calendar) -> Int {
        calendar.component(.hour, from: date) * 60 + calendar.component(.minute, from: date)
    }

    private static func earlierSleepStart(current: Int?, candidate: Int) -> Int {
        guard let current else { return candidate }
        let currentScore = current < 12 * 60 ? current + 24 * 60 : current
        let candidateScore = candidate < 12 * 60 ? candidate + 24 * 60 : candidate
        return candidateScore < currentScore ? candidate : current
    }

    private static func laterWake(current: Int?, candidate: Int) -> Int {
        guard let current else { return candidate }
        let currentScore = current < 12 * 60 ? current : current - 24 * 60
        let candidateScore = candidate < 12 * 60 ? candidate : candidate - 24 * 60
        return candidateScore > currentScore ? candidate : current
    }

    private static func signalCount(
        sleep: HealthSleepSummary?,
        steps: Int?,
        distance: Int?,
        activeEnergy: Int?,
        basalEnergy: Int?,
        workout: Int?,
        mindful: Int?,
        heartRate: Int?,
        restingHeartRate: Int?,
        hrv: Int?,
        respiratoryRate: Int?,
        oxygenSaturation: Int?,
        vo2Max: Int?,
        flights: Int?
    ) -> Int {
        [
            sleep?.sleepMinutes,
            sleep?.deepSleepMinutes,
            sleep?.remSleepMinutes,
            sleep?.coreSleepMinutes,
            sleep?.awakeMinutes,
            steps,
            distance,
            activeEnergy,
            basalEnergy,
            workout,
            mindful,
            heartRate,
            restingHeartRate,
            hrv,
            respiratoryRate,
            oxygenSaturation,
            vo2Max,
            flights
        ].compactMap { $0 }.count
    }
}
