import AppIntents
import DeviceActivity
import FamilyControls
import ManagedSettings
import SwiftUI
import WidgetKit

private let widgetKind = "BlankQuickBlockWidget"
private let widgetUnlockActivity = DeviceActivityName("BlankWidgetUnlock")

struct StartQuickBlockIntent: AppIntent {
    static var title: LocalizedStringResource = "Toggle Blank protection"
    static var description = IntentDescription("Blocks distractions or requests an unlock after a 60-second cooldown.")

    func perform() async throws -> some IntentResult {
        let defaults = BlankSharedState.defaults
        let store = ManagedSettingsStore()
        if BlankSharedState.finishWidgetUnlockIfDue(defaults: defaults)
            || BlankSharedState.finishExpiredBlock(defaults: defaults) { store.clearAllSettings() }
        guard BlankSharedState.familyControlsApproved else { return .result() }
        if BlankSharedState.loadActiveState(defaults: defaults).isActive {
            let previous = BlankSharedState.widgetUnlockDeadline(defaults: defaults)
            if let deadline = BlankSharedState.requestWidgetUnlock(defaults: defaults) {
                let callback = Date(timeIntervalSince1970: ceil(deadline.timeIntervalSince1970))
                let components: Set<Calendar.Component> = [.calendar, .timeZone, .year, .month, .day, .hour, .minute, .second]
                do {
                    // Release at interval START; the span meets the native 15-minute minimum.
                    try DeviceActivityCenter().startMonitoring(widgetUnlockActivity, during: DeviceActivitySchedule(
                        intervalStart: Calendar.current.dateComponents(components, from: callback),
                        intervalEnd: Calendar.current.dateComponents(components, from: callback.addingTimeInterval(15 * 60)),
                        repeats: false))
                } catch {
                    if previous == nil { BlankSharedState.cancelWidgetUnlock(defaults: defaults) }
                    WidgetCenter.shared.reloadTimelines(ofKind: widgetKind)
                    throw error
                }
            }
        } else if BlankSharedState.startQuickBlock(defaults: defaults),
                  let selection = BlankSharedState.loadSelection(from: defaults) {
            // Existing app-prepared timers must also expire when the app is closed.
            if let end = BlankSharedState.loadActiveState(defaults: defaults).endsAt {
                let minutes = max(1, Int(ceil(end.timeIntervalSinceNow / 60)))
                guard DeviceActivityTimerScheduler.start(protectionId: BlankSharedState.canonicalProtectionId, durationMinutes: minutes) else {
                    defaults.set(Date().timeIntervalSince1970, forKey: BlankSharedState.Keys.blankActiveUntil)
                    BlankSharedState.finishExpiredBlock(defaults: defaults)
                    WidgetCenter.shared.reloadTimelines(ofKind: widgetKind)
                    throw WidgetProtectionError.monitoringUnavailable
                }
            }
            store.shield.applications = selection.applicationTokens
            store.shield.applicationCategories = selection.categoryTokens.isEmpty ? nil : .specific(selection.categoryTokens)
            store.shield.webDomains = selection.webDomainTokens
        }
        WidgetCenter.shared.reloadTimelines(ofKind: widgetKind)
        return .result()
    }
}

private enum WidgetProtectionError: Error { case monitoringUnavailable }

struct BlankWidgetEntry: TimelineEntry {
    let date: Date
    let activeState: BlankSharedState.ActiveState
    let hasConfiguration: Bool
    let hardProtection: Bool
    let cooldownUntil: Date?
}

