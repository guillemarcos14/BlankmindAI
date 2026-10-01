const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const between = (source, first, last) => {
  const start = source.indexOf(first);
  const end = source.indexOf(last, start + first.length);
  assert(start >= 0 && end > start, `Missing native test boundary: ${first}`);
  return source.slice(start, end);
};
const model = read('ios/Blank/Blank/BlankDomainModels.swift');
const scheduler = read('ios/Blank/Blank/DeviceActivityTimerScheduler.swift');
const monitor = read('ios/Blank/BlankDeviceActivityMonitor/DeviceActivityMonitorExtension.swift');
const store = read('ios/Blank/Blank/SessionStore.swift');
const home = read('ios/Blank/Blank/HomeView.swift');

// Cross-target integration gates complement the executable model regressions.
assert.doesNotMatch(scheduler, /where window\.runsEveryDay/);
assert.match(monitor, /ManagedSettingsStore\(named: ManagedSettingsStore\.Name\("BlankRecurringProtection"\)\)/);
assert.match(monitor, /ManagedSettingsStore\(named: ManagedSettingsStore\.Name\("BlankDailyLimitProtection"\)\)/);
assert.match(store, /dailyLimitRegistered = DeviceActivityTimerScheduler\.startDailyLimit/);
assert.match(store, /recurringScheduleRegistered = DeviceActivityTimerScheduler\.syncRecurringSchedule/);
assert.match(store, /blankActiveUntil == nil \|\| deviceActivityTimerScheduled/);
const capacity = scheduler.indexOf('guard intervals.count + expirations.count <= maxScheduleActivities');
assert(capacity >= 0 && scheduler.indexOf('center.stopMonitoring', capacity) > capacity);
const polling = between(home, '    private func pollPendingAssistantActionIfNeeded', '    private func clearAssistantNotificationRequest');
assert.equal((polling.match(/guard assistantIdentityMatches\(code: code, channel: channel, owner: accountID\)/g) || []).length, 2);
const signIn = between(home, '    private func signIn(idToken:', '    private func postJSON(');
assert(signIn.indexOf('guard AssistantAppSession.save(') >= 0
  && signIn.indexOf('guard AssistantAppSession.save(') < signIn.indexOf('onSignedIn?()'), 'Secure session must persist before sign-in completes');
const activation = between(home, '    private func confirmPendingAssistantAction()', '    private func assistantActionRequiresScreenTime(');
assert(activation.indexOf('if assistantActionRequiresScreenTime(pendingAction)') < activation.indexOf('switch pendingAction'),
  'Permission must be requested before schedule, selection or protection mutations');
const permissionOnly = activation.slice(activation.indexOf('        case .requestScreenTimePermission:'));
assert(permissionOnly.indexOf('guard assistantIdentityMatches(') > permissionOnly.indexOf('await screenTimeBlocker.requestAuthorization()')
  && permissionOnly.indexOf('pendingAssistantActionId == actionID') < permissionOnly.indexOf('finishPendingAssistantAction('),
  'Permission completion must not acknowledge a different account or action');
const pickerDismissal = between(home, '        .onChange(of: showingContextualAppPicker)', '        .fullScreenCover(isPresented: $showingAssistantChat');
assert.match(pickerDismissal, /let selectionConfirmed = permissionApproved &&/,
  'Permission revoked while the picker was open must prevent applying its plan');
assert(pickerDismissal.indexOf('screenTimeBlocker.refreshAuthorizationStatus()') < pickerDismissal.indexOf('sessionStore.selection = contextualPlanSelection'));

const selection = between(store, '    @Published var selection:', '    @Published var sessions:')
  .replace('@Published var selection: FamilyActivitySelection', 'var selection: Int');
const selectionPolicy = between(store, '    var canEditSelectedDistractions:', '    var isVacationModeActive:');
const intervals = scheduler.slice(scheduler.indexOf('    private static func recurringIntervals'))
  .replace('private static func recurringIntervals', 'static func recurringIntervals');
const extensionModel = between(monitor, '    private struct StoredWindow:', '    private static func recurringScheduleIsActive')
  .replace('private struct StoredWindow', 'struct StoredWindow');
