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

test('mobile navigation and hero both expose the student CTA', () => {
  const matches = html.match(/class="btn[^"]*student-cta-btn[^"]*"[^>]*>International Student<\/button>/g) || [];
  assert.equal(matches.length, 2);
  assert.match(html, /#landing-page \.student-cta-btn[\s\S]*visibility:visible !important/);
});

test('mobile experience includes thumb navigation and production touch targets', () => {
  assert.match(html, /<nav class="mobile-app-nav" id="mobile-app-nav"/);
  assert.match(html, /function renderMobileAppNav\(\)/);
  assert.match(html, /--mobile-nav-height:72px/);
  assert.match(html, /\.mobile-app-nav \{[\s\S]*?position:fixed;[\s\S]*?grid-template-columns:repeat\(4,1fr\)/);
  assert.match(html, /#landing-page \.landing-hero-feature-strip \{[\s\S]*?grid-template-columns:1fr 1fr/);
  assert.match(html, /#auth-screen \.form-input, #auth-screen \.form-select \{ min-height:50px/);
});

test('mobile landing header provides immediate sign-in and sign-up actions', () => {
  assert.match(html, /class="landing-mobile-header-actions" aria-label="Account actions"/);
  assert.match(html, /class="mobile-header-auth" onclick="openAuthScreen\('login'\)">Sign In<\/button>/);
  assert.match(html, /class="mobile-header-auth primary" onclick="openAuthScreen\('signup','employer'\)">Sign Up<\/button>/);
  assert.match(html, /#landing-page \.landing-mobile-header-actions \{[\s\S]*?display:flex/);
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
