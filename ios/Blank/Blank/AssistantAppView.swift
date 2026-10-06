import AVFoundation
import Security
import SwiftUI

enum AssistantAppSession {
    private static let service = "com.blanknfc.app.assistant.session"
    private static let lock = NSLock()
    static let didChangeNotification = Notification.Name("BlankAssistantSessionDidChange")

    private struct Credentials: Codable {
        let access: String
        let refresh: String
        let appleUserID: String?
        let email: String?
    }

    @discardableResult static func save(accessToken: String, refreshToken: String, appleUserID: String? = nil, email: String? = nil) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return saveCredentials(accessToken: accessToken, refreshToken: refreshToken, appleUserID: appleUserID, email: email)
    }

    static var appleUserID: String? { credentialValue(\.appleUserID) }
    static var email: String? { credentialValue(\.email) }

    private static func credentialValue(_ keyPath: KeyPath<Credentials, String?>) -> String? {
        lock.lock()
        defer { lock.unlock() }
        guard let data = readData(account: "credentials"),
              let credentials = try? JSONDecoder().decode(Credentials.self, from: data) else { return nil }
        return credentials[keyPath: keyPath]
    }

    static func clear() {
        lock.lock()
        defer { lock.unlock() }
        for account in ["credentials", "access", "refresh"] {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account,
            ]
            SecItemDelete(query as CFDictionary)
        }
        notifyChange()
    }

    static func token(_ account: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        return readToken(account)
    }

    // This claim scopes local drafts only. The server remains the identity authority.
    static var userID: String? {
        guard let access = token("access") else { return nil }
        let parts = access.split(separator: ".")
        guard parts.count == 3 else { return nil }
        var encoded = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
        guard let data = Data(base64Encoded: encoded),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = payload["sub"] as? String, UUID(uuidString: id) != nil else { return nil }
        return id
    }

    static var hasAppleIdentity: Bool {
        guard let access = token("access") else { return false }
        let parts = access.split(separator: ".")
        guard parts.count == 3 else { return false }
        var encoded = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
        guard let data = Data(base64Encoded: encoded),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let metadata = payload["app_metadata"] as? [String: Any] else { return false }
        if metadata["provider"] as? String == "apple" { return true }
        return (metadata["providers"] as? [String] ?? []).contains("apple")
    }

    static func replace(accessToken: String, refreshToken: String, ifCurrent expected: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        guard readToken("access") == expected else { return readToken("access") }
        let previous = readData(account: "credentials").flatMap { try? JSONDecoder().decode(Credentials.self, from: $0) }
        _ = saveCredentials(accessToken: accessToken, refreshToken: refreshToken,
                            appleUserID: previous?.appleUserID, email: previous?.email)
        return readToken("access")
    }

    private static func readToken(_ account: String) -> String? {
        if let data = readData(account: "credentials"),
           let credentials = try? JSONDecoder().decode(Credentials.self, from: data) {
            return account == "access" ? credentials.access : (account == "refresh" ? credentials.refresh : nil)
        }
        // Existing installations keep their session until the next successful refresh.
        return readData(account: account).flatMap { String(data: $0, encoding: .utf8) }
    }

    private static func readData(account: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { return nil }
        return result as? Data
    }

    private static func saveCredentials(accessToken: String, refreshToken: String, appleUserID: String?, email: String?) -> Bool {
        guard !accessToken.isEmpty, !refreshToken.isEmpty,
              let data = try? JSONEncoder().encode(Credentials(access: accessToken, refresh: refreshToken,
                                                                 appleUserID: appleUserID, email: email)) else { return false }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "credentials",
        ]
        // Keep the old credentials if writing fails; never delete before an update.
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecSuccess { notifyChange(); return true }
        guard status == errSecItemNotFound else { return false }
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { return false }
        notifyChange()
        return true
    }

    private static func notifyChange() {
        DispatchQueue.main.async {
            NotificationCenter.default.post(name: didChangeNotification, object: nil)
        }
    }
}

struct AssistantAppTurn: Codable, Identifiable {
    let id: String
    let userText: String
    let assistantText: String
    let status: String
    let actionId: String
    let actionLabel: String
    let actionStatus: String
    let createdAt: String
    var autoApply: Bool? = nil
    var controlSection: String? = nil

    var canApply: Bool {
        !actionId.isEmpty && ["queued", "delivered"].contains(actionStatus)
    }
}

private struct AssistantAppEnvelope: Decodable {
    let ok: Bool
    let turns: [AssistantAppTurn]?
    let turn: AssistantAppTurn?
    let nextBefore: String?
    let assistantConnectCode: String?
    let text: String?
}

struct AssistantAppHistoryPage {
    let turns: [AssistantAppTurn]
    let nextBefore: String?
}

enum AssistantGreetingFallback {
    static func make() -> String {
        let greetings = Locale.current.languageCode == "es"
            ? ["Hola, ¿cómo estás hoy?", "Hola, ¿qué tienes en mente?", "Hey, ¿cómo va el día?"]
            : ["Hey, how are you doing today?", "Hi, what's on your mind?", "Hey, how's your day going?"]
        return greetings.randomElement()!
    }
}

enum AssistantAppError: LocalizedError {
    case authenticationRequired
    case installationNotVerified
    case sessionChanged
    case server(status: Int, code: String)
    case network
    case timeout
    case invalidResponse
    case notConfigured

    var code: String {
        switch self {
        case .authenticationRequired: return "authentication_required"
        case .installationNotVerified: return "installation_not_verified"
        case .sessionChanged: return "session_changed"
        case let .server(_, code): return code
        case .network: return "network_unavailable"
        case .timeout: return "request_timed_out"
        case .invalidResponse: return "invalid_response"
        case .notConfigured: return "not_configured"
        }
    }

    var requiresAccountSignIn: Bool {
        switch self {
        case .authenticationRequired, .installationNotVerified, .sessionChanged: return true
        case .server(_, "apple_identity_required"): return true
        default: return false
        }
    }

    var isRetryable: Bool {
        switch self {
        case .network, .timeout, .invalidResponse: return true
        case let .server(status, code):
            return status >= 500 || status == 429
                || ["conversation_in_progress", "turn_in_progress_or_failed"].contains(code)
        default: return false
        }
    }

    var errorDescription: String? {
        let spanish = Locale.current.languageCode == "es"
        switch self {
        case .authenticationRequired, .sessionChanged:
            return spanish ? "Inicia sesión con Apple para continuar. Tu mensaje sigue guardado." : "Sign in with Apple to continue. Your message is still saved."
        case .server(_, "apple_identity_required"):
            return spanish ? "Inicia sesión con Apple para continuar con Blankmind." : "Sign in with Apple to continue using Blankmind."
        case .installationNotVerified:
            return spanish ? "Vuelve a iniciar sesión con Apple para vincular este iPhone." : "Sign in with Apple again to link this iPhone."
        case .network:
            return spanish ? "No hay conexión. Tu mensaje está guardado; reintenta cuando vuelvas a tener internet." : "You are offline. Your message is saved; retry when you have a connection."
        case .timeout:
            return spanish ? "La respuesta está tardando. Reintenta para recuperar el mismo mensaje." : "The reply is taking longer. Retry to recover the same message."
        case .invalidResponse:
            return spanish ? "No se pudo leer la respuesta. Reintenta para recuperarla." : "The reply could not be read. Retry to recover it."
        case .notConfigured:
            return spanish ? "Blankmind no está disponible en esta versión de la app." : "Blankmind is unavailable in this version of the app."
        case let .server(status, code):
            if code == "conversation_in_progress" || code == "turn_in_progress_or_failed" {
                return spanish ? "Blankmind está terminando tu mensaje anterior. Reintenta en unos segundos." : "Blankmind is finishing your previous message. Retry in a few seconds."
            }
            if code == "turn_payload_conflict" {
                return spanish ? "Este mensaje ya se envió con otro texto. Conservamos tu borrador." : "This message was already sent with different text. Your draft is saved."
            }
            if code == "invalid_turn" {
                return spanish ? "Escribe un mensaje de hasta 4.000 caracteres." : "Write a message of up to 4,000 characters."
            }
            if code == "action_unavailable" {
                return spanish ? "Esta acción ya no está disponible. Pide un bloqueo nuevo." : "This action is no longer available. Request a new block."
            }
            if status == 429 {
                return spanish ? "Espera unos segundos antes de volver a intentarlo." : "Wait a few seconds before trying again."
            }
            return spanish ? "Blankmind no está disponible ahora. Tu mensaje sigue guardado." : "Blankmind is unavailable right now. Your message is still saved."
        }
    }
}

