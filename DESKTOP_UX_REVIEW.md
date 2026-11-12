# Desktop messaging follow-up — 12 November 2026

## Reproduced defect

Logged into the employer QA account in a 1440 × 1000 desktop browser against the connected Supabase backend. Opened a test conversation, typed a draft, and ran the application's normal background reconciliation. Before the fix, the selected order changed from the open QA order to an empty value and the composer disappeared. The draft remained hidden in the textarea.

`renderMessagesPage()` replaced the selector's options and restored only an explicit one-time preselection. Subsequent realtime or periodic updates had no preselection and therefore closed the conversation. The earlier dedicated mobile-room fix did not cover this desktop renderer.

## Correction

- Keep the currently selected conversation when rebuilding the inbox, as long as it remains available to the signed-in user. An explicit requested conversation still takes precedence; removed or unauthorized conversations close.
- Retain the draft, selection/cursor, focus, and thread position during refreshes. Cache drafts separately per conversation in memory, and clear that state on logout or account change.
- Retain the sidebar's scroll position when rebuilding conversation cards.
- Keep the later message-metadata renderer on the same visibility-filtered messages as the primary renderer, including separate student/writer channels.
- Desktop styling is unchanged. The mobile layout remains restricted to its existing breakpoint.

## Verification

Used the existing isolated writer, employer, and student QA accounts, a local release checkout, and actual Supabase authentication/data/realtime. The public production domain remains blocked to this environment; this is not a production-browser sign-off.

- Reproduced the defect before editing and confirmed the same refresh keeps the chat/composer open afterward.
- Opened 44 desktop account screens: 15 employer, 18 writer, 11 student. No browser page errors or clipped controls at 1440px.
- Each role: selected an actual conversation card, typed a draft, and triggered three real task snapshots. Selection, composer visibility, draft, cursor, and reading position remained intact.
- Employer/writer live replies and updates to another order did not close or switch the selected chat. Unsent text survived an incoming reply.
- Separate drafts restored when switching between two conversations. Search and unread filters survived updates.
- A simulated message-send failure restored the draft and kept the conversation open; Enter initiated exactly one request. Task-details Back navigation restored the same chat and draft for employer and student. A local mixed-channel fixture confirmed the metadata renderer does not display writer-channel text to a student.
- Kept an open chat through a full automatic reconciliation cycle (65 seconds), then checked the account messaging views at 1366 × 768 and signed out all three roles.
- Desktop workflow checks: persisted messages after reload; separate-order access denial; text submission, employer revision request, writer resubmission; private file upload and student retrieval of its submission record; new order created through the form and directly assigned to the QA writer; logout.
- 88 automated tests pass, including new conversation-selection, draft/cursor/scroll, account-isolation, and logout regression cases.
- Original desktop homepage screenshot still matches pixel for pixel; mobile switching/keyboard regression checks still pass.

## Limits

The 44-screen scan checks navigation/layout, not every possible action. Real payments, Google/email authentication journeys, protected profile-save API calls, and replies from a real admin/support account remain outside the verified coverage described in MOBILE_UX_REVIEW.md. No real payments were made, and test operations used only QA orders and identities.

## Subsequent desktop styling pass

After the messaging correction, the owner authorized desktop styling while explicitly excluding the public landing page. The new `assets/desktop-workspace.css` is restricted to `#app-shell` at widths of 1024px and above. Public landing markup, copy, authentication screens, and the mobile styles were not edited in this pass.

- Refined dashboard spacing, readable current-work summaries, sidebar states, filters, buttons, and keyboard focus indicators, with subtle interaction feedback that respects reduced-motion preferences.
- Improved order-row readability. At 1024–1199px, the existing order rows become labeled cards so all actions remain accessible without sideways scrolling; wider desktops retain tables and their existing handlers.
- Gave messaging a viewport-sized workspace with independently scrolling conversations, thread, and task context. Increased message text and metadata sizes, kept the composer visible, and corrected dark-mode contrast for the conversation heading, incoming-message metadata, filters, and task details.

Additional verification used the same three isolated QA accounts and actual authentication/data/realtime:

