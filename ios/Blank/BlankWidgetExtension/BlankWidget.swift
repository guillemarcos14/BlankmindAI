import AppIntents
import FamilyControls
import ManagedSettings
import SwiftUI
import WidgetKit

private enum BlankWidgetPalette {
    static let charcoal = Color(red: 48 / 255.0, green: 49 / 255.0, blue: 42 / 255.0)
    static let powderGray = Color(red: 248 / 255.0, green: 249 / 255.0, blue: 244 / 255.0)
    static let pureWhite = Color.white
}

struct StartQuickBlockIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Blank"
    static var description = IntentDescription("Starts a quick block with your current Blankmind configuration.")

    func perform() async throws -> some IntentResult {
        let defaults = BlankSharedState.defaults
        guard BlankSharedState.startQuickBlock(defaults: defaults) else {
            return .result()
        }

        if let selection = BlankSharedState.loadSelection(from: defaults) {
            let store = ManagedSettingsStore()
            store.shield.applications = selection.applicationTokens
            store.shield.applicationCategories = selection.categoryTokens.isEmpty ? nil : .specific(selection.categoryTokens)
            store.shield.webDomains = selection.webDomainTokens
        }

        WidgetCenter.shared.reloadTimelines(ofKind: "BlankQuickBlockWidget")
        return .result()
    }
}

struct BlankWidgetEntry: TimelineEntry {
    let date: Date
    let activeState: BlankSharedState.ActiveState
    let hasConfiguration: Bool
}

struct BlankWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> BlankWidgetEntry {
        BlankWidgetEntry(
            date: Date(),
            activeState: BlankSharedState.ActiveState(
                isActive: false,
                startedAt: nil,
                endsAt: nil
            ),
            hasConfiguration: true
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (BlankWidgetEntry) -> Void) {
        completion(entry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<BlankWidgetEntry>) -> Void) {
        let current = entry()
        let nextRefresh = current.activeState.endsAt ?? (current.activeState.isActive ? Date().addingTimeInterval(60) : Date().addingTimeInterval(15 * 60))
        completion(Timeline(entries: [current], policy: .after(nextRefresh)))
    }

    private func entry(date: Date = Date()) -> BlankWidgetEntry {
        let defaults = BlankSharedState.defaults
        if BlankSharedState.finishExpiredBlock(defaults: defaults, now: date) {
            ManagedSettingsStore().clearAllSettings()
        }
        return BlankWidgetEntry(
            date: date,
            activeState: BlankSharedState.loadActiveState(now: date, defaults: defaults),
            hasConfiguration: BlankSharedState.hasConfiguredBlock(in: defaults)
        )
    }
}

struct BlankWidgetView: View {
    let entry: BlankWidgetEntry
    @Environment(\.widgetFamily) private var widgetFamily
    private var isActive: Bool { entry.activeState.isActive }
    private var titleColor: Color { isActive ? BlankWidgetPalette.pureWhite.opacity(0.96) : BlankWidgetPalette.charcoal }
    private let textColumnInset: CGFloat = 7

    var body: some View {
        ZStack(alignment: .topLeading) {
            actionContent
                .buttonStyle(.plain)
        }
            .blankWidgetBackground(isActive: entry.activeState.isActive, family: widgetFamily)
            .animation(.easeInOut(duration: 0.45), value: isActive)
    }

    @ViewBuilder
    private var actionContent: some View {
        if entry.activeState.isActive {
            Link(destination: URL(string: "blank://open")!) {
                content
            }
        } else if entry.hasConfiguration {
            if #available(iOSApplicationExtension 17.0, *) {
                Button(intent: StartQuickBlockIntent()) {
                    content
                }
            } else {
                Link(destination: URL(string: "blank://configure-block")!) {
                    content
                }
            }
        } else {
            Link(destination: URL(string: "blank://configure-block")!) {
                content
            }
        }
    }

    private var content: some View {
        Group {
            switch widgetFamily {
            case .accessoryInline:
                Text(isActive ? "Blankmind active" : "Start Blank")
            case .accessoryCircular:
                Image(systemName: isActive ? "lock.fill" : "lock.open.fill")
                    .font(.system(size: 18, weight: .semibold))
            case .accessoryRectangular:
                VStack(alignment: .leading, spacing: 2) {
                    Text(isActive ? "Blankmind" : "Start Blank")
                        .font(.headline.weight(.semibold))
                    Text(isActive ? "Protected now" : entry.hasConfiguration ? "Tap to block" : "Choose apps")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            default:
                if isActive {
                    activeContent
                } else {
                    idleContent
                }
            }
        }
        .contentShape(Rectangle())
    }

    private var activeContent: some View {
        widgetTitle
    }

    private var idleContent: some View {
        widgetTitle
    }

    private var widgetTitle: some View {
        Text(title)
            .font(.custom("HelveticaNeue", size: 19.5, relativeTo: .headline).weight(.semibold))
            .foregroundStyle(titleColor)
            .lineLimit(1)
            .minimumScaleFactor(0.72)
            .contentTransition(.opacity)
            .padding(.leading, textColumnInset)
            .padding(.bottom, 7)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
    }

    private var title: String {
        entry.activeState.isActive ? "Blankmind" : "Start Blank"
    }
}

