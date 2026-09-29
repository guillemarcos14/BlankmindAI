import Combine
import Foundation
import StoreKit

@MainActor
final class StoreKitPurchaseStore: ObservableObject {
    static let monthlyProductId = "blanked_monthly_299"
    static let annualProductId = "blanked_annual_19"
    private static let referralTrialEndsAtKey = "blankReferralTrialEndsAt"
    private static let referralCountKey = "blankReferralCount"
    private static let pendingReferrerUserIdKey = "blankPendingReferrerAnonymousUserId"
    private static let demoProAccessKey = "blankDemoProAccess"

    @Published private(set) var products: [Product] = []
    @Published private(set) var purchasedProductIds: Set<String> = []
    @Published private(set) var referralTrialEndsAt: Date?
    @Published private(set) var referralCount = 0
    @Published private(set) var demoProAccess = false
    @Published var pendingReferrerUserId = ""
    @Published private(set) var isLoading = false
    @Published private(set) var isPurchasing = false
    @Published private(set) var hasLoadedProducts = false
    @Published var message: String?

    private let productIds = [monthlyProductId, annualProductId]

    var hasEntitlement: Bool {
        !purchasedProductIds.isEmpty
    }

    var hasPremiumAccess: Bool {
        hasEntitlement || isReferralTrialActive || demoProAccess
    }

    var isReferralTrialActive: Bool {
        guard let referralTrialEndsAt else { return false }
        return referralTrialEndsAt > Date()
    }

    var referralTrialRemainingText: String? {
        guard let referralTrialEndsAt, referralTrialEndsAt > Date() else { return nil }
        let days = Calendar.current.dateComponents([.day], from: Date(), to: referralTrialEndsAt).day ?? 0
        return "\(max(1, days + 1)) days left"
    }

    var annualProduct: Product? {
        product(for: Self.annualProductId)
    }

    var monthlyProduct: Product? {
        product(for: Self.monthlyProductId)
    }

    init() {
        let defaults = BlankSharedState.defaults
        let timestamp = defaults.double(forKey: Self.referralTrialEndsAtKey)
        if timestamp > 0 {
            referralTrialEndsAt = Date(timeIntervalSince1970: timestamp)
        }
        referralCount = defaults.integer(forKey: Self.referralCountKey)
        demoProAccess = defaults.bool(forKey: Self.demoProAccessKey)
        pendingReferrerUserId = defaults.string(forKey: Self.pendingReferrerUserIdKey) ?? ""
    }

    func enableDemoProAccess() {
        demoProAccess = true
        BlankSharedState.defaults.set(true, forKey: Self.demoProAccessKey)
        message = "Review access enabled"
    }

    func loadProducts() async {
        guard products.isEmpty else { return }
        isLoading = true
        defer {
            isLoading = false
            hasLoadedProducts = true
        }

        do {
            let loadedProducts = try await Product.products(for: productIds)
            products = loadedProducts.sorted { first, second in
                (productIds.firstIndex(of: first.id) ?? 0) < (productIds.firstIndex(of: second.id) ?? 0)
            }
            message = loadedProducts.isEmpty ? "Subscriptions are not available yet." : nil
        } catch {
            message = "Could not load subscriptions."
        }

        await updateCustomerProductStatus()
    }

    func purchase(productId: String) async -> Bool {
        guard let accountID = AssistantAppSession.userID,
              AssistantAppSession.hasAppleIdentity,
              let accountToken = UUID(uuidString: accountID) else {
            message = "Sign in with Apple before subscribing."
            return false
        }
        if products.isEmpty {
            await loadProducts()
        }

        guard let product = product(for: productId) else {
            message = "This subscription is not available yet."
            return false
        }

        isPurchasing = true
        defer { isPurchasing = false }

        do {
            let result = try await product.purchase(options: [.appAccountToken(accountToken)])
            switch result {
            case .success(let verification):
                let transaction = try checkVerified(verification)
                await transaction.finish()
                await updateCustomerProductStatus()
                message = nil
                return true
            case .userCancelled:
                message = "Purchase cancelled."
                return false
            case .pending:
                message = "Purchase pending approval."
                return false
            @unknown default:
                message = "Purchase could not be completed."
                return false
            }
        } catch {
            message = "Purchase could not be completed."
            return false
        }
    }

    func restorePurchases() async {
        do {
            try await AppStore.sync()
            await updateCustomerProductStatus()
            message = hasEntitlement ? "Purchase restored." : "No active subscription found."
        } catch {
            message = "Could not restore purchases."
        }
    }

    func observeTransactionUpdates() async {
        for await result in Transaction.updates {
            guard let transaction = try? checkVerified(result) else { continue }
            await transaction.finish()
            await updateCustomerProductStatus()
        }
    }

    func priceText(for productId: String, fallback: String) -> String {
        if let displayPrice = product(for: productId)?.displayPrice {
            return displayPrice
        }
        return hasLoadedProducts ? fallback : "Loading..."
    }

    func savePendingReferrerUserId(_ value: String) {
        let cleaned = cleanReferralCode(value)
        pendingReferrerUserId = cleaned
        if cleaned.isEmpty {
            BlankSharedState.defaults.removeObject(forKey: Self.pendingReferrerUserIdKey)
        } else {
            BlankSharedState.defaults.set(cleaned, forKey: Self.pendingReferrerUserIdKey)
        }
    }

