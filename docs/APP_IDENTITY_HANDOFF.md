# Blankmind Web/App identity

## Current production iOS flow

- iOS signs in through Sign in with Apple using Supabase native ID-token exchange and a nonce. The app requests no Apple email/name scopes.
- If Keychain already holds an authenticated legacy phone session, the app links Apple to that Supabase user. This preserves the stable Supabase user ID and existing app chat history. New accounts have no phone requirement.
- After sign-in, `assistant-app?action=activate` binds `app_install_id` to the authenticated identity and returns an internal connect code. App turns and app-channel memory use the Supabase auth user ID; app routes require JWT plus the matching installation.
- iOS no longer handles `action=handoff`, calls `app-handoff?action=claim_identity`, requests OTP, or receives a phone number from the handoff route.
- Old `/open?action=handoff` links now show the App Store listing without forwarding their token to iOS. The legacy backend endpoint remains available for compatibility, but the current production flow does not call it.

## External Early Access

The website keeps its separate waitlist flow. It uses `waitlist-auth` to verify a phone by SMS, then starts the selected WhatsApp or SMS conversation. This OTP path is not part of the production app authentication surface. Existing `app-handoff` endpoints remain for legacy compatibility but are not called by the current iOS app.

## Release setup

Supabase production `blank-membership` has Apple enabled with Client IDs `com.blanknfc.web,com.blanknfc.app.ios` and manual identity linking enabled. Private staging has Apple enabled with Client IDs `com.blanknfc.app.ios`, no OAuth secret, and manual linking enabled (dashboard verified after reload 2026-09-27). Apple Developer confirms Sign in with Apple is enabled as the primary capability for `com.blanknfc.app.ios`. The four existing app/extension development and App Store provisioning profiles were regenerated and verified valid; they have not been installed on MacinCloud or used for a signed build. Verify legacy account-linking and fresh Apple accounts on iPhone before release. No phone or WhatsApp prompt belongs in production iOS onboarding or Home.
