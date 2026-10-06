import Foundation
import Security

// A retry always carries the original payload. New writing is a separate draft.
struct AssistantComposerState: Codable, Equatable {
    struct Pending: Codable, Equatable {
        let id: String
        let text: String
        var problem: AssistantPendingProblem? = nil
    }

    var draft = ""
    var pending: Pending?

    mutating func begin(audioText: String? = nil) -> Pending? {
        if let pending { return pending }
        let text = (audioText ?? draft).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.utf16.count <= 4000 else { return nil }
        let next = Pending(id: UUID().uuidString.lowercased(), text: text)
        pending = next
        if audioText == nil { draft = "" }
        return next
    }

    mutating func complete(_ id: String) {
        guard pending?.id == id else { return }
        pending = nil
    }
}

enum AssistantPendingProblem: String, Codable, CaseIterable {
    case offline, connection, timeout, sessionExpired, installation, serviceUnavailable
    case rateLimited, invalidResponse, unknown, notConfigured, payloadConflict, invalidTurn, actionUnavailable
    case missingReply, failedReply, processing

    var requiresSignIn: Bool { self == .sessionExpired || self == .installation }
    var canRetry: Bool {
        ![.sessionExpired, .installation, .notConfigured, .payloadConflict, .invalidTurn, .actionUnavailable].contains(self)
    }

    func message(spanish: Bool) -> String {
        switch self {
        case .offline: return spanish ? "La solicitud falló porque no había conexión a internet. Comprueba tu conexión y reintenta." : "Your request failed while offline. Check your internet connection and try again."
        case .connection: return spanish ? "No se pudo conectar con Blankmind. Reintenta en unos segundos." : "Could not connect to Blankmind. Try again in a few seconds."
        case .timeout: return spanish ? "La respuesta está tardando más de lo esperado. Reintenta para recuperarla." : "The reply is taking longer than expected. Try again to recover it."
        case .sessionExpired: return spanish ? "Tu sesión necesita verificarse. Inicia sesión con Apple para continuar." : "Your session needs verification. Sign in with Apple to continue."
        case .installation: return spanish ? "Este iPhone necesita vincularse a tu cuenta. Inicia sesión con Apple." : "This iPhone needs linking to your account. Sign in with Apple."
        case .serviceUnavailable: return spanish ? "El servicio de Blankmind no está disponible ahora. Reintenta en unos minutos." : "The Blankmind service is unavailable right now. Try again in a few minutes."
        case .rateLimited: return spanish ? "Se han enviado demasiadas solicitudes. Espera unos segundos y reintenta." : "Too many requests. Wait a few seconds and try again."
        case .invalidResponse: return spanish ? "No se pudo leer la respuesta de Blankmind. Reintenta para recuperarla." : "Could not read Blankmind's reply. Try again to recover it."
        case .notConfigured: return spanish ? "Blankmind no está disponible en esta versión de la app." : "Blankmind is unavailable in this version of the app."
        case .payloadConflict: return spanish ? "Este mensaje ya se envió con otro texto. Conservamos tu borrador." : "This message was already sent with different text. Your draft is saved."
        case .invalidTurn: return spanish ? "Escribe un mensaje de hasta 4.000 caracteres." : "Write a message of up to 4,000 characters."
        case .actionUnavailable: return spanish ? "Esta acción ya no está disponible. Pide un bloqueo nuevo." : "This action is no longer available. Request a new block."
        case .processing: return spanish ? "Blankmind sigue procesando tu mensaje. Espera unos segundos o comprueba de nuevo." : "Blankmind is still processing your message. Wait a few seconds or check again."
        case .failedReply: return spanish ? "Blankmind no pudo completar la respuesta. Reintenta para recuperarla." : "Blankmind could not complete the reply. Try again to recover it."
        case .missingReply: return spanish ? "Aún no hay una respuesta registrada para este mensaje. Reintenta para recuperarla." : "No reply is recorded for this message yet. Try again to recover it."
        case .unknown: return spanish ? "No se pudo recuperar la respuesta y no conocemos la causa. Reintenta." : "Could not recover the reply and the cause is unknown. Try again."
        }
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
