import AppKit
import CoreText
import SwiftUI

// Render the production SwiftUI material/button, with a fixed countdown fixture.
@main struct WidgetPreviewRenderer {
    @MainActor static func main() throws {
        let output = URL(fileURLWithPath: CommandLine.arguments[3])
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        CTFontManagerRegisterFontsForURL(URL(fileURLWithPath: CommandLine.arguments[2]) as CFURL, .process, nil)
        for state in ["idle", "active", "cooldown", "hard"] {
            let active = state != "idle"
            let now = Date()
            let view = ZStack(alignment: .bottomTrailing) {
                BlankWidgetAtmosphere(active: active)
                BlankWidgetButtonFace(active: active, hardProtection: state == "hard",
                    cooldownUntil: state == "cooldown" ? now.addingTimeInterval(42) : nil, date: now)
                    .frame(width: 158 * 0.4, height: 158 * 0.4).padding(158 * 0.09)
            }.frame(width: 158, height: 158).clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
            let renderer = ImageRenderer(content: view); renderer.scale = 3
            guard let image = renderer.nsImage, let tiff = image.tiffRepresentation,
                  let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else {
                fatalError("Could not render \(state)")
            }
            try png.write(to: output.appendingPathComponent("widget-\(state).png"))
        }
    }
}
