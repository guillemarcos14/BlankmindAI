# Blank Production Checklist

## Build Readiness

- Before any BM production deploy, run `node tools/bai_release_gate.js --save --count 125` and require zero `real_behavior_issue` failures.
- Before product release, run `node tools/product_harness.js --contract tools/product_harness_contract.json --mode validate` and require `product_harness passed`.
- Require the BM Harness Gate CI workflow to pass on the exact commit.
- Before enabling loop persistence, apply `supabase/migrations/012_bm_loop_engineering.sql` and verify the RPC, RLS tables, and `bm_loop_learning_summary` view.
- Run one remote `bm-loop` start/advance smoke with a duplicate event and a conflicting event. Require idempotent duplicate handling and rejection of the conflict.

## iOS Production Path

- Open `ios/Blank/Blank.xcodeproj` in Xcode on macOS.
- Set Team and bundle identifier.
- Request Apple's Family Controls entitlement before relying on real iPhone app shielding.
- Add/confirm Near Field Communication Tag Reading and Family Controls capabilities.
- Test only on physical iPhone for NFC.
- Use `docs/IOS_TESTFLIGHT_AND_ENTITLEMENT.md` for entitlement request copy, TestFlight steps, and review notes.

## Analytics And Crashes

- Decide Firebase or Sentry before public testing beyond close friends.
- Track setup completion, NFC registration, Blank activation/deactivation, selected app count, block screens, permission failures, NFC failures, and crashes.
- Use `docs/ANALYTICS_AND_CRASHES.md` as the instrumentation checklist.

## Market Test

- Publish `web/landing/` or port it to your site builder.
- Connect the beta form to Tally, Typeform, Airtable, ConvertKit, or a backend.
- Treat all users already signed up before public launch as one `founders` group.
- Founder benefits should thank early trust: 24-hour priority access, founder acknowledgement, 3-day preferred stock reservation, and 50% off the first Blank Physical Device with code `Founders`.
- Use 12.99 EUR as the launch price for the Blank Physical Device, with gradual price increases after the first phase.
- Keep the future 1.99 EUR/month subscription clearly marked as not implemented yet.
- Recruit 20-50 testers and give each one a physical NFC tag.
- Run the 7-day test described in `docs/MARKET_TEST_PLAN.md`.
- Use the success criteria before spending on larger inventory.

## Store Listing

- Create production launcher icon assets.
- Prepare phone screenshots for setup, home, app selector, privacy, and block screen.
- Write short description, full description, and release notes.
- Decide support email and privacy policy URL.
- Run closed testing before production submission.
- Use `docs/STORE_LISTING_COPY.md` as the first copy draft.
