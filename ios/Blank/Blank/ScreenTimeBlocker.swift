import FamilyControls
import Foundation
import ManagedSettings

@MainActor
final class ScreenTimeBlocker: ObservableObject {
    @Published private(set) var authorizationStatus = AuthorizationCenter.shared.authorizationStatus
    @Published var lastErrorMessage: String?

    private let store = ManagedSettingsStore()
    private var selection = FamilyActivitySelection()
    private var allowOnlyModeEnabled = false
    private var adultContentBlockingEnabled = false
    var hasAuthorization: Bool {
        if authorizationStatus == .approved { return true }
        #if compiler(>=6.3)
        if #available(iOS 26.4, *) { return authorizationStatus == .approvedWithDataAccess }
        #endif
        return false
    }
    #if DEBUG
    private var usesPreviewAuthorizationStatus = false
    #endif

    var authorizationStatusLabel: String {
        if hasAuthorization { return "approved" }
        switch authorizationStatus {
        case .notDetermined:
            return "notDetermined"
        case .denied:
            return "denied"
        case .approved:
            return "approved"
        @unknown default:
            return "unknown"
        }
    }

    func refreshAuthorizationStatus() {
        #if DEBUG
        guard !usesPreviewAuthorizationStatus else { return }
        #endif
        authorizationStatus = AuthorizationCenter.shared.authorizationStatus
    }

    func requestAuthorization() async -> Bool {
        #if DEBUG
        if usesPreviewAuthorizationStatus {
            return hasAuthorization
        }
        #endif
        do {
            try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
            await refreshAuthorizationStatusUntilSettled()
            lastErrorMessage = nil
            return hasAuthorization
        } catch {
            await refreshAuthorizationStatusUntilSettled()
            lastErrorMessage = error.localizedDescription
            return false
        }
    }

    func refreshAuthorizationStatusUntilSettled() async {
        for _ in 0..<10 {
            refreshAuthorizationStatus()
            if hasAuthorization {
                return
            }
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
        refreshAuthorizationStatus()
    }

    func restore(selection: FamilyActivitySelection) async {
        self.selection = selection
    }

    func updateSelection(_ selection: FamilyActivitySelection, isBlankActive: Bool) {
        self.selection = selection
        apply(isBlankActive: isBlankActive)
    }

    func updateAdvancedControls(allowOnlyModeEnabled: Bool, adultContentBlockingEnabled: Bool) {
        self.allowOnlyModeEnabled = allowOnlyModeEnabled
        self.adultContentBlockingEnabled = adultContentBlockingEnabled
    }

    func apply(isBlankActive: Bool) {
        guard isBlankActive else {
            clear()
            return
        }

        if allowOnlyModeEnabled {
            store.shield.applications = nil
            store.shield.webDomains = nil
            store.shield.applicationCategories = .all(except: selection.applicationTokens)
            store.shield.webDomainCategories = .all(except: selection.webDomainTokens)
        } else {
            store.shield.applications = selection.applicationTokens
            store.shield.applicationCategories = selection.categoryTokens.isEmpty ? nil : .specific(selection.categoryTokens)
            store.shield.webDomains = selection.webDomainTokens
            store.shield.webDomainCategories = nil
        }

        store.webContent.blockedByFilter = adultContentBlockingEnabled ? .auto() : nil
    }

    func clear() {
        store.clearAllSettings()
    }
}

#if DEBUG
extension ScreenTimeBlocker {
    static func preview(authorizationApproved: Bool = true) -> ScreenTimeBlocker {
        let blocker = ScreenTimeBlocker()
        blocker.usesPreviewAuthorizationStatus = true
        blocker.authorizationStatus = authorizationApproved ? .approved : .notDetermined
        return blocker
    }
}
#endif
