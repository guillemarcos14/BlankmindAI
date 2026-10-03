import Foundation

enum HomeOrbAction: Equatable {
    case menu, closeMenu, block, chat
}

enum HomeOrbGesturePolicy {
    static let holdDuration: TimeInterval = 2
    static let movementTolerance: Double = 12
    static let swipeDistance: Double = 48

    static func swipe(x: Double, y: Double, menuOpen: Bool) -> HomeOrbAction? {
        guard x.isFinite, y.isFinite else { return nil }
        if -y >= swipeDistance, -y > abs(x) * 1.25 { return .menu }
        if -x >= swipeDistance, -x > abs(y) * 1.25 { return .block }
        if menuOpen, y >= swipeDistance, y > abs(x) * 1.25 { return .closeMenu }
        return nil
    }
}

#if canImport(UIKit) && canImport(SwiftUI)
import SwiftUI
import UIKit

// Native recognizer arbitration: moving cancels the hold; a completed hold
// consumes the touch so lifting or dragging afterwards cannot also block apps.
struct HomeOrbControl: UIViewRepresentable {
    let menuOpen: Bool
    let protectionActive: Bool
    let onAction: (HomeOrbAction) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> OrbView {
        let view = OrbView()
        view.isAccessibilityElement = true
        view.accessibilityTraits = .button
        let hold = UILongPressGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.hold(_:)))
        hold.minimumPressDuration = HomeOrbGesturePolicy.holdDuration
        hold.allowableMovement = CGFloat(HomeOrbGesturePolicy.movementTolerance)
        let pan = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.pan(_:)))
        pan.maximumNumberOfTouches = 1
        pan.require(toFail: hold)
        view.addGestureRecognizer(hold)
        view.addGestureRecognizer(pan)
        view.activate = { context.coordinator.perform(.menu) }
        return view
    }

    func updateUIView(_ view: OrbView, context: Context) {
        context.coordinator.parent = self
        view.accessibilityLabel = menuOpen ? "Close menu" : "Blankmind controls"
        view.accessibilityValue = protectionActive ? "Protection active" : "Protection inactive"
        view.accessibilityHint = "Swipe up for menu, left to block distractions, or hold for two seconds for chat."
        view.activate = { context.coordinator.perform(menuOpen ? .closeMenu : .menu) }
        view.accessibilityCustomActions = [
            UIAccessibilityCustomAction(name: menuOpen ? "Close menu" : "Open menu", target: context.coordinator, selector: #selector(Coordinator.accessibleMenu)),
            UIAccessibilityCustomAction(name: "Block distractions", target: context.coordinator, selector: #selector(Coordinator.accessibleBlock)),
            UIAccessibilityCustomAction(name: "Open chat", target: context.coordinator, selector: #selector(Coordinator.accessibleChat))
        ]
    }

    final class OrbView: UIView {
        var activate: (() -> Void)?
        override init(frame: CGRect) {
            super.init(frame: frame)
            backgroundColor = UIColor(red: 41 / 255.0, green: 41 / 255.0, blue: 41 / 255.0, alpha: 1)
        }
        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
        override func layoutSubviews() { super.layoutSubviews(); layer.cornerRadius = bounds.width / 2 }
        override func accessibilityActivate() -> Bool { activate?(); return true }
    }

    final class Coordinator: NSObject {
        var parent: HomeOrbControl
        init(_ parent: HomeOrbControl) { self.parent = parent }
        func perform(_ action: HomeOrbAction) {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            parent.onAction(action)
        }
        @objc func hold(_ recognizer: UILongPressGestureRecognizer) {
            if recognizer.state == .began { perform(.chat) }
        }
        @objc func pan(_ recognizer: UIPanGestureRecognizer) {
            guard let view = recognizer.view else { return }
            let translation = recognizer.translation(in: view.superview)
            switch recognizer.state {
            case .began, .changed:
                if !UIAccessibility.isReduceMotionEnabled {
                    view.transform = CGAffineTransform(translationX: max(-120, min(24, translation.x)), y: max(-120, min(80, translation.y)))
                }
            case .ended, .cancelled, .failed:
                UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.3, delay: 0, options: [.curveEaseOut, .beginFromCurrentState]) { view.transform = .identity }
                if recognizer.state == .ended,
                   let action = HomeOrbGesturePolicy.swipe(x: Double(translation.x), y: Double(translation.y), menuOpen: parent.menuOpen) {
                    perform(action)
                }
            default: break
            }
        }
        @objc func accessibleMenu() -> Bool { perform(parent.menuOpen ? .closeMenu : .menu); return true }
        @objc func accessibleBlock() -> Bool { perform(.block); return true }
        @objc func accessibleChat() -> Bool { perform(.chat); return true }
    }
}
#endif
