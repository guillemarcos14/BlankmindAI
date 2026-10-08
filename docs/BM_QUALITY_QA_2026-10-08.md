# BM quality, private QA109, 2026-10-08

Reactive empty replies now receive one constrained prose repair. Device effects are preserved. Generated citations are bounded to available IDs; streamed/internal UUIDs are removed. Invalid sleep units are rejected without treating missing values as zero. Simulated current_sleep retains its provenance and native dated sleep takes precedence over old memories. Duration copy uses hours plus minutes from 60 minutes unless minutes are explicitly requested. Natural, familiar Spanish is contextual, with no forced jokes or double hyphen punctuation.

## Evidence

Three frozen fresh rounds, real provider and private QA DB, retrieval OFF: exploration candidate 6/7 versus reference 7/7; confirmation both 7/7; units both 2/2. Cleanup passed in every round. The failed exploration citation and the deficient first-confirmation units answer remain recorded. Citation/provenance fixes preceded confirmation; stored-unit distinction was then fixed and evaluated with two new ES/EN questions, both excellent under an independent model review. The other confirmation answers received five excellent, one acceptable and one poor verdict. These are model judgments, not human votes; original 24-pair feedback and historical latency failures are unchanged.

The units round is the final runtime before documentation-only changes. Source and response hashes bind each review to its exact input/history. Evidence: [BM_QUALITY_QA_2026-10-08.json](BM_QUALITY_QA_2026-10-08.json). Total cumulative estimated known/reserved provider spend: $3.94414876 of the original $4 ceiling, with no unknown billed requests in these rounds. No budget reset or purchase.

Confirmation final p50: reference 3.93s, candidate 6.12s; p95: reference 9.68s, candidate 12.41s. Seven turns do not establish a latency improvement. Extra safety repairs add calls; acceleration remains OFF.

Release integrates onto c3dd08a14d95268dca8f23865ef5155783a312f3, preserving QA109 dated sleep support and compact-route bypass. No ios/app changes. Physical iPhone evidence remains pending. Private packaging/deploy and final validation are recorded separately at closure.

## Private deployment packaging

The legacy staging helper assumed six CommonJS handlers. QA already serves ten. Packaging now preserves the ten-name allowlist, ESM streaming entries with their native NFT packaging, and the existing signed background worker. Cron schedules and extra handlers remain forbidden. A read-only preflight rejects an unexpected active inventory and enabled retrieval/Decisions/Jev flags before publication. This packaging change does not change BM response runtime.
