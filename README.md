# Blankmind for iOS

Blankmind works exclusively on iPhone, with Apple Watch sleep data informing the personal rest model.

## Project structure

- `ios/Blank/` — SwiftUI app and Screen Time extensions.
- `netlify/functions/` and `supabase/` — authenticated conversation, memory, voice and measured rest.
- `tools/` — runtime, database, native and release validation.
- `docs/` — product, validation and Apple distribution documentation.
- `web/landing/` — app access page.

## Validation

Create a baseline before editing, then validate the declared scope:

```powershell
node tools/product_harness.js --contract tools/product_harness_contract.json --write-baseline tmp/product-harness/baseline.json --mode plan
node tools/product_harness.js --contract tools/product_harness_contract.json --baseline tmp/product-harness/baseline.json --mode validate --enforce-scope
```

The iOS Build workflow compiles and tests the SwiftUI app on macOS. Open `ios/Blank/Blank.xcodeproj` in Xcode for local Apple development. Physical iPhone/Watch validation, signing and distribution remain separate gates; see `docs/IOS_TESTFLIGHT_AND_ENTITLEMENT.md`.
