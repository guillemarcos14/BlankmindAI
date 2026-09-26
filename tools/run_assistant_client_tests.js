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
const viewMethodsStart = source.indexOf('    @discardableResult private func restoreOwner()');
const viewMethodsEnd = source.indexOf('    #if DEBUG\n    private func loadPreview()', viewMethodsStart);
if (viewMethodsStart < 0 || viewMethodsEnd < viewMethodsStart) throw new Error('Assistant view state test boundaries changed');
const viewMethods = source.slice(viewMethodsStart, viewMethodsEnd).replaceAll('AssistantAppClient()', 'ConversationTestClient()');
const viewFixture = `
@MainActor final class ConversationFixture {
    var owner = "A"
    var preview = false
    var spanish = false
    var acceptingSpeech = false
    var speech = SpeechFixture()
    var saveTask: Task<Void, Never>?
    var conversationRevision = 0
    var sendRequestID: UUID?
    var reloadRequestID: UUID?
    var isSending: Bool { sendRequestID != nil }
    var isLoading = true
    var composerFocused = false
    var turns: [AssistantAppTurn] = []
    var nextHistoryCursor: String?
    var composer = AssistantComposerState()
    var error: String?
    var requiresVerification = false
    var canRetry = true
    func reloadForTest() async { await reload() }
    func sendForTest() async { await send() }
    func restoreForTest() { restoreOwner() }
${viewMethods}
}
`;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-assistant-client-'));
try {
  const file = path.join(temporary, 'AssistantClientTests.swift');
  const binary = path.join(temporary, 'assistant-client-tests');
  fs.writeFileSync(file, `import Foundation\n${source.slice(start, end)}\n${composer}\n${viewFixture}\n${test}`);
  const compiled = spawnSync('swiftc', ['-swift-version', '5', '-parse-as-library', file, '-o', binary], { encoding: 'utf8' });
  if (compiled.error) throw new Error(`Native client tests require Swift on macOS: ${compiled.error.message}`);
  if (compiled.status !== 0) throw new Error(compiled.stderr || compiled.stdout);
  const result = spawnSync(binary, [], { encoding: 'utf8' });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) throw result.error;
  process.exitCode = result.status || 0;
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
