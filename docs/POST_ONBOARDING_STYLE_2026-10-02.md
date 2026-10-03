# Post-onboarding style

Guillem approved the onboarding visual proposal for Home, Progress, Settings,
Chat and Distractions on 2026-10-02. Blankmind inputs are explicitly excluded.

- Section titles use the onboarding Times New Roman font; body and controls remain sans serif.
- On 2026-10-03, Home was changed to sans serif only (Helvetica Neue, 32 pt regular
  for its menu and start/unblank labels); its composer and other sections are unchanged.
- Black cards use 4 pt corners, 16 pt padding and regular control labels.
- Settings adds status checks and navigation symbols; Progress retains all metrics.
- Distractions groups native Apple token labels into Apps, Categories and Websites,
  keeps schedules separate, and uses a rectangular Edit distractions button.
- Chat keeps the latest response, history, voice and keyboard behavior; its title
  uses serif and conversation text remains sans serif.

The Home composer and Chat composerBar/composerField/composerActions, their color
dependencies, and the bottom safe-area layout remain unchanged from d3f8f4f.
Home menu margins change independently of its composer. Active protection keeps
the existing dark state and native edit restrictions.

Verification: baseline tmp/product-harness/baseline.json precedes edits;
final validation must use --enforce-scope. Existing release_gate_quick requires
physical release evidence and is independent of this visual change.

CI captures the production views for product-home, product-progress,
product-settings and product-distractions, plus the existing conversation states.
Product fixtures are Debug/simulator-only and use an isolated preview account;
the Distractions fixture shows the real empty state, with no invented Apple tokens.
These captures do not certify physical Screen Time, permissions, or distribution.
