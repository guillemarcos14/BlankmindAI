const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const source = fs.readFileSync(path.join(__dirname, '../ios/Blank/Blank/BlankApp.swift'), 'utf8');
const start = source.indexOf('enum BlankPrivateStageQA {');
const end = source.indexOf('\n@main', start);
if (start < 0 || end < start) throw Error('private_qa_source_boundaries');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blank-private-qa-'));
const file = path.join(directory, 'qa.swift');
fs.writeFileSync(file, `import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
${source.slice(start, end)}
let storage = HTTPCookieStorage.sharedCookieStorage(forGroupContainerIdentifier: UUID().uuidString)
let stage = URL(string: "https://blank-product-staging-20260926.netlify.app/.netlify/functions")!
let production = URL(string: "https://getblank.netlify.app/.netlify/functions")!
for url in [production, URL(string: "http://blank-product-staging-20260926.netlify.app")!, URL(string: "https://evil.test")!] {
    BlankPrivateStageQA.configure(baseURL: url, cookieHeader: "2ef5a74e-af70-4893-a5f6-63fb2537720d=synthetic-qa", storage: storage)
    precondition(storage.cookies?.isEmpty != false, "QA credential escaped staging")
}
for header in ["$(BLANK_PRIVATE_QA_COOKIE)", "2ef5a74e-af70-4893-a5f6-63fb2537720d=bad\\r\\nX-Leak: bad", "other=bad", ""] {
    BlankPrivateStageQA.configure(baseURL: stage, cookieHeader: header, storage: storage)
    precondition(storage.cookies?.isEmpty != false, "Invalid QA credential installed")
}
BlankPrivateStageQA.configure(baseURL: stage, cookieHeader: "2ef5a74e-af70-4893-a5f6-63fb2537720d=synthetic-qa", storage: storage)
#if BLANK_PRIVATE_STAGE_QA
precondition(storage.cookies(for: stage)?.count == 1)
precondition(storage.cookies(for: production)?.isEmpty != false)
precondition(storage.cookies?.first?.isSecure == true)
#else
precondition(storage.cookies?.isEmpty != false, "Production enabled private QA auth")
#endif
print("PASS private QA cookie isolation")
`);
for (const qa of [false, true]) {
  const executable = path.join(directory, qa ? 'qa' : 'production');
  const compiled = spawnSync('swiftc', [...(qa ? ['-D', 'BLANK_PRIVATE_STAGE_QA'] : []), file, '-o', executable], { encoding: 'utf8' });
  if (compiled.status !== 0) throw Error(compiled.stderr || 'Swift compiler unavailable');
  const result = spawnSync(executable, [], { encoding: 'utf8' });
  if (result.status !== 0) throw Error(result.stderr || 'Private QA isolation failed');
  process.stdout.write(result.stdout);
}
