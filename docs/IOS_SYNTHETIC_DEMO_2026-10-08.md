# iPhone demo with synthetic data — 2026-10-08

Entry: after Apple sign-in, tap **Explore demo with sample data** on device setup. No sleep observations or Screen Time permission are required for this isolated preview.

The demo starts in Progress, reuses ReportView and its aggregation/forecast with an in-memory 14-day fixture, and adds visible sleep/steps numbers. Control previews protection with local state; Chat offers explicitly scripted sample replies. The persistent DEMO / SAMPLE DATA banner and Exit demo remain visible. Exit returns to the existing onboarding gate; setup, real Health data, history, account and BM context are not updated. Production ReportView has no fixture by default and retains its behavior. No real protection can be applied from a demo report.

Validation: native fixture test covers 14 nights, stage totals, nonfuture sessions, weekly aggregation, midnight, DST and zero UserDefaults mutation. XCTest covers entering with no sleep, viewing numbers, disabled real protection, sample interaction and return to unmet onboarding. CI run: https://github.com/guillemarcos14/BlankmindAI/actions/runs/37748855157. Harness evidence: tmp/product-harness/demo-final.json, baseline demo-baseline.json.

Distribution: implementation is not installed on Guillem's iPhone. A new signed archive and TestFlight upload are required; archive107 predates this change. Last known upload blocker was Apple Account reconnection in MacinCloud (TESTFLIGHT107_2026-10-07.md).

Results: native fixture tests, Simulator build and the complete XCTest UI suite passed on source3e84eb3 (37748855157), including the new demo entry/numbers/exit case. Existing visual captures are still running. PostgreSQL, contract/runtime and Android passed in BM Harness Gate37748991320. Local harness76/76 with scope enforcement. No signed archive or TestFlight upload performed for this source.
