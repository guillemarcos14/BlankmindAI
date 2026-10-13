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

## Follow-up: all day today

The screenshot and affected account history showed that completing the reply was insufficient. The exact request was `Bloquea mis distracciones durante todo el día de hoy`. Immediate clock minutes had already elapsed by normalization, and midnight could be generated as the invalid minute1440. The planner now explicitly represents immediate one-time starts using `start_mode=now`; the server resolves the local date/start from its clock and maps next midnight to minute0. Build110's `applyBMBProtectionSchedule` requires a future start at receipt, so the server leaves a 60-second delivery lead and states that delay in the reply. Recurrence remains `once`, with no weekdays or duration_days. Fixed past times remain invalid, and timezone/DST midnight boundaries are preserved. Proposal acceptance normalizes both sides at the same instant so the delivery lead does not break the exact comparison.

Published source `ddb7257a0badcfc994000707cfd2f6bd3038be4f`, QA deploy `6acdf0efdbf6715f4dbcbe5f`. During this task, App Store preparation replaced the shared QA site with source `5e5d383`/deploy `6acdeea1a1f8c3a06ebb5c8b`, removing the earlier fix and stream metadata. The patch preserves that unified backend's language writer and ElevenLabs adapter; only `bmb-brain.js` and `bmb-proposal.js` differ from its function sources. Metadata is certified from the bundler manifest, with explicit Node22 and stream/background upload modes, and draft transport is probed before publication.

Three independent synthetic accounts sent the exact Spanish request, its English counterpart and an explicit now-to-midnight Spanish request. All three produced completed replies with auto-applicable once-only actions, exact local next-midnight ends, future starts compatible with build110, and identical durable UUID replay. 42 checks and18 cleanup operations passed. Harness88/88/scope and exact-source CI38371990032 passed all three jobs. Dated action metadata and native future-start compatibility were checked; no physical iPhone blocking was executed. Evidence and complete ZIPs are retained under `tmp/schedule-followup`; the affected account history is private local evidence, never a test fixture or repository file.

The old completed clarification remains immutable. Send the request again with a new turn UUID rather than replaying that old reply. Integrate the latest PR40 into the final App Store release before any subsequent shared-QA publication, so an older candidate cannot remove this correction.