- Public landing screenshots match the preceding production checkout pixel for pixel at 390px and 1440px.
- Mobile dashboard and order screenshots are identical with and without the new stylesheet for each role.
- All 44 account screens pass desktop navigation/layout checks again. Dashboard, orders, and messaging pass 54 combinations of role, viewport width (1024/1366/1440px), and light/dark mode with no page errors, document overflow, or clipped controls.
- The chat composer stays within a 768px-high viewport at widths of 1024, 1200, 1220, 1280, 1366, and 1440px for all three roles. Employer order actions remain within view at each width.
- Repeated the live messaging regression after applying the stylesheet: three real snapshots per role, separate drafts, two-way replies, another-order update, search/unread filters, a full 65-second reconciliation cycle, laptop resizing, and logout all pass with zero browser page errors.
- JavaScript syntax checks and all 88 automated tests pass. The production-browser and workflow-coverage limits above still apply.

## Dashboard repetition cleanup

Removed the repeated welcome-banner totals from writer and employer dashboards, moved the student's overview into the same card format, and kept one metric section per account. Active work remains available alongside the other unique metrics. Removed the extra writer revision-count shortcut and consolidated duplicate action cards into the welcome actions; submission, invoices, orders, and student/admin messaging remain accessible.

- Logged into all three isolated QA accounts and verified every displayed count against the account's task data through three real background snapshots. Each dashboard retains one metric section with unique labels and counter elements.
- Checked 30 role/viewport/theme combinations (390, 768, 1024, 1366, and 1440px, light/dark): no document overflow or clipped summary cards/actions.
- Clicked all three welcome actions per account and checked empty-account rendering with a temporary in-browser empty task list, restored afterward. No page errors or database writes were needed for this pass.
- Public landing and mobile landing-template markup match the preceding release. Landing screenshots at 390px and 1440px are identical with the new dashboard stylesheet enabled and disabled.
- JavaScript syntax checks and all 88 automated tests pass. The production-access limits noted above still apply.

## Employer task-posting redesign

The employer form now groups the existing controls into task details, scope/budget, and files/writer sections. A live summary shows the brief, length, deadline, assignment, attachments, and the existing calculated total. It stays beside the form on larger desktops and follows the form on smaller screens. Improved labels, focus states, dark-mode fields, and keyboard file selection/removal complete the interaction updates.

The enhancement moves the existing field nodes and buttons without duplicating their IDs or replacing posting/pricing handlers. It initializes after the legacy deferred modules finish. On employer sign-out it clears the unsent form and restores the shared page's original layout for other roles. The public landing markup is untouched.

Verification used the existing isolated test accounts and a local release checkout with the actual backend:

- Twelve viewport/theme combinations (320, 390, 768, 1024, 1366, and 1440px; light/dark) pass without document overflow or clipped controls. The summary action is accessible on a 1366 × 768 laptop.
- Changing scope, rate, citation style, writer, and deadline updates the preview; four pages at KES 350 calculates KES 1,400. Entered markup is displayed as text. Three real background snapshots preserve the filled brief and keep one summary/field set.
- Keyboard file selection/removal, drag-and-drop selection, attachment counts, form clearing, and blank-subject validation pass. These selected test files were removed before the real posting check, so no storage objects were created.
- A simulated persistence failure retains the filled brief. A real zero-value QA order posts through the existing handler with an instruction link and direct assignment only to the QA writer; the writer account retrieves it.
- Employer logout cleanup and student login in the same browser restore the original 15-group form and student currency calculation, without the employer's unsent draft. Zero browser page errors in the completed account checks.
- Landing markup matches the preceding release; phone/desktop screenshots are identical with the new stylesheet enabled and disabled. JavaScript syntax checks and all 88 automated tests pass.

Production deployment status is checked separately; the production-browser access limit described above still applies.

## Writer bidding workspace

Refreshed Available Orders and My Bids for desktop and mobile, using readable order cards, visible payout/deadline information, search/style/level filters, sorting, and pending/closed request filters. Removed the repeated bid-summary cards. Assigned work continues to move to My Tasks. Expired requests are shown as closed, and the sidebar pending count uses the same classification.

