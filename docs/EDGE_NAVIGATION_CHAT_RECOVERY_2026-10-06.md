# Edge navigation and durable chat recovery

Dragging inward from the leftmost 28 points goes to the previous section;
dragging inward from the rightmost 28 points goes to the next section.
Order: Control, Chat, Progress. From Chat, rightward opens Control and
leftward opens Progress. There is no wrapping. Horizontal travel must reach
45 points and dominate vertical travel by 1.5x. Centre drags and vertical
scrolls do not change tabs. The current page follows the drag slightly, then
slides/fades into its neighbour; Reduce Motion uses opacity only. Chat remains
mounted so navigation preserves its draft, pending request and response.

The reported screen is the saved-pending-message fallback in
AssistantAppView.reload: a durable draft exists but its reply is missing or
failed. The screenshot alone cannot distinguish a transport interruption,
timeout or server failure. Previously reopening/polling checked status but
required a manual send to resume the durable turn. Failed/processing history
rows could also conceal a fresher status response.

Recovery now checks the authoritative status and retries the original ID/text
at most three times, with 2/8/90 second backoff. The final delay accommodates
the backend's 90 second lease. An ongoing send finishes before another attempt.
Recovery stops when Chat is hidden, the scene deactivates, ownership changes,
authentication is required, or the server reports a nonretryable error. The
durable message and manual retry remain available after exhaustion. Automatic
recovery exposes protection actions for explicit confirmation; it does not
automatically apply an old action.

Validation: production Swift client/view-method tests cover identical retry
payload, bounded offline retries, visibility and authentication guards, and
stale failed history superseded by completed status. XCTest exercises both
edge directions, return trips, centre drag exclusion and vertical exclusion.
Product harness: 68/69, no scope violations; the pre-existing production gate
requires additional semantic replay and physical-device evidence. Native iOS
build/UI validation runs in GitHub Actions because this Windows host has no Xcode.

No backend deployment or new TestFlight distribution is part of this change.
