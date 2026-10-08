import Foundation
import HealthKit
import Combine

// Broad context stays on-device. Progress never enables cloud/AI consent.
enum RestHealthCatalog {
    static var quantities: [HKQuantityType] {
        var identifiers: [HKQuantityTypeIdentifier] = [
            .heartRate, .restingHeartRate, .heartRateVariabilitySDNN, .walkingHeartRateAverage,
            .heartRateRecoveryOneMinute, .atrialFibrillationBurden, .oxygenSaturation, .respiratoryRate,
            .bodyTemperature, .basalBodyTemperature, .appleSleepingWristTemperature,
            .bloodPressureSystolic, .bloodPressureDiastolic, .bloodGlucose, .vo2Max,
            .stepCount, .distanceWalkingRunning, .distanceCycling, .distanceSwimming,
            .activeEnergyBurned, .basalEnergyBurned, .appleExerciseTime, .appleStandTime,
            .flightsClimbed, .swimmingStrokeCount, .walkingSpeed, .walkingStepLength,
            .walkingAsymmetryPercentage, .walkingDoubleSupportPercentage,
            .stairAscentSpeed, .stairDescentSpeed, .sixMinuteWalkTestDistance, .appleWalkingSteadiness,
            .runningSpeed, .runningPower, .runningStrideLength, .runningVerticalOscillation, .runningGroundContactTime,
            .height, .bodyMass, .bodyMassIndex, .bodyFatPercentage, .leanBodyMass, .waistCircumference,
            .dietaryEnergyConsumed, .dietaryWater, .dietaryCaffeine, .dietaryCarbohydrates,
            .dietaryProtein, .dietaryFatTotal, .dietaryFatSaturated, .dietaryFatMonounsaturated,
            .dietaryFatPolyunsaturated, .dietaryCholesterol, .dietarySodium, .dietarySugar, .dietaryFiber,
            .dietaryCalcium, .dietaryIron, .dietaryPotassium, .dietaryMagnesium, .dietaryZinc,
            .dietaryVitaminA, .dietaryVitaminB6, .dietaryVitaminB12, .dietaryVitaminC,
            .dietaryVitaminD, .dietaryVitaminE, .dietaryVitaminK, .dietaryFolate,
            .dietaryThiamin, .dietaryRiboflavin, .dietaryNiacin, .dietaryBiotin,
            .dietaryPantothenicAcid, .dietaryPhosphorus, .dietaryIodine, .dietarySelenium,
            .dietaryCopper, .dietaryManganese, .dietaryChromium, .dietaryMolybdenum, .dietaryChloride,
            .numberOfAlcoholicBeverages, .bloodAlcoholContent,
            .environmentalAudioExposure, .headphoneAudioExposure,
            .uvExposure, .insulinDelivery, .inhalerUsage, .peakExpiratoryFlowRate,
            .forcedVitalCapacity, .forcedExpiratoryVolume1, .peripheralPerfusionIndex, .electrodermalActivity,
            .numberOfTimesFallen, .pushCount, .distanceWheelchair
        ]
        if #available(iOS 17, *) { identifiers.append(.timeInDaylight) }
        if #available(iOS 18, *) { identifiers.append(.appleSleepingBreathingDisturbances) }
        if #available(iOS 11.2, *) { identifiers.append(.distanceDownhillSnowSports) }
        if #available(iOS 8.0, *) { identifiers.append(.nikeFuel) }
        if #available(iOS 14.5, *) { identifiers.append(.appleMoveTime) }
        if #available(iOS 18.0, *) { identifiers.append(.crossCountrySkiingSpeed) }
        if #available(iOS 17.0, *) { identifiers.append(.cyclingCadence) }
        if #available(iOS 17.0, *) { identifiers.append(.cyclingFunctionalThresholdPower) }
        if #available(iOS 17.0, *) { identifiers.append(.cyclingPower) }
        if #available(iOS 17.0, *) { identifiers.append(.cyclingSpeed) }
        if #available(iOS 18.0, *) { identifiers.append(.distanceCrossCountrySkiing) }
        if #available(iOS 18.0, *) { identifiers.append(.distancePaddleSports) }
        if #available(iOS 18.0, *) { identifiers.append(.distanceRowing) }
        if #available(iOS 18.0, *) { identifiers.append(.distanceSkatingSports) }
        if #available(iOS 18.0, *) { identifiers.append(.estimatedWorkoutEffortScore) }
        if #available(iOS 18.0, *) { identifiers.append(.paddleSportsSpeed) }
        if #available(iOS 17.0, *) { identifiers.append(.physicalEffort) }
        if #available(iOS 18.0, *) { identifiers.append(.rowingSpeed) }
        if #available(iOS 18.0, *) { identifiers.append(.workoutEffortScore) }
        if #available(iOS 16.0, *) { identifiers.append(.environmentalSoundReduction) }
        if #available(iOS 16.0, *) { identifiers.append(.underwaterDepth) }
        if #available(iOS 16.0, *) { identifiers.append(.waterTemperature) }
        return identifiers.compactMap { HKObjectType.quantityType(forIdentifier: $0) }
    }
    static var categories: [HKCategoryType] {
        let identifiers: [HKCategoryTypeIdentifier] = [
            .sleepAnalysis, .mindfulSession, .appleStandHour, .lowHeartRateEvent, .highHeartRateEvent,
            .irregularHeartRhythmEvent, .lowCardioFitnessEvent, .environmentalAudioExposureEvent,
            .headphoneAudioExposureEvent, .appleWalkingSteadinessEvent,
            .menstrualFlow, .intermenstrualBleeding, .cervicalMucusQuality, .ovulationTestResult,
            .sexualActivity, .contraceptive, .pregnancy, .pregnancyTestResult, .lactation,
            .infrequentMenstrualCycles, .irregularMenstrualCycles, .persistentIntermenstrualBleeding,
            .prolongedMenstrualPeriods, .progesteroneTestResult,
            .abdominalCramps, .acne, .appetiteChanges, .bladderIncontinence, .bloating,
            .breastPain, .chestTightnessOrPain, .chills, .constipation, .coughing,
            .diarrhea, .dizziness, .drySkin, .fainting, .fatigue, .fever,
            .generalizedBodyAche, .hairLoss, .headache, .heartburn, .hotFlashes,
            .lossOfSmell, .lossOfTaste, .lowerBackPain, .memoryLapse, .moodChanges,
            .nausea, .nightSweats, .pelvicPain, .rapidPoundingOrFlutteringHeartbeat,
            .runnyNose, .shortnessOfBreath, .sinusCongestion, .skippedHeartbeat,
            .sleepChanges, .soreThroat, .vaginalDryness, .vomiting, .wheezing,
            .handwashingEvent, .toothbrushingEvent
        ]
        var types = identifiers.compactMap { HKObjectType.categoryType(forIdentifier: $0) }
        if #available(iOS 18, *), let type = HKObjectType.categoryType(forIdentifier: .sleepApneaEvent) { types.append(type) }
        return types
    }
    static var clinical: [HKClinicalType] {
        var identifiers: [HKClinicalTypeIdentifier] = [.allergyRecord, .conditionRecord, .immunizationRecord, .labResultRecord,
            .medicationRecord, .procedureRecord, .vitalSignRecord, .coverageRecord]
        if #available(iOS 16.4, *) { identifiers.append(.clinicalNoteRecord) }
        return identifiers.compactMap { HKObjectType.clinicalType(forIdentifier: $0) }
    }
    static var sampleTypes: [HKSampleType] {
        var types: [HKSampleType] = quantities.map { $0 as HKSampleType }
            + categories.map { $0 as HKSampleType } + clinical.map { $0 as HKSampleType }
        types.append(HKObjectType.workoutType())
        types.append(HKObjectType.electrocardiogramType())
        types.append(HKObjectType.audiogramSampleType())
        if #available(iOS 18, *) { types.append(HKObjectType.stateOfMindType()) }
        return types
    }
    static var characteristics: [HKCharacteristicType] {
        let identifiers: [HKCharacteristicTypeIdentifier] = [.dateOfBirth, .biologicalSex, .bloodType, .fitzpatrickSkinType, .wheelchairUse]
        return identifiers.compactMap { HKObjectType.characteristicType(forIdentifier: $0) }
    }
    static var readTypes: Set<HKObjectType> {
        Set(sampleTypes.map { $0 as HKObjectType } + characteristics.map { $0 as HKObjectType })
    }
    static func name(_ identifier: String) -> String {
        let stripped = identifier.replacingOccurrences(of: "HKQuantityTypeIdentifier", with: "")
            .replacingOccurrences(of: "HKCategoryTypeIdentifier", with: "")
            .replacingOccurrences(of: "HKClinicalTypeIdentifier", with: "")
            .replacingOccurrences(of: "HKDataType", with: "")
            .replacingOccurrences(of: "HK", with: "")
            .replacingOccurrences(of: "Identifier", with: "")
            .replacingOccurrences(of: "Type", with: "")
        return stripped.replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression).lowercased()
    }
    static func family(_ id: String) -> String {
        if id.contains("Clinical") { return "Clinical records" }
        if id.contains("Sleep") { return "Sleep & breathing" }
        if id.contains("Dietary") || id.contains("Alcohol") { return "Nutrition & alcohol" }
        if ["Menstrual", "Pregnancy", "Ovulation", "Cervical", "Sexual", "Contraceptive", "Lactation", "Progesterone"].contains(where: id.contains) { return "Reproductive health" }
        if ["Audio", "Audiogram"].contains(where: id.contains) { return "Hearing & environment" }
        if ["BodyMass", "BodyFat", "LeanBody", "Height", "Waist"].contains(where: id.contains) { return "Body measurements" }
        if ["Heart", "Blood", "Respiratory", "Temperature", "Oxygen", "Electrocardio", "Perfusion", "Electrodermal", "Insulin", "Expiratory", "Inhaler", "VO2"].contains(where: id.contains) { return "Physical signals" }
        if id.contains("Category") || id.contains("StateOfMind") { return "Wellbeing & symptoms" }
        return "Activity & daylight"
    }
}

