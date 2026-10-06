# Progressive BM replies in the app

BM previously buffered the complete model response and the durable transaction
before returning JSON to iOS. The new app route streams draft text during model
generation; the existing completed turn remains the authority for history,
memory, actions and automatic application.

## Implementation and guarantees

- `assistant-app-stream.mjs` returns NDJSON using Netlify's native streaming
  Response API and delegates to the existing authenticated, leased handler.
  `context.waitUntil` retains the transaction on disconnect. No new database
  tables, migrations or environment variables are required.
- `bm-response-stream.js` consumes Responses API SSE with a deadline, bounded
  buffers and a completion requirement. Only the final phase's `response_text`
  is previewed. The schema puts that field last; tool queries and internal
  decisions never become user-visible JSON. UTF-8, CRLF and incomplete JSON
  escapes/surrogates can cross chunk boundaries.
- A new model pass resets the draft, including copy repair and restored-offer
  recovery. All existing BMB validation, action authorization, semantic CAS,
  lease ownership and memory commit checks remain in the completed path.
- iOS uses `URLSession.bytes` and displays transient text in both chat surfaces.
  Drafts cannot enter history, clear the saved pending message or trigger an
  action. Account, request, turn and conversation guards reject stale updates.
  Stream truncation uses existing same-UUID status/retry recovery. Token refresh
  remains single-flight. A missing route (HTTP 404/405) falls back to legacy JSON
  with the same UUID and payload.
- Provider timings record headers, first preview text, completion and token
  counts, without storing prompt, response text or credentials. These are model
  timings, not end-to-end measurements of network/database/device latency.

## Validation

`node tools/bm_response_stream_test.js` verifies that the first draft arrives
before completion, byte-level fragmentation including Unicode/CRLF, hidden read
phases, failed/incomplete/truncated streams, endpoint frames and disconnect.
`node tools/assistant_app_test.js` and `node tools/bmb_test.js` retain the existing
transaction and authority regressions. Native tests compile the production
client and cover progressive Unicode, final authority, truncation, fallback,
refresh and account isolation.

Native client tests and Simulator build passed on macOS CI `37491288772`.
The same iOS source also passed native client tests, Simulator build and Home
UI tests in PR CI `37491377965`. The redundant push run `37491288772` was
cancelled after the PR run completed those checks; screenshot capture remains
separate from the functional validation.
The BM Harness Gate, PostgreSQL recovery and Android checks passed in
`37491377923`. Local product harness passed 69/70 with no scope violations
against baseline/diff `1915cad`; the existing quick production release gate
fails for insufficient reviewed model replay/physical-device evidence
(48 development turns passed, 0/20 physical cases). No gate was bypassed.
Focused tests also exercise the production BMB copy-repair draft reset and
the streaming endpoint against real authenticated claim/prepare/commit logic,
including completed-turn deduplication and unauthorized requests.

## Integration handoff

Objective: Display BM text during generation without weakening durable recovery.

Branch: `codex/app-response-streaming-2026-10-06`.

Base: `1915cad` (onboarding candidate; preserves prior iOS recovery/notices).

Surfaces: BM app backend/model transport, iOS chat transport/presentation,
focused regression tests and product harness contract.

Supabase migrations: none. Environment variables: none. Model: unchanged.

Remaining release work: integrate the backend through the existing Backend
Cloud release process, deploy the exact candidate to QA, build/distribute the
new iOS client and measure on a physical iPhone. This implementation branch
does not publish production or TestFlight. Until both backend and client are
available, the installed app retains buffered behavior.

Latency limitation: first text still waits for context acquisition and model
authority fields. Streaming does not remove that time or guarantee a specific
speedup; actual end-to-end p50/p95 must be measured on QA. Draft copy may change
during validation/repair; the final persisted reply always replaces it.

Platform references: [Netlify streaming responses](https://docs.netlify.com/build/functions/api/#streaming-responses)
and [OpenAI response streaming](https://developers.openai.com/api/docs/guides/streaming-responses).
