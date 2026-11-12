# Mobile UX review — 12 November 2026

The visual refresh applies only at widths up to 760px. Desktop retains the original public page, copy, imagery, signup layout, and workspace tables. The desktop homepage's first screen matches the original screenshot pixel for pixel. Moving between desktop and mobile preserves each version's form state and does not mount duplicate element IDs.

## Changes

- Mobile homepage: action before the photo, clearer copy, interactive sample order, shorter audience cards, concise FAQs, and an accurately named student brief builder.
- Mobile signup: all three roles are visible together and support keyboard activation and announced selection.
- Employer/student My Orders and writer task lists: labeled mobile cards replace sideways-scrolling tables so actions remain within the screen. Desktop tables are unchanged.
- Mobile chat: incoming messages now refresh the open room while preserving an unsent draft, cursor, focus, and reading position. Unrelated order updates do not rebuild that chat.
- Writer submission: revision orders are available for resubmission, and refreshing eligible orders retains the selected order. This functional correction also benefits desktop without changing its design.
- Rendering: copyright text no longer causes the icon mutation observer to repeatedly replace identical text when page content is moved.

## Verification

Used a local checkout with the actual connected Supabase backend, real authenticated browser sessions, three dedicated QA identities, and clearly labeled QA orders. No existing users' orders or messages were edited and no payments were made. Test addresses use Resend's documented delivered-test aliases. QA identities were administratively confirmed; this does **not** verify the emailed signup/OTP journey.

- Repository syntax checks and 85 automated tests.
- Real sign-in for writer, employer, and student; real sign-out for all three.
- Opened 44 available account screens: 15 employer, 18 writer, 11 student. No browser page errors or horizontally clipped controls in the final 390px scan. This is navigation/layout coverage, not a claim that every control on every screen was exercised.
- Additional mobile order/messaging/form checks at 320px and 760px.
- Employer-to-writer messaging and writer replies received live in the open mobile room, including preservation of an unsent draft. Messages persisted after reload.
- Student identity could not read the separate employer QA order.
- Student chat opened and rejected a blank message. No test conversation was sent to real support staff.
- Writer submitted text, employer requested a revision, writer resubmitted, and the unpaid-completion guard remained visible.
- Private file upload; student downloaded the exact test file contents. An unrelated employer could not create a signed URL for that file.
- New order posted through the mobile form and directly assigned to the QA writer.
- Writer requested an extension; employer approved it and the updated deadline appeared live.
- Dispute opened and withdrawn on the QA order.
- Mobile/desktop resizing, original desktop screenshot comparison, mobile demo keyboard navigation, and reduced-motion behavior.

The QA accounts were signed out. The uploaded test file was removed through the Storage API. QA-only order/account rows remain isolated for inspection: the Supabase cleanup confirmation expired, so deletion was not completed.

## Remaining verification

- Vercel team authorization was approved, but the connection still lists no projects and returns 404 for the known Janelle Writes project/deployment. Project-level access is needed for protected-preview checks and profile-save API verification. The local static server does not serve that backend endpoint.
- Real payment processing, deposits, withdrawals, refunds, and payment-confirmed completion were not executed. No money moved.
- Public bidding/assignment was not tested with an order advertised to real writers. The order-creation check used direct assignment to the QA writer.
- Student-to-admin replies and admin financial decisions require an isolated admin test environment. Student message-channel permission tests in the repository still pass.
- Email delivery/OTP verification, Google sign-in, and password recovery were not completed with a real inbox.

These limits remain explicit; the passing checks do not establish that every production integration works.