struct BlankWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> BlankWidgetEntry {
        BlankWidgetEntry(date: Date(), activeState: .init(isActive: false, startedAt: nil, endsAt: nil),
                         hasConfiguration: true, hardProtection: false, cooldownUntil: nil)
    }
    func getSnapshot(in context: Context, completion: @escaping (BlankWidgetEntry) -> Void) { completion(entry()) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<BlankWidgetEntry>) -> Void) {
        let current = entry()
        let deadlines = [current.cooldownUntil, current.activeState.endsAt].compactMap { $0 }.filter { $0 > current.date }
        let refresh = deadlines.min() ?? current.date.addingTimeInterval(current.activeState.isActive ? 60 : 900)
        completion(Timeline(entries: [current], policy: .after(refresh)))
    }
    private func entry(date: Date = Date()) -> BlankWidgetEntry {
        let defaults = BlankSharedState.defaults
        if BlankSharedState.finishWidgetUnlockIfDue(defaults: defaults, now: date)
            || BlankSharedState.finishExpiredBlock(defaults: defaults, now: date) { ManagedSettingsStore().clearAllSettings() }
        let state = BlankSharedState.loadActiveState(now: date, defaults: defaults)
        let reblock = defaults.double(forKey: "blankManualReblockAt")
        let cooldown = BlankSharedState.widgetUnlockDeadline(defaults: defaults)
            ?? (reblock > date.timeIntervalSince1970 ? Date(timeIntervalSince1970: reblock) : nil)
        return BlankWidgetEntry(date: date, activeState: state,
            hasConfiguration: BlankSharedState.hasConfiguredBlock(in: defaults)
                && BlankSharedState.familyControlsApproved,
            hardProtection: defaults.bool(forKey: "blankHardBlankActive"), cooldownUntil: cooldown)
    }
}

struct BlankWidgetView: View {
    let entry: BlankWidgetEntry
    @Environment(\.widgetFamily) private var family
    private let ivory = Color(red: 1, green: 254 / 255, blue: 245 / 255)

    var body: some View {
        Group {
            if family == .systemSmall {
                GeometryReader { geometry in
                    ZStack(alignment: .bottomTrailing) {
                        Color.clear.contentShape(Rectangle()).accessibilityLabel("Open Blank Home")
                        action
                            .frame(width: max(44, geometry.size.width * 0.40), height: max(44, geometry.size.width * 0.40))
                            .padding(geometry.size.width * 0.09)
                    }.frame(maxWidth: .infinity, maxHeight: .infinity)
                }.blankWidgetBackground(active: entry.activeState.isActive)
            } else {
                action
            }
        }.widgetURL(URL(string: "blank://open")!)
    }

    @ViewBuilder private var action: some View {
        if #available(iOSApplicationExtension 17.0, *) {
            if entry.cooldownUntil != nil || entry.hardProtection {
                Button(intent: StartQuickBlockIntent()) { control }
                    .disabled(true).buttonStyle(.plain)
                    .accessibilityLabel(entry.hardProtection ? "Hard protection. Open Home for options." : entry.activeState.isActive ? "Unlock cooldown" : "Restart cooldown")
            } else if entry.hasConfiguration {
                Button(intent: StartQuickBlockIntent()) { control }.buttonStyle(.plain)
                    .accessibilityLabel(entry.activeState.isActive ? "Unlock after 60 seconds" : "Block distractions")
            } else {
                Link(destination: URL(string: "blank://configure-block")!) { control }
                    .accessibilityLabel("Configure distraction protection")
            }
        } else {
            Link(destination: URL(string: "blank://widget-toggle")!) { control }
        }
    }

    private var control: some View {
        BlankWidgetButtonFace(active: entry.activeState.isActive, hardProtection: entry.hardProtection,
                              cooldownUntil: entry.cooldownUntil, date: entry.date, accessory: family != .systemSmall)
    }
}

private extension View {
    @ViewBuilder func blankWidgetBackground(active: Bool) -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            containerBackground(for: .widget) { BlankWidgetAtmosphere(active: active) }
        } else { background(BlankWidgetAtmosphere(active: active)) }
    }
}

struct BlankQuickBlockWidget: Widget {
    let kind = widgetKind
    var body: some WidgetConfiguration {
        blankWidgetConfiguration().contentMarginsDisabled()
    }
}

private func blankWidgetConfiguration() -> some WidgetConfiguration {
        StaticConfiguration(kind: widgetKind, provider: BlankWidgetProvider()) { entry in BlankWidgetView(entry: entry) }
            .configurationDisplayName("Blankmind")
            .description("Block or unlock distractions. Tap the background to open Home.")
            .supportedFamilies([.systemSmall, .accessoryInline, .accessoryCircular, .accessoryRectangular])
}

@main struct BlankWidgetBundle: WidgetBundle {
    var body: some Widget { BlankQuickBlockWidget() }
}
