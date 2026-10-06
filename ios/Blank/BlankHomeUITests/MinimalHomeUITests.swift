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

    func testControlFormsKeepNativeEditingAndDismissal() {
        let app = launch()
        app.buttons["home-tab-control"].tap()
        app.buttons["automatic protection"].tap()
        XCTAssertTrue(app.switches["Allow automatic protection"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.datePickers.firstMatch.exists)
        app.buttons["Done"].tap()
        let notices = app.buttons["notifications"]
        if !notices.isHittable { app.scrollViews.firstMatch.swipeUp() }
        notices.tap()
        XCTAssertTrue(app.switches["Receive notifications"].waitForExistence(timeout: 5))
        app.buttons["Done"].tap()
        app.buttons["home-tab-progress"].tap()
        let protect = app.buttons["progress-protect"]
        XCTAssertTrue(protect.waitForExistence(timeout: 5))
        XCTAssertGreaterThanOrEqual(protect.frame.width, 44)
        XCTAssertGreaterThanOrEqual(protect.frame.height, 44)
        app.scrollViews.firstMatch.swipeUp()
        XCTAssertTrue(app.buttons["home-tab-control"].isHittable)
        app.buttons["home-tab-chat"].tap()
        XCTAssertTrue(app.buttons["home-voice"].isHittable)
    }

    func testLargestTextKeepsPreferencesSaveReachable() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["BLANK_UI_SCENARIO"] = "product-automatic"
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        XCTAssertTrue(app.switches["Allow automatic protection"].waitForExistence(timeout: 10))
        let save = app.buttons["Save preferences"]
        for _ in 0..<8 {
            if save.isHittable { break }
            app.collectionViews.firstMatch.swipeUp()
        }
        XCTAssertTrue(save.isHittable)
        XCTAssertTrue(app.buttons["Done"].isHittable)
    }

    func testEmergencyConfirmationKeepsNativeTargetAndCancel() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["BLANK_UI_SCENARIO"] = "product-emergency-active"
        app.launch()
        XCTAssertTrue(app.buttons["spend emergency"].waitForExistence(timeout: 10))
        app.buttons["spend emergency"].tap()
        let confirm = app.buttons["emergency-confirm-unlock"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        XCTAssertTrue(confirm.isHittable)
        XCTAssertGreaterThanOrEqual(confirm.frame.width, 44)
        XCTAssertGreaterThanOrEqual(confirm.frame.height, 44)
        app.buttons["keep blocking"].tap()
        XCTAssertTrue(app.buttons["spend emergency"].isHittable)
        XCTAssertFalse(confirm.exists)
    }
}
