import Foundation

@main
struct HomeOrbTests {
    static func main() {
        let cases: [(Double, Double, Bool, HomeOrbAction?)] = [
            (0, -48, false, .menu), (-48, 0, false, .block),
            (0, 48, true, .closeMenu), (0, 48, false, nil),
            (48, 0, false, nil), (0, 0, false, nil),
            (-47, 0, false, nil), (0, -47, false, nil),
            (-80, -80, false, nil), (-60, -48, false, nil),
            (-48, -60, false, nil), (-61, -48, false, .block),
            (-48, -61, false, .menu), (.infinity, 0, false, nil),
            (0, .nan, true, nil), (-100, 20, true, .block)
        ]
        for (x, y, menu, expected) in cases {
            precondition(HomeOrbGesturePolicy.swipe(x: x, y: y, menuOpen: menu) == expected,
                         "Unexpected action for displacement \(x), \(y), menu \(menu)")
        }
        precondition(HomeOrbGesturePolicy.holdDuration == 2)
        precondition(HomeOrbGesturePolicy.movementTolerance < HomeOrbGesturePolicy.swipeDistance)
        print("PASS home orb: 16 directional cases, two-second hold, separated movement thresholds")
    }
}