private struct BlankWidgetGlassBackground: View {
    var isActive = false

    var body: some View {
        ZStack {
            baseFill

            LinearGradient(
                colors: [
                    isActive ? BlankWidgetPalette.pureWhite.opacity(0.10) : BlankWidgetPalette.pureWhite.opacity(0.52),
                    isActive ? BlankWidgetPalette.pureWhite.opacity(0.00) : BlankWidgetPalette.pureWhite.opacity(0.08)
                ],
                startPoint: .top,
                endPoint: UnitPoint(x: 0.5, y: 0.48)
            )

            RadialGradient(
                colors: [
                    isActive ? BlankWidgetPalette.pureWhite.opacity(0.06) : BlankWidgetPalette.pureWhite.opacity(0.34),
                    BlankWidgetPalette.pureWhite.opacity(0.00)
                ],
                center: UnitPoint(x: 0.12, y: 0.00),
                startRadius: 6,
                endRadius: 112
            )

            LinearGradient(
                colors: [
                    Color.clear,
                    isActive ? BlankWidgetPalette.charcoal.opacity(0.34) : BlankWidgetPalette.charcoal.opacity(0.018)
                ],
                startPoint: UnitPoint(x: 0.50, y: 0.62),
                endPoint: .bottom
            )

            if isActive {
                Rectangle()
                    .fill(
                        LinearGradient(
                            colors: [
                                BlankWidgetPalette.pureWhite.opacity(0.00),
                                BlankWidgetPalette.pureWhite.opacity(0.045),
                                BlankWidgetPalette.pureWhite.opacity(0.00)
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .rotationEffect(.degrees(-8))
                    .offset(y: -22)
            }

            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(
                    LinearGradient(
                        colors: [
                            isActive ? BlankWidgetPalette.pureWhite.opacity(0.22) : BlankWidgetPalette.pureWhite.opacity(0.88),
                            isActive ? BlankWidgetPalette.pureWhite.opacity(0.07) : BlankWidgetPalette.pureWhite.opacity(0.26),
                            isActive ? BlankWidgetPalette.pureWhite.opacity(0.03) : BlankWidgetPalette.charcoal.opacity(0.045)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
                .padding(0.6)
        }
    }

    private var baseFill: some View {
        Rectangle()
            .fill(
                LinearGradient(
                    colors: isActive ? [
                        BlankWidgetPalette.charcoal,
                        BlankWidgetPalette.charcoal.opacity(0.68)
                    ] : [
                        BlankWidgetPalette.pureWhite,
                        BlankWidgetPalette.powderGray
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
    }
}

private extension View {
    @ViewBuilder
    func blankWidgetBackground(isActive: Bool, family: WidgetFamily) -> some View {
        if family == .accessoryInline || family == .accessoryCircular || family == .accessoryRectangular {
            self
        } else if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(for: .widget) {
                BlankWidgetGlassBackground(isActive: isActive)
            }
        } else {
            background(BlankWidgetGlassBackground(isActive: isActive))
        }
    }
}

struct BlankQuickBlockWidget: Widget {
    let kind = "BlankQuickBlockWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: BlankWidgetProvider()) { entry in
            BlankWidgetView(entry: entry)
        }
        .configurationDisplayName("Blankmind")
        .description("Start a quick block.")
        .supportedFamilies([.systemSmall, .accessoryInline, .accessoryCircular, .accessoryRectangular])
    }
}

@main
struct BlankWidgetBundle: WidgetBundle {
    var body: some Widget {
        BlankQuickBlockWidget()
    }
}
