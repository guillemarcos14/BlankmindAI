# Sample sleep access without Apple Watch — 2026-10-13

Guillem's physical screenshot from build114 shows Home opening device setup when text or voice is attempted without sleep records. Public account-scoped sample sleep already exists, but its choice is below the long Health recovery content and basic blocking action. The initial viewport therefore directs the user to Health/watch setup and conceals the supported sample route.

## Correction

Move the existing Explore with sample sleep choice immediately after the two permission buttons, ahead of Health recovery and basic blocking. Reuse the existing typography and button style. Keep explicit confirmation, account scope, source labeling, and OpenAI/ElevenLabs consent. No Home/Progress appearance or backend changes.

Active samples show that neither Watch nor Health is required for exploration. Connect Apple Health remains incomplete while samples are active; sample nights never masquerade as measured records. Sample eligibility still uses onboardingSleepAccess and the existing authenticated complete_onboarding endpoint. Setup must complete in the backend before the native restAIAvailable policy opens text/voice.

## Validation

The authenticated endpoint regression accepts explicitly synthetic sample nights without measured Watch records, denies absent sleep and rejects a different installation. Native UI regression covers visible sample choice above Health recovery, explicit confirmation, Health still incomplete, sample-ready state and separate AI consent. The fixture is DEBUG Simulator only, uses an in-memory invalid-signature token, never writes Keychain and blocks automatic backend completion. Physical accounts and distribution builds do not use it. A real account without a parseable owner now returns to sign-in instead of becoming trapped in device setup.

Final native source6f2c3b1 (ios/Blank tree da0031dc829ae48a9610d8ad993e11a8b2f0b69d) passes the product harness89/89 with baseline-sample-access.json and enforced scope (ph_1791903626401_7acc890d). CI38417853644 passes native recovery, simulator build and both onboarding UI tests. Full38417854080 passes the complete UI suite; screenshot exports remain in progress. Earlier failed tests are preserved: the first incorrectly waited for Home tabs in standalone setup; the second depended on a fixture account not established in the unsigned simulator. The final fixture isolates that identity in memory; no production authentication bypass was added.

MacinCloud source6f2c3b1 produced public1.9(115), archive Blankmind115SampleFinal.xcarchive, with ARCHIVE SUCCEEDED, version/language/production URL/empty QA cookie verified and codesign deep/strict valid. Prior archives are retained and were not uploaded. Apple confirms Upload succeeded, Uploaded Blank and EXPORT SUCCEEDED at15:09:22UTC. App Store Connect processes115 and assigns Pruebas Internas with one invitation, UUID770a6973-cc02-4e7b-8042-306185d525e9. Evidence and receipt are in the central workspace tmp/sample-sleep-access-20261013. No App Review submission, backend deployment or paid model tests. Physical text/audio playback remains for Guillem to verify.

## iPhone check

Install1.9(115) from TestFlight. When setup opens, choose Explore with sample sleep, confirm Use sample data and allow OpenAI/ElevenLabs sharing if requested. The existing setup then synchronizes account-scoped fictional sleep and opens text/voice when Screen Time and backend setup are ready. Apple Health/Watch are not required for this sample route. Home/Progress and ElevenLabs providers remain unchanged.
