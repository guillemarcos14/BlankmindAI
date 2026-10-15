# Permanent free first window and personalized follow-up

Implementation source: `codex/monetization-funnel-2026-10-15`, isolated from PR50's committed `220c9f8`. PR50's uncommitted concurrent agent work is not included. CORE/iOS-only release and its existing repair are retained. Both approved model diagrams and the FINAL40 spending ledger are untouched. Tools/retrieval/labels remain gated OFF; changed source invalidates earlier optimization certificates.

## Commercial contract

The approved authority is `Blank Brain/REFERENCIAS/funnel_monetizacion_fuente_de_verdad.md` in the central workspace. One recurring window is free permanently, with manual correction, pause and disable. Initial conversation continues until actual iOS registration, without a message/token entitlement counter and without requiring Watch sleep. Free Progress exposes completed shield intervals and the latest measured Watch night. Paid access adds multiple windows, ongoing conversation, advanced Progress and existing bounded autonomous rest evaluation.

No new subscription price, billing period or trial has been approved. `funnel-catalog.json` has sales OFF and no sale IDs. Legacy product IDs are restoration-only identifiers, never fallback price strings. StoreKit provides actual localized product prices and billing periods only for an explicitly approved catalog. No purchase, App Store release or change to live commercial conditions is performed here.

## Implementation

- Native/extension: registration is scheduled, not evidence of completion. A full, owner-bound, non-uncertain `native_schedule_shield` interval is required for completion. The next opening presents a free summary once, with an optional follow-up CTA. Dismissal retains free access; active blocks are not interrupted for payment. Explicit paid-feature requests explain their benefit. Existing native release/consent rules still apply.
- Server: migration037 separates commercial rights from app snapshots. Premium requires server-verified Apple subscription status, bundle, environment, product, account token, current expiration and revocation checks. The official Apple server library validates the certificate chain/signature with online checks. Cached grants refresh after five minutes and fail closed. Refund/expiry removes paid rights; free controls and first window remain. Sandbox is rejected on production backends. Tokenless historical purchases are never silently assigned to an arbitrary account.
- Web: `web/funnel` is based on the actual `https://blankmind.ai` publication, captured 2026-10-15. Source fingerprints are in `tmp/funnel/web-source.json`. Sites identity `appgprj_6aa1367ba7648191904a0a1c0bd10e33`, public, version105, was checked read-only. This is a coordinated release candidate; do not replace the live page until the backend and compatible iOS build are available. The guided conversation runs locally, labels its proposal as a hypothesis, and transfers only on explicit consent through a 24-hour capability code. Claim binds it atomically to one authenticated Apple account. iOS Account imports context/proposal without authorizing or executing a block. Screenshot analysis is not claimed; the supported diagnosis entry is conversation.

## Release prerequisites and validation

Validation is in progress; final results are added below after execution. New migration037, runtime packages and nine-entry release inventory require coordinated integration. Do not deploy from this implementation branch or use the old eight-entry release manifest unchanged. App Store API credentials and trusted Apple roots must be supplied through protected Functions configuration (`FUNNEL_APPLE_PRIVATE_KEY`, `FUNNEL_APPLE_KEY_ID`, `FUNNEL_APPLE_ISSUER_ID`, `FUNNEL_APPLE_ROOT_CERTIFICATES`, `FUNNEL_STOREKIT_ENVIRONMENT`). The root list is DER certificates encoded in base64, obtained from Apple PKI. Sandbox purchases must be tested against an isolated Sandbox backend with these credentials. Unit fixtures do not certify a real purchase, device shield, Watch data or sleep efficacy.

Apple verification implementation reference: https://github.com/apple/app-store-server-library-node .
