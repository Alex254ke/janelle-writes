import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../supabase/migrations/20260730084329_admin_control_system.sql', import.meta.url),
  'utf8'
);
const profileApi = readFileSync(new URL('../api/auth/profile.js', import.meta.url), 'utf8');

test('admin control center exposes deliberate review workflows', () => {
  assert.match(html, /Verified admin session/);
  assert.match(html, /Priority review queue/);
  assert.match(html, /Decision integrity/);
  assert.match(html, /id="modal-admin-wallet-review"/);
  assert.match(html, /id="admin-wallet-review-note"/);
  assert.match(html, /id="admin-wallet-review-confirm"/);
  assert.match(html, /id="modal-admin-task-override"/);
  assert.match(html, /id="admin-task-override-reason"/);
});

test('financial approvals use the controlled RPC instead of browser ledger writes', () => {
  assert.match(html, /\.rpc\('jw_admin_resolve_wallet_transaction'/);
  assert.match(html, /\.rpc\('jw_admin_override_task'/);
  assert.match(html, /Review note must be between 10 and 1000 characters|decision note of at least 10 characters/i);
});

test('admin migration makes wallet decisions atomic and auditable', () => {
  assert.match(migration, /create table if not exists public\.jw_admin_audit_log/i);
  assert.match(migration, /for update;/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /insert into public\.jw_admin_audit_log/i);
  assert.match(migration, /revoke update, delete on table public\.jw_wallet_transactions from authenticated/i);
  assert.match(migration, /security invoker/i);
  assert.doesNotMatch(migration, /\bcascade\b/i);
});

test('administrator elevation remains server allowlist only', () => {
  assert.match(profileApi, /process\.env\.JW_ADMIN_EMAILS/);
  assert.match(profileApi, /configuredAdminEmails\(\)\.includes\(email\)/);
  assert.match(html, /currentUser\.is_admin === true && currentUser\.role === 'admin'/);
  assert.doesNotMatch(html, /isJwAdminEmail\([^)]*\)\s*\{\s*return\s+[^;]*janellewrites979@gmail\.com/i);
});

test('wallet balances refresh automatically for the signed-in owner', () => {
  assert.match(html, /config\.filter = `user_email=eq\.\$\{email\}`/);
  assert.match(html, /renderWalletPage\(\)/);
  assert.match(html, /Your balance has updated automatically/);
  assert.match(html, /removeChannel\(_jwWalletRealtimeSub\)/);
});
