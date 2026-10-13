# Sample sleep access without Apple Watch — 2026-10-13

Guillem's physical screenshot from build114 shows Home opening device setup when text or voice is attempted without sleep records. Public account-scoped sample sleep already exists, but its choice is below the long Health recovery content and basic blocking action. The initial viewport therefore directs the user to Health/watch setup and conceals the supported sample route.

## Correction

Move the existing Explore with sample sleep choice immediately after the two permission buttons, ahead of Health recovery and basic blocking. Reuse the existing typography and button style. Keep explicit confirmation, account scope, source labeling, and OpenAI/ElevenLabs consent. No Home/Progress appearance or backend changes.

Active samples show that neither Watch nor Health is required for exploration. Connect Apple Health remains incomplete while samples are active; sample nights never masquerade as measured records. Sample eligibility still uses onboardingSleepAccess and the existing authenticated complete_onboarding endpoint. Setup must complete in the backend before the native restAIAvailable policy opens text/voice.

## Validation

The authenticated endpoint regression accepts explicitly synthetic sample nights without measured Watch records, denies absent sleep and rejects a different installation. Native UI regression covers visible sample choice above Health recovery, explicit confirmation, Health still incomplete, sample-ready state and separate AI consent. The fixture is DEBUG Simulator only and blocks automatic backend completion; subsequent fixture launches clear the previous fixture credential. Physical accounts and distribution builds do not use it.

Source818e98c passes the product harness89/89 with the saved baseline and enforced scope. CI full38411505103/basic38411504974 are in progress. MacinCloud source818e98c produced public1.9(115), archive Blankmind115Sample.xcarchive, with ARCHIVE SUCCEEDED, version/language/production URL/empty QA cookie verified and codesign deep/strict valid. Upload waits for native UI confirmation.
