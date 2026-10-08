import XCTest

final class MinimalHomeUITests: XCTestCase {
    func testProgressShowsRestContextAndPreservesNavigation() {
        let app = launch("product-shell-progress")
        XCTAssertTrue(app.staticTexts["Progress"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["You feel more rested"].exists)
        XCTAssertTrue(app.buttons["progress-metric"].exists)
        XCTAssertFalse(app.staticTexts["risk signal"].exists)
        app.buttons["progress-metric"].tap()
        app.buttons["Sleep duration"].tap()
        XCTAssertTrue(app.staticTexts["main sleep episode · hours"].exists)
        app.swipeUp()
        app.swipeUp()
        let context = app.buttons["progress-all-context"]
        XCTAssertTrue(context.waitForExistence(timeout: 5))
        context.tap()
        XCTAssertTrue(app.staticTexts["All health context"].waitForExistence(timeout: 5))
        app.buttons["back"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["You feel more rested"].waitForExistence(timeout: 5))
        app.buttons["home-tab-chat"].tap()
        XCTAssertTrue(app.buttons["home-voice"].waitForExistence(timeout: 5))
    }

    func testControlGroupsKeepSettingsReachableAndRootClear() {
        let app = launch("product-control")
        func capture(_ name: String) {
            let attachment = XCTAttachment(screenshot: app.screenshot())
            attachment.name = name
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        func reveal(_ button: XCUIElement) {
            for _ in 0..<4 {
                if button.isHittable { return }
                app.scrollViews.firstMatch.swipeUp()
            }
        }
        XCTAssertTrue(app.buttons["protection"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["schedule"].exists)
        XCTAssertFalse(app.buttons["automatic protection"].exists)
        XCTAssertFalse(app.buttons["conversation history"].exists)
        XCTAssertFalse(app.buttons["privacy policy"].exists)
        capture("control-root")
        app.buttons["protection"].tap()
        XCTAssertTrue(app.buttons["schedule"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["automatic protection"].exists)
        capture("control-protection")
        app.buttons["schedule"].tap()
        XCTAssertTrue(app.buttons["back"].waitForExistence(timeout: 5))
        app.buttons["back"].tap()
        XCTAssertTrue(app.buttons["protection"].waitForExistence(timeout: 5))
        reveal(app.buttons["Data & Permissions"])
        app.buttons["Data & Permissions"].tap()
        XCTAssertTrue(app.buttons["conversation history"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["health"].exists)
        XCTAssertTrue(app.buttons["screen time"].exists)
        XCTAssertFalse(app.buttons["synthetic sleep"].exists, "Guest cannot enable QA sleep")
        capture("control-data")
        app.buttons["back"].tap()
        reveal(app.buttons["account"])
        app.buttons["account"].tap()
        XCTAssertTrue(app.buttons["manage account"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["privacy policy"].exists)
        XCTAssertTrue(app.buttons["terms of service"].exists)
        capture("control-account")
        app.buttons["back"].tap()
        XCTAssertTrue(app.buttons["protection"].waitForExistence(timeout: 5))
    }

    func testSleepSourceKeepsProductionScreensAndUnmetAccountGate() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["BLANK_UI_SCENARIO"] = "product-onboarding-device-empty"
        app.launch()
        XCTAssertTrue(app.staticTexts["onboarding-sleep-empty"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["onboarding-synthetic-demo"].exists, "Anonymous users cannot enable account-scoped sleep")
        XCTAssertFalse(app.staticTexts["synthetic-demo-banner"].exists)
        app.terminate()
        let home = launch()
        home.buttons["home-tab-control"].tap()
        XCTAssertTrue(home.buttons["protection"].waitForExistence(timeout: 5))
        XCTAssertTrue(home.buttons["distractions"].exists)
        home.buttons["home-tab-progress"].tap()
        XCTAssertTrue(home.staticTexts["Progress"].waitForExistence(timeout: 5))
        XCTAssertFalse(home.staticTexts["synthetic-demo-banner"].exists)
        home.buttons["home-tab-chat"].tap()
        XCTAssertTrue(home.buttons["home-voice"].waitForExistence(timeout: 5))
        XCTAssertFalse(home.buttons["Show my sample sleep"].exists)
    }

    private func launch(_ scenario: String = "product-home", language: String = "en") -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["BLANK_UI_SCENARIO"] = scenario
        app.launchArguments = ["-AppleLanguages", "(\(language))", "-AppleLocale", language == "es" ? "es_ES" : "en_US"]
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
        XCTAssertTrue(app.buttons["protection"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["notifications"].exists)
        XCTAssertTrue(app.buttons["distractions"].exists)
        app.buttons["distractions"].tap()
        XCTAssertTrue(app.buttons["back"].waitForExistence(timeout: 5))
        app.buttons["back"].tap()
        XCTAssertTrue(app.buttons["protection"].waitForExistence(timeout: 5))
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
        let reply = app.scrollViews.firstMatch
        XCTAssertTrue(reply.exists)
        for _ in 0..<10 { reply.swipeUp() }
        let response = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "End of your evening plan.")).firstMatch
        XCTAssertTrue(response.exists)
        XCTAssertLessThanOrEqual(response.frame.maxY, voice.frame.minY - 20)
        XCTAssertEqual(voice.frame, original)
        XCTAssertTrue(app.buttons["home-tab-control"].isHittable)
        XCTAssertGreaterThanOrEqual(voice.frame.width, 44)
        XCTAssertGreaterThanOrEqual(voice.frame.height, 44)
    }

    func testVoiceResponseKeepsOutputClean() {
        let app = launch("product-home-response")
        XCTAssertFalse(app.buttons["voice-replies-toggle"].exists)
        XCTAssertFalse(app.buttons["reply-voice"].exists)
        XCTAssertFalse(app.staticTexts["AI-generated voice"].exists)
        XCTAssertFalse(app.staticTexts["Listen"].exists)
        XCTAssertTrue(app.buttons["home-voice"].isHittable)
        XCTAssertTrue(app.buttons["home-tab-control"].isHittable)
    }

    func testEdgeSwipesNavigateNeighboursAndIgnoreCentreAndVerticalDrags() {
        let app = launch()
        func drag(_ x: CGFloat, _ y: CGFloat, _ endX: CGFloat, _ endY: CGFloat) {
            app.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y))
                .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: endX, dy: endY)))
        }
        drag(0.02, 0.5, 0.65, 0.5)
        XCTAssertTrue(app.buttons["protection"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["home-tab-control"].isSelected)
        drag(0.98, 0.5, 0.35, 0.5)
        XCTAssertTrue(app.buttons["home-voice"].waitForExistence(timeout: 5))
        drag(0.98, 0.5, 0.35, 0.5)
        XCTAssertTrue(app.staticTexts["Progress"].waitForExistence(timeout: 5))
        drag(0.02, 0.5, 0.65, 0.5)
        XCTAssertTrue(app.buttons["home-voice"].waitForExistence(timeout: 5))
        drag(0.5, 0.5, 0.85, 0.5)
        XCTAssertTrue(app.buttons["home-tab-chat"].isSelected)
        drag(0.02, 0.7, 0.02, 0.3)
        XCTAssertTrue(app.buttons["home-tab-chat"].isSelected)
    }

