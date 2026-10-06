// The runner prepends the actual production models, errors and HTTP client.
enum BlankSharedState {
    static let appInstallId = "fixture-install"
    static let defaults = UserDefaults.standard
}

enum AssistantAppSession {
    private static let lock = NSLock()
    private static var credentials = [String: String]()
    static func token(_ account: String) -> String? {
        lock.lock(); defer { lock.unlock() }
        return credentials[account]
    }
    static var userID: String? { token("access")?.components(separatedBy: "#").last }
    static func save(accessToken: String, refreshToken: String) {
        lock.lock(); defer { lock.unlock() }
        credentials = ["access": accessToken, "refresh": refreshToken]
    }
    static func replace(accessToken: String, refreshToken: String, ifCurrent expected: String) -> String? {
        lock.lock(); defer { lock.unlock() }
        if credentials["access"] == expected {
            credentials = ["access": accessToken, "refresh": refreshToken]
        }
        return credentials["access"]
    }
}

private final class TransportStub: URLProtocol {
    struct Reply {
        var status = 200
        var body = "{}"
        var error: Error?
        var contentType = "application/json"
    }
    static var respond: (URLRequest) -> Reply = { _ in Reply() }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let reply = Self.respond(request)
        if let error = reply.error {
            client?.urlProtocol(self, didFailWithError: error)
            return
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: reply.status,
            httpVersion: "HTTP/1.1", headerFields: ["Content-Type": reply.contentType])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(reply.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private let historyReply = #"{"ok":true,"turns":[],"next_before":null}"#
private let processingReply = #"{"ok":true,"turn":{"id":"turn-1","user_text":"hello","assistant_text":"","status":"processing","action_id":"","action_label":"","action_status":"","created_at":"2026-09-26T10:00:00Z"},"retry_after":3}"#

private func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() { fatalError(message) }
}

@main
struct AssistantClientTests {
    static func main() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [TransportStub.self]
        let session = URLSession(configuration: config)
        let client = AssistantAppClient(session: session, baseURL: URL(string: "https://blank.test/api")!,
            sessionRefresh: AssistantAppSessionRefresh())
        AssistantAppSession.save(accessToken: "expired#A", refreshToken: "refresh-A")