Reproduced an unsent request being erased when the existing task page refreshed. The full-page request composer now retains separate in-memory drafts, cursor/focus, textarea position, and ancestor scroll positions through refreshes. Submission uses the existing atomic bid RPC, guards duplicate requests per order, preserves drafts after failures, and shows a saved request even if its subsequent notification fails. Signing out clears request state; late responses cannot populate a different account. These hooks install after the legacy deferred modules finish.

- All 93 automated tests and JavaScript checks pass, including new tests for bid status/deadline boundaries, per-account draft state, overlapping requests, stale responses, and Unicode character counting consistent with Postgres.
- Authenticated with the real QA writer account. An actual call to the existing bid RPC with a nonexistent QA order confirms its parameter contract and expected rejection without changing data. The existing database function definition and task visibility policy were also inspected; no database permissions or schema were changed.
- Browser bid scenarios use isolated in-memory orders and intercepted bid/notification responses. No public QA orders were advertised, real bid records changed, or owner notifications delivered. These scenarios cover search/sort, pending/expired/declined states, expanded-request preservation, selected-order exclusion from My Bids, duplicate clicks, failed sending, notification failure, and sign-out during a request.
- Thirty-four settled viewport/theme checks pass: Available Orders and My Bids at six widths (320/390/768/1024/1366/1440px), plus the request composer at five widths, in light/dark mode. The longer Reconnecting header label no longer pushes actions off smaller laptop screens.
- A separate touch-device check covers opening an order, minimum message length (including emoji), draft/caret/textarea scrolling through refreshes, one successful simulated send, bid status/search/message expansion, and logout. Zero page errors in the completed desktop/mobile runs.
- Employer form compatibility and account-state isolation pass. Landing markup matches the preceding release, and landing screenshots at 390px/1440px are unchanged with the new stylesheet enabled and disabled.

Request history remains limited to task records returned by the existing server visibility policy; this release does not add a separate permanent bid archive. Production-browser access remains blocked from this environment, as noted above.

## Bid typing and reload recovery

The scheduled task refresh could still replace the focused request textarea. A read-only check on an actual public order confirmed that replacement during desktop typing, even though the preceding release restored its text in that run. A separate reproduction against the preceding release confirmed that a full browser reload erased the unsent draft.

The bidding enhancement now defers the same order's detail redraw while the writer is using its request form, including composition input, and applies deferred updates after focus leaves the form. Drafts are also saved per writer and order in the current tab's session storage, restored after a reload, and removed when cleared, successfully submitted, or explicitly signed out. Other account drafts are discarded on account changes. Storage failures leave the existing in-memory draft protection working.

Legacy DOM replacements also rehydrate the saved text and focus. If an order stops accepting bids, sending is disabled and the writer's unsent text remains available to copy; this does not grant access to the closed order. The landing page, stylesheets, database schema, and bid RPC are unchanged.

Verification for this follow-up uses real QA authentication and browser-only task fixtures; it does not submit bids to public orders:

- Desktop native keyboard typing passes a full 65-second cycle through the actual scheduled refresh, with the same textarea node throughout. Repeated explicit snapshots preserve the field, selection, focus, and textarea scroll on desktop and a 390px touch viewport; synthetic composition events are covered as well.
- Full page reloads restore the current writer's per-order text. Separate order drafts, legacy DOM replacement recovery, deliberately emptying a draft, closed-order text recovery, and explicit logout cleanup pass on both desktop and mobile, with zero browser page errors or task/bid writes.
- Five additional automated cases cover reload restoration, successful-send/clear cleanup, account isolation, unrelated storage preservation, and unavailable/malformed storage. JavaScript checks and all 98 automated tests pass.
- Repeated the bidding functional regression: minimum-length validation, failed-send draft recovery, one RPC for duplicate clicks, pending state across refresh, sent-draft storage cleanup, successful bid history despite notification failure, late-result isolation after logout, and employer form compatibility pass. Successful sends and notifications are intercepted fixtures; the actual authenticated bid RPC safely rejects a nonexistent QA order. Landing markup and phone/desktop screenshots remain unchanged. This follow-up does not repeat the previous release's full styling matrix.
