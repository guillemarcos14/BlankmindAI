# Control organization — 2026-10-08

Based on voice/text-sync 9f9c70b (QA109 and subsequent native improvements).

Control now has five settings entries: Distractions, Protection, Notifications,
Data & Permissions, Account. Emergency is followed directly by Distractions; the redundant manual hold block is removed.
Protection contains Schedule and Automatic Protection. Data & Permissions contains
Conversation History, Health, Screen Time, and the private synthetic sleep switch.
Account contains Manage Account, Privacy Policy and Terms of Service.

The existing header, background, fonts, row rendering, separators, dimensions and
light/dark colors are reused. Subgroups render inside the existing screen with Back.
Existing forms, permissions, history actions and account operations are reused.

Distributed synthetic sleep requires BOTH BLANK_PRIVATE_STAGE_QA and a sandboxReceipt.
A public receipt, missing receipt or public configuration blocks both its UI and saved
source selection. Owner scoping remains unchanged. DEBUG Simulator supports local
previews/tests only; DEBUG on a physical device alone no longer enables the source.

Validation: native UI tests cover grouping, Back, schedule navigation, form dismissal
and retained links/permissions. Native sleep tests cover private TestFlight, public
configuration, public/missing receipt and persisted source account isolation.
CI macOS is required for Swift compilation, simulator UI and screenshot review.
No signing, distribution or new TestFlight build is included in this change.
## Completed validation

Runtime source: e3082fa (96b48eb plus legacy Settings routing correction).
Local harness: 78/78 with baseline and --enforce-scope, including --diff-base 9f9c70b;
run ph_1791469444819_e94ec2cf.
Native Swift tests, Simulator build and 14 UI tests: PASS, CI 37792063971.
BM Harness Gate: all three jobs PASS, CI 37792202704.
Visual inspection: Control idle/active on Pro, compact SE and largest Dynamic Type.
Original gradient, typography, colors and row separators are retained;
compact and large-text screens scroll to the remaining settings as before.
UI test attachments include the three subgroup pages and root.
Evidence: tmp/control-visual/phone-product-control.png and sibling captures;
GitHub artifact ios-conversation-visuals on CI 37792063971.

No archive, signing, TestFlight upload or physical blocking validation was performed.
The existing installed TestFlight build remains unchanged until a new distribution.

## Follow-up: remove the manual hold block

Guillem approves removing the Control hold block entirely. Emergency is followed
by Distractions with the existing 12pt row spacing; there is no spacer or replacement
Blank now entry. Widget and voice remain the existing blocking entry points.
The private unused hold view and its AnyView plumbing are removed. Emergency,
row styles, permissions and protection settings are preserved.

Follow-up validated on source29f9da8: harness78/78/scope (ph_1791471570339_11da07a1), native tests/build/targeted Control UI/captures CI37796978325 PASS, BM CI37796983378 all three jobs PASS. Idle/active Control screenshots reviewed: Emergency and Distractions consecutive with the same row spacing, no hold block. Evidence tmp/control-no-hold-visual/phone-product-control.png and active sibling. CI adds a control test filter to confirm this small revision after the prior full14-test pass. No TestFlight upload.
