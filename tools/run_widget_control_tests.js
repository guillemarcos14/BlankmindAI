const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const between = (s, a, b) => { const i=s.indexOf(a), j=s.indexOf(b,i+1); assert(i>=0 && j>i); return s.slice(i,j); };
const widget = read('ios/Blank/BlankWidgetExtension/BlankWidget.swift');
const shared = read('ios/Blank/Blank/BlankSharedState.swift');
const monitor = read('ios/Blank/BlankDeviceActivityMonitor/DeviceActivityMonitorExtension.swift');
assert(widget.includes('.widgetURL(URL(string: "blank://open")!)'));
assert(widget.includes('callback.addingTimeInterval(15 * 60)'));
assert(widget.includes('if previous == nil { BlankSharedState.cancelWidgetUnlock'));
assert(monitor.includes('guard BlankSharedState.finishWidgetUnlockIfDue'));
assert(shared.includes('owner == date(forKey: Keys.blankActiveSince'));
if (process.argv.includes('--source-only')) { console.log('Widget integration contracts passed; native execution requires macOS CI'); process.exit(0); }
const model = read('ios/Blank/Blank/BlankDomainModels.swift');
const source = 'import Foundation\n'
    + 'enum TestAuthorizationStatus { case approved, approvedWithDataAccess, denied }; final class AuthorizationCenter { static let shared = AuthorizationCenter(); var authorizationStatus = TestAuthorizationStatus.approved }\n'
    + 'struct FamilyActivitySelection: Codable { var applicationTokens: Set<String> = []; var categoryTokens: Set<String> = []; var webDomainTokens: Set<String> = [] }\n'
    + between(model, 'enum BlankStrategyKind:', 'struct LegacyFocusMode:')
    + between(model, 'struct BlankSession:', 'struct BlankWeeklyReport:')
    + shared.replace('import FamilyControls', '')
    + read('tools/widget_control_test.swift');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-widget-tests-'));
try {
    const file=path.join(folder,'Tests.swift'), binary=path.join(folder,'tests'); fs.writeFileSync(file,source);
    const built=spawnSync('swiftc',['-swift-version','5','-parse-as-library',file,'-o',binary],{encoding:'utf8'});
    if(built.error || built.status!==0) throw Error(built.error?.message || built.stderr);
    const result=spawnSync(binary,[],{encoding:'utf8'}); process.stdout.write(result.stdout || '');
    if(result.error || result.status!==0) throw Error(result.error?.message || result.stderr);
} finally { fs.rmSync(folder,{recursive:true,force:true}); }
