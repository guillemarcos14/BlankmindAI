# Measured rest production,14October2026

Guillem explicitly authorized this operational release in a separate integration chat. PR41/df94541 was merged as e59c149 into the previous app-store release. This isolated checkout is `Extra/Codigo-rest-release`, branch `codex/backend-release-rest-coordinated-2026-10-14`. Original implementation/distribution checkouts and receipts remain intact. Conversational/agentic PR42 is not included.

## Backend and migration

Production is `6acf9143b38ee9277cfc9cbc`, package source `bf49200837bce43a659ee330bd031823e0c1cb72`. All77 remote digests match the frozen manifest;69 unrelated functions and17 statics remain preserved. Eight app/brain/account entries retain Node22, stream APIv2 and background mode. ElevenLabs and bounded retrieval/Decisions stay ON; generic/Jev experiments stay OFF. Environment mutations:0.

Only035 was applied to `vhiikgyyfisejjwqtxfc`, after prerequisites/history checks, under an advisory lock and transaction. No global db push or historical migrations. Four rest tables pass RLS/no-client-SELECT checks; RPCs remain server-only. Production SQL tests cover installation/account isolation, replay, withdrawal, forgetting and the20-other-contributors pool boundary; their transaction was rolled back.

The live smoke found `pgcrypto` in production's `extensions` schema. Only035's `bmb_enqueue_event` was reconciled to `search_path=public,extensions`, and035's stored migration source was updated transactionally. The SQL smoke then passed; public-schema CI remains compatible.

The existing `bmb-tick` is explicitly ON at `*/5 * * * *`. Its real worker advanced a revoked synthetic fixture at14:45:29UTC, setting next check15:45:29UTC. No manual dispatch, model/provider call, notification or Health/device data. Cleanup verifies0users/0accounts. Console streams emitted no app logs; database advancement is the execution evidence.

Candidate auth/installation/RLS smoke passes4checks/12cleanup; NDJSON200/auth401/voice401 pass. The frozen rollback runtime also passes4checks/12cleanup with035 installed, without switching production. No new paid semantic/voice evaluation or exact-candidate semantic certificate; no sleep improvement is claimed.

Receipts in `tmp/rest-release`: publication, schema-receipt, schema-repair, database-smoke, draft-infrastructure, rollback-infrastructure and schedule-receipt JSONs. Stable ZIPs/manifest remain in `tmp/appstore-final/production-bundle`.

## Privacy

Sites105/source56737aaff79bc71e1dd4ac35f6591da26290bd7f is published. Both blankmind.ai/privacy and /privacy/ return200, including measured sleep, separately opted-in additional Health, eligible EU usage/pickup bins, aggregate learning and withdrawal. Landing page/audience unchanged; privacy harness2/2/baseline/scope.

The ten ASC types were reconciled. Health/Fitness/Name/Other User Content retain App Functionality and Product Personalization without blanket Analytics. Purchase History retains App Functionality. Applicable identifier/product-event purposes remain; all types stay linked, tracking No. No App Review, language or Apple case update.

Current [OpenAI endpoint retention](https://developers.openai.com/api/docs/guides/your-data) is None/None for `/v1/audio/transcriptions`. Code retains the transcript, not the recording. Under [Apple's collection definition](https://developer.apple.com/app-store/app-privacy-details/), the reviewed real-time route does not add Audio Data solely for transcription. Generated TTS is separate; future recording retention/provider changes require reconciliation.

Local evidence: privacy.json, apple-capabilities.json and apple-privacy.jpg. Site checkout/artifact retained in `Blankmind-privacy-rest-release`.

## Signed app and TestFlight

FF368 has macOS15.7.5/Xcode26.3 and no managed upgrade. [Xcode26.4 requires macOS26.2](https://developer.apple.com/xcode/system-requirements). CI compiles the archive; the existing Mac signs/exports it. No new subscription, OS alteration or private-key export to CI.

CI38584565671: unsigned Release/arm64 archive with Xcode26.4/Swift6.3, public backend, English, no QA cookie,1.9(117). Source5ffcb0eab3bdace69b21d7741ff102d271654f34; iOS tree c8df357d102121139a3ab924457abdbc2e71df78. Archive SHA256958a5aa97179cebaa6ac201dc78b58e60c80d6fb39b30925b5cd9065bf5dca3f, plus all app-file digests. Full simulator/native/UI runs38584566252 and38581118724 PASS on the identical tree; original source38563897872 remains valid evidence.

Exact archive at `/Users/user301201/blank-rest-117`. Existing Apple Distribution certificate5F68E60D529BBF19FAAFD07DED818FF9296E086E and approved App Store profiles authorize the main app/four extensions. Main profile and signature include usage/Health background. Every bundle passes deep/strict codesign and signed-entitlement comparison. Apple's scalar associated-domain wildcard is supported; unapproved groups/Health/booleans/domains stay rejected.

Manual export initially rejected Xcode-managed profiles; automatic export with fixed build number, existing account/provisioning then completed. Log14October17:31:39.055: Upload succeeded; EXPORT SUCCEEDED. ASC processed117, UUID9a69d426-f882-422b-adbf-61ab737dd22f, Ready to Submit, existing Pruebas Internas group/1tester. Four bounded test notes saved. This is TestFlight availability, not App Review or physical verification.

Mac receipts: signing-receipt.json, upload-receipt.json, upload-automatic.log and ExportOptions.plist in `/Users/user301201/blank-rest-117`. Local archive/CI receipt: `tmp/rest-release/archive117`; signature-valid117.jpg and upload-succeeded117.jpg.

Physical Watch collection, eligible EU usage, shields, playback and withdrawal require an accessible iPhone/Watch. No physical result or improved sleep certified; measured comparisons still require the frozen baseline and sufficient comparable Watch nights.

## Compatible rollback

`node tools/rest_production_release.js --rollback --authorized-production` restores6ace0be5d1774a17ce921165, its cronOFF configuration and original publication-lock state. Environment/ElevenLabs settings stay intact.035's private tables/data and compatible RPCs remain; no down migration or data deletion. Normal readiness/semantic/physical gates are unchanged and not falsely certified. The old runtime's authenticated smoke with035 passes4/4 and12/12cleanup.

Signed/unsigned artifacts and original receipts remain recoverable. Rollback stops new automatic work; it does not certify the old runtime for new measured-rest endpoints or authorize deleting evidence.

## Final closure

Harness ph_1791993256685_0c6d9e59:92/92 with baseline/enforce-scope. PR45 merged8bbf5379d728468912a105e6c0c9986bcabaca54. TestFlight117 saved notes/group verified again on a fresh ASC page; evidence tmp/rest-release/testflight117.jpg. Consolidated receipt tmp/rest-release/closure.json. Blank Brain updated; physical checks and sleep efficacy remain pending.
