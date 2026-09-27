import SwiftUI
import UIKit

private struct BlankMinimalAppearanceKey: EnvironmentKey {
    static let defaultValue = false
}

private struct BlankSectionHorizontalPaddingKey: EnvironmentKey {
    static let defaultValue: CGFloat = 24
}

extension EnvironmentValues {
    var blankMinimalAppearance: Bool {
        get { self[BlankMinimalAppearanceKey.self] }
        set { self[BlankMinimalAppearanceKey.self] = newValue }
    }

    var blankSectionHorizontalPadding: CGFloat {
        get { self[BlankSectionHorizontalPaddingKey.self] }
        set { self[BlankSectionHorizontalPaddingKey.self] = newValue }
    }
}

enum BlankColors {
    // Blank brand palette: charcoal gray, pale steel blue, seafoam green, powder gray, pure white.
    static let charcoal = Color(red: 51 / 255.0, green: 59 / 255.0, blue: 65 / 255.0)
    static let paleSteelBlue = Color(red: 173 / 255.0, green: 191 / 255.0, blue: 201 / 255.0)
    static let seafoam = Color(red: 118 / 255.0, green: 201 / 255.0, blue: 171 / 255.0)
    static let powderGray = Color(red: 228 / 255.0, green: 235 / 255.0, blue: 239 / 255.0)
    static let pureWhite = Color.white

