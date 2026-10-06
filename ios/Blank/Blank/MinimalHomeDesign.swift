import SwiftUI
import UIKit

// The centre phone in the supplied reference is the geometry authority.
// Only its atmospheric material and typeface come from the local Minimal Web.
enum MinimalHomeDesign {
    static let ink = Color(red: 1, green: 254 / 255, blue: 245 / 255)
    static let base = Color(red: 213 / 255, green: 219 / 255, blue: 220 / 255)
    static let voiceInk = Color(red: 73 / 255, green: 84 / 255, blue: 78 / 255)
    static func font(_ size: CGFloat, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom("NeueMontreal-Regular", size: size, relativeTo: style)
    }

    static func panelHeight(_ height: CGFloat, bottomInset: CGFloat) -> CGFloat {
        max(180, height - max(116, max(height * 0.144, bottomInset + 92)))
    }
    static func navigationTop(_ safeTop: CGFloat) -> CGFloat { max(56, safeTop + 12) }
}

enum MinimalHomeTab: CaseIterable, Hashable {
    case control, chat, progress
    var label: String {
        switch self {
        case .control: return "Control"
        case .chat: return "Chat"
        case .progress: return "Progress"
        }
    }
}

struct MinimalHomeNavigation: View {
    let selected: MinimalHomeTab
    let foreground: Color
    let onSelect: (MinimalHomeTab) -> Void

    var body: some View {
        HStack(spacing: 20) {
            ForEach(MinimalHomeTab.allCases, id: \.self) { tab in
                Button { onSelect(tab) } label: {
                    MinimalHomeIcon(tab: tab)
                        .frame(width: 17, height: 17)
                        .frame(width: 44, height: 44)
                        .overlay(alignment: .bottom) {
                            Rectangle()
                                .fill(foreground)
                                .frame(width: 32, height: 1)
                                .opacity(selected == tab ? 1 : 0)
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(foreground)
                .accessibilityLabel(tab.label)
                .accessibilityAddTraits(selected == tab ? [.isSelected] : [])
                .accessibilityIdentifier("home-tab-\(tab.label.lowercased())")
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// Crisp, small vector glyphs traced from the reference: stacked diamonds,
// a five-dot constellation, and three ascending bars. No substitute symbols.
private struct MinimalHomeIcon: View {
    let tab: MinimalHomeTab
    var body: some View {
        GeometryReader { geometry in
            let w = geometry.size.width
            let h = geometry.size.height
            switch tab {
            case .control:
                Path { p in
                    p.move(to: CGPoint(x: w * 0.5, y: h * 0.12))
                    p.addLine(to: CGPoint(x: w * 0.86, y: h * 0.36))
                    p.addLine(to: CGPoint(x: w * 0.5, y: h * 0.60))
                    p.addLine(to: CGPoint(x: w * 0.14, y: h * 0.36))
                    p.closeSubpath()
                    p.move(to: CGPoint(x: w * 0.14, y: h * 0.62))
                    p.addLine(to: CGPoint(x: w * 0.5, y: h * 0.86))
                    p.addLine(to: CGPoint(x: w * 0.86, y: h * 0.62))
                }.stroke(style: StrokeStyle(lineWidth: 0.9, lineCap: .round, lineJoin: .round))
            case .chat:
                Path { p in
                    for point in [CGPoint(x: 0.50, y: 0.18), CGPoint(x: 0.80, y: 0.40),
                                  CGPoint(x: 0.70, y: 0.77), CGPoint(x: 0.29, y: 0.79),
                                  CGPoint(x: 0.16, y: 0.42)] {
                        p.addEllipse(in: CGRect(x: w * point.x - 0.8, y: h * point.y - 0.8, width: 1.6, height: 1.6))
                    }
                }.fill()
            case .progress:
                Path { p in
                    for (x, top) in [(0.24, 0.58), (0.50, 0.36), (0.76, 0.14)] {
                        p.move(to: CGPoint(x: w * x, y: h * 0.86))
                        p.addLine(to: CGPoint(x: w * x, y: h * top))
                    }
                }.stroke(style: StrokeStyle(lineWidth: 0.9, lineCap: .round))
            }
        }
        .accessibilityHidden(true)
    }
}

struct MinimalVoiceGlyph: View {
    var body: some View {
        HStack(spacing: 2.4) {
            ForEach(Array([7.0, 13.0, 19.0, 11.0, 6.0].enumerated()), id: \.offset) { _, height in
                Capsule().frame(width: 1.2, height: height)
            }
        }.accessibilityHidden(true)
    }
}

struct MinimalHomePanelShape: Shape {
    func path(in rect: CGRect) -> Path {
        Path(UIBezierPath(roundedRect: rect, byRoundingCorners: [.bottomLeft, .bottomRight],
                          cornerRadii: CGSize(width: 56, height: 56)).cgPath)
    }
}

// Every destination retains the same atmospheric navigation and quiet lower
// ground. Reading/editing surfaces use solid tonal ink rather than imagery
// behind small text. Only the conversational response is centered.
struct MinimalSectionBackground: View {
    var headerHeight: CGFloat = 132
    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .top) {
                MinimalHomeDesign.base
                BlankColors.canvas
                    .frame(height: max(0, proxy.size.height - 28))
                    .clipShape(MinimalHomePanelShape())
                Image("MinimalAtmosphere")
                    .resizable()
                    .scaledToFill()
                    .frame(width: proxy.size.width, height: headerHeight)
                    .clipped()
                    .overlay(Color.black.opacity(0.28))
                    .clipShape(MinimalHomePanelShape())
                    .accessibilityHidden(true)
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}

struct MinimalSheetStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.blankBody)
            .foregroundStyle(BlankColors.foreground)
            .tint(BlankColors.foreground)
            .scrollContentBackground(.hidden)
            .background(BlankColors.canvas)
            .toolbarBackground(BlankColors.canvas, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
    }
}

extension View {
    func minimalSheetStyle() -> some View { modifier(MinimalSheetStyle()) }
}