const fixtures = `
struct InboxDateFixture {
    var requestedAt: String?
${between(home, '    var requestedDate: Date?', '\n}\n\nstruct AssistantActionReceipt:')}
}
final class ManualUnlockFixture {
    let defaults: UserDefaults
    var isBlankActive = true
    var hardBlankActive = false
    var blankActiveSince: Date?
    var delayedManualUnlockAt: Date?
    var unlocks = 0
    enum Keys {
        static let isBlankActive = "blankIsActive"
        static let blankActiveSince = "blankActiveSince"
    }
    enum NfcResult { case unblanked }
    enum EntryMode { case app }
    enum EndReason { case manual }
    init(defaults: UserDefaults, startedAt: Date) {
        self.defaults = defaults
        blankActiveSince = startedAt
        let timestamp = defaults.double(forKey: "blankManualUnlockAt")
        delayedManualUnlockAt = timestamp > 0 ? Date(timeIntervalSince1970: timestamp) : nil
        defaults.set(true, forKey: Keys.isBlankActive)
        defaults.set(startedAt.timeIntervalSince1970, forKey: Keys.blankActiveSince)
    }
${between(store, '    func scheduleManualUnlock(', '    init(defaults: UserDefaults = BlankSharedState.defaults)')}
    func deactivateBlank(entryMode: EntryMode, endedReason: EndReason) -> NfcResult {
        unlocks += 1
        isBlankActive = false
        defaults.set(false, forKey: Keys.isBlankActive)
        return .unblanked
    }
}
final class IdentityFixture {
    var assistantConnectCode = "code-A"
    var accountID = "account-A"
${between(home, '    private func assistantIdentityMatches(', '    private func clearPendingAssistantIdentityState()')}
    func matches(code: String, channel: String, owner: String?) -> Bool {
        assistantIdentityMatches(code: code, channel: channel, owner: owner)
    }
${between(home, '    private func assistantActionRequiresScreenTime(', '    private func finishPendingAssistantAction(')}
    func requiresPermission(_ action: AssistantPendingAction) -> Bool {
        assistantActionRequiresScreenTime(action)
    }
}
enum BlankSharedState {
    static var sharedActive = false
    struct ActiveState { let isActive: Bool }
    static func loadActiveState(defaults: UserDefaults) -> ActiveState { ActiveState(isActive: sharedActive) }
}
enum AssistantAppSession { static var userID: String? = "account-A" }
enum DeviceActivityTimerScheduler {
    static var hasIndependentProtection = false
${intervals}
final class SelectionFixture {
    var isBlankActive = false
    let defaults = UserDefaults.standard
    var saved = 0
    var schedules = 0
    var limits = 0
${selection}
${selectionPolicy}
    init() { selection = 1 }
    func saveSelection(_ value: Int) { saved += 1 }
    func reloadBlankWidget() {}
    func syncRecurringSchedule() { schedules += 1 }
    func refreshDailyLimitMonitoring() { limits += 1 }
}
`;
if (process.argv.includes('--source-only')) {
  console.log('iOS protection source contracts passed; Swift runtime requires macOS CI');
  process.exit(0);
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-protection-tests-'));
try {
  const file = path.join(temporary, 'ProtectionTests.swift');
  const binary = path.join(temporary, 'protection-tests');
  fs.writeFileSync(file, 'import Foundation\n' + between(model, 'struct BlankHabitWindow:', 'struct BlankSession:')
    + between(store, 'enum AssistantPendingAction:', 'struct AssistantProtectionExecution:')
    + between(home, 'struct UnblankHoldCadence {', 'struct AssistantInboxResponse:') + extensionModel + fixtures + read('tools/ios_protection_test.swift'));
  const built = spawnSync('swiftc', ['-swift-version', '5', '-parse-as-library', file, '-o', binary], { encoding: 'utf8' });
  if (built.error) throw new Error(`Protection runtime tests require Swift on macOS: ${built.error.message}`);
  if (built.status !== 0) throw new Error(built.stderr || built.stdout);
  const result = spawnSync(binary, [], { encoding: 'utf8' });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) throw result.error;
  process.exitCode = result.status || 0;
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
