# Build 104: private streaming backend repair

The signed 1.9(104) client includes streaming and continuous writing haptics, but private QA returned HTTP404 for assistant-app-stream on 2026-10-06. The eight-function BMB packager omitted the new ESM endpoint, so iOS correctly fell back to buffered JSON and never had visible drafts to drive haptics.

Integration branch: codex/backend-release-app-streaming-2026-10-06, based on eb89b44. Retains unsupported-duration fix71e3e27. No migration, model, credential or iOS changes. Only private QA site2ef5a74e-af70-4893-a5f6-63fb2537720d with isolated Supabase njqbovsmoowkhhsqmitn is a deployment target.

The packager now includes nine entries, preserves the streaming default ESM export and requires Netlify runtime API2/invocationMode stream. Netlify automatically selects nft for this ESM entry. The report records runtime mode and version; source/input/ZIP hashes and privacy checks remain mandatory. Regression rejects a buffered streaming artifact. Real bundler dry-run passes. Local streaming and durable app transaction tests pass. Harness69/70, zero scope violations; pre-existing production release_gate_quick requires physical evidence, so this prepares private QA only.

Remote smoke uses a synthetic account, observes multiple real model drafts before completion, checks identical durable JSON replay, and repeats unsupported3min/supported5min/conflict/excessive-duration checks. Fixtures are cleaned by exact synthetic identity. iPhone haptic sensation is not established by the cloud test.

Deployment and smoke receipts: tmp/cloud-stage/package-*.json and tmp/streaming/cloud.json. GET before deployment:404, tmp/streaming/before.json.

Reference: https://docs.netlify.com/build/functions/api/#streaming-responses

The first private deployment exposed a CLI metadata issue: reinspection of ready ZIPs dropped invocationMode and returned502. The packager now supplies its fresh manifest at .netlify/functions/manifest.json and retains the Netlify API2/stream metadata during upload. Regression verifies this path and rejects --skip-functions-cache. Real ZIP hashes remain checked.
