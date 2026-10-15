import Combine
import Foundation
import StoreKit
import SwiftUI

@MainActor
final class StoreKitPurchaseStore: ObservableObject {
    static let shared = StoreKitPurchaseStore()
    @Published private(set) var products: [Product] = []
    @Published private(set) var purchasedProductIds: Set<String> = []
    @Published private(set) var isLoading = false
    @Published private(set) var isPurchasing = false
    @Published private(set) var hasLoadedProducts = false
    @Published var message: String?
    @Published var paywallReason: String?
    @Published var showingFirstSummary = false
    @Published private(set) var initialImplemented = false
    @Published private(set) var freeWindowID: String?
    @Published private(set) var premiumUntil: Date?
    @Published private(set) var premiumOwner: String?
    private var salesApproved = false
    private var productIDs: [String] = []
    private var entitlementIDs: [String] = []
    private var refreshing = false
    private let defaults = BlankSharedState.defaults
    init() { resetAccount() }
    var referralTrialEndsAt: Date? { nil }
    var referralCount: Int { 0 }
    var demoProAccess: Bool { false }
    var hasEntitlement: Bool { hasPremiumAccess }
    var hasPremiumAccess: Bool {
        premiumOwner == AssistantAppSession.userID && premiumOwner != nil && (premiumUntil ?? .distantPast) > Date()
    }
    var canConverse: Bool { FunnelPolicy.canConverse(implemented: initialImplemented, premium: hasPremiumAccess) }
    var hasActiveProtection: Bool {
        if BlankSharedState.loadActiveState().isActive { return true }
        guard let owner = AssistantAppSession.userID else { return false }
        let rows = defaults.array(forKey: "blankRestProtectionIntervals") as? [[String: Any]] ?? []
        return rows.contains { row in
            guard row["owner"] as? String == owner, row["ended_at"] == nil, row["uncertain"] as? Bool == false,
                  let start = AssistantInboxAction.parseDate(row["started_at"] as? String), let plan = row["plan"] as? [String: Any],
                  let from = plan["start_minute"] as? Int, let to = plan["end_minute"] as? Int else { return false }
            return Date() >= start && Date().timeIntervalSince(start) < Double((to - from + 1440) % 1440) * 60 + 60
        }
    }
    var freeWindowUUID: UUID? {
        let cached = AssistantAppSession.userID.flatMap { defaults.string(forKey: "funnel.window." + $0) }
        return (cached ?? freeWindowID).flatMap(UUID.init(uuidString:))
    }
    func enableDemoProAccess() {} // Legacy preview hook cannot grant commercial rights.
    func captureReferral(from url: URL) {}
    func registerReferredActivation(referredUserId: String) async {}
    func claimDiagnosis(_ token: String) async throws -> [String: Any] {
        let response = try await request(["action": "funnel_claim", "token": token.trimmingCharacters(in: .whitespacesAndNewlines)])
        defaults.removeObject(forKey: "funnel.pendingDiagnosis")
        return response["diagnosis"] as? [String: Any] ?? [:]
    }

