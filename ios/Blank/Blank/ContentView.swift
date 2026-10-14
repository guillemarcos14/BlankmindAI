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
            if showingOnboardingDemo || (!simulatorGuestHome && (!sessionStore.setupComplete || !AssistantAppSession.hasAppleIdentity || healthOnboardingVersion != 6 || !SleepAccessPolicy.canEnterBasic(screenTimeApproved: screenTimeBlocker.hasAuthorization))) {
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
            if phase == .active {
                healthKitStore.refresh()
                RestHealthContext.shared.refresh()
                Task { await RestDigitalContext.shared.refresh(); BlankBrain.shared.sync() }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: AssistantAppSession.didChangeNotification)) { _ in
            accountRevision += 1
            Task { await purchaseStore.updateCustomerProductStatus() }
        }
    }
}

struct AssistantContextSyncClient {
    private let defaults = BlankSharedState.defaults
    private let lastSuccessKey = "blankAssistantContextLastSyncedAt"
    private let lastErrorKey = "blankAssistantContextLastSyncError"

    @discardableResult
    func sync(connectCode: String, channel: String, payload: [String: Any]) async -> Bool {
        guard !connectCode.isEmpty else { return false }
        let body: [String: Any] = [
            "action": "sync_context",
            "connect_code": connectCode,
            "preferred_channel": channel,
            "app_install_id": BlankSharedState.appInstallId,
            "context": payload,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return false }
        var lastError = "context_sync_failed"
        for attempt in 0..<3 {
            do {
                let (_, response) = try await AssistantAppClient().postAuthorized(
                    path: "assistant-channel", payload: data, timeout: 8
                )
                if (200..<300).contains(response.statusCode) {
                    defaults.set(Date().timeIntervalSince1970, forKey: lastSuccessKey)
                    defaults.removeObject(forKey: lastErrorKey)
                    return true
                }
                lastError = "context_sync_http_\(response.statusCode)"
                if (400..<500).contains(response.statusCode) { break }
            } catch {
                lastError = "context_sync_network_error"
            }
            if attempt < 2 {
                try? await Task.sleep(nanoseconds: UInt64(attempt + 1) * 500_000_000)
            }
        }
        defaults.set(lastError, forKey: lastErrorKey)
        return false
    }
}
