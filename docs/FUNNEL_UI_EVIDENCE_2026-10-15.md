# Funnel UI evidence — 2026-10-15

**Verdict: SHIP for the reviewed web corrections only.** The finish reviewer scored all three fixes and the corrected pricing capture as resolved. This records an ordinary extension of the existing visual world; it approves no global token or design-system change.

## Inherited visual authority

Read `PRODUCT.md`, `DESIGN.md`, the Impeccable `reference/document.md` playbook, and the HTML, styles and behavior in `web/funnel`. The live web surface remains the authority for this extension: bundled Neue Montreal Regular, ivory lettering, green-gray ground, the existing warm/cool atmospheric image, sparse composition and bracketed scrolling section navigation. Desktop retains three columns; mobile retains horizontal navigation, a naturally aligned reading column and the App Store link. This web navigation does not redefine native Control/Chat/Progress navigation.

`tmp/funnel/web-source.json` records the live capture from `https://blankmind.ai/` at 2026-10-15T11:05:29.758Z. The new tracked PNG reuses the live version105 atmosphere; its embedded `impeccable:prompt` text records that origin and original SHA256 `67fc0e6153d4d6279a623d1854b1bb607ae81bb12c978b21186e49a71fbc0df4`. It is reused material, not a generated image. Added provenance metadata means the original hash identifies the fetched source, not necessarily the final PNG bytes.

## Scoped visual additions

Selected landing-page copy gains a dark translucent reading surface (`rgba(16,33,23,.72)`, 20px inset). The diagnosis adds a fixed atmosphere shade (`rgba(13,28,19,.62)`), a scrollable column up to 38rem, 17px body text and naturally wrapping headings. Light fields/actions (`#eef1ec` with `#243b30` text), 8px local corners, minimum 48px controls and visible focus outlines support reading and input. These are funnel-local choices, not additions to the normative root token system.

The reported contrast sampling is **8.94–11.04:1** for the reviewed text/background samples. This is sampled evidence, not a blanket claim for every inherited link, navigation opacity, image coordinate or interactive state.

## State hierarchy and behavior

The guided browser-local conversation leads to time selection, then a proposal labeled as a hypothesis. Copy distinguishes a proposal from a configured iPhone window and from demonstrated sleep improvement. The permanently free first window and optional personalized follow-up remain legible; pricing explicitly says subscriptions cannot yet be purchased and supplies no invented price or trial.

Consent starts unchecked and names saving the answers before transfer and the 24-hour expiry of the continuation code. Continuing without consent shows status guidance; saving disables the action and announces progress. Success replaces the transfer action with a prominent Open Blankmind action, while retaining the warning that configuration and implementation still happen on iPhone. The private code and installation fallback continue below the first handoff viewport; HTML/JS provide copy with selection fallback, expiry/privacy guidance and revision. A failed transfer retains the answers and exposes Try again with a specific status message. Revision clears the conversation/proposal/continuation and consent. Live status regions and focus movement are present in source; these captures do not constitute an assistive-technology audit.

## Evidence and limits

Visually checked all eight current captures under `tmp/funnel/web/`: desktop/mobile `pricing`, `proposal-viewport`, `handoff-viewport` and `transfer-error` PNGs. Pricing captures visibly show PRICING selected with pricing content, resolving the earlier capture mismatch. Desktop screenshots are 1440px wide; mobile screenshots are 390px wide. Proposal, consent, success and retry text wrap within the captured columns. Handoff and error content extending below the viewport rely on page scrolling; no screenshot alone proves every lower control.

The supplied Chrome validation passed desktop/mobile browser tests with **mocked transfer**. This documentation pass inspected source and captures; it did not rerun those tests. No publication, actual API transfer, purchase, native execution or physical-device certification is established. Native CI remains pending and is not reported as passed. Existing Impeccable context warnings for legacy PRODUCT schema and a stale design sidecar predate this pass; neither was repaired. `PRODUCT.md`, `DESIGN.md` and `.impeccable/design.json` remain unchanged by this documentation pass.
