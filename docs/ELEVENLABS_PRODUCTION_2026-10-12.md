# ElevenLabs production replacement, 12 October 2026

Guillem explicitly authorized this task to assume production integration and replace the old voice. Release branch `codex/backend-release-elevenlabs-2026-10-12` starts at PR34 runtime `160aaab`. Spanish Spain uses Cristina `dNjJKg63Fr5AXwIdkATa`; American English uses Ember `WtA85syCrJwasGeHGH2p`. Both were added to the ElevenLabs account; their accent labels were verified in the library. No selected-voice live synthesis is claimed.

## Candidate

- Each completed reply persists `response_language`; apply migration 034 before deploying the new writer. Server voice IDs are configured with `ELEVENLABS_VOICE_ID_ES` and `_EN`; `BM_VOICE_PROVIDER=elevenlabs` replaces OpenAI speech when enabled. No credential is embedded in the app.
- Updated onboarding and Home disclosure specifies that response text, potentially containing referenced personal/sleep facts, goes to ElevenLabs for speech. Account-scoped consent v2 requires renewed permission; v1 cannot authorize the new provider. The request carries the consent assertion and the server checks it before provider calls or quota reservation. An old app without that assertion gets text fallback rather than unapproved sharing. A newly distributed app is therefore required for ElevenLabs playback.
- Tests cover consent absent/false/malformed, no provider or quota calls before permission, account isolation, withdrawal, old consent rejection, both selected voices, canonical timestamps and missing-language text fallback. The private cloud test is updated for the new schema/consent; it has not run against the provider.

## Observed production, no mutations

Read-only Netlify inspection confirmed site `getblank`/`59955668-9a9b-4979-a283-63fbf3115fe5`, current deploy `6abe94a92bf201769389c075`, 73 functions. There is an older `assistant-app` but no `assistant-app-voice`; `BM_VOICE_ENABLED` and `BM_VOICE_PROVIDER` are unset. Existing ElevenLabs configuration previously returned 401 `invalid_api_key`; the voice ID was malformed. The newly created restricted key remains encrypted locally with Windows DPAPI. Automatic security review rejected the attempted decryption command for provider testing and no alternative mechanism was used.

Production preservation preflight verified exact local ZIP hashes for 67 of the 72 functions outside the proposed `assistant-app` replacement. Five functions are still missing, representing three original ZIP hashes: `sms-agent`, `waitlist-agent-background`, and the shared package for `waitlist-agent`, `whatsapp-agent`, `_bm_final_qa_dispatch`. This is the existing preservation incident, not a new failed deployment. Receipt: `tmp/elevenlabs-release/production-preservation-preflight.json`. Do not publish a manifest that removes or silently rebuilds unrelated production functions.

The actual production release gate returned `evidence_missing` for `tmp/bm-release/evidence.json`; no exact candidate artifact/model evaluation/20 physical cases were supplied. Receipt: `tmp/elevenlabs-release/readiness-initial.json`. Automated tests and a Simulator build are not signed distribution or physical evidence. The general gate is unchanged.

## Remaining release work

Complete secure human credential handoff and private QA voice tests; recover the three original production ZIPs; supply exact release evidence; apply only required migrations in the correct environments; publish a complete preserving manifest and verify remote digests/ES-EN playback. Distribution must include renewed consent. No production SQL, credential, flag, function, static page, purchase or App Store mutation was made in this task.

Production publication authorization is recorded and does not need to be requested again. The blockers are credential access, artifact preservation and missing release evidence.