        // Overlapping history reads share one rotating refresh token.
        var refreshes = 0
        var appRequests = 0
        TransportStub.respond = { request in
            if request.url!.lastPathComponent == "app-auth" {
                refreshes += 1
                Thread.sleep(forTimeInterval: 0.05)
                return .init(body: #"{"ok":true,"access_token":"fresh#A","refresh_token":"rotated-A"}"#)
            }
            appRequests += 1
            if request.value(forHTTPHeaderField: "Authorization") == "Bearer expired#A" {
                return .init(status: 401, body: #"{"error":"authentication_required"}"#)
            }
            return .init(body: historyReply)
        }
        async let first = client.history()
        async let second = client.history()
        let pages = try await [first, second]
        check(pages.count == 2 && refreshes == 1, "Concurrent 401s must refresh once")
        check(appRequests >= 3 && AssistantAppSession.token("refresh") == "rotated-A", "Refreshed credentials must persist")

        // An account login that finishes during refresh owns the session. The old
        // request must not run under that other user's identity or expose history.
        AssistantAppSession.save(accessToken: "expired#A", refreshToken: "refresh-A")
        appRequests = 0
        TransportStub.respond = { request in
            if request.url!.lastPathComponent == "app-auth" {
                AssistantAppSession.save(accessToken: "new-login#B", refreshToken: "refresh-B")
                return .init(body: #"{"ok":true,"access_token":"late-refresh#A","refresh_token":"rotated-A"}"#)
            }
            appRequests += 1
            return .init(status: 401, body: #"{"error":"authentication_required"}"#)
        }
        do { _ = try await client.history(); fatalError("Expected account-switch guard") }
        catch let error as AssistantAppError { check(error.code == "session_changed", "Wrong account-switch error") }
        check(appRequests == 1 && AssistantAppSession.token("access") == "new-login#B", "Late refresh overwrote a new login")

        // Transient refresh failure must remain retryable and clear single-flight.
        AssistantAppSession.save(accessToken: "expired#A", refreshToken: "refresh-A")
        refreshes = 0
        TransportStub.respond = { request in
            if request.url!.lastPathComponent == "app-auth" {
                refreshes += 1
                if refreshes == 1 { return .init(status: 502, body: #"{"error":"app_auth_unavailable"}"#) }
                return .init(body: #"{"ok":true,"access_token":"fresh#A","refresh_token":"rotated-A"}"#)
            }
            return request.value(forHTTPHeaderField: "Authorization") == "Bearer expired#A"
                ? .init(status: 401, body: #"{"error":"authentication_required"}"#)
                : .init(body: historyReply)
        }
        do { _ = try await client.history(); fatalError("Expected transient refresh failure") }
        catch let error as AssistantAppError {
            check(error.isRetryable && !error.requiresAccountSignIn, "A server outage must not force account sign-in")
        }
        _ = try await client.history()
        check(refreshes == 2, "A failed refresh prevented later recovery")

        for (status, code, retryable, verify) in [
            (403, "installation_not_verified", false, true),
            (409, "conversation_in_progress", true, false),
            (409, "turn_payload_conflict", false, false),
            (429, "rate_limited", true, false),
            (503, "assistant_app_unavailable", true, false),
        ] {
            TransportStub.respond = { _ in .init(status: status, body: "{\"error\":\"\(code)\",\"detail\":\"SECRET INTERNAL TRACE\"}") }
            do { _ = try await client.history(); fatalError("Expected HTTP error \(status)") }
            catch let error as AssistantAppError {
                check(error.code == code && error.isRetryable == retryable && error.requiresAccountSignIn == verify, "Incorrect recovery for \(code)")
                check(!error.localizedDescription.contains("SECRET") && !error.localizedDescription.contains(code), "Raw backend error exposed")
            }
        }

        TransportStub.respond = { _ in .init(status: 202, body: processingReply) }
        let processing = try await client.send(text: "hello", turnId: "turn-1")
        check(processing.status == "processing" && !processing.canApply, "202 must preserve pending state, never imply applied")
        TransportStub.respond = { _ in .init(status: 404, body: #"{"error":"turn_not_found"}"#) }
        let missing = try await client.status(turnId: "turn-1")
        check(missing == nil, "Absent turn must permit recovery with the original ID")

        TransportStub.respond = { _ in .init(body: "not JSON") }
        do { _ = try await client.history(); fatalError("Expected malformed response error") }
        catch let error as AssistantAppError { check(error.code == "invalid_response" && error.isRetryable, "Malformed reply recovery") }
        for (urlCode, expected) in [(URLError.notConnectedToInternet, "offline"), (.cannotConnectToHost, "network_unavailable"), (.timedOut, "request_timed_out")] {
            TransportStub.respond = { _ in .init(error: URLError(urlCode)) }
            do { _ = try await client.history(); fatalError("Expected network error") }
            catch let error as AssistantAppError { check(error.code == expected && error.isRetryable, "Network recovery") }
        }
        TransportStub.respond = { _ in .init(error: URLError(.cancelled)) }
        do { _ = try await client.history(); fatalError("Expected cancellation") }
        catch is CancellationError { }
        try await verifyStreamingClient(client)
        try await verifyViewRaces()
        try await verifyAutomaticRecovery()
        try await verifyProblemNotices()
        verifyLocalActionReceipts()
        print("assistant client: refresh concurrency, identity switch, transient recovery, typed errors, 202/status, network and cancellation passed")
    }
}

@MainActor private func verifyAutomaticRecovery() async throws {
    AssistantAppSession.save(accessToken: "session#A", refreshToken: "refresh-A")
    let view = ConversationFixture()
    let pending = AssistantComposerState.Pending(id: "durable-recovery", text: "Protect for three minutes")
    view.composer.pending = pending
    var sends = 0
    ViewTransport.history = { .init(turns: [], nextBefore: nil) }
    ViewTransport.status = { _ in nil }
    ViewTransport.send = { text, id in
        sends += 1
        check(id == pending.id && text == pending.text, "Automatic retry changed the durable payload")
        return makeTurn(id: id, text: text)
    }
    await view.recoverForTest()
    check(sends == 1 && view.composer.pending == nil, "Recovery must complete without a manual tap")

    view.composer.pending = pending
    ViewTransport.send = { _, _ in sends += 1; throw AssistantAppError.network }
    sends = 0
    await view.recoverForTest()
    while view.isSending { await Task.yield() }
    check(sends == 3 && view.composer.pending?.id == pending.id && view.composer.pending?.text == pending.text
        && view.composer.pending?.problem == .connection && view.canRetry, "Offline retry must be bounded and keep the message and known cause")
    view.isHomeVisible = false
    await view.recoverForTest()
    check(sends == 3, "Hidden chat must not auto-send")
    view.isHomeVisible = true
    ViewTransport.status = { _ in throw AssistantAppError.authenticationRequired }
    await view.recoverForTest()
    check(sends == 3 && view.requiresVerification, "Authentication requires sign-in, never automatic resending")

    view.requiresVerification = false
    let failed = AssistantAppTurn(id: pending.id, userText: pending.text, assistantText: "", status: "failed",
        actionId: "", actionLabel: "", actionStatus: "", createdAt: "2026-10-06T10:00:00Z")
    ViewTransport.history = { .init(turns: [failed], nextBefore: nil) }
    ViewTransport.status = { _ in makeTurn(id: pending.id, text: pending.text) }
    await view.reloadForTest()
    check(view.composer.pending == nil && view.error == nil, "Stale failed history must not hide a completed status")
    print("automatic recovery: same payload, bounded offline attempts, visibility/auth guards and stale history passed")
}

@MainActor private func verifyProblemNotices() async throws {
    check(AssistantAppError.offline.problem == .offline, "Confirmed offline must be distinct from connection failure")
    check(AssistantAppError.network.problem == .connection, "A server connection failure does not prove offline")
    check(AssistantAppError.server(status: 503, code: "internal_detail").problem == .serviceUnavailable, "503 service notice")
    check(AssistantAppError.server(status: 429, code: "internal_detail").problem == .rateLimited, "429 wait notice")
    check(AssistantAppError.server(status: 409, code: "turn_in_progress_or_failed").problem == .unknown, "Ambiguous server code must not claim processing")
    check(AssistantAppError.server(status: 400, code: "private_detail").problem == .unknown, "Unknown cause fallback")
    AssistantAppSession.save(accessToken: "session#A", refreshToken: "refresh-A")
    let view = ConversationFixture()
    view.composer.pending = .init(id: "notice-turn", text: "A saved message", problem: .timeout)
    ViewTransport.history = { .init(turns: [], nextBefore: nil) }
    ViewTransport.status = { _ in nil }
    await view.reloadForTest()
    check(view.error == AssistantPendingProblem.timeout.message(spanish: false), "Polling erased the identified timeout")
    view.composer.pending?.problem = nil
    await view.reloadForTest()
    check(view.composer.pending?.problem == .missingReply, "Missing reply is not proof of network failure")
    view.composer.pending?.problem = .sessionExpired
    await view.reloadForTest()
    check(!view.requiresVerification && view.canRetry, "Successful authenticated reload must release expired-session notice")
    ViewTransport.status = { _ in throw NSError(domain: "SECRET", code: 99, userInfo: [NSLocalizedDescriptionKey: "PRIVATE TRACE"]) }
    await view.reloadForTest()
    check(view.error == AssistantPendingProblem.unknown.message(spanish: false), "Unknown errors must never expose raw details")
    let restored = AssistantDraftVault.load(owner: "A")
    check(restored.pending?.problem == .unknown, "Problem must persist with the pending message")
    print("problem notices: precise classification, honest fallback, persistence, polling and authentication recovery passed")
}

@MainActor final class SpeechFixture {
    var isRecording = false
    var isStarting = false
    func stop() { isRecording = false; isStarting = false }
}
@MainActor enum AssistantDraftVault {
    static var states: [String: AssistantComposerState] = [:]
    static func load(owner: String) -> AssistantComposerState { states[owner] ?? AssistantComposerState() }
    static func save(_ state: AssistantComposerState, owner: String) -> Bool { states[owner] = state; return true }
}
@MainActor enum ViewTransport {
    static var history: () async throws -> AssistantAppHistoryPage = { .init(turns: [], nextBefore: nil) }
    static var status: (String) async throws -> AssistantAppTurn? = { _ in nil }
    static var send: (String, String) async throws -> AssistantAppTurn = { text, id in makeTurn(id: id, text: text) }
}
struct ConversationTestClient {
    @MainActor func history() async throws -> AssistantAppHistoryPage { try await ViewTransport.history() }
    @MainActor func status(turnId: String) async throws -> AssistantAppTurn? { try await ViewTransport.status(turnId) }
    @MainActor func send(text: String, turnId: String, context: [String: Any]? = nil,
                        onDraft: (@MainActor (String) -> Void)? = nil) async throws -> AssistantAppTurn {
        onDraft?("Partial response")
        return try await ViewTransport.send(text, turnId)
    }
}

@MainActor private func verifyStreamingClient(_ client: AssistantAppClient) async throws {
    AssistantAppSession.save(accessToken: "session#A", refreshToken: "refresh-A")
    let completed = #"{"ok":true,"turn":{"id":"turn-stream","user_text":"hello","assistant_text":"Hola 👋","status":"completed","action_id":"","action_label":"","action_status":"","created_at":"2026-10-06T12:00:00Z"}}"#
    let frames = "{\"type\":\"start\",\"turn_id\":\"turn-stream\"}\n"
        + "{\"type\":\"draft\",\"turn_id\":\"turn-stream\",\"text\":\"Hola\"}\n"
        + "{\"type\":\"keepalive\"}\n"
        + "{\"type\":\"draft\",\"turn_id\":\"turn-stream\",\"text\":\"Hola 👋\"}\n"
    var drafts: [String] = []
    TransportStub.respond = { _ in .init(body: frames + "{\"type\":\"result\",\"status\":200,\"body\":\(completed)}\n", contentType: "application/x-ndjson") }
    let turn = try await client.send(text: "hello", turnId: "turn-stream", onDraft: { drafts.append($0) })
    check(drafts == ["Hola", "Hola 👋"] && turn.status == "completed" && !turn.canApply, "Streaming changed final authority or lost Unicode drafts")
    TransportStub.respond = { _ in .init(body: frames, contentType: "application/x-ndjson") }
    do { _ = try await client.send(text: "hello", turnId: "turn-stream", onDraft: { _ in }); fatalError("Draft EOF cannot complete") }
    catch let error as AssistantAppError { check(error.code == "invalid_response", "Truncated stream must use recovery") }
    var sentIDs: [String] = []
    TransportStub.respond = { request in
        let body = try! JSONSerialization.jsonObject(with: requestBody(request)) as! [String: Any]
        sentIDs.append(body["turn_id"] as! String)
        if request.url!.lastPathComponent == "assistant-app-stream" { return .init(status: 404) }
        return .init(body: completed)
    }
    _ = try await client.send(text: "hello", turnId: "turn-stream", onDraft: { _ in })
    check(sentIDs == ["turn-stream", "turn-stream"], "Legacy fallback changed the durable UUID")
    var refreshed = 0
    AssistantAppSession.save(accessToken: "expired#A", refreshToken: "refresh-A")
    TransportStub.respond = { request in
        if request.url!.lastPathComponent == "app-auth" {
            refreshed += 1
            return .init(body: #"{"ok":true,"access_token":"fresh#A","refresh_token":"rotated-A"}"#)
        }
        if request.value(forHTTPHeaderField: "Authorization") == "Bearer expired#A" {
            return .init(body: "{\"type\":\"result\",\"status\":401,\"body\":{\"error\":\"authentication_required\"}}\n", contentType: "application/x-ndjson")
        }
        return .init(body: frames + "{\"type\":\"result\",\"status\":200,\"body\":\(completed)}\n", contentType: "application/x-ndjson")
    }
    _ = try await client.send(text: "hello", turnId: "turn-stream", onDraft: { _ in })
    check(refreshed == 1, "Stream 401 must refresh once")
    AssistantAppSession.save(accessToken: "session#A", refreshToken: "refresh-A")
    TransportStub.respond = { _ in .init(body: frames + "{\"type\":\"result\",\"status\":200,\"body\":\(completed)}\n", contentType: "application/x-ndjson") }
    do {
        _ = try await client.send(text: "hello", turnId: "turn-stream", onDraft: { _ in
            AssistantAppSession.save(accessToken: "session#B", refreshToken: "refresh-B")
        })
        fatalError("A switched account cannot receive the remaining stream")
    } catch let error as AssistantAppError { check(error.code == "session_changed", "Stream account isolation failed") }
    print("streaming client: progressive Unicode, final authority, truncated EOF, same-ID fallback, token refresh and account isolation passed")
}

private func requestBody(_ request: URLRequest) -> Data {
    if let body = request.httpBody { return body }
    guard let stream = request.httpBodyStream else { return Data() }
    stream.open(); defer { stream.close() }
    var body = Data(), buffer = [UInt8](repeating: 0, count: 4096)
    while stream.hasBytesAvailable {
        let count = stream.read(&buffer, maxLength: buffer.count)
        if count <= 0 { break }
        body.append(contentsOf: buffer.prefix(count))
    }
    return body
}
private func makeTurn(id: String, text: String) -> AssistantAppTurn {
    .init(id: id, userText: text, assistantText: "Reply to \(text)", status: "completed", actionId: "",
        actionLabel: "", actionStatus: "", createdAt: "2026-09-26T10:00:00Z")
}

@MainActor private func verifyViewRaces() async throws {
    AssistantAppSession.save(accessToken: "session#A", refreshToken: "refresh-A")
    let view = ConversationFixture()
    view.composer.draft = "New message"
    var suspendedHistory: CheckedContinuation<AssistantAppHistoryPage, Error>?
    ViewTransport.history = { try await withCheckedThrowingContinuation { suspendedHistory = $0 } }
    let oldReload = Task { await view.reloadForTest() }
    while suspendedHistory == nil { await Task.yield() }
    await view.sendForTest()
    check(view.turns.last?.userText == "New message", "Send did not complete")
    suspendedHistory!.resume(returning: .init(turns: [makeTurn(id: "old", text: "Older message")], nextBefore: nil))
    await oldReload.value
    check(view.turns.last?.userText == "New message" && view.turns.count == 1, "Stale history overwrote a completed reply")

    // A status lookup belonging to an earlier account must not repopulate the
    // cleared conversation or write that account's pending message to the vault.
    view.composer.pending = .init(id: "pending-A", text: "Private A")
    ViewTransport.history = { .init(turns: [], nextBefore: nil) }
    var suspendedStatus: CheckedContinuation<AssistantAppTurn?, Error>?
    ViewTransport.status = { _ in try await withCheckedThrowingContinuation { suspendedStatus = $0 } }
    let oldStatus = Task { await view.reloadForTest() }
    while suspendedStatus == nil { await Task.yield() }
    AssistantAppSession.save(accessToken: "session#B", refreshToken: "refresh-B")
    view.restoreForTest()
    check(view.owner == "B" && view.turns.isEmpty && view.composer.pending == nil, "Account switch did not clear private state")
    suspendedStatus!.resume(returning: makeTurn(id: "pending-A", text: "Private A"))
    await oldStatus.value
    check(view.turns.isEmpty && AssistantDraftVault.states["B"] == nil, "Old status leaked across accounts")

    // A failed old send must not overwrite the new account's error or cancel its
    // spinner while the new account has its own request in progress.
    var firstSend: CheckedContinuation<AssistantAppTurn, Error>?
    var secondSend: CheckedContinuation<AssistantAppTurn, Error>?
    ViewTransport.send = { _, _ in try await withCheckedThrowingContinuation { firstSend = $0 } }
    view.composer.draft = "B message"
    let oldSend = Task { await view.sendForTest() }
    while firstSend == nil { await Task.yield() }
    AssistantAppSession.save(accessToken: "session#C", refreshToken: "refresh-C")
    view.restoreForTest()
    view.composer.draft = "C message"
    ViewTransport.send = { _, _ in try await withCheckedThrowingContinuation { secondSend = $0 } }
    let currentSend = Task { await view.sendForTest() }
    while secondSend == nil { await Task.yield() }
    firstSend!.resume(throwing: AssistantAppError.network)
    await oldSend.value
    check(view.isSending && view.error == nil && view.composer.pending?.text == "C message", "Old send changed the new owner's request")
    let currentID = view.composer.pending!.id
    secondSend!.resume(returning: makeTurn(id: currentID, text: "C message"))
    await currentSend.value
    check(!view.isSending && view.turns.last?.userText == "C message", "New owner's completion failed")
    // Only a newly submitted imperative may apply automatically. Reload and
    // lost-response recovery must keep the explicit CTA without executing.
    ViewTransport.send = { text, id in AssistantAppTurn(id: id, userText: text, assistantText: "Applying", status: "completed", actionId: "app_fresh_action", actionLabel: "Apply", actionStatus: "queued", createdAt: "2026-10-02T10:00:00Z", autoApply: true) }
    view.composer.draft = "Block now"
    await view.sendForTest()
    let executable = view.turns.last!
    check(view.appliedActions == ["app_fresh_action"] && view.dismissCount == 1, "New explicit action was not applied once")
    ViewTransport.history = { .init(turns: [executable], nextBefore: nil) }
    await view.reloadForTest()
    check(view.appliedActions.count == 1, "History executed an old action")
    check(view.visibleTurnID == executable.id, "Reload lost the reply submitted in this visit")
    let freshVisit = ConversationFixture()
    await freshVisit.reloadForTest()
    check(freshVisit.visibleTurnID == nil, "Opening chat must not surface the last historical reply")
    view.composer.draft = "Retry block"
    ViewTransport.send = { _, _ in throw AssistantAppError.network }
    ViewTransport.status = { _ in executable }
    await view.sendForTest()
    check(view.appliedActions.count == 1, "Lost-response recovery executed an old action")
    let home = ConversationFixture()
    home.owner = "C"
    home.usesHomePresentation = true
    home.showingHomeKeyboard = true
    home.composer.draft = "Block from Home"
    home.homeActionHandler = {
        AssistantActionReceiptStore.save(actionId: "app_home_action", status: "verified", detail: "native_verified", executionStarted: true)
    }
    ViewTransport.send = { text, id in AssistantAppTurn(id: id, userText: text, assistantText: "Applying", status: "completed", actionId: "app_home_action", actionLabel: "Apply", actionStatus: "queued", createdAt: "2026-10-06T10:00:00Z", autoApply: true) }
    await home.sendForTest()
    check(home.appliedActions == ["app_home_action"] && home.homeActionPreparedCount == 1 && home.dismissCount == 0,
          "Embedded Home must confirm the native action without dismissing the app root")
    check(home.turns.last?.actionStatus == "verified" && home.turns.last?.canApply == false,
          "The chat offered a second block after the native receipt")
    let staleTurn = ViewTransport.send
    ViewTransport.history = { .init(turns: [try await staleTurn("Block from Home", "home-turn")], nextBefore: nil) }
    await home.reloadForTest()
    check(home.turns.last?.actionStatus == "verified" && home.turns.last?.canApply == false,
          "Stale cloud history restored the redundant block button")
    check(home.appliedActions.count == 1, "Receipt reconciliation executed the block twice")
    AssistantActionReceiptStore.clear(actionId: "app_home_action")
    check(!home.showingHomeKeyboard, "Sending text must close the Home keyboard sheet")
    print("assistant view: stale history, account switch during status and obsolete send completion passed")
}

@MainActor private func verifyLocalActionReceipts() {
    AssistantAppSession.save(accessToken: "session#A", refreshToken: "refresh-A")
    let queued = AssistantAppTurn(id: "turn", userText: "Block for five minutes", assistantText: "Applying",
        status: "completed", actionId: "app_receipt", actionLabel: "Block 5 minutes", actionStatus: "queued",
        createdAt: "2026-10-06T18:00:00Z", autoApply: true)
    check(queued.resolvingLocalReceipt.canApply, "An unexecuted action lost its setup/recovery button")
    AssistantActionReceiptStore.save(actionId: "app_other", status: "verified", detail: "", executionStarted: true)
    check(queued.resolvingLocalReceipt.canApply, "A different block suppressed this action")
    for status in ["confirmed", "execution_started"] {
        AssistantActionReceiptStore.save(actionId: queued.actionId, status: status, detail: "", executionStarted: true)
        check(queued.resolvingLocalReceipt.canApply, "Preparation was treated as native completion")
    }
    for status in ["verified", "delayed", "failed", "dismissed"] {
        AssistantActionReceiptStore.save(actionId: queued.actionId, status: status, detail: "", executionStarted: true)
        let resolved = queued.resolvingLocalReceipt
        check(!resolved.canApply && resolved.actionStatus == status && resolved.autoApply == false,
              "Native outcome did not remove the duplicate action button")
        check(resolved.id == queued.id && resolved.userText == queued.userText && resolved.assistantText == queued.assistantText,
              "Receipt reconciliation changed conversation content")
    }
    AssistantActionReceiptStore.save(actionId: queued.actionId, status: "verified", detail: "", executionStarted: true)
    AssistantAppSession.save(accessToken: "session#B", refreshToken: "refresh-B")
    check(AssistantActionReceiptStore.load() == nil && queued.resolvingLocalReceipt.canApply, "Another account's receipt changed this turn")
    AssistantAppSession.save(accessToken: "session#A", refreshToken: "refresh-A")
    var terminal = queued
    terminal = AssistantAppTurn(id: terminal.id, userText: terminal.userText, assistantText: terminal.assistantText,
        status: terminal.status, actionId: terminal.actionId, actionLabel: terminal.actionLabel, actionStatus: "superseded", createdAt: terminal.createdAt)
    check(terminal.resolvingLocalReceipt.actionStatus == "superseded", "Receipt overrode a terminal server status")
    AssistantActionReceiptStore.clear(actionId: queued.actionId)
    check(AssistantActionReceiptStore.load() == nil, "Receipt cleanup failed")
    print("action receipts: immediate CTA removal, stale history, exact action/account, setup and terminal outcomes passed")
}
