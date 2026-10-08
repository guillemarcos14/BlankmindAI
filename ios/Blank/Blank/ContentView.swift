import Foundation
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @EnvironmentObject private var purchaseStore: StoreKitPurchaseStore
    @EnvironmentObject private var screenTimeBlocker: ScreenTimeBlocker
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var healthKitStore = HealthKitStore.shared
    @AppStorage("blankHealthOnboardingVersion", store: BlankSharedState.defaults) private var healthOnboardingVersion = 0
    @State private var showingOnboardingDemo = false
    @State private var simulatorGuestHome = false
    @State private var accountRevision = 0

    var body: some View {
        #if DEBUG
        #if targetEnvironment(simulator)
        if PostOnboardingPreviewScene.enabled {
            PostOnboardingPreviewScene()
        } else {
            debugContent
        }
        #else
        debugContent
        #endif
        #else
        productContent
        #endif
    }

    #if DEBUG
    @ViewBuilder
    private var debugContent: some View {
        if AssistantAppPreview.enabled {
            AssistantAppView { _ in }
        } else {
            productContent
        }
    }
    #endif

    private var productContent: some View {
        let _ = accountRevision
        return ZStack {
            if showingOnboardingDemo || (!simulatorGuestHome && (!sessionStore.setupComplete || !AssistantAppSession.hasAppleIdentity || healthOnboardingVersion != 6 || !SleepAccessPolicy.canEnter(screenTimeApproved: screenTimeBlocker.authorizationStatus == .approved, sleep: healthKitStore.onboardingSleepAccess))) {
                SetupView(healthKitStore: healthKitStore) {
                    withAnimation(.easeInOut(duration: 0.35)) {
                        showingOnboardingDemo = false
                        #if targetEnvironment(simulator)
                        simulatorGuestHome = true
                        #endif
                    }
                }
                .transition(.opacity)
            } else {
                HomeView(simulatorGuest: simulatorGuestHome && !AssistantAppSession.hasAppleIdentity) {
                    withAnimation(.easeInOut(duration: 0.35)) {
                        showingOnboardingDemo = true
                    }
                }
                .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.35), value: showingOnboardingDemo)
        .environment(\.blankMinimalAppearance, true)
        .task { healthKitStore.verifySleepAccess() }
        .onChange(of: scenePhase) { phase in
            if phase == .active { healthKitStore.verifySleepAccess() }
        }
        .onReceive(NotificationCenter.default.publisher(for: AssistantAppSession.didChangeNotification)) { _ in
            accountRevision += 1
            Task { await purchaseStore.updateCustomerProductStatus() }
        }
    }
}