struct RestHealthTrait: Identifiable {
    let id: String
    let title: String
    let value: String
}

final class RestHealthContext: ObservableObject {
    static let shared = RestHealthContext()
    @Published private(set) var metrics: [RestHealthMetric] = []
    @Published private(set) var nights: [RestNight] = []
    @Published private(set) var traits: [RestHealthTrait] = []
    @Published private(set) var loading = false
    @Published private(set) var error: String?
    @Published private(set) var loadedAt: Date?
    private let health = HKHealthStore()
    private var request = UUID()
    private var queries: [HKQuery] = []
    private var observer: NSObjectProtocol?
    private var owner: String?

    init() {
        owner = AssistantAppSession.userID
        observer = NotificationCenter.default.addObserver(forName: AssistantAppSession.didChangeNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self, self.owner != AssistantAppSession.userID else { return }
            self.clear()
        }
    }
    deinit { if let observer { NotificationCenter.default.removeObserver(observer) } }
    func clear() {
        request = UUID()
        queries.forEach(health.stop)
        queries = []
        metrics = []; nights = []; traits = []; heartSamples = []; loading = false; error = nil; loadedAt = nil
        owner = AssistantAppSession.userID
    }
    func refresh(force: Bool = false) {
        if owner != AssistantAppSession.userID { clear() }
        guard !loading, HKHealthStore.isHealthDataAvailable(), owner != nil,
              BlankSharedState.defaults.bool(forKey: "blankHealthKitRequested") else { return }
        if !force, let loadedAt, Date().timeIntervalSince(loadedAt) < 300 { return }
        clear()
        loading = true
        let token = request, account = owner, now = Date(), calendar = Calendar.current
        let start = calendar.date(byAdding: .day, value: -35, to: calendar.startOfDay(for: now))!
        // Query a bounded number concurrently; each query has a timeout and a latest-sample cap.
        let types = RestHealthCatalog.sampleTypes
        readCharacteristics(now: now)
        health.preferredUnits(for: Set(RestHealthCatalog.quantities)) { [weak self] units, unitError in
            DispatchQueue.main.async {
                guard let self, self.request == token, account == AssistantAppSession.userID else { return }
                if unitError != nil { self.error = "Some health units could not be loaded. Try refreshing." }
                self.readBatch(types: types, index: 0, units: units, token: token, account: account, start: start, now: now, calendar: calendar)
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 90) { [weak self] in
            guard let self, self.request == token, self.loading else { return }
            self.queries.forEach(self.health.stop)
            self.queries = []; self.request = UUID(); self.loading = false
            self.error = "Some health data did not respond. Refresh to try again."
        }
    }
    private func readCharacteristics(now: Date) {
        // These have dedicated read APIs, not sample queries or measurement dates.
        // Missing/not-set and read-denied remain indistinguishable.
        var values: [RestHealthTrait] = []
        let calendar = Calendar(identifier: .gregorian)
        if let components = try? health.dateOfBirthComponents(), let birthday = calendar.date(from: components),
           birthday <= now, let years = calendar.dateComponents([.year], from: birthday, to: now).year {
            values.append(RestHealthTrait(id: "age", title: "age from date of birth", value: "\(years) years"))
        }
        if let object = try? health.biologicalSex() {
            let labels: [HKBiologicalSex: String] = [.female: "female", .male: "male", .other: "other"]
            if let value = labels[object.biologicalSex] { values.append(RestHealthTrait(id: "sex", title: "biological sex", value: value)) }
        }
        if let object = try? health.bloodType() {
            let labels: [HKBloodType: String] = [.aPositive: "A+", .aNegative: "A−", .bPositive: "B+", .bNegative: "B−",
                .abPositive: "AB+", .abNegative: "AB−", .oPositive: "O+", .oNegative: "O−"]
            if let value = labels[object.bloodType] { values.append(RestHealthTrait(id: "blood", title: "blood type", value: value)) }
        }
        if let object = try? health.fitzpatrickSkinType(), (1...6).contains(object.skinType.rawValue) {
            let roman = ["I", "II", "III", "IV", "V", "VI"]
            values.append(RestHealthTrait(id: "skin", title: "Fitzpatrick skin type", value: roman[object.skinType.rawValue - 1]))
        }
        if let object = try? health.wheelchairUse(), object.wheelchairUse != .notSet {
            let labels: [HKWheelchairUse: String] = [.yes: "yes", .no: "no"]
            if let value = labels[object.wheelchairUse] { values.append(RestHealthTrait(id: "wheelchair", title: "wheelchair use", value: value)) }
        }
        traits = values
    }
    private func readBatch(types: [HKSampleType], index: Int, units: [HKQuantityType: HKUnit], token: UUID,
                           account: String?, start: Date, now: Date, calendar: Calendar) {
        guard request == token, account == AssistantAppSession.userID else { return }
        guard index < types.count else {
            loading = false; loadedAt = now
            metrics.sort { ($0.family, $0.title) < ($1.family, $1.title) }
            return
        }
        let group = DispatchGroup()
        for type in types[index..<min(index + 6, types.count)] {
            group.enter()
            var finished = false // Only read/write on main queue, including timeout.
            // Chronic diagnoses and medications may be older than the trend window.
            let predicate = HKQuery.predicateForSamples(withStart: type is HKClinicalType ? nil : start, end: now)
            let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: 10000,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]) { [weak self] _, samples, queryError in
                DispatchQueue.main.async {
                    guard !finished else { return }; finished = true
                    defer { group.leave() }
                    guard let self, self.request == token, account == AssistantAppSession.userID else { return }
                    if let queryError {
                        // Read denial is opaque; never call an empty result denied/zero.
                        if (queryError as NSError).code != HKError.errorAuthorizationDenied.rawValue { self.error = "Some health data could not be loaded. Try refreshing." }
                        return
                    }
                    let rows = (samples ?? []).filter { $0.endDate <= now }
                    if type.identifier == HKCategoryTypeIdentifier.sleepAnalysis.rawValue {
                        self.nights = RestNight.build((rows as? [HKCategorySample] ?? []).map {
                            RestSleepObservation(start: $0.startDate, end: $0.endDate, value: $0.value,
                                source: $0.sourceRevision.source.bundleIdentifier,
                                manual: $0.metadata?[HKMetadataKeyWasUserEntered] as? Bool == true)
                        }, now: now, calendar: calendar)
                    }
                    if let quantity = type as? HKQuantityType, let unit = units[quantity], let values = rows as? [HKQuantitySample] {
                        let cumulative = quantity.aggregationStyle == .cumulative
                        // Native statistics apply HealthKit source handling for daily cumulative totals.
                        if cumulative {
                            group.enter()
                            self.readDailyStatistics(type: quantity, unit: unit, start: start, now: now, calendar: calendar,
                                token: token, account: account, capped: rows.count == 10000) { group.leave() }
                        } else {
                            self.metrics.append(Self.quantityMetric(type: quantity, samples: values, unit: unit,
                                calendar: calendar, capped: rows.count == 10000))
                        }
                        if quantity.identifier == HKQuantityTypeIdentifier.heartRate.rawValue {
                            // Sleep is queried first in this catalogue order via a second projection below.
                            self.heartSamples = values
                        }
                    } else if !rows.isEmpty {
                        self.metrics.append(Self.recordMetric(type: type, samples: rows, calendar: calendar, capped: rows.count == 10000))
                    }
                    self.rebuildNightHeartRate(calendar: calendar)
                }
            }
            queries.append(query)
            health.execute(query)
            DispatchQueue.main.asyncAfter(deadline: .now() + 12) { [weak self] in
                guard !finished else { return }; finished = true
                self?.health.stop(query)
                if self?.request == token { self?.error = "Some health data did not respond. Try refreshing." }
                group.leave()
            }
        }
        group.notify(queue: .main) { [weak self] in
            self?.readBatch(types: types, index: index + 6, units: units, token: token, account: account, start: start, now: now, calendar: calendar)
        }
    }
    private var heartSamples: [HKQuantitySample] = []
    private func rebuildNightHeartRate(calendar: Calendar) {
        metrics.removeAll { $0.id == "blank.nightHeartRate" }
        let unit = HKUnit.count().unitDivided(by: .minute())
        let points = nights.compactMap { night -> RestHealthPoint? in
            let samples = heartSamples.filter { sample in night.asleep.contains { sample.startDate >= $0.start && sample.endDate <= $0.end } }
            guard let value = RestProgressSnapshot.mean(samples.map { $0.quantity.doubleValue(for: unit) }) else { return nil }
            return RestHealthPoint(date: night.date, value: value, count: samples.count,
                sources: Array(Set(samples.map { $0.sourceRevision.source.name })).sorted())
        }
        if !points.isEmpty { metrics.append(RestHealthMetric(id: "blank.nightHeartRate", title: "night-time heart rate",
            family: "Physical signals", unit: "bpm", points: points,
            note: "Average of pulse samples within measured sleep intervals; not a stress diagnosis.")) }
    }
    private func readDailyStatistics(type: HKQuantityType, unit: HKUnit, start: Date, now: Date, calendar: Calendar,
                                     token: UUID, account: String?, capped: Bool, completion: @escaping () -> Void) {
        var finished = false
        let query = HKStatisticsCollectionQuery(quantityType: type,
            quantitySamplePredicate: HKQuery.predicateForSamples(withStart: start, end: now),
            options: .cumulativeSum, anchorDate: calendar.startOfDay(for: start), intervalComponents: DateComponents(day: 1))
        query.initialResultsHandler = { [weak self] _, results, queryError in
            var points: [RestHealthPoint] = []
            results?.enumerateStatistics(from: start, to: now) { row, _ in
                if let value = row.sumQuantity()?.doubleValue(for: unit) {
                    points.append(RestHealthPoint(date: calendar.startOfDay(for: row.startDate), value: value, count: 1,
                        sources: (row.sources ?? []).map(\.name).sorted()))
                }
            }
            DispatchQueue.main.async {
                guard !finished else { return }; finished = true
                defer { completion() }
                guard let self, self.request == token, account == AssistantAppSession.userID else { return }
                if queryError != nil { self.error = "Some health totals could not be loaded. Try refreshing." }
                self.metrics.append(RestHealthMetric(id: type.identifier, title: RestHealthCatalog.name(type.identifier),
                    family: RestHealthCatalog.family(type.identifier), unit: unit.unitString, points: points,
                    note: "Daily totals from Apple Health statistics. Current day may be incomplete."))
                self.metrics.sort { ($0.family, $0.title) < ($1.family, $1.title) }
            }
        }
        queries.append(query); health.execute(query)
        DispatchQueue.main.asyncAfter(deadline: .now() + 12) { [weak self] in
            guard !finished else { return }; finished = true
            self?.health.stop(query)
            if self?.request == token { self?.error = "Some health totals did not respond. Try refreshing." }
            completion()
        }
    }
    private static func quantityMetric(type: HKQuantityType, samples: [HKQuantitySample], unit: HKUnit,
                                        calendar: Calendar, capped: Bool) -> RestHealthMetric {
        let points = Dictionary(grouping: samples, by: { calendar.startOfDay(for: $0.endDate) }).compactMap { day, rows -> RestHealthPoint? in
            guard let value = RestProgressSnapshot.mean(rows.map { $0.quantity.doubleValue(for: unit) }) else { return nil }
            return RestHealthPoint(date: day, value: value, count: rows.count,
                sources: Array(Set(rows.map { $0.sourceRevision.source.name })).sorted())
        }.sorted { $0.date < $1.date }
        return RestHealthMetric(id: type.identifier, title: RestHealthCatalog.name(type.identifier),
            family: RestHealthCatalog.family(type.identifier), unit: unit.unitString, points: points,
            note: "Daily sample averages; multiple sources may contribute." + (capped ? " Latest 10,000 samples only; coverage is partial." : ""))
    }
    private static func recordMetric(type: HKSampleType, samples: [HKSample], calendar: Calendar, capped: Bool) -> RestHealthMetric {
        var unit = "records"
        let points = Dictionary(grouping: samples, by: { calendar.startOfDay(for: $0.endDate) }).map { day, rows -> RestHealthPoint in
            var value = Double(rows.count)
            if #available(iOS 18, *), let moods = rows as? [HKStateOfMind], let mean = RestProgressSnapshot.mean(moods.map(\.valence)) {
                value = mean; unit = "valence"
            }
            return RestHealthPoint(date: day, value: value, count: rows.count,
                sources: Array(Set(rows.map { $0.sourceRevision.source.name })).sorted())
        }.sorted { $0.date < $1.date }
        let entries = samples.prefix(100).map { sample -> RestHealthEntry in
            var title = RestHealthCatalog.name(type.identifier)
            var detail = "Recorded in Apple Health"
            if let record = sample as? HKClinicalRecord {
                title = record.displayName
                detail = "Clinical record · original document in Apple Health"
            } else if let workout = sample as? HKWorkout {
                detail = "\(Int(workout.duration / 60)) min of recorded exercise"
            } else if let ecg = sample as? HKElectrocardiogram {
                detail = "Recorded ECG"
                if let pulse = ecg.averageHeartRate {
                    detail += String(format: " · %.0f bpm", pulse.doubleValue(for: HKUnit.count().unitDivided(by: .minute())))
                }
            } else if let category = sample as? HKCategorySample {
                let symptoms = ["Fatigue", "NightSweats", "Headache", "Fever", "Coughing", "ShortnessOfBreath",
                    "Dizziness", "Nausea", "GeneralizedBodyAche", "SleepChanges", "LowerBackPain", "HotFlashes"]
                if symptoms.contains(where: type.identifier.contains), let severity = HKCategoryValueSeverity(rawValue: category.value) {
                    switch severity {
                    case .notPresent: detail = "Not present"
                    case .mild: detail = "Mild"
                    case .moderate: detail = "Moderate"
                    case .severe: detail = "Severe"
                    default: detail = "Severity unspecified"
                    }
                } else if type.identifier == HKCategoryTypeIdentifier.mindfulSession.rawValue {
                    detail = "\(Int(sample.endDate.timeIntervalSince(sample.startDate) / 60)) mindful minutes"
                }
            }
            if #available(iOS 18, *), let mood = sample as? HKStateOfMind {
                detail = String(format: "Recorded mood valence: %.2f (−1 to 1)", mood.valence)
            }
            return RestHealthEntry(id: sample.uuid, date: sample.endDate, title: title, detail: detail,
                source: sample.sourceRevision.source.name)
        }
        return RestHealthMetric(id: type.identifier, title: RestHealthCatalog.name(type.identifier),
            family: RestHealthCatalog.family(type.identifier), unit: unit, points: points,
            note: (type is HKClinicalType ? "Available clinical history, including records older than 35 days. " : "")
                + "Recorded entries; their presence does not diagnose a condition. Clinical documents and ECG waveforms remain in Apple Health." + (capped ? " Latest 10,000 records only." : ""),
            isCategory: unit == "records", entries: entries)
    }
}