    func testControlFormsKeepNativeEditingAndDismissal() {
        let app = launch()
        app.buttons["home-tab-control"].tap()
        app.buttons["protection"].tap()
        app.buttons["automatic protection"].tap()
        XCTAssertTrue(app.switches["Allow automatic protection"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.datePickers.firstMatch.exists)
        app.buttons["Done"].tap()
        app.buttons["back"].tap()
        let notices = app.buttons["notifications"]
        if !notices.isHittable { app.scrollViews.firstMatch.swipeUp() }
        notices.tap()
        XCTAssertTrue(app.switches["Receive notifications"].waitForExistence(timeout: 5))
        app.buttons["Done"].tap()
        app.buttons["home-tab-progress"].tap()
        let progressMetric = app.buttons["progress-metric"]
        XCTAssertTrue(progressMetric.waitForExistence(timeout: 5))
        XCTAssertGreaterThanOrEqual(progressMetric.frame.width, 44)
        XCTAssertGreaterThanOrEqual(progressMetric.frame.height, 44)
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

    func testEmptySleepKeepsRecoveryInPreparation() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["BLANK_UI_SCENARIO"] = "product-onboarding-device-empty"
        app.launchArguments = ["-AppleLanguages", "(es)", "-AppleLocale", "es_ES"]
        app.launch()
        XCTAssertTrue(app.staticTexts["onboarding-sleep-empty"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["home-tab-chat"].exists)
        XCTAssertFalse(app.buttons["Choose apps"].exists)
        XCTAssertFalse(app.buttons["Enable notifications"].exists)
        for title in ["Review access", "Set up sleep tracking", "Check again"] {
            let button = app.buttons[title]
            for _ in 0..<6 { if button.isHittable { break }; app.scrollViews.firstMatch.swipeUp() }
            XCTAssertTrue(button.isHittable, title)
        }
    }

    func testFirstConversationOffersAppSelection() {
        let app = launch("product-home-first-use", language: "es")
        XCTAssertTrue(app.buttons["first-use-choose-apps"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons["first-use-choose-apps"].label, "Choose apps")
        XCTAssertFalse(app.buttons["first-use-notifications"].exists)
        XCTAssertTrue(app.buttons["home-voice"].isHittable)
    }

    func testFirstConversationNotificationsCanBeDeferred() {
        let app = launch("product-home-first-use-notifications", language: "es")
        XCTAssertTrue(app.buttons["first-use-notifications"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["first-use-choose-apps"].exists)
        app.buttons["Not now"].tap()
        XCTAssertFalse(app.buttons["first-use-notifications"].exists)
        XCTAssertTrue(app.buttons["home-voice"].isHittable)
    }

    func testSimulatorCanOpenHomeWithoutHealthFromOnboarding() {
        for scenario in ["product-onboarding-account", "product-onboarding-device-empty"] {
            let app = XCUIApplication()
            app.launchEnvironment["BLANK_UI_SCENARIO"] = scenario
            app.launchArguments = ["-AppleLanguages", "(es)", "-AppleLocale", "es_ES"]
            app.launch()
            let home = app.buttons["Preview Home"]
            XCTAssertTrue(home.waitForExistence(timeout: 10))
            home.tap()
            XCTAssertTrue(app.buttons["home-tab-chat"].waitForExistence(timeout: 10))
            XCTAssertTrue(app.buttons["home-voice"].exists)
            XCTAssertFalse(app.buttons["Connect Apple Health"].exists)
            app.terminate()
        }
    }

    func testLargestTextKeepsOnboardingActionsReachable() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["BLANK_UI_SCENARIO"] = "product-onboarding-account"
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US",
                               "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        let apple = app.buttons["Continue with Apple"]
        XCTAssertTrue(apple.waitForExistence(timeout: 10))
        for _ in 0..<8 {
            if apple.isHittable { break }
            app.scrollViews.firstMatch.swipeUp()
        }
        XCTAssertTrue(apple.isHittable)
        app.buttons["Preview device setup"].tap()
        for title in ["Allow Screen Time", "Connect Apple Health"] {
            let action = app.buttons[title]
            XCTAssertTrue(action.waitForExistence(timeout: 5))
            for _ in 0..<8 {
                if action.isHittable { break }
                app.scrollViews.firstMatch.swipeUp()
            }
            XCTAssertTrue(action.isHittable, title)
            XCTAssertGreaterThanOrEqual(action.frame.height, 44)
        }
        XCTAssertTrue(app.buttons["Preview account sign-in"].isHittable)
    }
}
