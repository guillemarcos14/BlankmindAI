# Blankmind unavailable: unsupported duration

The screenshot's 3-minute request is stored as a failed app turn on private QA. Netlify diagnostics report `bmb_missing_duration` on each retry. Both backend normalization and the native timer support integer durations from 5 through 240 minutes. An unsupported duration was thrown as an infrastructure failure and mapped to HTTP 503.

The planner now turns that known constraint into a completed conversational reply with no action or silent duration change. One bounded model call can explain the constraint naturally; a localized constraint message remains available if that call fails. The unsupported request is retained for clarification, and previous proposals/history recovery are cleared so a later acceptance cannot execute an unrelated earlier offer. Other validation failures continue to fail closed.

Regression tests cover unsupported block/daily-limit durations, exact 5/240 boundaries, Spanish copy, repair failure, and old-proposal removal. The private cloud smoke checks completed replies, durable status, identical UUID replay, payload conflicts, valid 5-minute proposals, and excessive durations using a synthetic account only. No native receipt is fabricated.

Release is based on the already deployed `68e818e` source to keep this incident isolated from subsequent streaming and UI changes. No database migration or new iOS build is required.
