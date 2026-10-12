import SwiftUI

struct BlankWidgetButtonFace: View {
    let active: Bool
    let hardProtection: Bool
    let cooldownUntil: Date?
    let date: Date
    var accessory = false
    private let ivory = Color(red: 1, green: 254 / 255, blue: 245 / 255)
    var body: some View {
        ZStack {
            if !accessory {
                Circle().fill(LinearGradient(colors: [Color.black.opacity(0.96), Color(white: 0.30)], startPoint: .top, endPoint: .bottom))
                    .overlay(Circle().stroke(LinearGradient(colors: [.black.opacity(0.90), ivory.opacity(0.45)], startPoint: .top, endPoint: .bottom), lineWidth: 1.5))
            }
            if let deadline = cooldownUntil {
                Text(timerInterval: date...max(date, deadline), countsDown: true)
                    .font(.custom("NeueMontreal-Regular", size: !accessory ? 16 : 13))
                    .monospacedDigit().lineLimit(1).minimumScaleFactor(0.7).padding(5)
            } else {
                Image(systemName: active && !hardProtection ? "lock.open" : "lock")
                    .font(.system(size: !accessory ? 24 : 18, weight: .regular))
            }
        }.foregroundStyle(ivory).contentShape(Circle())
    }
}

struct BlankWidgetAtmosphere: View {
    let active: Bool
    var body: some View {
        GeometryReader { geometry in
            Image("MinimalAtmosphere").resizable().scaledToFill()
                .frame(width: geometry.size.width, height: geometry.size.height).clipped()
                .overlay(Color(red: 0.02, green: 0.12, blue: 0.10).opacity(active ? 0.45 : 0))
        }
    }
}

