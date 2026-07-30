import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const vercel = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../supabase/migrations/20260730215442_realtime_task_review_workflow.sql', import.meta.url),
  'utf8'
);

test('task posting is idempotent and production duplicates remain auditable', () => {
  assert.match(html, /client_request_id:\s*task\.client_request_id\s*\|\|\s*jwGetPostingRequestId\(\)/);
  assert.match(html, /\.eq\('client_request_id', payload\.client_request_id\)/);
  assert.doesNotMatch(
    html.slice(html.indexOf('// PRODUCTION COHERENCE')),
    /makeFallbackOrderNum/
  );
  assert.match(migration, /create unique index if not exists uq_jw_tasks_client_request_id/i);
  assert.match(migration, /set duplicate_of = 'JW-DM-RHL-0001-8XV4'/i);
  assert.match(migration, /duplicate_of is null/i);
});

test('writer submissions wait for owner review and paid completion', () => {
  assert.match(html, /\.rpc\('jw_submit_task'/);
  assert.match(html, /\.rpc\('jw_review_task_submission'/);
  assert.match(html, /Approve &amp; Complete/);
  assert.match(html, /Request Revision/);
  assert.match(migration, /status = 'submitted'/i);
  assert.match(migration, /Confirm payment before completing this task/i);
  assert.match(migration, /Revision instructions must be between 10 and 10000 characters/i);
});

test('orders bids messages and reviews use realtime database events', () => {
  assert.match(html, /table:'jw_tasks'/);
  assert.match(html, /Task request sent\. It will update live/);
  assert.match(html, /_jwLiveReconcileTimer = setInterval\(jwRefreshLiveSnapshot, 60000\)/);
  assert.match(migration, /alter publication supabase_realtime add table public\.jw_tasks/i);
  assert.match(migration, /alter publication supabase_realtime add table public\.jw_notifications/i);
  assert.match(migration, /New review received/i);
});

test('admin portal is routed and remains restricted to the server-authorized admin', () => {
  assert.match(vercel, /"source": "\/admin"/);
  assert.match(html, /function jwIsAdminPath\(\)/);
  assert.match(html, /if \(result && isJwAdmin\(\)\)/);
  assert.match(html, /That account is not authorized for the administrator portal/);
});

test('task materials support secure previews and external originality checks are disclosed', () => {
  assert.match(html, /jwOpenInstructionMaterial/);
  assert.match(html, /view\.officeapps\.live\.com\/op\/embed\.aspx/);
  assert.match(html, /AI &amp; Originality Check/);
  assert.match(html, /Do not upload confidential client instructions/);
  assert.match(html, /window\.open\('https:\/\/www\.quetext\.com\/'/);
  assert.doesNotMatch(html, /quetext\.com\/\?fpr=/);
});
