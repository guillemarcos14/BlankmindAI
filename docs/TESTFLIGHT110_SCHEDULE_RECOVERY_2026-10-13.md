# TestFlight 110 schedule recovery

The private backend serving TestFlight 110 returned `bmb_invalid_schedule` and HTTP 503 on repeated acceptance of a schedule. OpenAI completed the generation; schedule normalization rejected the generated parameters.

The patch converts invalid schedule times, recurrence, horizon and once-only dates into a completed clarification without a device action, memory write or executable proposal. Invalid saved offers also fail closed with a conversational reply. Valid schedules retain their exact parameters. Proactive validation remains strict.

Source `7b9f805a79bb0b60b07faf97ea041015bd8303bd` preserves the active QA runtime from `5f51c88` (function sources identical to the prior published `b9935d9`). Published private deploy `6acde6c360ff48b1a6af1942` on `blank-product-staging-20260926`; ten function digests, Node 22 and API v2 verified. Existing experimental flag digest is identical before and after publication. Public production `6abe94a92bf201769389c075` and static files are unchanged. No SQL, iOS or distribution changes.

Validation: local product harness 88/88 with baseline and enforced scope; five live provider/database conversations over NDJSON, 28 checks, six cleanup operations passed. English equal-time input exercised the patched fallback. Acceptance did not execute the invalid offer; a subsequent valid overnight Monday schedule produced an action; Spanish equal-time clarification and ordinary advice completed. Status recovery and exact UUID replay passed for every turn. Final replies took 4.2–9.0 seconds, or 5.7–10.5 seconds including status/replay checks. Device execution was not tested.

Evidence: `tmp/schedule-fix/deployment.json`, `cloud-test.json`, `after.json`, and `tmp/product-harness/pre-deploy.json`. Complete final ZIPs are retained in `tmp/schedule-fix/final-package`, outside system Temp. Rollback is the previous QA deploy `6ac93372c15d9174ec3c0a1b`.

Two intermediate publications were reverted after real transport probes detected 502 responses. Prebundled ZIP publication must preserve `build_data.runtimeAPIVersion=2`, the existing Node runtime, and explicit upload `invocation_mode=stream` (or background for the worker). Cached ZIP hashes alone do not preserve invocation mode. The publisher now probes the protected draft: NDJSON HTTP 200 carrying the expected unauthenticated 401, without model calls, before publication. Failed smoke reports and intermediate receipts remain in `tmp/schedule-fix`; the initial raw full-environment digest comparison is not used as proof of unchanged secrets because that comparison was unequal. No environment mutation requests were performed; the specific experiment digest and runtime/static checks provide the preservation evidence.

Reproduce the private deploy with the protected header in the process environment:

```powershell
node tools/backend_staging.js --deploy --preserve-existing-experiments
```

The deployed backend is compatible with the installed build 110. Physical confirmation is to retry the saved message on that iPhone; this report does not certify device UI or native blocking.
