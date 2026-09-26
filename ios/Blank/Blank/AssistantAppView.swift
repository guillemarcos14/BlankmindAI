import AVFoundation
import Security
import Speech
import SwiftUI

enum AssistantAppSession {
    private static let service = "com.blanknfc.app.assistant.session"
    private static let lock = NSLock()
    static let didChangeNotification = Notification.Name("BlankAssistantSessionDidChange")

    private struct Credentials: Codable {
        let access: String
        let refresh: String
    }

    @discardableResult static func save(accessToken: String, refreshToken: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return saveCredentials(accessToken: accessToken, refreshToken: refreshToken)
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

    static func replace(accessToken: String, refreshToken: String, ifCurrent expected: String) -> String? {
        lock.lock()
        defer { lock.unlock() }
        guard readToken("access") == expected else { return readToken("access") }
        _ = saveCredentials(accessToken: accessToken, refreshToken: refreshToken)
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

    private static func saveCredentials(accessToken: String, refreshToken: String) -> Bool {
        guard !accessToken.isEmpty, !refreshToken.isEmpty,
              let data = try? JSONEncoder().encode(Credentials(access: accessToken, refresh: refreshToken)) else { return false }
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

    var canApply: Bool {
        !actionId.isEmpty && ["queued", "delivered"].contains(actionStatus)
    }
}

private struct AssistantAppEnvelope: Decodable {
    let ok: Bool
    let turns: [AssistantAppTurn]?
    let turn: AssistantAppTurn?
    let nextBefore: String?
}

struct AssistantAppHistoryPage {
    let turns: [AssistantAppTurn]
    let nextBefore: String?
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

    var requiresPhoneVerification: Bool {
        switch self {
        case .authenticationRequired, .installationNotVerified, .sessionChanged: return true
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
            return spanish ? "Verifica tu teléfono para continuar. Tu mensaje sigue guardado." : "Verify your phone to continue. Your message is still saved."
        case .installationNotVerified:
            return spanish ? "Verifica tu teléfono para vincular este iPhone con tu cuenta." : "Verify your phone to link this iPhone to your account."
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

    func history(before: String? = nil) async throws -> AssistantAppHistoryPage {
        let result = try await request(action: "history", extra: before.map { ["before": $0] } ?? [:])
        return AssistantAppHistoryPage(turns: result.turns ?? [], nextBefore: result.nextBefore)
    }

    func send(text: String, turnId: String) async throws -> AssistantAppTurn {
        let result = try await request(action: "send", extra: ["text": text, "turn_id": turnId])
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
        guard let access = AssistantAppSession.token("access") else {
            throw AssistantAppError.authenticationRequired
        }
        let userID = AssistantAppSession.userID
        var body = extra
        body["action"] = action
        body["app_install_id"] = BlankSharedState.appInstallId
        let payload = try JSONSerialization.data(withJSONObject: body)
        let first = try await post(base: base, path: "assistant-app", payload: payload, token: access)
        guard userID == AssistantAppSession.userID else { throw AssistantAppError.sessionChanged }
        if first.1.statusCode == 401 {
            let refreshed = try await sessionRefresh.accessToken(rejected: access) {
                try await refresh(base: base, rejectedToken: access)
            }
            guard userID == AssistantAppSession.userID else { throw AssistantAppError.sessionChanged }
            try Task.checkCancellation()
            let retried = try await post(base: base, path: "assistant-app", payload: payload, token: refreshed)
            guard userID == AssistantAppSession.userID else { throw AssistantAppError.sessionChanged }
            return try decode(retried)
        }
        return try decode(first)
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
        // A completed OTP sign-in wins over an older refresh still in flight.
        guard let saved = AssistantAppSession.replace(accessToken: access,
            refreshToken: data["refresh_token"] as? String ?? refresh, ifCurrent: rejectedToken),
              saved != rejectedToken else { throw AssistantAppError.authenticationRequired }
        return saved
    }

    private func post(base: URL, path: String, payload: Data, token: String?) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: base.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.httpBody = payload
        request.timeoutInterval = 60
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

    private let engine = AVAudioEngine()
    private let recognizer = SFSpeechRecognizer(locale: Locale.current)
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var generation = UUID()
    private var tapInstalled = false
    private var audioSessionActive = false
    private var interruptionObserver: NSObjectProtocol?

    init() {
        interruptionObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
        ) { [weak self] notification in
            guard let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
            Task { @MainActor [weak self] in self?.stop() }
        }
    }

    deinit {
        if let interruptionObserver { NotificationCenter.default.removeObserver(interruptionObserver) }
    }

    private func message(_ spanish: String, _ english: String) -> String {
        Locale.current.languageCode == "es" ? spanish : english
    }

    func toggle() {
        if isRecording || isStarting { stop(); return }
        generation = UUID()
        let current = generation
        isStarting = true
        transcript = ""
        error = nil
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                guard let self, self.generation == current, self.isStarting else { return }
                guard status == .authorized else {
                    self.isStarting = false
                    self.error = self.message("Activa Reconocimiento de voz en Ajustes.", "Enable Speech Recognition in Settings.")
                    return
                }
                AVAudioSession.sharedInstance().requestRecordPermission { [weak self] allowed in
                    DispatchQueue.main.async {
                        guard let self, self.generation == current, self.isStarting else { return }
                        if allowed { self.start(generation: current) }
                        else {
                            self.isStarting = false
                            self.error = self.message("Activa el acceso al micrófono en Ajustes.", "Enable Microphone access in Settings.")
                        }
                    }
                }
            }
        }
    }

    private func start(generation current: UUID) {
        guard let recognizer, recognizer.isAvailable else {
            isStarting = false
            error = message("El dictado no está disponible ahora. Puedes escribir tu mensaje.", "Dictation is unavailable right now. You can type your message.")
            return
        }
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audio.setActive(true, options: .notifyOthersOnDeactivation)
            audioSessionActive = true
            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            self.request = request
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else {
                stop()
                error = message("No se detecta un micrófono disponible.", "No microphone is available.")
                return
            }
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                request.append(buffer)
            }
            tapInstalled = true
            engine.prepare()
            try engine.start()
            isStarting = false
            isRecording = true
            task = recognizer.recognitionTask(with: request) { [weak self] result, failure in
                DispatchQueue.main.async {
                    guard let self, self.generation == current else { return }
                    if let result { self.transcript = result.bestTranscription.formattedString }
                    if failure != nil || result?.isFinal == true {
                        self.stop()
                        if failure != nil {
                            self.error = self.message("El dictado se interrumpió. Conservamos el texto; puedes seguir escribiendo.", "Dictation stopped. Your text is kept; you can continue typing.")
                        }
                    }
                }
            }
        } catch {
            stop()
            self.error = message("No se pudo iniciar el micrófono. Puedes escribir o reintentar.", "Could not start the microphone. You can type or retry.")
        }
    }