actor AssistantAppSessionRefresh {
    static let shared = AssistantAppSessionRefresh()
    private var inFlight: Task<String, Error>?

    func accessToken(rejected: String, refresh: @escaping () async throws -> String) async throws -> String {
        if let current = AssistantAppSession.token("access"), current != rejected { return current }
        if let inFlight { return try await inFlight.value }
        let pending = Task { try await refresh() }
        inFlight = pending
        defer { inFlight = nil }
        return try await pending.value
    }
}

struct AssistantAppClient {
    var session: URLSession = .shared
    var baseURL: URL?
    var sessionRefresh: AssistantAppSessionRefresh = .shared

    func activate() async throws -> String {
        let result = try await request(action: "activate", extra: [:])
        guard let code = result.assistantConnectCode, !code.isEmpty else {
            throw AssistantAppError.invalidResponse
        }
        BlankSharedState.defaults.set(code, forKey: "blankAssistantConnectCode")
        return code
    }

    func transcribe(audio: Data) async throws -> String {
        let result = try await request(action: "transcribe", extra: ["audio_base64": audio.base64EncodedString()])
        guard let text = result.text, !text.isEmpty else { throw AssistantAppError.invalidResponse }
        return text
    }

    func greeting(spanish: Bool) async throws -> String {
        let result = try await request(action: "greeting", extra: ["language": spanish ? "es" : "en"])
        guard let text = result.text, !text.isEmpty else { throw AssistantAppError.invalidResponse }
        return text
    }

    func history(before: String? = nil) async throws -> AssistantAppHistoryPage {
        let result = try await request(action: "history", extra: before.map { ["before": $0] } ?? [:])
        return AssistantAppHistoryPage(turns: result.turns ?? [], nextBefore: result.nextBefore)
    }

    func send(text: String, turnId: String, context: [String: Any]? = nil) async throws -> AssistantAppTurn {
        var extra: [String: Any] = ["text": text, "turn_id": turnId]
        if let context { extra["context"] = context }
        let result = try await request(action: "send", extra: extra)
        guard let turn = result.turn else { throw AssistantAppError.invalidResponse }
        return turn
    }

    func status(turnId: String) async throws -> AssistantAppTurn? {
        do {
            let result = try await request(action: "status", extra: ["turn_id": turnId])
            guard let turn = result.turn else { throw AssistantAppError.invalidResponse }
            return turn
        } catch AssistantAppError.server(404, "turn_not_found") {
            return nil
        }
    }

    private func request(action: String, extra: [String: Any]) async throws -> AssistantAppEnvelope {
        let raw = Bundle.main.object(forInfoDictionaryKey: "BlankMembershipAPIBaseURL") as? String ?? ""
        guard let base = baseURL ?? (raw.contains("$(") ? nil : URL(string: raw)),
              base.scheme == "https", base.host != nil else {
            throw AssistantAppError.notConfigured
        }
        guard AssistantAppSession.token("access") != nil else {
            throw AssistantAppError.authenticationRequired
        }
        var body = extra
        body["action"] = action
        body["app_install_id"] = BlankSharedState.appInstallId
        let payload = try JSONSerialization.data(withJSONObject: body)
        return try decode(await postAuthorized(base: base, path: "assistant-app", payload: payload, timeout: 60))
    }

    func postAuthorized(path: String, payload: Data, timeout: TimeInterval = 12) async throws -> (Data, HTTPURLResponse) {
        let raw = Bundle.main.object(forInfoDictionaryKey: "BlankMembershipAPIBaseURL") as? String ?? ""
        guard let base = baseURL ?? (raw.contains("$(") ? nil : URL(string: raw)),
              base.scheme == "https", base.host != nil else {
            throw AssistantAppError.notConfigured
        }
        return try await postAuthorized(base: base, path: path, payload: payload, timeout: timeout)
    }

    private func postAuthorized(base: URL, path: String, payload: Data, timeout: TimeInterval) async throws -> (Data, HTTPURLResponse) {
        guard let access = AssistantAppSession.token("access"), let userID = AssistantAppSession.userID else {
            throw AssistantAppError.authenticationRequired
        }
        let first = try await post(base: base, path: path, payload: payload, token: access, timeout: timeout)
        guard userID == AssistantAppSession.userID else { throw AssistantAppError.sessionChanged }
        guard first.1.statusCode == 401 else { return first }
        let refreshed = try await sessionRefresh.accessToken(rejected: access) {
            try await refresh(base: base, rejectedToken: access)
        }
        guard userID == AssistantAppSession.userID else { throw AssistantAppError.sessionChanged }
        try Task.checkCancellation()
        let retried = try await post(base: base, path: path, payload: payload, token: refreshed, timeout: timeout)
        guard userID == AssistantAppSession.userID else { throw AssistantAppError.sessionChanged }
        return retried
    }

    private func refresh(base: URL, rejectedToken: String) async throws -> String {
        guard let refresh = AssistantAppSession.token("refresh"), !refresh.isEmpty else {
            throw AssistantAppError.authenticationRequired
        }
        let payload = try JSONSerialization.data(withJSONObject: [
            "action": "refresh_session", "refresh_token": refresh,
        ])
        let response = try await post(base: base, path: "app-auth", payload: payload, token: nil)
        try validate(response)
        guard let data = try? JSONSerialization.jsonObject(with: response.0) as? [String: Any],
              let access = data["access_token"] as? String, !access.isEmpty else {
            throw AssistantAppError.invalidResponse
        }
        // A completed account sign-in wins over an older refresh still in flight.
        guard let saved = AssistantAppSession.replace(accessToken: access,
            refreshToken: data["refresh_token"] as? String ?? refresh, ifCurrent: rejectedToken),
              saved != rejectedToken else { throw AssistantAppError.authenticationRequired }
        return saved
    }

    private func post(base: URL, path: String, payload: Data, token: String?, timeout: TimeInterval = 60) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: base.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.httpBody = payload
        request.timeoutInterval = timeout
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw AssistantAppError.invalidResponse }
            return (data, http)
        } catch let error as URLError {
            if error.code == .cancelled { throw CancellationError() }
            if error.code == .timedOut { throw AssistantAppError.timeout }
            throw AssistantAppError.network
        }
    }

    private func validate(_ response: (Data, HTTPURLResponse)) throws {
        guard (200..<300).contains(response.1.statusCode) else {
            let code = (try? JSONSerialization.jsonObject(with: response.0) as? [String: Any])?["error"] as? String ?? "unavailable"
            if response.1.statusCode == 401 { throw AssistantAppError.authenticationRequired }
            if code == "installation_not_verified" { throw AssistantAppError.installationNotVerified }
            throw AssistantAppError.server(status: response.1.statusCode, code: code)
        }
    }

    private func decode(_ response: (Data, HTTPURLResponse)) throws -> AssistantAppEnvelope {
        try validate(response)
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        guard let result = try? decoder.decode(AssistantAppEnvelope.self, from: response.0), result.ok else {
            throw AssistantAppError.invalidResponse
        }
        return result
    }
}

