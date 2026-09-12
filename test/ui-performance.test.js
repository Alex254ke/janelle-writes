import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('compact profile names show first name and second-name initial', () => {
  const match = html.match(/function jwCompactDisplayName\(value\) \{([\s\S]*?)\n\}/);
  assert.ok(match, 'compact display-name helper should exist');
  const compactName = new Function('value', match[1]);

  assert.equal(compactName('ALEX WILLIAMS'), 'Alex W.');
  assert.equal(compactName('daisy'), 'Daisy');
  assert.equal(compactName('  jasmine   smith  johnson '), 'Jasmine S.');
});

test('sidebar profile identity reserves space for the user name', () => {
  assert.match(html, /\.sidebar-user \.user-info \{[\s\S]*?flex: 1 1 auto;[\s\S]*?min-width: 0;/);
  assert.match(html, /\.sidebar-user \.user-avatar \{[\s\S]*?width: 36px;[\s\S]*?height: 36px;/);
  assert.match(html, /\.sidebar-profile-link \{[\s\S]*?width: 38px !important;[\s\S]*?min-width: 38px !important;[\s\S]*?padding: 0 !important;/);
  assert.match(html, /class="sidebar-profile-link"[^>]*aria-label="Open profile"[^>]*>\s*<i class="bi bi-person"/);
  assert.doesNotMatch(html, /class="sidebar-profile-link"[^>]*>[\s\S]{0,80}👤/);
});

test('mobile navigation and hero both expose the student CTA', () => {
  const matches = html.match(/class="btn[^"]*student-cta-btn[^"]*"[^>]*>International Student<\/button>/g) || [];
  assert.equal(matches.length, 2);
  assert.match(html, /#landing-page \.student-cta-btn[\s\S]*visibility:visible !important/);
});

test('international students have a dedicated integrity-first support journey', () => {
  assert.match(html, /<section class="landing-section" id="landing-students" hidden>/);
  assert.match(html, /<nav class="landing-nav-links">[\s\S]*?<a class="student-nav-link" href="\/students\/">Students/);
  assert.match(html, /class="landing-mobile-links"[\s\S]*?<a class="student-nav-link" href="\/students\/" onclick="closeLandingMenu\(\)">Students/);
  assert.match(html, /\.landing-nav-links a\.student-nav-link,[\s\S]*?background:linear-gradient\(110deg,#168d80 0%,#249f91 48%,#a86f1e 100%\)/);
  assert.match(html, /Academic guidance that feels clear from the start\./);
  assert.match(html, /Editing and proofreading/);
  assert.match(html, /Research guidance/);
  assert.match(html, /Citations and formatting/);
  assert.match(html, /Time-zone friendly communication/);
  assert.match(html, /Academic integrity matters\./);
  assert.match(html, /onsubmit="return buildStudentEstimate\(event\)"/);
  assert.match(html, /localStorage\.setItem\('jw_student_estimate_draft'/);
  assert.match(html, /openAuthScreen\('signup', 'student'\)/);
  assert.doesNotMatch(html, /student-estimate-result[\s\S]{0,500}(guaranteed|instant quote)/i);
});

test('student support layout collapses cleanly on mobile', () => {
  assert.match(html, /\.student-support-intro \{[\s\S]*?grid-template-columns:minmax\(0,1\.08fr\) minmax\(300px,\.72fr\)/);
  assert.match(html, /@media \(max-width: 680px\) \{[\s\S]*?\.student-service-grid,[\s\S]*?\.student-estimate-grid,[\s\S]*?\.student-workflow,[\s\S]*?\.student-trust-strip \{ grid-template-columns:1fr; \}/);
  assert.match(html, /\.student-estimate-field select,[\s\S]*?\.student-estimate-field input \{[\s\S]*?min-height:46px/);
});

test('mobile experience includes thumb navigation and production touch targets', () => {
  assert.match(html, /<nav class="mobile-app-nav" id="mobile-app-nav"/);
  assert.match(html, /function renderMobileAppNav\(\)/);
  assert.match(html, /--mobile-nav-height:72px/);
  assert.match(html, /\.mobile-app-nav \{[\s\S]*?position:fixed;[\s\S]*?grid-template-columns:repeat\(5,1fr\)/);
  assert.match(html, /class="mobile-notification-action"[\s\S]*?id="jw-notification-count-mobile"/);
  assert.match(html, /#landing-page \.landing-hero-feature-strip \{[\s\S]*?grid-template-columns:1fr 1fr/);
  assert.match(html, /#auth-screen \.form-input, #auth-screen \.form-select \{ min-height:50px/);
});

test('signed-in mobile support stays clear of bottom navigation', () => {
  assert.match(html, /#app-shell:not\(\[style\*="display: none"\]\) ~ \.floating-support-widget\.jw-whatsapp-widget \{[\s\S]*?bottom:calc\(var\(--mobile-nav-height\) \+ 28px \+ env\(safe-area-inset-bottom\)\) !important;/);
  assert.match(html, /#app-shell:not\(\[style\*="display: none"\]\) ~ \.floating-support-widget\.jw-whatsapp-widget \{[\s\S]*?z-index:205 !important;/);
  assert.match(html, /\.mobile-app-nav \{[\s\S]*?z-index:210;/);
});

test('mobile landing header provides immediate sign-in and sign-up actions', () => {
  assert.match(html, /class="landing-mobile-header-actions" aria-label="Account actions"/);
  assert.match(html, /class="mobile-header-auth" onclick="openAuthScreen\('login'\)">Sign In<\/button>/);
  assert.match(html, /class="mobile-header-auth primary" onclick="openAuthScreen\('signup','employer'\)">Sign Up<\/button>/);
  assert.match(html, /#landing-page \.landing-mobile-header-actions \{[\s\S]*?display:flex/);
});

test('mobile header contains the wordmark across browser font metrics', () => {
  assert.match(html, /grid-template-columns:minmax\(0,1fr\) max-content 44px/);
  assert.match(html, /#landing-page \.landing-nav > \.landing-brand \{[\s\S]*?overflow:hidden/);
  assert.match(html, /#landing-page \.landing-nav > \.landing-brand \.landing-brand-text \{[\s\S]*?max-width:100%;[\s\S]*?overflow:hidden/);
});

test('workspace animation releases quickly while data continues in background', () => {
  assert.match(html, /function jwLoadWorkspaceInBackground\(reason = 'login'\)/);
  assert.match(html, /jwRefreshDashboardAfterLogin = function\(reason = 'login'\)/);
  assert.match(html, /setTimeout\(jwReleaseWorkspaceAnimation, 1400\)/);
  assert.match(html, /Math\.max\(0, 650 - \(Date\.now\(\) - startedAt\)\)/);
  assert.match(html, /function jwReleaseWorkspaceAnimation\(\)[\s\S]*?jwHideDataOverlay\(\)[\s\S]*?jwStrictHideWorkspaceLoader\(\)/);
  assert.match(html, /document\.getElementById\('jw-data-loading-overlay'\)[\s\S]*?dataOverlay\.style\.display = 'none'/);
});

test('an empty mobile workspace does not trigger an endless task refresh', () => {
  assert.doesNotMatch(html, /jwRefreshDashboardAfterLogin\('zero-retry'\)/);
  assert.doesNotMatch(html, /setInterval\([\s\S]{0,500}tasks\.length === 0[\s\S]{0,500}, 6000\)/);
  assert.match(html, /An empty task list is a valid workspace state/);
});

test('authentication uses a responsive full-screen workspace shell', () => {
  assert.match(html, /<div id="auth-screen"[^>]*>\s*<div class="auth-shell">/);
  assert.match(html, /\.auth-shell \{[\s\S]*?width:100%;[\s\S]*?height:100vh;[\s\S]*?grid-template-columns:[^;]+;/);
  assert.match(html, /\.auth-shell \{[\s\S]*?border-radius:0;[\s\S]*?box-shadow:none;/);
  assert.match(html, /@media \(max-width:860px\) \{[\s\S]*?#auth-screen \.auth-visual \{ display:none; \}/);
  assert.match(html, /#auth-screen \.auth-panel \{[\s\S]*?overflow-y:auto;/);
  assert.match(html, /#notification:not\(\.show\) \{[\s\S]*?visibility:hidden;/);
});

test('first-time visitors have a resilient Supabase browser-client load path', () => {
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.110\.7\/dist\/umd\/supabase\.js/);
  assert.match(html, /unpkg\.com\/@supabase\/supabase-js@2\.110\.7\/dist\/umd\/supabase\.js/);
  assert.match(html, /window\.__jwBootFallbackTimer = window\.setTimeout/);
  assert.match(html, /clearTimeout\(window\.__jwBootFallbackTimer\)/);

  const vercelConfig = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');
  assert.match(vercelConfig, /script-src[^"\n]*https:\/\/unpkg\.com/);
});

test('mobile dark mode keeps the primary authentication action visible', () => {
  assert.match(html, /body\.dark-mode #auth-screen \.btn-primary \{[\s\S]*?color:#fff !important;[\s\S]*?background:linear-gradient\([\s\S]*?!important;/);
  assert.match(html, /body\.dark-mode #auth-screen \.auth-tab\.active \{[\s\S]*?color:#fff;/);
  assert.match(html, /const isSignIn = text === 'sign in';/);
  assert.doesNotMatch(html, /const isSignIn = text === 'sign in' \|\| text\.includes\('sign in'\)/);
});

test('password recovery uses a professional return action and safe failure state', () => {
  const returnButtons = html.match(/class="auth-return-btn" onclick="showLogin\(\)">Back to sign in<\/button>/g) || [];
  assert.equal(returnButtons.length, 2);

  const start = html.indexOf('async function doForgotPassword()');
  const end = html.indexOf('function showPasswordResetForm', start);
  assert.ok(start >= 0 && end > start, 'password recovery handler should exist');
  const recovery = html.slice(start, end);
  assert.match(recovery, /localStorage\.removeItem\('jw_password_recovery_pending'\)/);
  assert.match(recovery, /Password reset email is temporarily unavailable/);
  assert.doesNotMatch(recovery, /Could not send reset email:[\s\S]*err\.message/);
  assert.doesNotMatch(recovery, /Password reset error:[\s\S]*err\.message/);
});

test('password recovery links are scanner-resistant and processed only once', () => {
  assert.match(html, /\{\{ \.SiteURL \}\}\/\?token_hash=\{\{ \.TokenHash \}\}&amp;type=recovery&amp;view=reset-password/);
  assert.doesNotMatch(html, /href="\{\{ \.ConfirmationURL \}\}"/);
  assert.match(html, /let __jwPasswordRecoveryPromise = null;/);
  assert.match(html, /if \(__jwPasswordRecoveryPromise\) return await __jwPasswordRecoveryPromise;/);
  assert.match(html, /_sb\.auth\.setSession\(\{[\s\S]*?access_token: accessToken,[\s\S]*?refresh_token: refreshToken/);
  assert.doesNotMatch(html, /if \(isPasswordRecoveryUrl\(\)\) \{\s*handlePasswordRecoveryReturn\(\);\s*\}/);
});

test('mobile navigation cannot log users out accidentally', () => {
  const backStart = html.indexOf('function handleBackButtonAction(event)');
  const backEnd = html.indexOf("window.addEventListener('popstate'", backStart);
  assert.ok(backStart >= 0 && backEnd > backStart, 'back-button handler should exist');
  assert.doesNotMatch(html.slice(backStart, backEnd), /doLogout\s*\(/);

  assert.match(html, /closest\?\.\('\.btn-logout, \[onclick\*="doLogout"\], \[data-action="logout"\]'\)/);
  assert.doesNotMatch(html, /closest\?\.\('\.btn-logout, \[onclick\*="doLogout"\], button, div, a'\)/);
});

test('initial task summaries exclude large file payload columns', () => {
  const match = html.match(/const JW_TASK_SUMMARY_COLUMNS = \[([\s\S]*?)\]\.join\(','\);/);
  assert.ok(match, 'task summary column allowlist should exist');
  assert.doesNotMatch(match[1], /submitted_files/);
  assert.doesNotMatch(match[1], /instruction_files/);
  assert.match(html, /select\(JW_TASK_SUMMARY_COLUMNS\)/);
});

test('historical notification scans no longer write notifications', () => {
  const match = html.match(/jwScanTaskNotifications = function\(\) \{([\s\S]*?)\n\};/);
  assert.ok(match, 'final historical scan override should exist');
  assert.doesNotMatch(match[1], /jw_create_notification|jwCreateNotificationInSupabase|\.rpc\(/);
});

test('task cards open details in the current app tab', () => {
  const match = html.match(/jwOpenTaskDetailInNewTab = function\(taskId\) \{([\s\S]*?)\n\};/);
  assert.ok(match, 'legacy new-tab route should have a final override');
  assert.match(match[1], /openTaskDetailsPage\(taskId, \{ sameTab:true, inPlace:true \}\)/);
  assert.doesNotMatch(match[1], /window\.open/);
  assert.doesNotMatch(html, /window\.open\(jwTaskDetailUrl/);
  assert.match(html, /function jwOpenTaskDetailInNewTab\(taskId\) \{[\s\S]*?jwOpenDedicatedTaskPageOnly\(id, \{ sameTab:true, inPlace:true \}\)/);
  assert.match(html, /now - _jwLastTaskOpen\.at < 700/);
});

test('task back navigation restores the exact source page', () => {
  assert.match(html, /window\.__jwStableTaskReturn = \{[\s\S]*?page:activePage/);
  assert.match(html, /if \(_currentPage === 'task-details'\) \{[\s\S]*?navigate\(target, \{ skipHistory:true, fromBackButton:true \}\)/);
  assert.match(html, /returnFromTaskDetails = function\(event\) \{[\s\S]*?navigate\(saved\.page, \{ replaceHistory:true \}\)/);
});

test('submitted file previews reserve a tab before asynchronous URL resolution', () => {
  const start = html.indexOf('async function jwOpenSubmittedMaterial');
  const end = html.indexOf('function jwSubmissionViewerHtml', start);
  assert.ok(start >= 0 && end > start, 'submitted-file opener should exist');
  const opener = html.slice(start, end);

  const reserveIndex = opener.indexOf("window.open('', '_blank')");
  const resolveIndex = opener.indexOf('await jwResolveSubmittedFileUrl');
  assert.ok(reserveIndex >= 0 && reserveIndex < resolveIndex, 'preview tab must be reserved during the click gesture');
  assert.doesNotMatch(opener, /window\.open\(url/);
  assert.match(opener, /jwDataUrlToBlob\(url\)/);
  assert.match(opener, /URL\.createObjectURL\(embeddedBlob\)/);
  assert.match(opener, /download:false/);
  assert.match(html, /jwDownloadSubmittedMaterial[\s\S]*?jwResolveSubmittedFileUrl\(f, 3600, \{ download:true \}\)/);
});

test('embedded Base64 files are converted locally without fetching data URLs', async () => {
  const match = html.match(/function jwDataUrlToBlob\(dataUrl\) \{([\s\S]*?)\n\}/);
  assert.ok(match, 'embedded-file conversion helper should exist');
  const convert = new Function('dataUrl', match[1]);
  const blob = convert('data:text/plain;base64,SGVsbG8gSmFuZWxsZQ==');

  assert.equal(blob.type, 'text/plain');
  assert.equal(await blob.text(), 'Hello Janelle');
  assert.doesNotMatch(match[1], /fetch\(/);
});

test('student message-admin action is exposed and opens the inbox immediately', () => {
  assert.match(html, /window\.openStudentAdminMessages = openStudentAdminMessages;/);

  const start = html.indexOf('async function openStudentAdminMessages()');
  const end = html.indexOf('window.openStudentAdminMessages = openStudentAdminMessages;', start);
  assert.ok(start >= 0 && end > start, 'student message-admin handler should exist');
  const handler = html.slice(start, end);
  const immediateNavigate = handler.indexOf("navigate('messages');");
  const createThread = handler.indexOf('await dbInsertTaskSafe(supportTask)');
  assert.ok(immediateNavigate >= 0 && immediateNavigate < createThread, 'the inbox should open before support-thread creation finishes');
  assert.match(handler, /jw-message-loading/);
});

test('all user messaging views use the premium conversation workspace', () => {
  assert.match(html, /class="jw-message-page-head"/);
  assert.match(html, /id="message-search"/);
  assert.match(html, /id="admin-message-search"/);
  assert.match(html, /data-message-scope="standard" data-filter="unread"/);
  assert.match(html, /data-message-scope="admin" data-filter="unread"/);
  assert.match(html, /function jwEnhanceMessageCards\(scope = 'standard'\)/);
  assert.match(html, /function jwBindPremiumMessageComposer\(\)/);
  assert.match(html, /\.message-room-summary \{[\s\S]*?grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(html, /class="jw-message-safety"/);
});

test('messaging workspace provides task-bound context without exposing private contact fields', () => {
  assert.match(html, /id="message-context" aria-label="Task and participant context"/);
  assert.match(html, /id="admin-message-context" aria-label="Student order context"/);
  assert.match(html, /grid-template-columns:minmax\(250px,300px\) minmax\(420px,1fr\) minmax\(240px,275px\)/);
  assert.match(html, /function jwUpdateMessageContext\(scope = 'standard'\)/);
  assert.match(html, /function jwMessageMobileContextHtml\(task\)/);
  assert.match(html, /class="jw-mobile-task-context"/);
  assert.match(html, /Messages and files stay inside this task and are visible only to authorized participants/);

  const start = html.indexOf("function jwMessageContextHtml(task, scope = 'standard')");
  const end = html.indexOf('function jwMessageMobileContextHtml(task)', start);
  assert.ok(start >= 0 && end > start, 'task context renderer should exist');
  const renderer = html.slice(start, end);
  assert.doesNotMatch(renderer, /task\.(phone|email)|Phone number|Email address/);
});

test('message inbox stays list-first and mobile chats use a familiar dedicated room', () => {
  const inboxStart = html.indexOf('function renderMessagesPage()');
  const inboxEnd = html.indexOf('function loadMessageThread()', inboxStart);
  assert.ok(inboxStart >= 0 && inboxEnd > inboxStart, 'message inbox renderer should exist');
  const inbox = html.slice(inboxStart, inboxEnd);
  assert.match(inbox, /const preselected = _preselectMessageTaskId/);
  assert.doesNotMatch(inbox, /latestExistingConversation|fallbackAssignedTask|list\[0\]/);

  const adminStart = html.indexOf('function renderAdminStudentMessagesPage()');
  const adminEnd = html.indexOf('function adminSelectStudentMessageThread', adminStart);
  assert.ok(adminStart >= 0 && adminEnd > adminStart, 'admin message inbox renderer should exist');
  const adminInbox = html.slice(adminStart, adminEnd);
  assert.match(adminInbox, /const selected = list\.find[\s\S]*?\|\| null/);
  assert.match(adminInbox, /if \(!selected\)/);
  assert.doesNotMatch(adminInbox, /\|\| list\[0\]/);

  assert.match(html, /class="jw-room-header-button"[^>]*aria-label="Back to conversations"/);
  assert.match(html, /class="jw-room-contact-avatar"/);
  assert.match(html, /class="jw-room-contact-copy"/);
  assert.match(html, /function openMessagesForTask\(id\) \{[\s\S]*?openMessageRoom\(id\)/);
  assert.match(html, /jw-admin-mobile-chat-open/);
});

test('Pesapal top-up clearly communicates its secure hosted checkout flow', () => {
  assert.match(html, /Continue to secure checkout/);
  assert.match(html, /PesaPal opens in a secure payment window/);
  assert.doesNotMatch(html, /id="pesapal-stk-btn"[^>]*>Send STK Push/);
  assert.match(html, /if \(data\.redirect_url\) \{[\s\S]*?payWindow\.location\.href = data\.redirect_url/);
});