    func requestPremium(_ benefit: String) {
        guard !hasPremiumAccess else { return }
        // Payment never interrupts active protection. The free controls remain reachable.
        guard !hasActiveProtection else {
            message = "Your block is active. You can review personalized follow-up after it ends."
            return
        }
        paywallReason = benefit
    }
    func resetAccount() {
        products = []; purchasedProductIds = []; premiumUntil = nil; premiumOwner = nil
        initialImplemented = false; freeWindowID = nil; salesApproved = false
        paywallReason = nil; showingFirstSummary = false
        if let owner = AssistantAppSession.userID {
            initialImplemented = defaults.bool(forKey: "funnel.implemented." + owner)
            freeWindowID = defaults.string(forKey: "funnel.window." + owner)
        }
    }
    func request(_ body: [String: Any]) async throws -> [String: Any] {
        let owner = AssistantAppSession.userID
        var payload = body; payload["app_install_id"] = BlankSharedState.appInstallId
        let data = try JSONSerialization.data(withJSONObject: payload)
        let (result, response) = try await AssistantAppClient().postAuthorized(path: "assistant-app", payload: data, timeout: 20)
        guard owner != nil, owner == AssistantAppSession.userID else { throw AssistantAppError.sessionChanged }
        guard (200..<300).contains(response.statusCode), let decoded = try JSONSerialization.jsonObject(with: result) as? [String: Any] else {
            if response.statusCode == 402 { requestPremium("Personalized follow-up") }
            throw URLError(.badServerResponse)
        }
        return decoded
    }
    func loadProducts() async {
        guard !refreshing else { return }; refreshing = true
        isLoading = true; defer { isLoading = false; refreshing = false; hasLoadedProducts = true }
        do {
            let status = try await request(["action": "funnel_status"])
            apply(status)
            let catalog = status["catalog"] as? [String: Any] ?? [:]
            salesApproved = catalog["sales_approved"] as? Bool == true
            productIDs = salesApproved ? (catalog["product_ids"] as? [String] ?? []) : []
            entitlementIDs = catalog["entitlement_ids"] as? [String] ?? []
            let offersApproved = catalog["introductory_offers_approved"] as? Bool == true
            products = try await Product.products(for: productIDs).filter { $0.type == .autoRenewable && (offersApproved || $0.subscription?.introductoryOffer == nil) }
            message = products.isEmpty ? "Personalized follow-up is not available to purchase yet. Your first recurring window stays free." : nil
            await updateCustomerProductStatus()
        } catch {
            // No fabricated prices or optimistic entitlement when the server is unavailable.
            message = "Could not refresh follow-up access. Try again. Your free window remains available."
        }
    }
    private func apply(_ status: [String: Any]) {
        guard let owner = AssistantAppSession.userID else { return }
        if let implemented = status["initial_implemented_at"] as? String, !implemented.isEmpty {
            initialImplemented = true; defaults.set(true, forKey: "funnel.implemented." + owner)
        }
        if let id = status["free_window_id"] as? String {
            freeWindowID = id
            // A local replacement can be registered while its receipt is still in flight.
            // Keep that slot until reconciliation, rather than restoring a deleted server ID.
            if defaults.string(forKey: "funnel.window." + owner) == nil { defaults.set(id, forKey: "funnel.window." + owner) }
        }
        if status["premium"] as? Bool != true { premiumUntil = nil; purchasedProductIds = [] }
        if status["premium"] as? Bool != true { defaults.removeObject(forKey: "funnel.premiumUntil." + owner) }
    }
    private func verify(_ result: VerificationResult<StoreKit.Transaction>) async throws -> StoreKit.Transaction {
        let transaction: StoreKit.Transaction
        switch result { case .verified(let value): transaction = value; case .unverified: throw URLError(.cannotParseResponse) }
        guard let owner = AssistantAppSession.userID, let token = UUID(uuidString: owner), transaction.appAccountToken == token,
              entitlementIDs.contains(transaction.productID) else { throw URLError(.userAuthenticationRequired) }
        let response = try await request(["action": "funnel_verify", "signed_transaction": result.jwsRepresentation])
        guard owner == AssistantAppSession.userID else { throw AssistantAppError.sessionChanged }
        if response["premium"] as? Bool == true, let expiry = response["expires_at"] as? String {
            premiumUntil = AssistantInboxAction.parseDate(expiry); premiumOwner = owner
            defaults.set(premiumUntil?.timeIntervalSince1970 ?? 0, forKey: "funnel.premiumUntil." + owner)
            defaults.set(premiumUntil?.timeIntervalSince1970 ?? 0, forKey: "funnel.lastPremiumUntil." + owner)
            purchasedProductIds.insert(transaction.productID)
        } else { premiumUntil = nil; purchasedProductIds = []; defaults.removeObject(forKey: "funnel.premiumUntil." + owner) }
        return transaction
    }
    func purchase(productId: String) async -> Bool {
        guard !isPurchasing else { return false }
        guard salesApproved, productIDs.contains(productId), let product = products.first(where: { $0.id == productId }),
              let owner = AssistantAppSession.userID, AssistantAppSession.hasAppleIdentity, let token = UUID(uuidString: owner) else {
            message = "This subscription is not available yet."; return false
        }
        isPurchasing = true; defer { isPurchasing = false }
        do {
            switch try await product.purchase(options: [.appAccountToken(token)]) {
            case .success(let verification):
                let t = try await verify(verification)
                await t.finish()
                if hasPremiumAccess { paywallReason = nil; message = nil; return true }
                return false
            case .pending: message = "Purchase pending approval. Your free window is available."
            case .userCancelled: message = nil
            @unknown default: message = "Purchase could not be completed. Try again."
            }
        } catch { message = "Could not verify the purchase. Restore purchases to retry." }
        return false
    }
    func restorePurchases() async {
        do {
            try await AppStore.sync()
            await loadProducts()
            await updateCustomerProductStatus()
            message = hasPremiumAccess ? "Purchase restored." : "No verified active subscription found for this account."
        } catch { message = "Could not restore purchases. Try again." }
    }
    func updateCustomerProductStatus() async {
        guard AssistantAppSession.hasAppleIdentity else { resetAccount(); return }
        premiumUntil = nil; purchasedProductIds = []
        for await result in StoreKit.Transaction.currentEntitlements {
            guard case .verified(let t) = result, entitlementIDs.contains(t.productID), t.revocationDate == nil,
                  !t.isUpgraded, let expiry = t.expirationDate, expiry > Date() else { continue }
            do { _ = try await verify(result) } catch { message = "Could not verify follow-up access. Restore purchases to retry." }
        }
        if !hasPremiumAccess, let owner = AssistantAppSession.userID { defaults.removeObject(forKey: "funnel.premiumUntil." + owner) }
    }
    func observeTransactionUpdates() async {
        for await result in StoreKit.Transaction.updates {
            do { let transaction = try await verify(result); await transaction.finish() }
            catch { await updateCustomerProductStatus() }
        }
    }
    func reconcile(store: SessionStore, onOpening: Bool = false) async {
        guard let owner = AssistantAppSession.userID else { return }
        if let window = store.schedule.windows.first(where: { $0.id == freeWindowUUID }) ?? store.schedule.windows.first,
           window.startsAt == nil, window.expiresAt == nil, store.recurringScheduleRegistered, store.hasSelectedApps,
           BlankSharedState.familyControlsApproved, window.enabled {
            var receipt: [String: Any] = ["window_id": window.id.uuidString, "registered": true, "screen_time_authorized": true,
                "selection_count": store.selectionCount, "start_minute": window.startMinute, "end_minute": window.endMinute,
                "weekdays": window.weekdays, "permanent": true, "window_count": store.schedule.windows.count]
            if let prior = freeWindowID, prior.lowercased() != window.id.uuidString.lowercased() { receipt["replaces_window_id"] = prior }
            do { apply(try await request(["action": "funnel_receipt", "receipt": receipt])) }
            catch { message = "Your window is scheduled on this iPhone. Setup confirmation will retry when connected." }
        }
        guard owner == AssistantAppSession.userID else { return }
        let completed = completedBlocks(owner: owner)
        if onOpening, FunnelPolicy.offerSummary(completed: !completed.isEmpty, active: store.isBlankActive || hasActiveProtection,
            premium: hasPremiumAccess, seen: defaults.bool(forKey: "funnel.summarySeen." + owner)) {
            showingFirstSummary = true
            defaults.set(true, forKey: "funnel.summarySeen." + owner)
        }
    }
    func completedBlocks(owner: String) -> [[String: Any]] {
        let rows = defaults.array(forKey: "blankRestProtectionIntervals") as? [[String: Any]] ?? []
        return rows.filter { FunnelPolicy.completedBlock($0, owner: owner) }
    }
}

