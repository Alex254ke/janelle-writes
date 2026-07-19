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

test('authentication uses a responsive full-screen workspace shell', () => {
  assert.match(html, /<div id="auth-screen"[^>]*>\s*<div class="auth-shell">/);
  assert.match(html, /\.auth-shell \{[\s\S]*?width:100%;[\s\S]*?height:100vh;[\s\S]*?grid-template-columns:[^;]+;/);
  assert.match(html, /\.auth-shell \{[\s\S]*?border-radius:0;[\s\S]*?box-shadow:none;/);
  assert.match(html, /@media \(max-width:860px\) \{[\s\S]*?#auth-screen \.auth-visual \{ display:none; \}/);
  assert.match(html, /#auth-screen \.auth-panel \{[\s\S]*?overflow-y:auto;/);
  assert.match(html, /#notification:not\(\.show\) \{[\s\S]*?visibility:hidden;/);
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
