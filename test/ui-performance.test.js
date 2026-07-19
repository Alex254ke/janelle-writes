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
