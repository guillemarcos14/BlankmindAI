# Blankmind AI — App Store preparation, 2026-10-09

Release is NOT submitted. User requires validated Decisions in the final production build.

## Product decisions
- New app remains free; existing subscriptions remain available and are not cancelled.
- Without measured sleep: basic local app selection, blocking and existing safe unlock/emergency controls. No personalised rest statistics, rest assistant, conversation history or AI automatic-protection settings.
- Full rest AI requires measured sleep, explicit account-scoped third-party AI consent, and successful backend onboarding. Basic users can complete rest setup later.
- Name: Blankmind AI, including native display name. Opaque white icon is intentional; final archive icon still requires visual verification.

## Changes saved in App Store Connect
- Version 1.9 draft: Spanish and English promotional text, descriptions and release notes sourced from blankmind.ai; keywords preserve focus/blocking/Screen Time/productivity/rest intent.
- Spanish subtitle: Inteligencia para descansar. English: Intelligence for better rest.
- Support https://blankmind.ai/support; privacy https://blankmind.ai/privacy saved in both localisations.
- Reviewer notes corrected for Apple sign-in and basic access; temporary preparation warning must be removed after final verification.
- Price already zero in all 175 regions; ratings preserved. Legacy subscription products unchanged.
- Privacy labels add email (account functionality, linked, no tracking), user conversation content (functionality/personalisation/analysis, linked, no tracking), and device ID (functionality/analysis, linked, no tracking). Audio retention and final backend data flows require verification before final release.

## Analytics evidence
Private analytics evidence is recorded in Blank Brain. Search dominates impressions and impressions have risen, but observations do not establish that title, screenshots or copy caused growth. Preserve successful search intent and ratings; replace obsolete screenshots with current verified UI after Decisions integration. Current public screenshots describe the old Blanked interface.

## Website
Sites version 102, source 77c68b9adc58d4b45cae38d92728b505b654e505, published successfully to the existing public site/domains. Dedicated privacy and support pages and footer links added; homepage copy/assets retained. Isolated checkout: tmp/appstore-web-privacy-20261009. Website harness 2/2 plus scope. Legacy Netlify privacy.html redirect is prepared in this PR; not yet deployed to avoid overwriting unrelated production backend changes.

## Validation and remaining release gates
- Native baseline ph_1791560210511_2c1994c3; enforce-scope harness ph_1791564913424_99fe0170 passes 82/82. Earlier release-gate diagnostic failed; later rerun passed development checks. This does not certify physical production release.
- Native Swift tests and simulator compilation pass on 68cb229. Focused UI run 37962591887 passes 5/5: basic access without sleep, hidden rest controls, full-rest settings/forms, progress and return navigation. Full suite 37962594826 remains in progress at documentation time. Earlier failures came from debug-only full-rest fixtures; those fixtures are fixed without a production bypass.
- Add production-path UI evidence for missing sleep, basic blocking/unblocking, valid sleep upgrade, consent decline and account switch.
- Decisions remains controlled by its own validation thread; do not enable OFF features or submit QA build 110 as a public binary.
- Final merged production source, backend compatibility, physical DeviceActivity/Health/sign-in/voice validation, account deletion, reviewer full-feature access, screenshots, privacy manifest/required reasons and App Store archive remain release gates.
- ASC 1.9 currently has no attached build. Need production-distributable archive and upload; internal-only QA builds are unsuitable.
