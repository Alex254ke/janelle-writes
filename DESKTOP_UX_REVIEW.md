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
