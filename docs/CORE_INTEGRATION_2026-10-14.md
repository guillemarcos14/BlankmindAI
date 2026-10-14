# CORE integration and compilation

PR47 merged the iOS-only CORE cleanup into the current measured-rest release, preserving conversational fixes frozen at 545d92c. The integrated source is 73b5bc8b68a5fb2760364ace30c6c25d7a0c1cf7; release merge c55f00f939aeeb8c1cbb74217449ec0c281b15fa. Both contain native component tree bbfd5ebb229cf89ffd4ecbb90ee8e17aa16aaf2d.

Inputs: CORE PR43/32fa44c, iOS-only PR44/0af4c63 and deployed-rest source 1d60746. Rest migration 035 and agent labels 036 remain separate. No removed platform, provider transport, widget, secondary NFC control, external connector or broad wellness engine was restored. Advanced optimizations remain CORE with their existing consent and evidence gates; this integration does not certify or activate them.

Validation: 43/43 product harness checks against the initial baseline and diff-base 545d92c, with scope enforcement; PostgreSQL and runtime CI 38599464420 passed. Runtime fingerprint regenerated after platform removal. Native component matches the CORE source whose Swift tests, simulator build and full UI suite passed in 38592443407; integration adds no native source changes.

Unsigned production archive 1.9 (118), Xcode 26.4, requested in GitHub Actions 38599345604 against exact source 73b5bc8. Compilation passed: **ARCHIVE SUCCEEDED**. Downloaded receipt, actual Info.plist, all packaged file hashes and exactly the three protection extensions verified. Production URL, English development region and empty private QA cookie confirmed. Local integration receipt: tmp/backend-release/integration.json.

This task does not deploy Netlify/Supabase, spend provider budget, sign, upload to TestFlight or certify physical iPhone/Watch behavior. Existing production and TestFlight 117 remain separate.

Archive SHA-256: `d77aeda6e0ce3ec334b1f7e80c4b0e5a41c7c01476ba259cbbdeefdf7017d35f`. Artifact and verification: `tmp/core-archive118/`. No native or runtime source changed in this documentation closure.