    // Semantic alert color: retained for error/destructive states because the brand palette has no alert equivalent.
    static let red = Color(red: 0.827, green: 0.184, blue: 0.184)
    static let statusGreen = seafoam
    static let redDark = charcoal
    static let green = seafoam
    static let background = powderGray
    static let surface = pureWhite
    static let text = pureWhite
    static let secondaryText = charcoal.opacity(0.86)
    static let warmBackground = powderGray
    static let warmSurface = pureWhite.opacity(0.92)
    static let ink = charcoal
    static let mutedInk = secondaryText
    static let line = charcoal.opacity(0.14)
    static let airBlue = paleSteelBlue
    static let airMist = powderGray
    static let airStone = powderGray.opacity(0.92)
    static let glassTint = paleSteelBlue
    static let premiumBlue = seafoam
    static let controlSurface = pureWhite.opacity(0.16)
    static let activeControlSurface = pureWhite.opacity(0.09)
    static let minimalBackground = pureWhite
    static let minimalInk = charcoal
    static let minimalSecondary = secondaryText
    static let minimalFaded = charcoal.opacity(0.42)
    static let minimalCardSurface = Color(uiColor: .secondarySystemBackground)
    static let darkCardSurface = pureWhite.opacity(0.10)
    static let newLookDarkBackground = charcoal
    static let newLookDarkSecondary = pureWhite.opacity(0.55)
    static let homeLightBackground = pureWhite
    static let homeLightInk = charcoal
    static let homeLightOption = charcoal.opacity(0.78)
    static let homeLightSecondary = charcoal.opacity(0.68)
    static let homeDarkBackground = charcoal
    static let homeDarkSecondary = pureWhite.opacity(0.74)
    static let newLookRule = charcoal.opacity(0.16)
    static let glassBorder = LinearGradient(
        colors: [
            pureWhite.opacity(0.48),
            paleSteelBlue.opacity(0.24),
            paleSteelBlue.opacity(0.06),
            Color.clear
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
}

extension Font {
    static func blankInter(size: CGFloat, weight: Weight = .regular, relativeTo textStyle: TextStyle = .body) -> Font {
        .custom("Inter", size: size, relativeTo: textStyle).weight(weight)
    }

    static var blankBody: Font {
        .blankInter(size: 16)
    }
}

struct BlankPrimaryButtonStyle: ButtonStyle {
    var light: Bool = false
    @Environment(\.blankMinimalAppearance) private var minimalAppearance
    @Environment(\.colorScheme) private var colorScheme

    func makeBody(configuration: Configuration) -> some View {
        let minimalTextColor = light ? BlankColors.pureWhite :
            (colorScheme == .dark ? BlankColors.charcoal : BlankColors.pureWhite)
        let minimalSurfaceColor = light ? BlankColors.minimalInk :
            (colorScheme == .dark ? BlankColors.pureWhite : BlankColors.charcoal)

        configuration.label
            .font(.blankInter(size: 16, weight: .medium, relativeTo: .headline))
            .frame(maxWidth: 342)
            .frame(height: minimalAppearance ? 52 : 50)
            .foregroundStyle(minimalAppearance ? minimalTextColor : (light ? BlankColors.ink : BlankColors.pureWhite))
            .background {
                ZStack {
                    if minimalAppearance {
                        Rectangle()
                            .fill(light ? minimalSurfaceColor.opacity(configuration.isPressed ? 0.78 : 1) : minimalSurfaceColor.opacity(configuration.isPressed ? 0.72 : 0.94))
                    } else {
                        Capsule().fill(.ultraThinMaterial)
                        Capsule().fill(light ? BlankColors.pureWhite.opacity(0.56) : BlankColors.glassTint.opacity(configuration.isPressed ? 0.58 : 0.48))
                        BlankGlassCornerHighlight(width: 92, height: 34, xOffset: -122, yOffset: -17)
                            .clipShape(Capsule())
                        Capsule().stroke(BlankColors.glassBorder, lineWidth: 1)
                    }
                }
                .allowsHitTesting(false)
            }
            .shadow(color: minimalAppearance ? .clear : BlankColors.charcoal.opacity(configuration.isPressed ? 0.02 : 0.05), radius: 5, y: 3)
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
    }
}

struct BlankAtmosphericBackground: View {
    var dimmed: Bool = false
    @Environment(\.blankMinimalAppearance) private var minimalAppearance

    var body: some View {
        ZStack {
            if minimalAppearance {
                (dimmed ? BlankColors.newLookDarkBackground : BlankColors.minimalBackground)
            } else {
                Image(dimmed ? "blank_home_background_active" : "blank_home_background_idle")
                    .resizable()
                    .scaledToFill()
                    .opacity(dimmed ? 1 : 0.94)

                LinearGradient(
                    colors: [
                        BlankColors.pureWhite.opacity(dimmed ? 0.02 : 0.14),
                        BlankColors.airMist.opacity(dimmed ? 0.10 : 0.20),
                        BlankColors.airStone.opacity(dimmed ? 0.06 : 0.16)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            }
        }
        .ignoresSafeArea()
    }
}

struct BlankGlassCornerHighlight: View {
    let width: CGFloat
    let height: CGFloat
    let xOffset: CGFloat
    let yOffset: CGFloat

    var body: some View {
        Ellipse()
            .fill(
                RadialGradient(
                    colors: [
                        BlankColors.pureWhite.opacity(0.24),
                        BlankColors.pureWhite.opacity(0.08),
                        BlankColors.pureWhite.opacity(0.00)
                    ],
                    center: .center,
                    startRadius: 0,
                    endRadius: max(width, height) / 2
                )
            )
            .frame(width: width, height: height)
            .offset(x: xOffset, y: yOffset)
    }
}

private struct BlankGlassCardModifier: ViewModifier {
    let cornerRadius: CGFloat
    let tintOpacity: Double
    @Environment(\.blankMinimalAppearance) private var minimalAppearance
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .background {
                if minimalAppearance {
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .fill(colorScheme == .dark ? BlankColors.darkCardSurface : BlankColors.minimalCardSurface)
                } else {
                    ZStack {
                        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                            .fill(.ultraThinMaterial)
                        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                            .fill(BlankColors.pureWhite.opacity(tintOpacity))
                        BlankGlassCornerHighlight(width: 104, height: 40, xOffset: -112, yOffset: -22)
                            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
                    }
                }
            }
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(minimalAppearance ? Color.clear : BlankColors.pureWhite.opacity(0.20), lineWidth: minimalAppearance ? 0 : 1)
            )
            .shadow(color: minimalAppearance ? .clear : BlankColors.ink.opacity(0.045), radius: 14, x: 0, y: 8)
    }
}

private struct BlankControlSurfaceModifier: ViewModifier {
    let cornerRadius: CGFloat
    let tintOpacity: Double
    let emphasized: Bool
    @Environment(\.blankMinimalAppearance) private var minimalAppearance
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .background {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(minimalAppearance ? (colorScheme == .dark ? BlankColors.darkCardSurface : BlankColors.minimalCardSurface) : BlankColors.pureWhite.opacity(tintOpacity))
            }
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(
                        minimalAppearance ? Color.clear : BlankColors.pureWhite.opacity(emphasized ? 0.34 : 0.18),
                        lineWidth: minimalAppearance ? 0 : 0.8
                    )
            }
            .shadow(
                color: minimalAppearance ? .clear : BlankColors.ink.opacity(emphasized ? 0.05 : 0.025),
                radius: emphasized ? 18 : 10,
                x: 0,
                y: emphasized ? 10 : 5
            )
    }
}

