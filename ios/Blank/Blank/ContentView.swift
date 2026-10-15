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
        Group {
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
        .sheet(isPresented: Binding(get: { purchaseStore.paywallReason != nil }, set: { if !$0 { purchaseStore.paywallReason = nil } })) {
            PersonalizedFollowupSheet(reason: purchaseStore.paywallReason ?? "Personalized follow-up")
        }
        .sheet(isPresented: $purchaseStore.showingFirstSummary) {
            NavigationStack {
                List {
                    Text("Your first completed block").font(.blankInter(size: 26, relativeTo: .title))
                    Text("Your iPhone recorded a completed protection window. This does not establish that your sleep improved.")
                    if let owner = AssistantAppSession.userID, let block = purchaseStore.completedBlocks(owner: owner).last,
                       let date = AssistantInboxAction.parseDate(block["ended_at"] as? String) {
                        Text("Completed \(date.formatted(date: .abbreviated, time: .shortened))")
                    }
                    if let night = RestHealthContext.shared.nights.filter({ $0.watchMeasured && !$0.manual && $0.end <= Date() }).max(by: { $0.end < $1.end }) {
                        Text("Latest Watch sleep: \(Int(RestInterval.minutes(night.asleep))) minutes on \(night.date.formatted(date: .abbreviated, time: .omitted)).")
                    } else { Text("No measured Apple Watch sleep is available yet.") }
                    Text("Your recurring window stays free. View completed blocks and your latest available Watch night in Progress.")
                    Button("Activate personalized follow-up") {
                        purchaseStore.showingFirstSummary = false
                        Task { @MainActor in
                            try? await Task.sleep(nanoseconds: 350_000_000)
                            purchaseStore.requestPremium("Understand your nights and adapt your plan to your routine.")
                        }
                    }.frame(minHeight: 44)
                    Button("Continue free") { purchaseStore.showingFirstSummary = false }.frame(minHeight: 44)
                }.navigationTitle("Your progress")
            }
        }
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
        .task {
            await purchaseStore.loadProducts()
            await purchaseStore.reconcile(store: sessionStore, onOpening: true)
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 240_000_000_000)
                if scenePhase == .active {
                    await purchaseStore.loadProducts()
                    sessionStore.reconcileCommercialAccess()
                }
            }
        }
        .onChange(of: sessionStore.schedule) { _ in Task { await purchaseStore.reconcile(store: sessionStore) } }
        .onChange(of: sessionStore.selectionCount) { _ in Task { await purchaseStore.reconcile(store: sessionStore) } }
        .onChange(of: sessionStore.isBlankActive) { active in
            if active { purchaseStore.paywallReason = nil; purchaseStore.showingFirstSummary = false }
            else { sessionStore.reconcileCommercialAccess() }
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active {
                Task {
                    await purchaseStore.loadProducts()
                    sessionStore.reconcileCommercialAccess()
                    await purchaseStore.reconcile(store: sessionStore, onOpening: true)
                }
                healthKitStore.refresh()
                RestHealthContext.shared.refresh()
                Task { await RestDigitalContext.shared.refresh(); BlankBrain.shared.sync() }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: AssistantAppSession.didChangeNotification)) { _ in
            accountRevision += 1
            purchaseStore.resetAccount()
            Task { await purchaseStore.loadProducts() }
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
                    path: "assistant-device", payload: data, timeout: 8
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
