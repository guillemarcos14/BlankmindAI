import Foundation

@main
struct HomeOrbTests {
    static func main() {
        let cases: [(Double, Double, Bool, HomeOrbAction?)] = [
            (0, -48, false, .menu), (-48, 0, false, .menu),
            (0, 48, true, .closeMenu), (0, 48, false, .menu),
            (48, 0, false, .menu), (0, 0, false, nil),
            (-47, 0, false, nil), (0, -47, false, nil),
            (-80, -80, false, .menu), (-60, -48, false, .menu),
            (-48, -60, false, .menu), (-61, -48, false, .menu),
            (-48, -61, false, .menu), (.infinity, 0, false, nil),
            (0, .nan, true, nil), (-100, 20, true, .closeMenu),
            (34, 34, false, .menu), (33, 33, false, nil)
        ]
        for (x, y, menu, expected) in cases {
            precondition(HomeOrbGesturePolicy.swipe(x: x, y: y, menuOpen: menu) == expected,
                         "Unexpected action for displacement \(x), \(y), menu \(menu)")
        }
        precondition(HomeBlockGesturePolicy.holdDuration == 3)
        precondition(HomeBlockGesturePolicy.movementTolerance < HomeOrbGesturePolicy.swipeDistance)
        print("PASS home orb: 18 directional cases, three-second Home hold, radial activation without blocking")
    }
}
