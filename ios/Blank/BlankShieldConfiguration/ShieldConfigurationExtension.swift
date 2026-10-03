import ManagedSettings
import ManagedSettingsUI
import UIKit

private enum BlankShieldPalette {
    static let charcoal = UIColor(red: 41 / 255.0, green: 41 / 255.0, blue: 41 / 255.0, alpha: 1)
    static let paleSteelBlue = UIColor(red: 201 / 255.0, green: 202 / 255.0, blue: 196 / 255.0, alpha: 1)
    static let pureWhite = UIColor(red: 1, green: 1, blue: 252 / 255.0, alpha: 1)
}

final class ShieldConfigurationExtension: ShieldConfigurationDataSource {
    override func configuration(shielding application: Application) -> ShieldConfiguration {
        makeConfiguration(appName: application.localizedDisplayName ?? "This app")
    }

    override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration {
        makeConfiguration(appName: application.localizedDisplayName ?? "This app")
    }

    private func makeConfiguration(appName: String) -> ShieldConfiguration {
        ShieldConfiguration(
            backgroundBlurStyle: .systemUltraThinMaterialDark,
            backgroundColor: BlankShieldPalette.charcoal.withAlphaComponent(0.92),
            icon: nil,
            title: ShieldConfiguration.Label(
                text: "\(appName) is blocked",
                color: BlankShieldPalette.pureWhite
            ),
            subtitle: ShieldConfiguration.Label(
                text: "\(appName) is now blocked.\nYou're doing a great job.",
                color: BlankShieldPalette.paleSteelBlue
            ),
            primaryButtonLabel: ShieldConfiguration.Label(
                text: "Continue focus",
                color: BlankShieldPalette.charcoal
            ),
            primaryButtonBackgroundColor: BlankShieldPalette.pureWhite
        )
    }
}
