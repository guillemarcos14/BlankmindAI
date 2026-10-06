import XCTest

final class MinimalHomeUITests: XCTestCase {
    private func launch(_ scenario: String = "product-home") -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["BLANK_UI_SCENARIO"] = scenario
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        XCTAssertTrue(app.buttons["home-tab-chat"].waitForExistence(timeout: 10))
        return app
    }

    func testThreeSectionsKeepAllSettingsAndReturnToChat() {
        let app = launch()
        let tabs = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "home-tab-"))
        XCTAssertEqual(tabs.count, 3)
        for tab in tabs.allElementsBoundByIndex {
            XCTAssertGreaterThanOrEqual(tab.frame.width, 44)
            XCTAssertGreaterThanOrEqual(tab.frame.height, 44)
        }
        XCTAssertTrue(app.buttons["home-tab-chat"].isSelected)
        XCTAssertTrue(app.buttons["home-voice"].exists)
        app.buttons["home-tab-control"].tap()
        XCTAssertTrue(app.buttons["automatic protection"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["notifications"].exists)
        XCTAssertTrue(app.buttons["distractions"].exists)
        app.buttons["distractions"].tap()
        XCTAssertTrue(app.buttons["back"].waitForExistence(timeout: 5))
        app.buttons["back"].tap()
        XCTAssertTrue(app.buttons["automatic protection"].waitForExistence(timeout: 5))
        app.buttons["home-tab-chat"].tap()
        XCTAssertTrue(app.buttons["home-voice"].waitForExistence(timeout: 5))
        app.buttons["home-tab-progress"].tap()
        XCTAssertTrue(app.staticTexts["Progress"].waitForExistence(timeout: 5))
        app.buttons["home-tab-chat"].tap()
        XCTAssertTrue(app.buttons["home-voice"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["home-tab-chat"].isSelected)
    }

    func testLongResponseScrollsWhileVoiceAndTabsStayReachable() {
        let app = launch("product-home-long")
        let voice = app.buttons["home-voice"]
        let original = voice.frame
        app.scrollViews.firstMatch.swipeUp()
        XCTAssertEqual(voice.frame, original)
        XCTAssertTrue(app.buttons["home-tab-control"].isHittable)
        XCTAssertGreaterThanOrEqual(voice.frame.width, 44)
        XCTAssertGreaterThanOrEqual(voice.frame.height, 44)
    }
}
