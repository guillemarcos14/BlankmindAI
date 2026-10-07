const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Compile the production transport, rather than a JavaScript copy of its logic.
// Keychain and the install ID are replaced with process-local test fixtures.
const source = fs.readFileSync(path.join(__dirname, '../ios/Blank/Blank/AssistantAppView.swift'), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('struct AssistantAppTurn:');
const end = source.indexOf('@MainActor\nfinal class AssistantSpeechInput');
if (start < 0 || end < start) throw new Error('Assistant client source boundaries changed');
const test = fs.readFileSync(path.join(__dirname, 'assistant_client_test.swift'), 'utf8');
const composerSource = fs.readFileSync(path.join(__dirname, '../ios/Blank/Blank/AssistantComposerState.swift'), 'utf8');
const composer = composerSource.slice(composerSource.indexOf('struct AssistantComposerState:'), composerSource.indexOf('enum AssistantDraftVault'));
const homeSource = fs.readFileSync(path.join(__dirname, '../ios/Blank/Blank/HomeView.swift'), 'utf8');
const receipts = homeSource.slice(homeSource.indexOf('struct AssistantActionReceipt:'), homeSource.indexOf('struct AssistantActionInboxClient'));
const viewMethodsStart = source.indexOf('    @discardableResult private func restoreOwner()');
const viewMethodsEnd = source.indexOf('    #if DEBUG', viewMethodsStart);
if (viewMethodsStart < 0 || viewMethodsEnd < viewMethodsStart) throw new Error('Assistant view state test boundaries changed');
const viewMethods = source.slice(viewMethodsStart, viewMethodsEnd).replaceAll('AssistantAppClient()', 'ConversationTestClient()');
const applyMethod = source.slice(source.indexOf('    private func applyAction('), source.indexOf('    private func openControls('));
const appSource = fs.readFileSync(path.join(__dirname, '../ios/Blank/Blank/BlankApp.swift'), 'utf8');
const notificationNames = appSource.slice(appSource.indexOf('enum AssistantRemoteNotification'), appSource.indexOf('// Only private QA archives'));
const viewFixture = `
@MainActor final class BlankBrain {
    static let shared = BlankBrain()
    func freshSnapshot() async -> [String: Any]? { nil }
}

@MainActor final class ConversationFixture {
    enum ScenePhase { case active, background }
    var scenePhase = ScenePhase.active
    var isHomeVisible = true
    var owner = "A"
    var preview = false
    var simulatorGuest = false
    var spanish = false
    var acceptingSpeech = false
    var speech = SpeechFixture()
    var saveTask: Task<Void, Never>?
    var conversationRevision = 0
    var sendRequestID: UUID?
    var reloadRequestID: UUID?
    var isSending: Bool { sendRequestID != nil }
    var waiting: Bool { isSending || composer.pending != nil || isApplyingAction }
    var isLoading = true
    var composerFocused = false
    var turns: [AssistantAppTurn] = []
    var nextHistoryCursor: String?
    var composer = AssistantComposerState()
    var error: String?
    var requiresVerification = false
    var canRetry = true
    var isApplyingAction = false
    var showHistory = false
    var showingHomeKeyboard = false
    var usesHomePresentation = false
    var homeActionPreparedCount = 0
    var homeActionHandler: (() -> Void)?
    func onHomeActionPrepared() { homeActionPreparedCount += 1; homeActionHandler?() }
    var visibleTurnID: String?
    var streamedText = ""
    var writingHaptics = WritingHapticsFixture()
    var presentationIsVisible = true
    var greeting: String?
    var appliedActions: [String] = []
    var dismissCount = 0
    func onApplyAction(_ id: String) async throws { appliedActions.append(id) }
    func dismiss() { dismissCount += 1 }
    func reloadForTest() async { await reload() }
    func sendForTest() async { await send() }
    func applyForTest(_ id: String) async { await applyAction(id) }
    func restoreForTest() { restoreOwner() }
    func recoverForTest() async { await recoverPendingMessage(delays: [1_000_000, 1_000_000, 1_000_000]) }
    func followupForTest() async { await showRequestedFollowup() }
${viewMethods}
${applyMethod}
}
`;
const hapticsFixture = `
@MainActor final class WritingHapticsFixture {
    var updates: [String] = []
    var stops = 0
    func update(text: String, enabled: Bool) { if enabled { updates.append(text) } }
    func stop() { stops += 1 }
}
`;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-assistant-client-'));
try {
  const file = path.join(temporary, 'AssistantClientTests.swift');
  const binary = path.join(temporary, 'assistant-client-tests');
  fs.writeFileSync(file, `import Foundation\n${notificationNames}\n${receipts}\n${source.slice(start, end)}\n${composer}\n${hapticsFixture}\n${viewFixture}\n${test}`);
  const compiled = spawnSync('swiftc', ['-swift-version', '5', '-parse-as-library', file, '-o', binary], { encoding: 'utf8' });
  if (compiled.error) throw new Error(`Native client tests require Swift on macOS: ${compiled.error.message}`);
  if (compiled.status !== 0) throw new Error(compiled.stderr || compiled.stdout);
  const result = spawnSync(binary, [], { encoding: 'utf8', timeout: 120000 });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Native client tests terminated by ${result.signal}`);
  process.exitCode = result.status || 0;
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
