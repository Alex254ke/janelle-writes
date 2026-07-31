import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../supabase/migrations/20260731081644_notification_recipient_isolation.sql', import.meta.url),
  'utf8'
);

test('notification rows retain and enforce their recipient in every client cache', () => {
  assert.match(
    html,
    /user_email:\s*String\(row\.user_email \|\| row\.userEmail \|\| ''\)\.trim\(\)\.toLowerCase\(\)/
  );
  assert.match(
    html,
    /if \(!currentUser\?\.email \|\| !rowEmail \|\| !jwRecipientIsCurrentUser\(rowEmail\)\) return null/
  );
  assert.match(html, /const safeRows = \(list \|\| \[\]\)\.filter/);
  assert.match(html, /if \(_jwNotificationCacheOwner !== owner\) \{[\s\S]*?_jwNotificationRows = \[\]/);
  assert.match(html, /\.eq\('user_email', currentUser\.email\.toLowerCase\(\)\)/);
});

test('database notification policies never expose all rows to an administrator session', () => {
  const selectPolicy = migration.match(
    /create policy "Users can view own notifications"([\s\S]*?);\n\ncreate policy/
  );
  assert.ok(selectPolicy, 'the recipient-only select policy should exist');
  assert.match(selectPolicy[1], /lower\(btrim\(user_email\)\)/i);
  assert.match(selectPolicy[1], /auth\.jwt\(\)/i);
  assert.doesNotMatch(selectPolicy[1], /is_jw_admin/i);

  assert.match(migration, /n\.type in \('submitted', 'bid'\)/i);
  assert.match(migration, /lower\(btrim\(n\.user_email\)\) <> lower\(btrim\(t\.posted_by\)\)/i);
  assert.match(migration, /read_at = coalesce\(notification\.read_at, now\(\)\)/i);
});

test('notification RPC validates recipients by workflow event type', () => {
  assert.match(
    migration,
    /p_type = 'submitted'[\s\S]*?actor_email = writer_email[\s\S]*?target_email = owner_email/i
  );
  assert.match(
    migration,
    /p_type in \('revision', 'assigned', 'paid', 'review'\)[\s\S]*?target_email = writer_email/i
  );
  assert.match(
    migration,
    /p_type = 'bid'[\s\S]*?actor_role = 'writer'[\s\S]*?target_email = owner_email/i
  );
});

test('mobile workspace includes an accessible live notification action', () => {
  assert.match(html, /class="mobile-notification-action" onclick="jwToggleNotifications\(\)"/);
  assert.match(html, /<i class="bi bi-bell" aria-hidden="true"><\/i><span>Alerts<\/span>/);
  assert.match(html, /id="jw-notification-count-mobile" aria-label="Unread notifications"/);
  assert.match(html, /grid-template-columns:repeat\(5,1fr\)/);
});
