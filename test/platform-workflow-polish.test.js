import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const api = readFileSync(new URL('../api/auth/profile.js', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../supabase/migrations/20261009073000_platform_workflow_polish.sql', import.meta.url),
  'utf8'
);

test('platform fee is five percent in the client and database defaults', () => {
  assert.match(html, /const COMMISSION_RATE = 0\.05/);
  assert.match(migration, /jw_tasks[\s\S]*commission_rate set default 0\.05/i);
  assert.match(migration, /jw_commission_ledger[\s\S]*commission_rate set default 0\.05/i);
  assert.match(migration, /where not coalesce\(commission_paid, false\)/i);
});

test('disputes use authenticated RPCs and task-row action clicks are not swallowed', () => {
  assert.match(html, /jwWorkflowRpc\('jw_open_dispute'/);
  assert.match(html, /jwWorkflowRpc\('jw_resolve_dispute'/);
  assert.match(html, /interactive=e\.target\.closest/);
  assert.match(html, /interactive&&!interactive\.classList\.contains\('order-link'\)\)return/);
  assert.match(migration, /Only task participants can open a dispute/i);
  assert.match(migration, /Only the dispute opener or admin can withdraw it/i);
});

test('deadline changes are available to owners and requestable by assigned writers', () => {
  assert.match(html, />Extend Deadline<\/button>/);
  assert.match(html, />Request Deadline Extension<\/button>/);
  assert.match(html, /jw_request_deadline_extension/);
  assert.match(html, /jw_respond_deadline_extension/);
  assert.match(migration, /actor_email = lower\(coalesce\(task_row\.posted_by/i);
  assert.match(migration, /actor_email <> lower\(coalesce\(task_row\.taken_by/i);
  assert.match(migration, /A deadline extension request is already pending/i);
});

test('task details retain authorized orders across partial background refreshes', () => {
  const start = html.indexOf('function findTask(id)');
  const end = html.indexOf('function idFromText', start);
  const lookup = html.slice(start, end);
  assert.match(lookup, /__jwTaskDetailMemory/);
  assert.match(lookup, /var merged=\{\.\.\.previous,\.\.\.found\}/);
  assert.match(lookup, /merged\[key\]===undefined\|\|merged\[key\]===null\|\|merged\[key\]===''/);
  assert.match(lookup, /canCurrentUserSeeTask\(remembered\)/);
  assert.match(lookup, /remembered\.status==='pending'/);

  const actionsStart = html.indexOf('window.taskDetailActionsHtml=function');
  const actionsEnd = html.indexOf('function partner', actionsStart);
  const actions = html.slice(actionsStart, actionsEnd);
  assert.match(actions, /openDeadlineExtensionModal/);
  assert.match(actions, /Request Deadline Extension/);
});

test('task detail deadline action survives partial owner task records', () => {
  assert.match(html, /var visibleToOwner=!!\(currentUser&&\['employer','student'\]\.includes\(currentUser\.role\)/);
  assert.match(html, /ownerCanExtend=.*visibleToOwner/);
});

test('cross-script workflow helpers use explicit window exports', () => {
  assert.match(html, /window\.jwHydratePartnerProfileButtons = jwHydratePartnerProfileButtons/);
  assert.doesNotMatch(html, /window\._activeTaskDetailId \|\| activeTaskId/);
});

test('ratings are persisted through a participant-aware RPC and exposed as aggregates', () => {
  assert.match(html, /jwWorkflowRpc\('jw_rate_task'/);
  assert.match(migration, /Only task participants can rate this task/i);
  assert.match(migration, /'rating_summary'/i);
  assert.doesNotMatch(migration.slice(migration.indexOf('create or replace function public.jw_get_public_writer_profile_v2')), /'comment'/i);
  assert.match(api, /jw_get_public_writer_profile_v2/);
  assert.match(api, /'rating_summary'/);
});

test('new workflow RPCs are denied to anonymous users', () => {
  for (const name of [
    'jw_open_dispute',
    'jw_resolve_dispute',
    'jw_extend_task_deadline',
    'jw_request_deadline_extension',
    'jw_respond_deadline_extension',
    'jw_rate_task'
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${name}\\(`, 'i'));
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}\\(.*authenticated`, 'i'));
  }
});