    func captureReferral(from url: URL) {
        guard url.scheme == "blank", url.host == "referral" else { return }
        let ref = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first { $0.name == "ref" }?
            .value
        savePendingReferrerUserId(ref ?? "")
    }

    func refreshReferralStatus(for anonymousUserId: String) async {
        guard let baseURL = configuredBaseURL() else { return }
        do {
            let response: ReferralResponse = try await postReferralRequest(
                baseURL: baseURL,
                body: ReferralStatusRequest(action: "status", anonymous_user_id: anonymousUserId)
            )
            applyReferralResponse(response)
        } catch {
            message = "Could not refresh referral status."
        }
    }

    func registerReferredActivation(referredUserId: String) async {
        let referrer = cleanReferralCode(pendingReferrerUserId)
        guard !referrer.isEmpty, referrer != referredUserId, let baseURL = configuredBaseURL() else { return }

        do {
            let response: ReferralResponse = try await postReferralRequest(
                baseURL: baseURL,
                body: ReferralActivationRequest(
                    action: "register_activation",
                    referrer_anonymous_user_id: referrer,
                    referred_anonymous_user_id: referredUserId,
                    source: "ios",
                    app_version: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
                    build_number: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
                )
            )
            applyReferralResponse(response)
            savePendingReferrerUserId("")
        } catch {
            message = "Could not register invite."
        }
    }

    private func applyReferralResponse(_ response: ReferralResponse) {
        referralCount = response.referral_count
        BlankSharedState.defaults.set(referralCount, forKey: Self.referralCountKey)

        guard response.reward_unlocked else { return }
        let parsedEnd = response.reward_ends_at.flatMap(Self.parseDate)
        let fallbackEnd = Calendar.current.date(byAdding: .day, value: response.reward_days, to: Date()) ?? Date().addingTimeInterval(7 * 24 * 60 * 60)
        let newEnd = parsedEnd ?? fallbackEnd
        referralTrialEndsAt = max(referralTrialEndsAt ?? Date.distantPast, newEnd)
        BlankSharedState.defaults.set(referralTrialEndsAt?.timeIntervalSince1970 ?? 0, forKey: Self.referralTrialEndsAtKey)
        message = "7-day Pro pass unlocked."
    }

    private func postReferralRequest<RequestBody: Encodable, ResponseBody: Decodable>(
        baseURL: URL,
        body: RequestBody
    ) async throws -> ResponseBody {
        let url = baseURL.appendingPathComponent("referrals")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, (200..<300).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(ResponseBody.self, from: data)
    }

    private func configuredBaseURL() -> URL? {
        guard let rawValue = Bundle.main.object(forInfoDictionaryKey: "BlankMembershipAPIBaseURL") as? String else {
            return nil
        }
        let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("$(") else {
            return nil
        }
        return URL(string: trimmed)
    }

    private func cleanReferralCode(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func parseDate(_ value: String) -> Date? {
        let fractionalFormatter = ISO8601DateFormatter()
        fractionalFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractionalFormatter.date(from: value) {
            return date
        }
        return ISO8601DateFormatter().date(from: value)
    }

    private func product(for productId: String) -> Product? {
        products.first { $0.id == productId }
    }

    func updateCustomerProductStatus() async {
        var activeProductIds = Set<String>()
        guard let accountID = AssistantAppSession.userID,
              AssistantAppSession.hasAppleIdentity,
              let accountToken = UUID(uuidString: accountID) else {
            purchasedProductIds = []
            return
        }

        for await result in Transaction.currentEntitlements {
            guard let transaction = try? checkVerified(result) else { continue }
            guard productIds.contains(transaction.productID) else { continue }
            // Purchases made before account tokens existed remain restorable.
            if let owner = transaction.appAccountToken, owner != accountToken { continue }
            activeProductIds.insert(transaction.productID)
        }

        purchasedProductIds = activeProductIds
    }

    private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .verified(let safe):
            return safe
        case .unverified:
            throw StoreKitPurchaseError.failedVerification
        }
    }
}

private enum StoreKitPurchaseError: Error {
    case failedVerification
}

private struct ReferralStatusRequest: Encodable {
    let action: String
    let anonymous_user_id: String
}

private struct ReferralActivationRequest: Encodable {
    let action: String
    let referrer_anonymous_user_id: String
    let referred_anonymous_user_id: String
    let source: String
    let app_version: String
    let build_number: String
}

private struct ReferralResponse: Decodable {
    let referral_count: Int
    let required_referrals: Int
    let reward_days: Int
    let reward_unlocked: Bool
    let reward_ends_at: String?

    private enum CodingKeys: String, CodingKey {
        case referral_count
        case required_referrals
        case reward_days
        case reward_unlocked
        case reward_ends_at
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        referral_count = try container.decodeIfPresent(Int.self, forKey: .referral_count) ?? 0
        required_referrals = try container.decodeIfPresent(Int.self, forKey: .required_referrals) ?? 3
        reward_days = try container.decodeIfPresent(Int.self, forKey: .reward_days) ?? 7
        reward_unlocked = try container.decodeIfPresent(Bool.self, forKey: .reward_unlocked) ?? false
        reward_ends_at = try container.decodeIfPresent(String.self, forKey: .reward_ends_at)
    }
}
