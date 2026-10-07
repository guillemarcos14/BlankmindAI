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
    }

    #if DEBUG && targetEnvironment(simulator)
    func setPreviewSleepAccess(_ status: SleepAccessStatus) {
        sleepAccess = status
        state = status.hasData ? .connected : .notRequested
    }
    #endif

    func requestAccess() {
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
                guard let self else { return }
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
                guard let self, self.sleepRequestID == requestID else { return }
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
            guard let self, self.sleepRequestID == requestID, self.sleepCheckInFlight else { return }
            self.healthStore.stop(query)
            self.sleepRequestID = nil
            self.sleepCheckInFlight = false
            self.sleepAccess = .failed("Apple Health did not respond. Try again.")
        }
    }

    func refresh(days: Int = 14) {
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
            guard let self else { return }
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
            self.summaries = loadedSummaries.filter(\.hasSignals)
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
        return types
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
            var asleepTotals: [Date: TimeInterval] = [:]
            var inBedTotals: [Date: TimeInterval] = [:]
            var deepSleepTotals: [Date: TimeInterval] = [:]
            var remSleepTotals: [Date: TimeInterval] = [:]
            var coreSleepTotals: [Date: TimeInterval] = [:]
            var awakeTotals: [Date: TimeInterval] = [:]
            var bedtimeByDay: [Date: Int] = [:]
            var wakeByDay: [Date: Int] = [:]
            for sample in samples as? [HKCategorySample] ?? [] {
                let day = calendar.startOfDay(for: sample.startDate)
                let duration = sample.endDate.timeIntervalSince(sample.startDate)
                if sample.value == HKCategoryValueSleepAnalysis.inBed.rawValue {
                    inBedTotals[day, default: 0] += duration
                }
                if sample.value == HKCategoryValueSleepAnalysis.awake.rawValue {
                    awakeTotals[day, default: 0] += duration
                }
                if sample.value == HKCategoryValueSleepAnalysis.asleepDeep.rawValue {
                    deepSleepTotals[day, default: 0] += duration
                }
                if sample.value == HKCategoryValueSleepAnalysis.asleepREM.rawValue {
                    remSleepTotals[day, default: 0] += duration
                }
                if sample.value == HKCategoryValueSleepAnalysis.asleepCore.rawValue {
                    coreSleepTotals[day, default: 0] += duration
                }
                guard Self.isAsleepValue(sample.value) else { continue }
                asleepTotals[day, default: 0] += duration
                let startMinute = Self.minuteOfDay(sample.startDate, calendar: calendar)
                let endMinute = Self.minuteOfDay(sample.endDate, calendar: calendar)
                bedtimeByDay[day] = Self.earlierSleepStart(current: bedtimeByDay[day], candidate: startMinute)
                wakeByDay[day] = Self.laterWake(current: wakeByDay[day], candidate: endMinute)
            }
            let days = Set(asleepTotals.keys)
                .union(inBedTotals.keys)
                .union(deepSleepTotals.keys)
                .union(remSleepTotals.keys)
                .union(coreSleepTotals.keys)
                .union(awakeTotals.keys)
                .union(bedtimeByDay.keys)
                .union(wakeByDay.keys)
            let summaries = Dictionary(uniqueKeysWithValues: days.map { day in
                (
                        day,
                        HealthSleepSummary(
                            inBedMinutes: inBedTotals[day].map { Int(($0 / 60).rounded()) },
                            sleepMinutes: asleepTotals[day].map { Int(($0 / 60).rounded()) },
                            deepSleepMinutes: deepSleepTotals[day].map { Int(($0 / 60).rounded()) },
                            remSleepMinutes: remSleepTotals[day].map { Int(($0 / 60).rounded()) },
                            coreSleepMinutes: coreSleepTotals[day].map { Int(($0 / 60).rounded()) },
                            awakeMinutes: awakeTotals[day].map { Int(($0 / 60).rounded()) },
                            bedtimeMinute: bedtimeByDay[day],
                            wakeMinute: wakeByDay[day]
                        )
                )
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
