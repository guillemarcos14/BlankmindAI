# Problem-specific chat notices

AssistantAppError maps transport and HTTP failures to AssistantPendingProblem,
which supplies Spanish/English messages and is stored with the pending ID/text
in the existing Keychain draft. Old drafts without this optional field remain
readable. No raw server code, exception text or diagnostic trace is shown.

Only URLError.notConnectedToInternet is labelled offline. Other transport
failures say that Blankmind could not be reached; timeout, unreadable response,
session verification, installation linking, HTTP 429 and HTTP 5xx have distinct
messages. Missing, failed and processing replies describe the observed turn
state. An ambiguous server code does not claim the turn is processing.

Messages explain the next action: check connection/retry, wait/retry, or sign
in with Apple. Existing sign-in/retry buttons follow the classification and
retryability. The unknown fallback explicitly states that the cause is unknown.

Reload preserves an identified causal failure for pending turns. New observed
processing/missing/failed states replace earlier status-only notices. A
successful authenticated reload clears obsolete sign-in requirements, and a
completed reply removes the pending message and its notice. Automatic retry,
immutable ID/text and explicit confirmation for recovered actions are retained.

Native production tests cover offline versus server connectivity, HTTP 429/503,
ambiguous/unknown errors, persistence through reopening, legacy-draft decoding,
polling without losing timeout information, restored authentication and privacy.
The client test runner now treats a signal-terminated binary as failure.