@MainActor
final class AssistantSpeechInput: ObservableObject {
    @Published var transcript = ""
    @Published var isRecording = false
    @Published var isStarting = false
    @Published var error: String?
    @Published var hasAudio = false
    @Published var levels: [CGFloat] = Array(repeating: 3, count: 24)
    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    private var file: URL?
    private var generation = UUID()
    private var transcription: Task<Void, Never>?
    private var observer: NSObjectProtocol?

    init() {
        observer = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification,
            object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor [weak self] in self?.stop() }
        }
    }
    deinit { if let observer { NotificationCenter.default.removeObserver(observer) } }

    private func copy(_ spanish: String, _ english: String) -> String {
        Locale.current.languageCode == "es" ? spanish : english
    }

    func toggle() {
        if isRecording { finish(); return }
        if isStarting { return }
        if file != nil { finish(); return }
        generation = UUID()
        let current = generation
        let owner = AssistantAppSession.userID
        transcript = ""; error = nil; isStarting = true
        AVAudioSession.sharedInstance().requestRecordPermission { [weak self] allowed in
            Task { @MainActor [weak self] in
                guard let self, self.generation == current, owner == AssistantAppSession.userID else { return }
                guard allowed else { self.isStarting = false; self.error = self.copy("Activa el acceso al micrófono en Ajustes.", "Enable Microphone access in Settings."); return }
                do {
                    let audio = AVAudioSession.sharedInstance()
                    try audio.setCategory(.record, mode: .measurement)
                    try audio.setActive(true)
                    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".m4a")
                    self.file = url; self.hasAudio = true
                    let recorder = try AVAudioRecorder(url: url, settings: [
                        AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 24000,
                        AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 48000])
                    recorder.isMeteringEnabled = true
                    guard recorder.record() else { throw AssistantAppError.invalidResponse }
                    self.recorder = recorder; self.isStarting = false; self.isRecording = true
                    self.timer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in
                        Task { @MainActor [weak self] in
                            guard let self, let recorder = self.recorder else { return }
                            recorder.updateMeters()
                            self.levels.removeFirst()
                            self.levels.append(CGFloat(max(3, min(28, pow(10, Double(recorder.averagePower(forChannel: 0)) / 40) * 28))))
                            if recorder.currentTime >= 90 { self.finish() }
                        }
                    }
                } catch { self.stop(); self.error = self.copy("No se pudo iniciar el micrófono. Reintenta.", "Could not start the microphone. Try again.") }
            }
        }
    }

    private func finish() {
        timer?.invalidate(); timer = nil
        recorder?.stop(); recorder = nil; isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        guard let file else { return }
        isStarting = true; error = nil
        let current = generation
        let owner = AssistantAppSession.userID
        transcription = Task { [weak self] in
            do {
                let data = try Data(contentsOf: file)
                let text = try await AssistantAppClient().transcribe(audio: data)
                guard let self, self.generation == current, owner == AssistantAppSession.userID else { return }
                self.isStarting = false
                try? FileManager.default.removeItem(at: file); self.file = nil; self.hasAudio = false
                self.transcript = text
            } catch {
                guard let self, self.generation == current else { return }
                self.isStarting = false
                self.error = self.copy("No se pudo transcribir. Pulsa el micrófono para reintentar o cancela.", "Could not transcribe audio. Tap the microphone to retry, or cancel.")
            }
        }
    }

    func stop() {
        generation = UUID(); transcription?.cancel(); transcription = nil
        timer?.invalidate(); timer = nil; recorder?.stop(); recorder = nil
        if let file { try? FileManager.default.removeItem(at: file) }; file = nil; hasAudio = false
        isRecording = false; isStarting = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

struct AssistantAudioWaveform: View {
    @ObservedObject var audio: AssistantSpeechInput
    var body: some View {
        HStack(spacing: 3) {
            if audio.isStarting { ProgressView() }
            else { ForEach(Array(audio.levels.enumerated()), id: \.offset) { _, level in
                Capsule().frame(width: 3, height: level)
            } }
            Spacer(minLength: 0)
            Button { audio.stop() } label: { Image(systemName: "xmark").frame(width: 44, height: 44) }
                .accessibilityLabel("Cancel audio")
        }.frame(maxWidth: .infinity, minHeight: 50)
        .accessibilityLabel(audio.isStarting ? "Processing audio" : "Recording audio")
    }
}

struct AssistantAppView: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @StateObject private var speech = AssistantSpeechInput()
    @FocusState private var composerFocused: Bool
    @State private var turns: [AssistantAppTurn] = []
    @State private var nextHistoryCursor: String?
    @State private var composer = AssistantComposerState()
    @State private var owner = ""
    @State private var acceptingSpeech = false
    @State private var sendRequestID: UUID?
    @State private var isLoading = true
    @State private var reloadRequestID: UUID?
    @State private var conversationRevision = 0
    @State private var error: String?
    @State private var requiresVerification = false
    @State private var canRetry = true
    @State private var showHistory = false // Debug screenshot fixture only; entry point lives in Settings.
    @State private var showAccountSignIn = false
    @State private var saveTask: Task<Void, Never>?
    @State private var initialMessageHandled = false
    @State private var visibleTurnID: String?
    @State private var greeting: String? = AssistantGreetingFallback.make()

    var initialMessage: String? = nil
    var simulatorGuest = false
    var usesHomePresentation = false
    var isHomeVisible = true
    var onHomeActionPrepared: () -> Void = {}
    var onConversationActivityChanged: (Bool) -> Void = { _ in }
    var onOpenControls: (HomeSection?) -> Void = { _ in }
    let onApplyAction: (String) async throws -> Void
    @State private var isApplyingAction = false

    private var latest: AssistantAppTurn? {
        guard composer.pending == nil else { return nil }
        return turns.first(where: { $0.id == visibleTurnID && $0.status == "completed" })
    }
    private var spanish: Bool { Locale.current.languageCode == "es" }
    private var preview: Bool {
        #if DEBUG
        return AssistantAppPreview.enabled
        #else
        return false
        #endif
    }
    private var dark: Bool {
        #if DEBUG
        if preview { return AssistantAppPreview.scenario.hasPrefix("active") }
        #endif
        return sessionStore.isBlankActive
    }
    private var foreground: Color { usesHomePresentation ? MinimalHomeDesign.ink : (dark ? BlankColors.pureWhite : BlankColors.charcoal) }
    private var background: Color { usesHomePresentation ? MinimalHomeDesign.base : (dark ? BlankColors.charcoal : BlankColors.pureWhite) }
    private var draftTooLong: Bool { composer.draft.utf16.count > 4000 }
    private var isSending: Bool { sendRequestID != nil }
    private var waiting: Bool { isSending || composer.pending != nil || isApplyingAction }

    var body: some View {
        Group {
            if usesHomePresentation {
                homeConversation
            } else {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                VStack(spacing: 0) {
            HStack {
                Button { dismiss() } label: {
                    Label(spanish ? "Volver" : "Back", systemImage: "chevron.left")
                        .font(.blankInter(size: 14))
                        .frame(minWidth: 76, minHeight: 48, alignment: .leading)
                }
                .accessibilityLabel(spanish ? "Volver a Inicio" : "Back to Home")
                .disabled(isApplyingAction)
                Spacer(minLength: 0)
            }
            .frame(height: 56)
            .padding(.horizontal, 24)
            .layoutPriority(1)
            .background(background)
            .zIndex(1)

                    ScrollView {
                    VStack(alignment: .leading, spacing: 26) {
                        VStack(alignment: .leading, spacing: 24) {
                            Text("Chat")
                                .font(.blankSectionEditorial())
                                .tracking(-0.9)
                                .accessibilityAddTraits(.isHeader)
                        }
                        if let latest {
                            Text(latest.assistantText)
                                .font(.blankInter(size: 20))
                                .lineSpacing(4)
                                .fixedSize(horizontal: false, vertical: true)
                                .textSelection(.enabled)
                                .accessibilityLabel("Blankmind: \(latest.assistantText)")
                        } else if isSending || (composer.pending != nil && error == nil) {
                            BlankLoadingIndicator(color: foreground)
                        } else {
                            Text(greeting ?? (spanish ? "Hola, ¿cómo estás hoy?" : "Hey, how are you doing today?"))
                                .font(.blankInter(size: 20))
                                .fixedSize(horizontal: false, vertical: true)
                            if simulatorGuest {
                                Text("Simulator navigation preview")
                                    .font(.blankInter(size: 14, relativeTo: .footnote))
                                    .foregroundStyle(foreground.opacity(0.65))
                            }
                            if requiresVerification {
                                Button(spanish ? "Iniciar sesión con Apple" : "Sign in with Apple") { showAccountSignIn = true }
                                    .font(.blankInter(size: 17, weight: .semibold))
                                    .frame(minHeight: 44)
                            }
                        }

                    }
                        .frame(maxWidth: 640, alignment: .leading)
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, 24)
                        .padding(.vertical, 16)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .frame(maxHeight: .infinity)
                    .clipped()
                    Spacer(minLength: 0)
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 8) {
                    status
                    composerBar
                }.padding(.bottom, 8).background(background)
            }
            .animation(.easeInOut(duration: reduceMotion ? 0.12 : 0.3), value: waiting)
            .animation(.easeInOut(duration: reduceMotion ? 0.12 : 0.3), value: isLoading)
            .animation(.easeInOut(duration: reduceMotion ? 0.12 : 0.3), value: latest?.id)
        }
            }
        }
        .foregroundStyle(foreground)
        .background(background.ignoresSafeArea())
        .preferredColorScheme(dark ? .dark : .light)
        .task {
            #if DEBUG
            if usesHomePresentation && preview {
                loadHomePreview()
                return
            }
            #endif
            #if targetEnvironment(simulator)
            if simulatorGuest {
                isLoading = false
                composer.draft = initialMessage ?? ""
                return
            }
            #endif
            #if DEBUG
            if preview { loadPreview(); return }
            #endif
            restoreOwner()
            await reload()
            if !initialMessageHandled, let text = initialMessage?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
                initialMessageHandled = true
                composer.draft = text
                persist()
                if composer.pending == nil { await send() }
            }
        }
        .onChange(of: speech.transcript) { transcript in
            if acceptingSpeech && !transcript.isEmpty && composer.pending == nil {
                acceptingSpeech = false
                Task { await send(audioText: transcript) }
            }
        }
        .task(id: recoveryTaskID) { await recoverPendingMessage() }
        .onChange(of: speech.error) { value in
            if let value {
                error = value
                canRetry = false
            }
        }
        .onChange(of: composer.draft) { _ in
            saveTask?.cancel()
            saveTask = Task { @MainActor in
                do { try await Task.sleep(nanoseconds: 300_000_000) } catch { return }
                persist()
            }
        }
        .onReceive(Timer.publish(every: 8, on: .main, in: .common).autoconnect()) { _ in
            if scenePhase == .active { BlankBrain.shared.chatIsOpen = isHomeVisible; BlankBrain.shared.sync() }
            guard isHomeVisible, scenePhase == .active, !preview, !simulatorGuest, !isSending else { return }
            if composer.pending != nil || latest.map({ !$0.actionId.isEmpty && !AssistantActionCopy.terminal.contains($0.actionStatus) }) == true {
                Task { await reload() }
            }
        }
        .onChange(of: scenePhase) { phase in
            BlankBrain.shared.chatIsOpen = phase == .active && isHomeVisible
            if phase == .active && !preview && !simulatorGuest { Task { restoreOwner(); await reload() } }
            else {
                // Permission alerts temporarily deactivate the scene. Keep that
                // pending request; stop audio when leaving or while interrupted.
                if phase == .background || speech.isRecording {
                    acceptingSpeech = false
                    speech.stop()
                }
                persist()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: AssistantAppSession.didChangeNotification)) { _ in
            guard !preview, !simulatorGuest, restoreOwner() else { return }
            Task { await reload() }
        }
        .onDisappear { acceptingSpeech = false; speech.stop(); saveTask?.cancel(); persist() }
        .sheet(isPresented: $showHistory) {
            AssistantAppHistoryView(turns: turns, nextBefore: nextHistoryCursor,
                foreground: foreground, background: background, onApplyAction: { id in Task { await applyAction(id) } })
                .preferredColorScheme(dark ? .dark : .light)
        }
        .onAppear { BlankBrain.shared.chatIsOpen = isHomeVisible; BlankBrain.shared.sync() }
        .onChange(of: isHomeVisible) { visible in
            BlankBrain.shared.chatIsOpen = visible && scenePhase == .active
            BlankBrain.shared.sync()
            onConversationActivityChanged(visible && (waiting || speech.isRecording || speech.isStarting))
            if !visible { acceptingSpeech = false; speech.stop(); composerFocused = false; persist() }
        }
        .onChange(of: waiting || speech.isRecording || speech.isStarting) { busy in
            onConversationActivityChanged(isHomeVisible && busy)
        }
        .onDisappear { BlankBrain.shared.chatIsOpen = false; BlankBrain.shared.sync() }
        .sheet(isPresented: $showAccountSignIn, onDismiss: { Task { restoreOwner(); await reload() } }) {
            AppAccountSignInSheet()
        }
    }

    @State private var showingHomeKeyboard = false

    private var homeConversation: some View {
        GeometryReader { geometry in
            let panelHeight = MinimalHomeDesign.panelHeight(geometry.size.height, bottomInset: geometry.safeAreaInsets.bottom)
            let contentTop = MinimalHomeDesign.navigationTop(geometry.safeAreaInsets.top) + 68
            let contentHeight = max(80, panelHeight - contentTop - 88)
            VStack(spacing: 0) {
                ZStack(alignment: .top) {
                    Image("MinimalAtmosphere")
                        .resizable()
                        .scaledToFill()
                        .frame(width: geometry.size.width, height: panelHeight)
                        .clipped()
                    // Retain the web's actual material, with enough shade for readable ivory text.
                    Color.black.opacity(0.28)
                    ScrollView {
                        VStack(spacing: 22) {
                            if speech.isRecording || speech.isStarting {
                                Text(spanish ? "Te escucho…" : "I'm listening…")
                                    .font(MinimalHomeDesign.font(26, relativeTo: .title3))
                                AssistantAudioWaveform(audio: speech)
                                    .frame(maxWidth: 240, minHeight: 50)
                            } else if let latest {
                                homeResponse(latest.assistantText)
                                    .accessibilityLabel("Blankmind: \(latest.assistantText)")
                            } else if isSending || (composer.pending != nil && error == nil) {
                                BlankLoadingIndicator(color: foreground)
                            } else {
                                homeResponse(greeting ?? (spanish ? "Hola, ¿cómo estás hoy?" : "Hey, how are you doing today?"))
                            }
                            if error != nil || isApplyingAction || draftTooLong || requiresVerification
                                || latest.map({ !$0.actionId.isEmpty || $0.controlSection != nil }) == true {
                                status
                            }
                        }
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity, minHeight: contentHeight, alignment: .center)
                        .padding(.horizontal, 28)
                        .padding(.vertical, 14)
                    }
                    .scrollIndicators(.hidden)
                    .padding(.top, contentTop)
                    .frame(height: panelHeight)
                }
                .frame(height: panelHeight)
                .clipShape(MinimalHomePanelShape())
                .accessibilityIdentifier("home-chat-panel")

                Button {
                    guard !simulatorGuest else { return }
                    if requiresVerification { showAccountSignIn = true; return }
                    if !speech.isRecording && !speech.isStarting {
                        composerFocused = false
                        acceptingSpeech = true
                    }
                    speech.toggle()
                } label: {
                    Group {
                        if speech.isStarting {
                            ProgressView().tint(MinimalHomeDesign.voiceInk)
                        } else if speech.isRecording {
                            RoundedRectangle(cornerRadius: 2).frame(width: 14, height: 14)
                        } else {
                            MinimalVoiceGlyph()
                        }
                    }
                    .foregroundStyle(MinimalHomeDesign.voiceInk)
                    .frame(width: 70, height: 70)
                    .background(Circle().fill(MinimalHomeDesign.ink))
                    .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .disabled(waiting || speech.isStarting)
                .opacity(waiting ? 0.5 : 1)
                .accessibilityLabel(speech.isRecording ? (spanish ? "Enviar audio" : "Send audio") : (spanish ? "Hablar con Blankmind" : "Speak to Blankmind"))
                .accessibilityHint(spanish ? "Toca para hablar. Toca de nuevo para enviar. Mantén pulsado para escribir." : "Tap to speak. Tap again to send. Hold to write.")
                .accessibilityIdentifier("home-voice")
                .contextMenu {
                    Button { showingHomeKeyboard = true } label: {
                        Label(spanish ? "Escribir un mensaje" : "Write a message", systemImage: "keyboard")
                    }
                }
                .padding(.top, 22)
                Spacer(minLength: 0)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
            .background(MinimalHomeDesign.base)
            .sheet(isPresented: $showingHomeKeyboard) {
                VStack(spacing: 20) {
                    HStack {
                        Text(spanish ? "Mensaje para Blankmind" : "Message Blankmind")
                            .font(MinimalHomeDesign.font(20))
                        Spacer()
                        Button(spanish ? "Listo" : "Done") { showingHomeKeyboard = false }
                            .frame(minHeight: 44)
                    }.padding(.horizontal, 24)
                    composerBar
                }
                .padding(.vertical, 20)
                .foregroundStyle(BlankColors.charcoal)
                .background(MinimalHomeDesign.base)
                .presentationDetents([.height(200), .medium])
                .presentationDragIndicator(.visible)
                .onAppear { composerFocused = true }
            }
        }
    }

    private func homeResponse(_ text: String) -> some View {
        Text(text)
            .font(MinimalHomeDesign.font(26, relativeTo: .title3))
            .lineSpacing(3)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
            .frame(maxWidth: 360)
            .onTapGesture { showingHomeKeyboard = true }
            .accessibilityAction(named: Text(spanish ? "Escribir un mensaje" : "Write a message")) { showingHomeKeyboard = true }
    }

    private func controlSection(_ name: String) -> HomeSection? {
        switch name {
        case "report": return .report
        case "schedule": return .schedule
        case "distractions": return .distractions
        case "settings": return .settings
        case "emergency": return .emergency
        default: return nil
        }
    }

    @ViewBuilder private var status: some View {
        VStack(alignment: usesHomePresentation ? .center : .leading, spacing: 8) {
            if let latest {
                            if let name = latest.controlSection, let section = controlSection(name) {
                                Button(spanish ? "Abrir" : "Open") { openControls(section) }
                                    .font(usesHomePresentation ? MinimalHomeDesign.font(16) : .blankOnboardingControl)
                            }
                            if latest.canApply && !waiting {
                                Button {
                                    Task { await applyAction(latest.actionId) }
                                } label: {
                                    Text(latest.actionLabel.isEmpty ? (spanish ? "Aplicar ahora" : "Apply now") : latest.actionLabel)
                                        .font(usesHomePresentation ? MinimalHomeDesign.font(16) : .blankOnboardingControl)
                                        .multilineTextAlignment(.leading)
                                        .padding(.horizontal, 16)
                                        .padding(.vertical, 12)
                                        .frame(minHeight: 44)
                                        .background(RoundedRectangle(cornerRadius: 4).fill(dark ? BlankColors.pureWhite : BlankColors.charcoal))
                                        .foregroundStyle(dark ? BlankColors.charcoal : BlankColors.pureWhite)
                                }
                                .disabled(isApplyingAction)
                                .accessibilityHint(spanish ? "Aplica la acción sobre tus distracciones seleccionadas" : "Applies the action to your selected distractions")
                            } else if !latest.actionId.isEmpty && !latest.canApply {
                                Text(AssistantActionCopy.outcome(latest.actionStatus, spanish: spanish))
                                    .font(usesHomePresentation ? MinimalHomeDesign.font(15) : .blankInter(size: 15))
                                    .foregroundStyle(foreground.opacity(0.74))
                            }
            }
            if let error {
                Text(error)
                    .foregroundStyle(usesHomePresentation ? foreground : (dark ? Color(red: 1, green: 0.66, blue: 0.64) : BlankColors.red))
                    .fixedSize(horizontal: false, vertical: true)
                if let pending = composer.pending {
                    Text((spanish ? "Pendiente: " : "Pending: ") + pending.text)
                        .lineLimit(2)
                        .foregroundStyle(foreground.opacity(0.74))
                        .accessibilityLabel((spanish ? "Mensaje pendiente: " : "Pending message: ") + pending.text)
                }
                if requiresVerification {
                    Button(spanish ? "Iniciar sesión con Apple" : "Sign in with Apple") { showAccountSignIn = true }.frame(minHeight: 44)
                } else if canRetry {
                    Button(spanish ? "Reintentar" : "Try again") {
                        Task {
                            if composer.pending != nil { await send() }
                            else { await reload() }
                        }
                    }
                    .font(usesHomePresentation ? MinimalHomeDesign.font(15) : .blankInter(size: 15, weight: .semibold))
                    .frame(minHeight: 44)
                    .disabled(isSending)
                }
            } else if isApplyingAction {
                BlankLoadingIndicator(color: foreground)
            }
            if draftTooLong {
                Text(spanish ? "Acorta el mensaje a 4.000 caracteres." : "Keep your message under 4,000 characters.")
            }
        }
        .font(usesHomePresentation ? MinimalHomeDesign.font(14) : .blankInter(size: 14))
        .frame(maxWidth: 640, alignment: usesHomePresentation ? .center : .leading)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 28)
        .padding(.bottom, 10)
        .accessibilityElement(children: .contain)
    }

    private var composerBar: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 0) {
                    composerField
                    HStack(spacing: 12) {
                        Spacer(minLength: 0)
                        composerActions
                    }
                    .padding(.bottom, 6)
                }
            } else {
                HStack(alignment: .bottom, spacing: 4) {
                    composerField
                    composerActions
                }
            }
        }
        .padding(.leading, 18).padding(.trailing, 16)
        .background(RoundedRectangle(cornerRadius: 28).fill(usesHomePresentation ? MinimalHomeDesign.voiceInk.opacity(0.08) : foreground.opacity(dark ? 0.11 : 0.06)))
        .frame(maxWidth: 640)
        .padding(.horizontal, 22)
        .layoutPriority(1)
    }

    @ViewBuilder private var composerField: some View {
        if speech.isRecording || speech.isStarting || speech.hasAudio {
            AssistantAudioWaveform(audio: speech)
        } else {
        TextField("", text: $composer.draft,
                      prompt: Text(spanish ? "Escribe un mensaje" : "Write a message")
                        .foregroundColor((usesHomePresentation ? MinimalHomeDesign.voiceInk : foreground).opacity(0.72)), axis: .vertical)
                .font(usesHomePresentation ? MinimalHomeDesign.font(17) : .blankInter(size: 17))
                .foregroundStyle(usesHomePresentation ? MinimalHomeDesign.voiceInk : foreground)
                .lineLimit(1...(dynamicTypeSize.isAccessibilitySize ? 2 : 5))
                .focused($composerFocused)
                .submitLabel(.send)
                .onSubmit { if composer.pending == nil { Task { await send() } } }
                .padding(.vertical, 14)
                .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
                .disabled(requiresVerification || simulatorGuest)
                .accessibilityLabel(spanish ? "Mensaje para Blankmind" : "Message Blankmind")
        }
    }

    @ViewBuilder private var composerActions: some View {
        Button {
                if !speech.isRecording && !speech.isStarting {
                    composerFocused = false
                    acceptingSpeech = true
                }
                speech.toggle()
            } label: {
                Image(systemName: speech.isRecording || speech.isStarting ? "stop.circle.fill" : "mic")
                    .font(.system(size: 22)).frame(width: 44, height: 50)
            }
            .fixedSize(horizontal: true, vertical: false)
            .foregroundStyle(usesHomePresentation ? MinimalHomeDesign.voiceInk : foreground)
            .disabled(requiresVerification || simulatorGuest || waiting || speech.isStarting)
            .opacity(requiresVerification || isSending ? 0.45 : 1)
            .accessibilityLabel(speech.isRecording || speech.isStarting
                                ? (spanish ? "Enviar audio" : "Send audio")
                                : (spanish ? "Grabar audio" : "Record audio"))
            if !speech.hasAudio && !speech.isRecording && !speech.isStarting && !composer.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Button { Task { await send() } } label: {
                    Image(systemName: "arrow.up.circle.fill").font(.system(size: 29))
                        .frame(width: 44, height: 50)
                }
                .fixedSize(horizontal: true, vertical: false)
                .foregroundStyle(usesHomePresentation ? MinimalHomeDesign.voiceInk : foreground)
                .disabled(waiting || draftTooLong || requiresVerification || simulatorGuest)
                .opacity(waiting || draftTooLong || requiresVerification ? 0.45 : 1)
                .accessibilityLabel(spanish ? "Enviar mensaje" : "Send message")
            }
    }

    private func applyAction(_ actionID: String) async {
        guard !isApplyingAction, !actionID.isEmpty, owner == AssistantAppSession.userID else { return }
        isApplyingAction = true
        defer { isApplyingAction = false }
        acceptingSpeech = false
        speech.stop()
        composerFocused = false
        showHistory = false
        do {
            try await onApplyAction(actionID)
            guard owner == AssistantAppSession.userID else { throw AssistantAppError.sessionChanged }
            if usesHomePresentation { onHomeActionPrepared() } else { dismiss() }
        } catch {
            handle(error)
        }
    }

    private func openControls(_ section: HomeSection?) {
        acceptingSpeech = false
        speech.stop()
        persist()
        if !usesHomePresentation { dismiss() }
        onOpenControls(section)
    }

    @discardableResult private func restoreOwner() -> Bool {
        let current = AssistantAppSession.userID ?? ""
        guard current != owner else { return false }
        acceptingSpeech = false
        speech.stop()
        saveTask?.cancel()
        conversationRevision += 1
        sendRequestID = nil
        reloadRequestID = nil
        isLoading = true
        owner = current
        turns = []
        visibleTurnID = nil
        nextHistoryCursor = nil
        composer = AssistantDraftVault.load(owner: current)
        error = nil
        requiresVerification = false
        canRetry = true
        return true
    }

    @discardableResult private func persist() -> Bool {
        guard !preview, !owner.isEmpty, owner == AssistantAppSession.userID else { return false }
        return AssistantDraftVault.save(composer, owner: owner)
    }

    private func reload() async {
        guard !preview, reloadRequestID == nil, !isSending else { return }
        let requestID = UUID()
        reloadRequestID = requestID
        let expectedOwner = owner
        let expectedRevision = conversationRevision
        defer {
            if reloadRequestID == requestID { reloadRequestID = nil; isLoading = false }
        }
        do {
            let page = try await AssistantAppClient().history()
            guard expectedOwner == owner, expectedOwner == AssistantAppSession.userID,
                  expectedRevision == conversationRevision else { return }
            turns = page.turns
            nextHistoryCursor = page.nextBefore
            requiresVerification = false
            if let pending = composer.pending {
                let recovered: AssistantAppTurn?
                if let stored = turns.first(where: { $0.id == pending.id && $0.status == "completed" }) { recovered = stored }
                else { recovered = try await AssistantAppClient().status(turnId: pending.id) }
                guard expectedOwner == owner, expectedOwner == AssistantAppSession.userID,
                      expectedRevision == conversationRevision else { return }
                if let recovered, recovered.status == "completed" {
                    accept(recovered)
                    error = nil
                } else if recovered == nil || recovered?.status == "failed" {
                    error = spanish ? "Tu mensaje está guardado. Reintenta para recuperar la respuesta." : "Your message is saved. Retry to recover the reply."
                    canRetry = true
                } else if recovered?.status == "processing" {
                    // Checking again resends the same durable identity. A crashed
                    // worker can be reclaimed by the server after its lease ends.
                    error = spanish ? "La respuesta sigue pendiente. Comprueba de nuevo para recuperarla." : "The reply is still pending. Check again to recover it."
                    canRetry = true
                }
            } else { error = nil }
        } catch {
            guard expectedOwner == owner, expectedRevision == conversationRevision else { return }
            handle(error)
        }
    }

    private func accept(_ turn: AssistantAppTurn) {
        if let index = turns.firstIndex(where: { $0.id == turn.id }) { turns[index] = turn }
        else { turns.append(turn) }
        if turn.status == "completed" {
            visibleTurnID = turn.id
            composer.complete(turn.id)
        }
        persist()
    }

    private var recoveryTaskID: String {
        guard !preview, !simulatorGuest, isHomeVisible, scenePhase == .active,
              !owner.isEmpty, let pending = composer.pending else { return "" }
        return owner + ":" + pending.id
    }

    // Bounded recovery of the durable turn, including after reopening the app.
    // Keep its original ID and payload: the server's lease prevents duplicate work.
    @MainActor private func recoverPendingMessage(delays: [UInt64] = [2_000_000_000, 8_000_000_000, 90_000_000_000]) async {
        let identity = recoveryTaskID
        guard !identity.isEmpty else { return }
        for delay in delays {
            do { try await Task.sleep(nanoseconds: delay) }
            catch { return }
            guard !Task.isCancelled, recoveryTaskID == identity,
                  owner == AssistantAppSession.userID else { return }
            while isSending {
                do { try await Task.sleep(nanoseconds: 1_000_000_000) }
                catch { return }
                guard recoveryTaskID == identity else { return }
            }
            await reload()
            guard !Task.isCancelled, recoveryTaskID == identity,
                  !requiresVerification, canRetry else { return }
            if composer.pending != nil {
                // Sending outlives this polling task when accept clears pending.
                let retry = Task { @MainActor in
                    guard recoveryTaskID == identity else { return }
                    await send(allowAutoApply: false)
                }
                await retry.value
            }
        }
    }

    private func send(audioText: String? = nil, allowAutoApply: Bool = true) async {
        guard !preview, !simulatorGuest, !isSending, !requiresVerification else { return }
        acceptingSpeech = false
        speech.stop()
        let before = composer
        guard let pending = composer.begin(audioText: audioText) else { return }
        guard persist() else {
            composer = before
            error = spanish ? "No se pudo guardar el mensaje en este iPhone. Reintenta." : "Could not save the message on this iPhone. Try again."
            canRetry = false
            return
        }
        composerFocused = false
        showingHomeKeyboard = false
        visibleTurnID = nil
        let requestID = UUID()
        sendRequestID = requestID
        conversationRevision += 1
        let expectedRevision = conversationRevision
        reloadRequestID = nil
        isLoading = false
        error = nil
        let expectedOwner = owner
        defer { if sendRequestID == requestID { sendRequestID = nil } }
        do {
            let turn = try await AssistantAppClient().send(text: pending.text, turnId: pending.id, context: await BlankBrain.shared.freshSnapshot())
            guard expectedOwner == owner, expectedOwner == AssistantAppSession.userID,
                  expectedRevision == conversationRevision else { return }
            accept(turn)
            requiresVerification = false
            if allowAutoApply, turn.autoApply == true, turn.canApply { await applyAction(turn.actionId) }
        } catch {
            guard expectedOwner == owner, expectedRevision == conversationRevision else { return }
            handle(error)
            if let recovered = try? await AssistantAppClient().status(turnId: pending.id),
               expectedOwner == owner, expectedOwner == AssistantAppSession.userID,
               expectedRevision == conversationRevision, recovered.status == "completed" {
                accept(recovered)
                self.error = nil
            }
        }
    }

    private func handle(_ failure: Error) {
        if failure is CancellationError { return }
        error = failure.localizedDescription
        let typed = failure as? AssistantAppError
        requiresVerification = typed?.requiresAccountSignIn == true
        canRetry = typed?.isRetryable ?? true
    }

    #if DEBUG
    private func loadHomePreview() {
        isLoading = false
        greeting = "Hello Alex,\nwhat's on your mind\nthis evening?"
        let scenario = AssistantAppPreview.scenario
        if scenario.contains("response") {
            turns = [AssistantAppTurn(id: "home-preview", userText: "Help me put my phone down tonight.",
                assistantText: "Let's make room for rest.\nPut your phone aside\nand take a quiet moment\nbefore bed.", status: "completed", actionId: "", actionLabel: "",
                actionStatus: "", createdAt: "2026-10-06T18:00:00Z")]
            visibleTurnID = "home-preview"
        } else if scenario.contains("long") {
            turns = [AssistantAppTurn(id: "home-long", userText: "Help me plan my evening.",
                assistantText: String(repeating: "Give yourself a quiet moment before bed. Put your phone somewhere you won't reach for it automatically.\n\n", count: 8),
                status: "completed", actionId: "", actionLabel: "", actionStatus: "", createdAt: "2026-10-06T18:00:00Z")]
            visibleTurnID = "home-long"
        } else if scenario.contains("error") {
            greeting = nil
            error = "No connection. Your message is saved. You can try again without sending it twice."
            composer.pending = .init(id: "home-pending", text: "Help me put my phone down tonight.")
        }
    }

    private func loadPreview() {
        isLoading = false
        let scenario = AssistantAppPreview.scenario
        if scenario == "loading" { isLoading = true; return }
        if scenario == "empty" || scenario == "active-empty" { return }
        if scenario == "signin" { requiresVerification = true; return }
        turns = [AssistantAppTurn(id: "preview", userText: "Necesito concentrarme esta tarde.",
            assistantText: "Me dijiste que las tardes son el momento más difícil.\n\n¿Protegemos tus distracciones durante 45 minutos?",
            status: "completed", actionId: "preview_action", actionLabel: "Bloquear 45 min",
            actionStatus: scenario == "active" ? "verified" : "queued", createdAt: "2026-09-26T12:00:00Z")]
        visibleTurnID = "preview"
        if scenario == "error" || scenario == "active-error" {
            visibleTurnID = nil
            error = "No hay conexión. Tu mensaje está guardado; puedes reintentar sin enviarlo dos veces."
            composer.pending = .init(id: "preview_pending", text: "Bloquea ahora 45 minutos.")
            composer.draft = "Después quiero revisar mis horarios."
        }
        if scenario == "history" {
            turns.append(AssistantAppTurn(id: "preview_followup", userText: "Gracias.",
                assistantText: "Aquí estoy cuando lo necesites.", status: "completed",
                actionId: "", actionLabel: "", actionStatus: "", createdAt: "2026-09-26T12:01:00Z"))
            showHistory = true
        }
    }
    #endif
}

