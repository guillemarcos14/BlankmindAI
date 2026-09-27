# Real assistant-app staging smoke

`tools/assistant_app_cloud_test.js` exercises deployed Netlify functions against a real Supabase staging database. It permits only Supabase project `njqbovsmoowkhhsqmitn` and Netlify site `blank-product-staging-20260926` (including that site's deploy aliases). Other targets, paths in origin configuration, insecure URLs, embedded credentials, and redirects are rejected before any credentials are used.

Staging must have migrations 001–024 and the candidate functions deployed. It must have **no Twilio, Meta/WhatsApp, APNs, or `WHATSAPP_APP_SECRET` configuration**. The smoke creates no device push token and never calls provider delivery APIs. Only the app and native inbox endpoints are exercised; native receipt transitions use an explicitly simulated **failed** outcome. No verified receipt or physical enforcement is fabricated.

Provide these environment variables without printing their values:

- `BM_CLOUD_TEST_SERVICE_ROLE_KEY`: service-role key for the allowed staging database.
- `BM_CLOUD_TEST_ANON_KEY`: public anon key for the same database.
- `BM_CLOUD_TEST_SUPABASE_URL`: optional; defaults to `https://njqbovsmoowkhhsqmitn.supabase.co`.
- `BM_CLOUD_TEST_NETLIFY_URL`: optional; defaults to `https://blank-product-staging-20260926.netlify.app`. Set the origin only, without `/.netlify/functions`.
- `BM_CLOUD_TEST_EXTRA_HEADERS_JSON`: optional JSON object with Netlify protection `Cookie` or `X-NF-*` headers. It cannot replace the user JWT or Supabase authorization.

Read-only local guards, with no network:

```powershell
node tools/assistant_app_cloud_test.js --self-test
node tools/assistant_app_cloud_test.js
```

After staging is ready and remote execution is authorized:

```powershell
node tools/assistant_app_cloud_test.js --run --out tmp/assistant-app-cloud/report.json
```

If model API credits are unavailable, `--run --infrastructure-only --out tmp/assistant-app-cloud/infrastructure.json` executes only the first four checks, makes no model call, and still cleans both synthetic accounts. Its report declares `full_conversation_tested: false`; passing that restricted scope cannot stand in for the full nine-check smoke or release readiness.

The test creates exactly two synthetic QA auth users with admin-confirmed `example.invalid` emails and randomly generated passwords. This bypasses email delivery. Phone fields are synthetic identity-table fixtures, never OTP recipients. Each user has its own install, connection, canonical snapshot and assistant memory namespace.

Nine checks cover missing JWT, cross-install/account denial, client denial of service-only tables/RPC, committed reply/action/shared WhatsApp semantic state, immutable replay without duplicate rows/outbox events, payload conflict, history/status isolation, cancellation across shared memory, and a simulated delivered-to-failed receipt that remains durable after later turns. The report records checks, scoped cleanup results, synthetic user IDs, script hash and exact destinations; it excludes credentials, prompts from real users and auth tokens.

Cleanup runs in `finally` and only deletes those generated users and their identity-scoped fixtures. User deletion cascades app turns; identity deletion cascades its canonical snapshot; synthetic semantic and event rows are removed by exact generated identities. A cleanup failure makes the smoke fail and retains the synthetic user IDs for recovery. Successful cleanup does not imply any production data was touched.

This validates real cloud transport, authentication, persistence and endpoint contracts. It does not validate onboarding OTP, provider delivery, App Store builds or iPhone blocking.
