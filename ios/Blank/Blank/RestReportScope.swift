import Foundation

/// Report scope is independent of the broader, explicitly consented AI context.
enum RestReportScope {
    static func includes(_ identifier: String) -> Bool {
        let value = identifier.lowercased()
        return value.contains("sleep") || value.contains("nightheartrate")
            || value.contains("heartratevariability") || value.contains("restingheartrate")
            || value.contains("respiratoryrate") || value.contains("oxygensaturation")
            || value.contains("sleepingwristtemperature")
    }
}