enum AssistantActionCopy {
    static let terminal: Set<String> = ["verified", "delayed", "failed", "dismissed", "expired", "superseded"]

    static func outcome(_ status: String, spanish: Bool) -> String {
        switch status {
        case "verified": return spanish ? "Aplicado y verificado en el iPhone" : "Applied and verified on iPhone"
        case "delayed": return spanish ? "Aplicado con retraso" : "Applied after a delay"
        case "failed": return spanish ? "No se pudo aplicar en el iPhone. Revisa permisos y distracciones." : "Could not apply on iPhone. Check permissions and distractions."
        case "dismissed": return spanish ? "Cancelado" : "Cancelled"
        case "expired", "superseded": return spanish ? "Esta acción ya no está disponible. Puedes pedir una nueva." : "This action is no longer available. You can request a new one."
        default: return spanish ? "Esperando confirmación del iPhone" : "Waiting for iPhone confirmation"
        }
    }
}

struct AssistantAppHistoryView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var turns: [AssistantAppTurn]
    @State private var nextBefore: String?
    @State private var loading = true
    @State private var hasFreshSnapshot = false
    @State private var requestID: UUID?
    @State private var error: String?
    let foreground: Color
    let background: Color
    let onApplyAction: (String) -> Void
    @State private var owner: String?
    private var spanish: Bool { Locale.current.languageCode == "es" }
    private var preview: Bool {
        #if DEBUG
        return AssistantAppPreview.scenario == "history"
        #else
        return false
        #endif
    }

    init(turns: [AssistantAppTurn], nextBefore: String?, foreground: Color, background: Color,
         onApplyAction: @escaping (String) -> Void) {
        _turns = State(initialValue: turns)
        _nextBefore = State(initialValue: nextBefore)
        self.foreground = foreground
        self.background = background
        self.onApplyAction = onApplyAction
        _owner = State(initialValue: AssistantAppSession.userID)
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { scroll in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 24) {
                        if nextBefore != nil {
                            Button(loading ? (spanish ? "Cargando…" : "Loading…") : (spanish ? "Cargar anteriores" : "Load earlier")) {
                                Task { await loadEarlier() }
                            }
                            .disabled(loading || !hasFreshSnapshot)
                            .font(.blankInter(size: 15, weight: .medium)).frame(minHeight: 44)
                        }
                        if let error {
                            Text(error).font(.blankInter(size: 14)).foregroundStyle(.red)
                            Button(spanish ? "Actualizar historial" : "Refresh history") {
                                Task { await refresh() }
                            }
                            .font(.blankInter(size: 15, weight: .medium))
                            .frame(minHeight: 44)
                            .disabled(loading)
                        } else if loading {
                            ProgressView(spanish ? "Actualizando historial…" : "Updating history…")
                                .font(.blankInter(size: 14)).tint(foreground)
                        }
                        if turns.isEmpty && !loading && error == nil {
                            Text(spanish ? "Tus mensajes y las respuestas aparecerán aquí." : "Your messages and replies will appear here.")
                                .font(.blankInter(size: 17)).padding(.top, 32)
                        }
                        ForEach(turns) { turn in
                            VStack(alignment: .leading, spacing: 10) {
                                Text(spanish ? "Tú" : "You").font(.blankInter(size: 13, weight: .semibold))
                                    .foregroundStyle(foreground.opacity(0.86))
                                Text(turn.userText).font(.blankInter(size: 17)).textSelection(.enabled)
                                Text("Blankmind").font(.blankInter(size: 13, weight: .semibold))
                                    .foregroundStyle(foreground.opacity(0.86)).padding(.top, 8)
                                Text(turn.assistantText.isEmpty ? (spanish ? "Respuesta pendiente" : "Reply pending") : turn.assistantText)
                                    .font(.blankInter(size: 17)).textSelection(.enabled)
                                if !turn.actionId.isEmpty {
                                    if hasFreshSnapshot && error == nil && turn.canApply {
                                        Button {
                                            Task { await apply(turn) }
                                        } label: {
                                            Text(turn.actionLabel.isEmpty ? (spanish ? "Aplicar ahora" : "Apply now") : turn.actionLabel)
                                                .font(.blankOnboardingControl)
                                                .multilineTextAlignment(.leading)
                                                .padding(.horizontal, 20)
                                                .padding(.vertical, 12)
                                                .frame(minHeight: 44)
                                                .background(RoundedRectangle(cornerRadius: 4).fill(foreground))
                                                .foregroundStyle(background)
                                        }
                                        .disabled(loading)
                                        .accessibilityHint(spanish ? "Comprueba y aplica esta acción sobre tus distracciones seleccionadas" : "Checks and applies this action to your selected distractions")
                                    } else {
                                        Text(hasFreshSnapshot
                                             ? AssistantActionCopy.outcome(turn.actionStatus, spanish: spanish)
                                             : (spanish ? "Estado pendiente de actualizar" : "Waiting for an updated status"))
                                            .font(.blankInter(size: 14)).foregroundStyle(foreground.opacity(0.86))
                                    }
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .id(turn.id)
                            Divider()
                        }
                    }
                    .frame(maxWidth: 640).padding(24)
                }
                .background(background)
                .onAppear { if let id = turns.last?.id { scroll.scrollTo(id, anchor: .bottom) } }
                .onChange(of: hasFreshSnapshot) { fresh in
                    if fresh, let id = turns.last?.id { scroll.scrollTo(id, anchor: .bottom) }
                }
            }
            .navigationTitle(spanish ? "Historial" : "Conversation history")
            .minimalSheetStyle()
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(spanish ? "Listo" : "Done") { dismiss() } } }
        }
        .foregroundStyle(foreground)
        .tint(foreground)
        .task { await refresh() }
        .onChange(of: scenePhase) { phase in
            if phase == .active { Task { await refresh() } }
            else { invalidateSnapshot() }
        }
        .onDisappear { invalidateSnapshot() }
        .onReceive(NotificationCenter.default.publisher(for: AssistantAppSession.didChangeNotification)) { _ in
            validateOwner()
        }
    }

    @discardableResult private func validateOwner() -> Bool {
        guard owner == AssistantAppSession.userID else {
            invalidateSnapshot()
            turns = []
            nextBefore = nil
            error = spanish ? "La cuenta ha cambiado. Cierra el historial para continuar." : "The account changed. Close history to continue."
            return false
        }
        return true
    }

    private func invalidateSnapshot() {
        hasFreshSnapshot = false
        requestID = nil
        loading = false
    }

    private func refresh() async {
        if preview {
            hasFreshSnapshot = true
            loading = false
            return
        }
        guard validateOwner(), requestID == nil else { return }
        let id = UUID()
        requestID = id
        loading = true
        hasFreshSnapshot = false
        error = nil
        defer { if requestID == id { requestID = nil; loading = false } }
        do {
            let page = try await AssistantAppClient().history()
            guard validateOwner(), requestID == id else { return }
            turns = page.turns
            nextBefore = page.nextBefore
            hasFreshSnapshot = true
        } catch {
            guard validateOwner(), requestID == id else { return }
            self.error = error.localizedDescription
        }
    }

    private func apply(_ turn: AssistantAppTurn) async {
        guard !preview else { return }
        guard validateOwner(), hasFreshSnapshot, !loading, error == nil, turn.canApply else { return }
        let id = UUID()
        requestID = id
        loading = true
        defer { if requestID == id { requestID = nil; loading = false } }
        do {
            // The action may have expired, been cancelled or superseded while
            // reading older messages. Revalidate the exact server ID before Home.
            let current = try await AssistantAppClient().status(turnId: turn.id)
            guard validateOwner(), requestID == id else { return }
            if let current, let index = turns.firstIndex(where: { $0.id == current.id }) {
                turns[index] = current
            }
            guard let current, current.canApply, current.actionId == turn.actionId else {
                hasFreshSnapshot = false
                error = spanish ? "Esta acción ya no está disponible. Actualiza el historial." : "This action is no longer available. Refresh history."
                return
            }
            dismiss()
            onApplyAction(current.actionId)
        } catch {
            guard validateOwner(), requestID == id else { return }
            hasFreshSnapshot = false
            self.error = error.localizedDescription
        }
    }

    private func loadEarlier() async {
        guard !preview else { return }
        guard validateOwner(), hasFreshSnapshot, let cursor = nextBefore, !loading else { return }
        let id = UUID()
        requestID = id
        loading = true
        error = nil
        defer { if requestID == id { requestID = nil; loading = false } }
        do {
            let page = try await AssistantAppClient().history(before: cursor)
            guard validateOwner(), requestID == id else { return }
            let ids = Set(turns.map(\.id))
            turns.insert(contentsOf: page.turns.filter { !ids.contains($0.id) }, at: 0)
            nextBefore = page.nextBefore
        } catch {
            guard validateOwner(), requestID == id else { return }
            hasFreshSnapshot = false
            self.error = error.localizedDescription
        }
    }
}

#if DEBUG
enum AssistantAppPreview {
    static var scenario: String { ProcessInfo.processInfo.environment["BLANK_UI_SCENARIO"] ?? "" }
    static var enabled: Bool { !scenario.isEmpty }
}
#endif


private struct BlankLoadingIndicator: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    let color: Color

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion || scenePhase != .active)) { timeline in
            HStack(spacing: 6) {
                ForEach(0..<3) { index in
                    Circle()
                        .fill(color)
                        .frame(width: 5, height: 5)
                        .opacity(reduceMotion ? 0.6 : 0.25 + 0.65 * (1 + sin(timeline.date.timeIntervalSinceReferenceDate * 4 - Double(index) * 0.8)) / 2)
                }
            }
            .frame(height: 24)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Locale.current.languageCode == "es" ? "Cargando" : "Loading")
    }
}


private struct AssistantComposerHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 56
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}