    func stop() {
        // Invalidates permission prompts and callbacks from a previous session.
        generation = UUID()
        if engine.isRunning { engine.stop() }
        if tapInstalled {
            engine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil
        isRecording = false
        isStarting = false
        if audioSessionActive {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            audioSessionActive = false
        }
    }
}

struct AssistantAppView: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @StateObject private var speech = AssistantSpeechInput()
    @FocusState private var composerFocused: Bool
    @State private var turns: [AssistantAppTurn] = []
    @State private var nextHistoryCursor: String?
    @State private var composer = AssistantComposerState()
    @State private var owner = ""
    @State private var speechPrefix = ""
    @State private var acceptingSpeech = false
    @State private var sendRequestID: UUID?
    @State private var isLoading = true
    @State private var reloadRequestID: UUID?
    @State private var conversationRevision = 0
    @State private var error: String?
    @State private var requiresVerification = false
    @State private var canRetry = true
    @State private var showHistory = false
    @State private var showPhoneSignIn = false
    @State private var showWhatsApp = false
    @State private var saveTask: Task<Void, Never>?

    var onOpenControls: (HomeSection?) -> Void = { _ in }
    let onApplyAction: (String) -> Void

    private var latest: AssistantAppTurn? { turns.last(where: { $0.status == "completed" }) }
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
        if preview { return AssistantAppPreview.scenario == "active" }
        #endif
        return sessionStore.isBlankActive
    }
    private var foreground: Color { dark ? .white : BlankColors.charcoal }
    private var background: Color { dark ? BlankColors.charcoal : .white }
    private var draftTooLong: Bool { composer.draft.utf16.count > 4000 }
    private var isSending: Bool { sendRequestID != nil }
    private var waiting: Bool { isSending || composer.pending != nil }

    var body: some View {
        VStack(spacing: 0) {
            Menu {
                Button(spanish ? "Historial" : "Conversation history", systemImage: "clock.arrow.circlepath") { showHistory = true }
                Section {
                    Button(spanish ? "Distracciones" : "Distractions", systemImage: "apps.iphone") { openControls(.distractions) }
                    Button(spanish ? "Horarios" : "Schedules", systemImage: "calendar") { openControls(.schedule) }
                    Button(spanish ? "Progreso" : "Progress", systemImage: "chart.bar") { openControls(.report) }
                    Button(spanish ? "Ajustes" : "Settings", systemImage: "gearshape") { openControls(.settings) }
                }
                Section {
                    Button(spanish ? "Conexión WhatsApp" : "WhatsApp connection", systemImage: "message") { showWhatsApp = true }
                    Button(spanish ? "Verificar teléfono" : "Verify phone", systemImage: "iphone") { showPhoneSignIn = true }
                    Button(spanish ? "Controles de protección" : "Protection controls", systemImage: "hand.raised") { openControls(nil) }
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 23, weight: .bold))
                    .frame(width: 48, height: 48)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel(spanish ? "Menú de Blankmind" : "Blankmind menu")
            .frame(height: 56)
            .layoutPriority(1)
            .background(background)
            .zIndex(1)

            GeometryReader { geometry in
                ScrollView {
                    VStack(alignment: .leading, spacing: 26) {
                        if let latest {
                            Text(latest.assistantText)
                                .font(.blankInter(size: 28, weight: .regular, relativeTo: .largeTitle))
                                .tracking(-0.5)
                                .lineSpacing(4)
                                .fixedSize(horizontal: false, vertical: true)
                                .textSelection(.enabled)
                                .accessibilityLabel("Blankmind: \(latest.assistantText)")
                            if latest.canApply && !waiting {
                                Button {
                                    applyAction(latest.actionId)
                                } label: {
                                    Text(latest.actionLabel.isEmpty ? (spanish ? "Aplicar ahora" : "Apply now") : latest.actionLabel)
                                        .font(.blankInter(size: 17, weight: .semibold))
                                        .multilineTextAlignment(.leading)
                                        .padding(.horizontal, 26)
                                        .padding(.vertical, 14)
                                        .frame(minHeight: 52)
                                        .background(Capsule().fill(foreground))
                                        .foregroundStyle(background)
                                }
                                .accessibilityHint(spanish ? "Aplica la acción sobre tus distracciones seleccionadas" : "Applies the action to your selected distractions")
                            } else if !latest.actionId.isEmpty && !latest.canApply {
                                Text(AssistantActionCopy.outcome(latest.actionStatus, spanish: spanish))
                                    .font(.blankInter(size: 15))
                                    .foregroundStyle(foreground.opacity(0.74))
                            }
                        } else if isLoading {
                            ProgressView(spanish ? "Recuperando conversación…" : "Loading conversation…")
                                .font(.blankInter(size: 15)).tint(foreground)
                        } else {
                            Text(requiresVerification
                                 ? (spanish ? "Tu conversación, en la app y en WhatsApp." : "Your conversation, here and on WhatsApp.")
                                 : (spanish ? "¿Qué tienes en mente?" : "What is on your mind?"))
                                .font(.blankInter(size: 28, weight: .regular, relativeTo: .largeTitle))
                                .fixedSize(horizontal: false, vertical: true)
                            if requiresVerification {
                                Button(spanish ? "Verificar mi teléfono" : "Verify my phone") { showPhoneSignIn = true }
                                    .font(.blankInter(size: 17, weight: .semibold))
                                    .frame(minHeight: 44)
                            }
                        }
                        if dynamicTypeSize.isAccessibilitySize { status }
                    }
                    .frame(maxWidth: 640, alignment: .leading)
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: dynamicTypeSize.isAccessibilitySize ? 0 : geometry.size.height * 0.72, alignment: .center)
                    .padding(.horizontal, 28)
                    .padding(.vertical, 16)
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .clipped()

            if !dynamicTypeSize.isAccessibilitySize { status }
            composerBar
        }
        .foregroundStyle(foreground)
        .background(background.ignoresSafeArea())
        .preferredColorScheme(dark ? .dark : .light)
        .task {
            #if DEBUG
            if preview { loadPreview(); return }
            #endif
            restoreOwner()
            await reload()
        }
        .onChange(of: speech.transcript) { transcript in
            if acceptingSpeech { composer.draft = speechPrefix + transcript }
        }
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
            guard scenePhase == .active, !preview, !isSending else { return }
            if composer.pending != nil || latest.map({ !$0.actionId.isEmpty && !AssistantActionCopy.terminal.contains($0.actionStatus) }) == true {
                Task { await reload() }
            }
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active && !preview { Task { restoreOwner(); await reload() } }
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
            guard !preview, restoreOwner() else { return }
            Task { await reload() }
        }
        .onDisappear { acceptingSpeech = false; speech.stop(); saveTask?.cancel(); persist() }
        .sheet(isPresented: $showHistory) {
            AssistantAppHistoryView(turns: turns, nextBefore: nextHistoryCursor,
                foreground: foreground, background: background, onApplyAction: applyAction)
                .preferredColorScheme(dark ? .dark : .light)
        }
        .sheet(isPresented: $showPhoneSignIn, onDismiss: { Task { restoreOwner(); await reload() } }) {
            AppPhoneSignInSheet(initialPhone: BlankSharedState.defaults.string(forKey: "blankAssistantPhoneNumber") ?? "")
        }
        .sheet(isPresented: $showWhatsApp, onDismiss: { Task { await reload() } }) {
            AssistantConnectSheet(
                whatsAppNumber: Bundle.main.object(forInfoDictionaryKey: "BlankWhatsAppPhoneNumber") as? String,
                smsNumber: Bundle.main.object(forInfoDictionaryKey: "BlankSMSPhoneNumber") as? String,
                openURL: openURL, initialContext: [:]
            )
        }
    }

    @ViewBuilder private var status: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error {
                Text(error)
                    .foregroundStyle(dark ? Color(red: 1, green: 0.66, blue: 0.64) : BlankColors.red)
                    .fixedSize(horizontal: false, vertical: true)
                if let pending = composer.pending {
                    Text((spanish ? "Pendiente: " : "Pending: ") + pending.text)
                        .lineLimit(2)
                        .foregroundStyle(foreground.opacity(0.74))
                        .accessibilityLabel((spanish ? "Mensaje pendiente: " : "Pending message: ") + pending.text)
                }
                if requiresVerification {
                    if latest != nil { Button(spanish ? "Verificar teléfono" : "Verify phone") { showPhoneSignIn = true }.frame(minHeight: 44) }
                } else if canRetry {
                    Button(spanish ? "Reintentar" : "Try again") {
                        Task {
                            if composer.pending != nil { await send() }
                            else { await reload() }
                        }
                    }
                    .font(.blankInter(size: 15, weight: .semibold))
                    .frame(minHeight: 44)
                    .disabled(isSending)
                }
            } else if waiting {
                HStack(spacing: 10) {
                    ProgressView().tint(foreground)
                    Text(spanish ? "Blankmind está respondiendo…" : "Blankmind is replying…")
                }
            } else if speech.isRecording || speech.isStarting {
                Text(spanish ? "Dictando. Revisa el texto antes de enviar." : "Dictating. Review your words before sending.")
            }
            if draftTooLong {
                Text(spanish ? "Acorta el mensaje a 4.000 caracteres." : "Keep your message under 4,000 characters.")
            }
        }
        .font(.blankInter(size: 14))
        .frame(maxWidth: 640, alignment: .leading)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, dynamicTypeSize.isAccessibilitySize ? 0 : 28)
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
        .padding(.leading, 18).padding(.trailing, 8)
        .background(RoundedRectangle(cornerRadius: 28).fill(foreground.opacity(dark ? 0.11 : 0.06)))
        .frame(maxWidth: 640)
        .padding(.horizontal, 22).padding(.bottom, 12)
        .layoutPriority(1)
    }

    private var composerField: some View {
        TextField("", text: $composer.draft,
                      prompt: Text(spanish ? "Escribe un mensaje" : "Write a message")
                        .foregroundColor(foreground.opacity(0.72)), axis: .vertical)
                .font(.blankInter(size: 17))
                .lineLimit(1...(dynamicTypeSize.isAccessibilitySize ? 2 : 5))
                .focused($composerFocused)
                .submitLabel(.send)
                .onSubmit { if composer.pending == nil { Task { await send() } } }
                .padding(.vertical, 14)
                .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
                .disabled(requiresVerification)
                .accessibilityLabel(spanish ? "Mensaje para Blankmind" : "Message Blankmind")
    }

    @ViewBuilder private var composerActions: some View {
        Button {
                if !speech.isRecording && !speech.isStarting {
                    let prefix = composer.draft.trimmingCharacters(in: .whitespacesAndNewlines)
                    speechPrefix = prefix.isEmpty ? "" : "\(prefix) "
                    acceptingSpeech = true
                }
                speech.toggle()
            } label: {
                Image(systemName: speech.isRecording || speech.isStarting ? "stop.circle.fill" : "mic")
                    .font(.system(size: 22)).frame(width: 44, height: 50)
            }
            .fixedSize(horizontal: true, vertical: false)
            .disabled(requiresVerification || isSending)
            .opacity(requiresVerification || isSending ? 0.45 : 1)
            .accessibilityLabel(speech.isRecording || speech.isStarting
                                ? (spanish ? "Detener dictado" : "Stop dictation")
                                : (spanish ? "Dictar mensaje" : "Dictate message"))
            if !composer.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Button { Task { await send() } } label: {
                    Image(systemName: "arrow.up.circle.fill").font(.system(size: 29))
                        .frame(width: 44, height: 50)
                }
                .fixedSize(horizontal: true, vertical: false)
                .disabled(waiting || draftTooLong || requiresVerification)
                .opacity(waiting || draftTooLong || requiresVerification ? 0.45 : 1)
                .accessibilityLabel(spanish ? "Enviar mensaje" : "Send message")
            }
    }

    private func applyAction(_ actionID: String) {
        guard !actionID.isEmpty, owner == AssistantAppSession.userID else { return }
        acceptingSpeech = false
        speech.stop()
        composerFocused = false
        showHistory = false
        onApplyAction(actionID)
        dismiss()
    }

    private func openControls(_ section: HomeSection?) {
        acceptingSpeech = false
        speech.stop()
        persist()
        dismiss()
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
                if let stored = turns.first(where: { $0.id == pending.id }) { recovered = stored }
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
        if turn.status == "completed" { composer.complete(turn.id) }
        persist()
    }

    private func send() async {
        guard !preview, !isSending, !requiresVerification else { return }
        acceptingSpeech = false
        speech.stop()
        let before = composer
        guard let pending = composer.begin() else { return }
        guard persist() else {
            composer = before
            error = spanish ? "No se pudo guardar el mensaje en este iPhone. Reintenta." : "Could not save the message on this iPhone. Try again."
            canRetry = false
            return
        }
        composerFocused = false
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
            let turn = try await AssistantAppClient().send(text: pending.text, turnId: pending.id)
            guard expectedOwner == owner, expectedOwner == AssistantAppSession.userID,
                  expectedRevision == conversationRevision else { return }
            accept(turn)
            requiresVerification = false
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
        requiresVerification = typed?.requiresPhoneVerification == true
        canRetry = typed?.isRetryable ?? true
    }

    #if DEBUG
    private func loadPreview() {
        isLoading = false
        let scenario = AssistantAppPreview.scenario
        if scenario == "empty" { return }
        if scenario == "signin" { requiresVerification = true; return }
        turns = [AssistantAppTurn(id: "preview", userText: "Necesito concentrarme esta tarde.",
            assistantText: "Me dijiste que las tardes son el momento más difícil.\n\n¿Protegemos tus distracciones durante 45 minutos?",
            status: "completed", actionId: "preview_action", actionLabel: "Bloquear 45 min",
            actionStatus: scenario == "active" ? "verified" : "queued", createdAt: "2026-09-26T12:00:00Z")]
        if scenario == "error" {
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

private struct AssistantAppHistoryView: View {
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
                                    .foregroundStyle(foreground.opacity(0.74))
                                Text(turn.userText).font(.blankInter(size: 17)).textSelection(.enabled)
                                Text("Blankmind").font(.blankInter(size: 13, weight: .semibold))
                                    .foregroundStyle(foreground.opacity(0.74)).padding(.top, 8)
                                Text(turn.assistantText.isEmpty ? (spanish ? "Respuesta pendiente" : "Reply pending") : turn.assistantText)
                                    .font(.blankInter(size: 17)).textSelection(.enabled)
                                if !turn.actionId.isEmpty {
                                    if hasFreshSnapshot && error == nil && turn.canApply {
                                        Button {
                                            Task { await apply(turn) }
                                        } label: {
                                            Text(turn.actionLabel.isEmpty ? (spanish ? "Aplicar ahora" : "Apply now") : turn.actionLabel)
                                                .font(.blankInter(size: 15, weight: .semibold))
                                                .multilineTextAlignment(.leading)
                                                .padding(.horizontal, 20)
                                                .padding(.vertical, 12)
                                                .frame(minHeight: 44)
                                                .background(Capsule().fill(foreground))
                                                .foregroundStyle(background)
                                        }
                                        .disabled(loading)
                                        .accessibilityHint(spanish ? "Comprueba y aplica esta acción sobre tus distracciones seleccionadas" : "Checks and applies this action to your selected distractions")
                                    } else {
                                        Text(hasFreshSnapshot
                                             ? AssistantActionCopy.outcome(turn.actionStatus, spanish: spanish)
                                             : (spanish ? "Estado pendiente de actualizar" : "Waiting for an updated status"))
                                            .font(.blankInter(size: 14)).foregroundStyle(foreground.opacity(0.74))
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
