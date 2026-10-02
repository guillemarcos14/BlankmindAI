"use strict";
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { spawnSync } = require("node:child_process");
const root = path.join(__dirname,"..");
const read = name => fs.readFileSync(path.join(root,name),"utf8").replace(/\r\n/g,"\n");
const store = read("ios/Blank/Blank/SessionStore.swift");
const commands = store.slice(store.indexOf("enum AssistantPendingAction:"),store.indexOf("struct AssistantProtectionExecution:"));
const brain = read("ios/Blank/Blank/BlankBrain.swift");
const scope = brain.slice(brain.indexOf("    static func scopedSessions("),brain.indexOf("    func freshSnapshot()"));
const fixture = `
struct BlankSession {
  var id = UUID()
  var startedAt: Date
  var endedAt: Date?
  var pauseStartedAt: Date? = nil
  var pauseEndedAt: Date? = nil
}
enum BlankSharedState { static let defaults = UserDefaults.standard }
enum ScopeFixture { ${scope} }
func check(_ condition: @autoclosure () -> Bool, _ message: String) {
  if !condition() { fatalError(message) }
}
let t = Date(timeIntervalSince1970: 1000000)
let sessions = [BlankSession(startedAt: t, endedAt: t.addingTimeInterval(3600), pauseStartedAt: t.addingTimeInterval(600), pauseEndedAt: t.addingTimeInterval(1200)),
  BlankSession(startedAt: t.addingTimeInterval(1800), endedAt: t.addingTimeInterval(5400))]
check(BlankBrainMetrics.protectedSeconds(sessions: sessions, from:t, to:t.addingTimeInterval(6000)) == 4800, "Overlap/pause double counted")
check(BlankBrainMetrics.sessionCount(sessions: sessions, from:t, to:t.addingTimeInterval(6000)) == 2, "Session count")
check(BlankBrainMetrics.protectedSeconds(sessions: sessions, from:t.addingTimeInterval(2100), to:t.addingTimeInterval(3300)) == 1200, "Clipping")
check(BlankBrainMetrics.protectedSeconds(sessions: [], from:t, to:t) == 0, "Empty range")
let active = [BlankSession(startedAt:t, endedAt:nil, pauseStartedAt:t.addingTimeInterval(300), pauseEndedAt:nil)]
check(BlankBrainMetrics.protectedSeconds(sessions:active,from:t,to:t.addingTimeInterval(1000)) == 300,"Ongoing pause")
let suite = "brain-native-" + UUID().uuidString
let defaults = UserDefaults(suiteName:suite)!
check(ScopeFixture.scopedSessions(sessions,owner:nil,defaults:defaults).isEmpty,"Guest history leaked")
check(ScopeFixture.scopedSessions(sessions,owner:"A",defaults:defaults,now:t).count == 2,"First-account legacy migration")
check(ScopeFixture.scopedSessions(sessions,owner:"B",defaults:defaults,now:t.addingTimeInterval(6000)).isEmpty,"Account switch leaked sessions")
let newSession=BlankSession(startedAt:t.addingTimeInterval(6100),endedAt:t.addingTimeInterval(6200))
check(ScopeFixture.scopedSessions(sessions+[newSession],owner:"B",defaults:defaults,now:t.addingTimeInterval(7000)).count == 1,"New account missing its session")
check(ScopeFixture.scopedSessions(sessions+[newSession],owner:"A",defaults:defaults,now:t.addingTimeInterval(7000)).count == 2,"Returning account inherits another account's history")
defaults.removePersistentDomain(forName:suite)
let raw="""
{"id":"action-1","type":"start_protection","minutes":30,"requested_at":"2026-10-02T08:00:00.123Z"}
"""
let command=try JSONDecoder().decode(AssistantInboxAction.self,from:Data(raw.utf8))
check(command.requestedDate != nil,"Fractional timestamp")
check(command.toPendingAction() == .startProtection(minutes:30,hardMode:false,appNames:[]),"Shared transport translation")
let invalid=try JSONDecoder().decode(AssistantInboxAction.self,from:Data("{\\"id\\":\\"x\\",\\"type\\":\\"update_schedule\\"}".utf8))
check(invalid.toPendingAction() == nil,"Incomplete action must fail closed")
let schedule=try JSONDecoder().decode(AssistantInboxAction.self,from:Data("{\\"id\\":\\"x\\",\\"type\\":\\"apply_schedule\\",\\"start_minute\\":540,\\"end_minute\\":600,\\"weekdays\\":[2,3,4,5,6]}".utf8))
check(schedule.toPendingAction() == .applySchedule(name:"Protection",startMinute:540,endMinute:600,weekdays:[2,3,4,5,6],durationDays:7,appNames:[]),"Canonical schedule command")
print("Brain native: shared commands, timestamps, clipping, pauses, overlaps and account isolation passed")
`;
const temporary = fs.mkdtempSync(path.join(os.tmpdir(),"blank-brain-native-"));
try {
  const file=path.join(temporary,"Tests.swift"),binary=path.join(temporary,"tests");
  fs.writeFileSync(file,"import Foundation\n"+commands+"\n"+read("ios/Blank/Blank/AssistantControl.swift")+"\n"+read("ios/Blank/Blank/BlankBrainMetrics.swift")+"\n"+fixture);
  const compile=spawnSync("swiftc",["-swift-version","5",file,"-o",binary],{encoding:"utf8"});
  if(compile.error || compile.status!==0) throw new Error(compile.stderr || compile.error?.message || "Swift compilation failed");
  const run=spawnSync(binary,[],{encoding:"utf8"});
  process.stdout.write(run.stdout||""); if(run.status!==0) throw new Error(run.stderr||"Native brain test failed");
} finally { fs.rmSync(temporary,{recursive:true,force:true}); }
