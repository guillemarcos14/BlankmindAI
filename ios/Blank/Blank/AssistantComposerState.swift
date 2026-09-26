import Foundation
import Security

// A retry always carries the original payload. New writing is a separate draft.
struct AssistantComposerState: Codable, Equatable {
    struct Pending: Codable, Equatable {
        let id: String
        let text: String
    }

    var draft = ""
    var pending: Pending?

    mutating func begin() -> Pending? {
        if let pending { return pending }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.utf16.count <= 4000 else { return nil }
        let next = Pending(id: UUID().uuidString.lowercased(), text: text)
        pending = next
        draft = ""
        return next
    }

    mutating func complete(_ id: String) {
        guard pending?.id == id else { return }
        pending = nil
    }
}

enum AssistantDraftVault {
    private static let service = "com.blanknfc.app.assistant.draft"

    private static func query(owner: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: owner]
    }

    static func load(owner: String) -> AssistantComposerState {
        guard !owner.isEmpty else { return AssistantComposerState() }
        var lookup = query(owner: owner)
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(lookup as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let state = try? JSONDecoder().decode(AssistantComposerState.self, from: data) else {
            return AssistantComposerState()
        }
        return state
    }

    @discardableResult
    static func save(_ state: AssistantComposerState, owner: String) -> Bool {
        guard !owner.isEmpty, let data = try? JSONEncoder().encode(state) else { return false }
        let lookup = query(owner: owner)
        let update = [kSecValueData as String: data]
        let status = SecItemUpdate(lookup as CFDictionary, update as CFDictionary)
        if status == errSecSuccess { return true }
        guard status == errSecItemNotFound else { return false }
        var item = lookup
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
    }
}