extension View {
    func blankGlassCard(cornerRadius: CGFloat = 22, tintOpacity: Double = 0.34) -> some View {
        modifier(BlankGlassCardModifier(cornerRadius: cornerRadius, tintOpacity: tintOpacity))
    }

    func blankControlSurface(cornerRadius: CGFloat = 18, tintOpacity: Double = 0.12, emphasized: Bool = false) -> some View {
        modifier(BlankControlSurfaceModifier(cornerRadius: cornerRadius, tintOpacity: tintOpacity, emphasized: emphasized))
    }
}

struct TopSheetHeader: View {
    @Environment(\.blankMinimalAppearance) private var minimalAppearance
    let title: String
    let subtitle: String
    var titleColor: Color = BlankColors.ink
    var subtitleColor: Color = BlankColors.mutedInk

    var body: some View {
        VStack(alignment: minimalAppearance ? .leading : .center, spacing: minimalAppearance ? 5 : 10) {
            Text(minimalAppearance ? title.lowercased() : title)
                .font(.blankInter(
                    size: minimalAppearance ? 40 : 34,
                    weight: minimalAppearance ? .bold : .medium,
                    relativeTo: .largeTitle
                ))
                .foregroundStyle(titleColor)
                .tracking(minimalAppearance ? -0.6 : 0)
                .multilineTextAlignment(minimalAppearance ? .leading : .center)
                .lineLimit(1)
                .minimumScaleFactor(0.86)

            Text(minimalAppearance ? subtitle.lowercased() : subtitle)
                .font(minimalAppearance ? .blankInter(size: 13, weight: .medium, relativeTo: .caption) : .body)
                .foregroundStyle(subtitleColor)
                .multilineTextAlignment(minimalAppearance ? .leading : .center)
                .lineSpacing(minimalAppearance ? 0 : 2)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 330)
        }
        .frame(maxWidth: .infinity, alignment: minimalAppearance ? .leading : .center)
    }
}

struct TopSheetPrimaryButtonLabel: View {
    @Environment(\.blankMinimalAppearance) private var minimalAppearance
    let title: String

    var body: some View {
        Text(title)
            .font(.blankInter(size: 16, weight: .medium, relativeTo: .headline))
            .foregroundStyle(minimalAppearance ? BlankColors.minimalInk : BlankColors.ink)
            .padding(.horizontal, 26)
            .frame(height: minimalAppearance ? 52 : 46)
            .background {
                ZStack {
                    if minimalAppearance {
                        Rectangle().fill(BlankColors.minimalInk.opacity(0.08))
                    } else {
                        Capsule().fill(.ultraThinMaterial)
                        Capsule().fill(BlankColors.pureWhite.opacity(0.34))
                        BlankGlassCornerHighlight(width: 74, height: 28, xOffset: -44, yOffset: -15)
                            .clipShape(Capsule())
                    }
                }
                .allowsHitTesting(false)
            }
            .overlay {
                if !minimalAppearance {
                    Capsule().stroke(BlankColors.glassBorder, lineWidth: 1)
                }
            }
            .shadow(color: minimalAppearance ? .clear : BlankColors.ink.opacity(0.045), radius: 12, x: 0, y: 7)
    }
}