struct WebDiagnosisImportView: View {
    @EnvironmentObject private var purchases: StoreKitPurchaseStore
    @State private var code = BlankSharedState.defaults.string(forKey: "funnel.pendingDiagnosis") ?? ""
    @State private var status = ""
    @State private var busy = false
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Continue web diagnosis").font(.blankInter(size: 17, relativeTo: .headline))
            TextField("Private continuation code", text: $code).textInputAutocapitalization(.never).autocorrectionDisabled()
                .textFieldStyle(.roundedBorder).accessibilityIdentifier("funnel-diagnosis-code")
            Button("Import my context and proposal") {
                busy = true
                Task {
                    defer { busy = false }
                    do {
                        let diagnosis = try await purchases.claimDiagnosis(code)
                        let routine = diagnosis["routine"] as? String ?? ""
                        status = "Context imported: \(routine). Continue your initial conversation to agree the window and implement it. Importing does not apply a block."
                        code = ""
                    } catch { status = "Could not import this code. Check the code or create a new one on the website; codes expire after 24 hours." }
                }
            }.frame(minHeight: 44).disabled(busy || code.count != 64)
            if busy { ProgressView() }
            if !status.isEmpty { Text(status).font(.blankInter(size: 14, relativeTo: .footnote)) }
        }
    }
}

