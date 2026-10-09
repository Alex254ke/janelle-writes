import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `${startMarker} should exist before ${endMarker}`);
  return html.slice(start, end);
}

test('refresh route access is restricted to pages available to the signed-in role', () => {
  const source = sourceBetween('function canRestoreAppPage(page)', 'function getRefreshRoute()');
  const pages = new Set([
    'page-student-dashboard', 'page-emp-tasks', 'page-writer-available',
    'page-admin-control', 'page-task-details'
  ]);
  const document = { getElementById: id => pages.has(id) ? {} : null };

  const forUser = currentUser => new Function(
    'currentUser', 'document', 'isJwAdmin',
    `${source}; return canRestoreAppPage;`
  )(currentUser, document, () => currentUser.role === 'admin');

  assert.equal(forUser({ role: 'student' })('emp-tasks'), true);
  assert.equal(forUser({ role: 'student' })('writer-available'), false);
  assert.equal(forUser({ role: 'writer' })('writer-available'), true);
  assert.equal(forUser({ role: 'writer' })('admin-control'), false);
  assert.equal(forUser({ role: 'admin' })('admin-control'), true);
  assert.equal(forUser({ role: 'student' })('task-details'), true);
});

test('refresh resolves normal sections and dedicated order links from the URL hash', () => {
  const source = sourceBetween('function getRefreshRoute()', 'function appRouteUrl(page)');
  const buildResolver = hash => new Function(
    'window', 'getHomePage', 'canRestoreAppPage',
    `${source}; return getRefreshRoute;`
  )({ location: { hash } }, () => 'writer-dashboard', page => ['writer-available', 'task-details'].includes(page));

  assert.deepEqual(buildResolver('#writer-available')(), { page: 'writer-available', taskId: '' });
  assert.deepEqual(buildResolver('#task=JW-1042')(), { page: 'task-details', taskId: 'JW-1042' });
  assert.deepEqual(buildResolver('#admin-control')(), { page: 'writer-dashboard', taskId: '' });
  assert.deepEqual(buildResolver('#access_token=secret')(), { page: 'writer-dashboard', taskId: '' });
});

test('app launch and browser history preserve the resolved refresh location', () => {
  const launch = sourceBetween('function launchApp(options = {})', 'function buildSidebar()');
  assert.match(launch, /const initialRoute = getRefreshRoute\(\)/);
  assert.match(launch, /navigate\(initialRoute\.page, \{ skipHistory: true \}\)/);
  assert.match(launch, /initBackButtonGuard\(initialRoute\.page\)/);

  const history = sourceBetween('function initBackButtonGuard(initialPage = getHomePage())', 'function handleBackButtonAction(event)');
  assert.match(history, /setAppHistory\(initialPage, 'replace'\)/);
  assert.match(history, /setAppHistory\(initialPage, 'push'\)/);

  const routeUrl = sourceBetween('function appRouteUrl(page)', 'function resetBackLogoutWarning()');
  assert.match(routeUrl, /page === 'task-details'/);
  assert.match(routeUrl, /\^#task=/);
  assert.match(routeUrl, /window\.location\.hash/);
});
