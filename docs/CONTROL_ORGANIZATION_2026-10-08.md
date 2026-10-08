# Control organization — 2026-10-08

Based on voice/text-sync 9f9c70b (QA109 and subsequent native improvements).

Control now has five settings entries: Distractions, Protection, Notifications,
Data & Permissions, Account. Emergency and the hold action remain unchanged.
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