struct PersonalizedFollowupSheet: View {
    @EnvironmentObject private var purchases: StoreKitPurchaseStore
    @Environment(\.dismiss) private var dismiss
    let reason: String
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Personalized follow-up").font(.blankInter(size: 26, relativeTo: .title))
                    Text(reason).font(.blankInter(size: 17, relativeTo: .body))
                    Text("Your first recurring window stays free permanently. You can edit, pause or disable it in Control. Add follow-up when you want help adapting your routine.")
                }
                Section {
                    Text("Multiple windows and different schedules by day")
                    Text("Unlimited conversations by text and voice")
                    Text("Full Progress history, trends, comparisons and explanations")
                    Text("Automatic evaluation and adjustments within your permissions")
                } header: {
                    Text("Included with follow-up").foregroundStyle(BlankColors.ink)
                }
                Section {
                    ForEach(purchases.products, id: \.id) { product in
                        Button { Task { _ = await purchases.purchase(productId: product.id) } } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(product.displayName)
                                Text("\(product.displayPrice) / \(period(product)) · auto-renews")
                            }.frame(minHeight: 44)
                        }.disabled(purchases.isPurchasing)
                    }
                    if purchases.isLoading { ProgressView("Loading subscriptions") }
                    if let message = purchases.message { Text(message) }
                    Button("Restore purchases") { Task { await purchases.restorePurchases() } }.disabled(purchases.isPurchasing)
                    Link("Manage subscription", destination: URL(string: "https://apps.apple.com/account/subscriptions")!)
                    Link("Privacy", destination: URL(string: "https://blankmind.ai/privacy/")!)
                    Link("Terms of Use", destination: URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!)
                    Text("Payment is charged to your Apple account after confirmation. Subscriptions renew unless canceled at least 24 hours before the current period ends. Manage or cancel in the App Store.")
                        .font(.blankInter(size: 13, relativeTo: .footnote))
                }
            }
            .tint(BlankColors.ink)
            .font(.blankInter(size: 17, relativeTo: .body))
            .scrollContentBackground(.hidden)
            .background(BlankColors.minimalBackground)
            .safeAreaInset(edge: .bottom) {
                Button("Continue free") { purchases.paywallReason = nil; dismiss() }
                    .font(.blankInter(size: 17, relativeTo: .body))
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .contentShape(Rectangle())
                    .accessibilityIdentifier("funnel-continue-free")
                    .padding(.horizontal, 20).padding(.vertical, 12)
                    .background(BlankColors.minimalBackground)
            }
            .preferredColorScheme(.light)
            .navigationTitle("Follow-up")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { purchases.paywallReason = nil; dismiss() } } }
            .task { await purchases.loadProducts() }
        }
    }
    private func period(_ product: Product) -> String {
        guard let period = product.subscription?.subscriptionPeriod else { return "billing period" }
        let unit: String
        switch period.unit { case .day: unit = "day"; case .week: unit = "week"; case .month: unit = "month"; case .year: unit = "year"; @unknown default: unit = "period" }
        return period.value == 1 ? unit : "\(period.value) \(unit)s"
    }
}
