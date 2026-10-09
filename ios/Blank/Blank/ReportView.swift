import SwiftUI

struct ReportView: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @Environment(\.blankSectionHorizontalPadding) private var sectionHorizontalPadding
    @StateObject private var healthKitStore = HealthKitStore.shared
    @State private var showContext = false
    var usesMainBackground = false
    var onClose: (() -> Void)? = nil

    private var headerPrimary: Color { sessionStore.isBlankActive ? BlankColors.pureWhite : BlankColors.charcoal }
    private var headerSecondary: Color { sessionStore.isBlankActive ? BlankColors.pureWhite.opacity(0.72) : BlankColors.mutedInk }
    private var canShowRest: Bool {
        #if DEBUG && targetEnvironment(simulator)
        if PostOnboardingPreviewScene.enabled && AssistantAppPreview.scenario != "product-basic-home" { return true }
        #endif
        return healthKitStore.sleepDataAvailable
    }
    private var content: some View {
        VStack(alignment: .leading, spacing: 12) {
            Group {
                if let onClose {
                    SectionHeader(title: "progress",
                        subtitle: "Understand how your rest changes.\nYour sleep, body and habits in context.",
                        action: { if showContext { showContext = false } else { onClose() } }, titleColor: headerPrimary, subtitleColor: headerSecondary)
                        .padding(.bottom, 12)
                } else {
                    TopSheetHeader(title: "progress",
                        subtitle: "Understand how your rest changes.\nYour sleep, body and habits in context.",
                        titleColor: headerPrimary, subtitleColor: headerSecondary)
                        .padding(.top, 16).padding(.bottom, 24)
                }
            }
            if canShowRest {
                RestProgressContent(showContext: $showContext)
            } else {
                Text("Personalised rest statistics require measured sleep records. Blocking and unlocking remain available.")
                    .font(.blankBody)
                    .accessibilityIdentifier("progress-sleep-required")
                Button("Connect Apple Health") { healthKitStore.requestAccess() }
                    .buttonStyle(.plain).padding(.top, 16)
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    var body: some View {
        Group {
            if usesMainBackground {
                GeometryReader { proxy in
                    let viewportWidth = proxy.size.width
                    let contentWidth = max(0, viewportWidth - (sectionHorizontalPadding * 2))
                    ScrollView(.vertical, showsIndicators: false) {
                        HStack(alignment: .top, spacing: 0) {
                            Spacer(minLength: 0)
                            content.padding(.bottom, 34).frame(width: contentWidth, alignment: .top)
                            Spacer(minLength: 0)
                        }.frame(width: viewportWidth, alignment: .center)
                    }.id(showContext).frame(width: viewportWidth, height: proxy.size.height, alignment: .top)
                }
            } else {
                List {
                    content.padding(.horizontal, 22).padding(.top, 24).padding(.bottom, 34)
                        .listRowInsets(EdgeInsets()).listRowSeparator(.hidden).listRowBackground(Color.clear)
                }.id(showContext).listStyle(.plain).scrollContentBackground(.hidden)
            }
        }
        .background {
            (sessionStore.isBlankActive ? BlankColors.newLookDarkBackground : BlankColors.minimalBackground)
                .ignoresSafeArea()
        }
        .foregroundStyle(BlankColors.cardInk)
        .preferredColorScheme(sessionStore.isBlankActive ? .dark : .light)
    }
}

extension View {
    func reportFlatCard() -> some View { modifier(ReportFlatCardModifier()) }
}

private struct ReportFlatCardModifier: ViewModifier {
    func body(content: Content) -> some View {
        content.background {
            RoundedRectangle(cornerRadius: 16, style: .continuous).fill(BlankColors.cardSurface)
        }
    }
}
