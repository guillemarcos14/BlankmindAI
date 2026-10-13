# Unified Decisions / ElevenLabs / iPhone candidate

Branch: `codex/backend-release-appstore-2026-10-13`. Native base PR38 (`1ea5ca6` runtime, `dffdff3` documentation), merged PR32 (`5f51c88`, runtime `5c3134c`) and PR37 (`cd049c6`, runtime `5b1644b`). Git ancestry preserves each original and all PR38 native changes. The combined source needs its own validation; historical model reviews do not certify this merge.

## Current behavior

Four owner-scoped factual routes use bounded Decisions retrieval with the existing planner fallback. Jev and generic/private experimental Decisions remain disabled. Replies persist their canonical ES/EN language, which selects Cristina / Ember; old replies without a language remain text. Consent v2 is per account and checked before quota/provider use. Native sample sleep is explicit, labelled and independent of private QA; it writes no Apple Health data. Broad Progress health context and clinical documents remain local, as disclosed. No additional sensitive Health transmission is introduced by this release.

Product polish, regular unlock/cooldown, the small widget, Progress, basic access without sleep, Apple sign-in, account deletion and review sample are retained. The global retrieval/voice integration regression exercises the merged planner, committed reply shape, both provider voices, exact text/cues, denied consent and legacy fallback without real providers.

## Build and test on iPhone

Use an isolated Mac checkout of this branch. Do not reuse an old visual branch. All targets default to version 1.9 build112 for public distribution; `config/AppStore112.xcconfig` explicitly uses the production backend without a private cookie. Build111 is reserved for private iPhone QA by `config/iPhoneQA111.xcconfig.example`; use the existing private cookie in a local config outside Git. Check that 111/112 remain unused before upload. Xcode26+/SDKiOS26+ required. App minimum iOS16; interactive widget minimum iOS17.

```sh
git clone --branch codex/backend-release-appstore-2026-10-13 https://github.com/guillemarcos14/BlankmindAI.git blankmind-appstore-20261013
cd blankmind-appstore-20261013/ios/Blank
TMPDIR=/Users/user301201/blank-build-tmp/ xcodebuild -project Blank.xcodeproj -scheme Blank -sdk iphonesimulator -configuration Debug build
```

For private iPhone QA, use the generated private xcconfig and archive with matching Health Records/Family Controls distribution profiles. The compiled binary must identify its source, backend deploy and bundle SHA. Upload for testing only; never attach a private QA binary to App Review. The public archive uses:

```sh
xcodebuild -project Blank.xcodeproj -scheme Blank -sdk iphoneos -configuration Release -xcconfig config/AppStore112.xcconfig -archivePath build/Blankmind112.xcarchive archive
```

MacinCloud commands are entered one character at a time. This task prepares the source/configuration; it does not claim that the signed archive, upload or physical testing has happened.

## Backend order

1. Validate the clean combined candidate with the saved baseline and `--enforce-scope`; package/deploy ten app entries only to the reserved private QA site with `tools/backend_staging.js`. The guard permits only bounded authenticated-account Decisions on the known isolated database; Jev, generic flags, SMS/WhatsApp credentials, public routing and schedules remain forbidden.
2. Check the actual QA catalogue and apply only missing voice migrations031–034. Never run global `db push`, alter migration020, reapply production026–028 or execute the disposable test setup on a real database. Production031–034 remains separate from private QA preparation.
3. Verify private protection, exact packaged digests, Apple authentication/installation/account isolation, deletion and cleanup without paid inference. Voice requires an existing protected ElevenLabs key in QA and the selected IDs, `BM_VOICE_PROVIDER=elevenlabs`, `BM_VOICE_ENABLED=true`. A missing secret is a real prerequisite; do not test a Netlify mask, extract a rejected credential or create another key.
4. Keep the 67 original function ZIPs, three validated reconstructed packages and 17 static files from the PR37 preservation bundle. Build the final production manifest from the combined candidate packages; never publish PR37's older three-entry voice manifest or replace unrelated messaging endpoints indiscriminately. Retain rollback6abe94a. Proactive tick/worker code is integrated; do not enable scheduled paid work before its own validation and budget.
5. Execute exact-candidate physical tests and real provider/independent model validation. The previous 24USD ledger has no sufficient allowance for the92 remaining Decisions reviews; no new paid model tests are started here. The Decisions-only exception does not waive voice/public release gates. Only then deploy/enable production and repeat remote smokes. No App Store submission before those checks.

## Physical acceptance

Record actual results for the20 release cases and seven voice checks with commit, deploy, build, trace and evidence hashes. Cover fresh Apple sign-in, basic mode without Health/AI, consent refusal and v1 renewal, labelled sample/on-off cleanup, measured sleep, account switch/delete, app selection/block/unlock, Emergency/hard protection, recurring schedule/daily limit, cooldown with app closed, widget action, APNs/ack and ES/EN playback/cancellation/text alignment. Simulator fixtures never count as device permission or execution evidence.

Reviewer instructions: Sign in with Apple -> Screen Time/select apps -> use basic mode, or explicitly enable Sample sleep -> separately allow OpenAI/ElevenLabs sharing -> open Home/Progress. Sample nights must remain visibly fictional; full access still requires the final working backend. Store screenshots already replaced on12October; older pending lists are historical. Public policy is updated separately through Sites and the draft here matches it. Preserve existing subscriptions and the free new experience; recheck store labels/age rating against actual final flows, then attach only build112 with production configuration.

## Preparation receipts, 13 October

Sites103 is published: source `16273c3592078274888a92e2e6320922d8156ea6`, deployment `appgdep_6acde61761908191866bc8f9ab3be934`. Both blankmind.ai/privacy and blanked.app/privacy return200 with ElevenLabs, renewed consent and labelled sample disclosure; all other static bytes are preserved.

Private QA031–033 already existed with RLS/server-only reservations. Only migration034 was applied, transactionally, after schema/history checks. No production SQL was executed. `tools/appstore_qa_prepare.ps1` defaults to read-only; `-Apply` only adds the missing034 on the fixed isolated project. `tools/appstore_qa_environment.js --configure` sets nonsecret selected voice IDs/provider and bounded Decisions flags on the fixed QA site. The protected ElevenLabs key is absent there, so voice remains OFF with normal text fallback; it cannot be certified or switched ON until that existing key is securely configured in Functions/production. No key is read/exported or created by this tool.

`tools/prepare_iphone_qa.ps1` reuses the existing protected private session cookie and generates an owner-readable config outside Git at `tmp/appstore-final/qa111.xcconfig`. Do not upload that file or include its contents in reports. For the final production package:

```powershell
node tools/backend_staging.js --dry-run
node tools/appstore_preserving_prepare.js tmp/cloud-stage/package-<exact-head>-<timestamp>.json ../Codigo-elevenlabs-production
```

The latter copies every required original/reconstructed/candidate archive into a stable `tmp/appstore-final/production-bundle`, validates all archive digests and preserves the static backup and schedule configuration. It performs no remote calls and never publishes. The manifest replaces only the eight app/account/brain entry points; unrelated messaging endpoints retain their original or explicitly approved reconstruction hashes. Voice/model/device evidence and production live-digest preflight remain required before publication.
