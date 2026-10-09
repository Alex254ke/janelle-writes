import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const vercel = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../supabase/migrations/20260730215442_realtime_task_review_workflow.sql', import.meta.url),
  'utf8'
);
const materialPolicyMigration = readFileSync(
  new URL('../supabase/migrations/20260913090000_instruction_preview_and_profile_compatibility.sql', import.meta.url),
  'utf8'
);
const publicProfileMigration = readFileSync(
  new URL('../supabase/migrations/20260913101500_public_writer_profile_v2.sql', import.meta.url),
  'utf8'
);

test('public writer profiles expose an explicit safe field set', () => {
  assert.match(publicProfileMigration, /create or replace function public\.jw_get_public_writer_profile_v2/i);
  assert.match(publicProfileMigration, /security definer/i);
  assert.match(publicProfileMigration, /\(select auth\.uid\(\)\) is not null/i);
  assert.match(publicProfileMigration, /'photo', account\.profile -> 'photo'/i);
  assert.doesNotMatch(publicProfileMigration, /'phone'|'payment'|'auth_id'|'is_admin'/i);
  assert.match(publicProfileMigration, /revoke all on function public\.jw_get_public_writer_profile_v2\(text\) from public, anon/i);
  assert.match(publicProfileMigration, /grant execute on function public\.jw_get_public_writer_profile_v2\(text\) to authenticated, service_role/i);
});

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
  assert.match(html, /\.jw-submission-review-mounted'\)\.forEach\(el => el\.remove\(\)\)/);
  assert.equal((html.match(/class="jw-review-workflow jw-submission-review-mounted"/g) || []).length, 2);
  assert.match(migration, /status = 'submitted'/i);
  assert.match(migration, /Confirm payment before completing this task/i);
  assert.match(migration, /Revision instructions must be between 10 and 10000 characters/i);
});

test('task details link to writer profiles without listing review history inline', () => {
  const start = html.indexOf('function partnerRatingPanelForTask(t)');
  const end = html.indexOf('function taskRatingSummary(t)', start);
  const panel = html.slice(start, end);
  assert.match(panel, /smallPartnerProfileButton/);
  assert.match(panel, /Open the writer's profile to view ratings, feedback, and experience/);
  assert.doesNotMatch(panel, /publicRatingPanelForUser\(t\.taken_by/);
});

test('summary refreshes cannot erase loaded task files or review controls', () => {
  const mergeMatch = html.match(/function jwMergeTaskDetailRecord\(previous, incoming\) \{([\s\S]*?)\n\}/);
  assert.ok(mergeMatch, 'stable task-detail merge helper should exist');
  const merge = new Function('previous', 'incoming', `${mergeMatch[1]}\n`);
  const file = { name:'completed-order.docx', path:'submissions/completed-order.docx' };
  const full = { id:'JW-1', status:'submitted', submitted_files:[file], _jwSummaryOnly:false };
  const summary = { id:'JW-1', status:'submitted', submitted_files:[], _jwSummaryOnly:true };
  const merged = merge(full, summary);
  assert.deepEqual(merged.submitted_files, [file]);
  assert.equal(merged._jwSummaryOnly, false);

  const unmarkedFull = { id:'JW-1', status:'submitted', submitted_files:[file] };
  const mergedFromUnmarked = merge(unmarkedFull, summary);
  assert.deepEqual(mergedFromUnmarked.submitted_files, [file]);
  assert.equal(mergedFromUnmarked._jwSummaryOnly, false);

  const ensureStart = html.indexOf('function jwEnsureSubmittedMaterialsInTaskPage');
  const ensureEnd = html.indexOf('// Patch the full task detail renderer', ensureStart);
  const ensure = html.slice(ensureStart, ensureEnd);
  assert.ok(ensure.indexOf('const html = jwSubmissionViewerHtml(t)') < ensure.indexOf("body.querySelectorAll('#jw-task-submissions-section"));
  assert.match(ensure, /if \(!html\)[\s\S]*?jwEnsureFullTaskLoaded/);

  const rendererStart = html.indexOf("if (typeof renderTaskDetailsPage === 'function' && !renderTaskDetailsPage.__jwSubmittedMaterialsViewPatched)");
  const rendererEnd = html.indexOf('// Patch workflow HTML too', rendererStart);
  const renderer = html.slice(rendererStart, rendererEnd);
  assert.match(renderer, /previousSubmission/);
  assert.match(renderer, /!body\.querySelector\('#jw-task-submissions-section'\)/);
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
  assert.match(html, /function jwCanAccessInstructionMaterials\(task\)/);
  assert.match(html, /String\(currentUser\.role \|\| ''\)\.toLowerCase\(\) === 'writer'[\s\S]*?String\(task\.status \|\| ''\)\.toLowerCase\(\) === 'pending'[\s\S]*?!task\.taken_by/);
  assert.match(html, /jwOpenInstructionMaterial[\s\S]*?!jwCanAccessInstructionMaterials\(task\)/);
  assert.match(html, /view\.officeapps\.live\.com\/op\/embed\.aspx/);
  assert.match(materialPolicyMigration, /\(storage\.foldername\(name\)\)\[2\] = 'instructions'/i);
  assert.match(materialPolicyMigration, /task\.status[\s\S]*?'pending'/i);
  assert.match(materialPolicyMigration, /task\.taken_by[\s\S]*?is null/i);
  assert.match(materialPolicyMigration, /viewer\.role[\s\S]*?'writer'/i);
  assert.match(html, /AI &amp; Originality Check/);
  assert.match(html, /Do not upload confidential client instructions/);
  assert.match(html, /window\.open\('https:\/\/www\.quetext\.com\/'/);
  assert.doesNotMatch(html, /quetext\.com\/\?fpr=/);
});

test('profile images save through the authenticated profile service', () => {
  const start = html.indexOf('async function saveProfile()');
  const end = html.indexOf('// ══', start);
  assert.ok(start >= 0 && end > start, 'profile save handler should exist');
  const save = html.slice(start, end);
  assert.match(save, /secureUpsertPlatformUser\(/);
  assert.doesNotMatch(save, /dbUpdateUser\(/);
  assert.doesNotMatch(save, /Add the profile JSONB column/);

  const collectStart = html.indexOf('function collectProfileForm()');
  const collectEnd = html.indexOf('function updateProfilePreview()', collectStart);
  const collect = html.slice(collectStart, collectEnd);
  assert.match(collect, /\.\.\.existing/);
  assert.doesNotMatch(collect, /updated_at:\s*new Date/);
  assert.match(materialPolicyMigration, /add column if not exists profile jsonb not null default '\{\}'::jsonb/i);
});

test('instruction access allows available-task review without exposing assigned work', () => {
  const match = html.match(/function jwCanAccessInstructionMaterials\(task\) \{([\s\S]*?)\n\}/);
  assert.ok(match, 'instruction authorization helper should exist');
  const makeAccessCheck = (currentUser) => new Function(
    'currentUser',
    'isJwAdmin',
    'canCurrentUserSeeTask',
    `return function(task) {${match[1]}\n}`
  )(currentUser, () => false, () => false);

  const writerCanAccess = makeAccessCheck({ email:'writer@example.com', role:'writer' });
  assert.equal(writerCanAccess({ id:'JW-1', status:'pending', taken_by:null }), true);
  assert.equal(writerCanAccess({ id:'JW-2', status:'pending', taken_by:'other@example.com' }), false);
  assert.equal(writerCanAccess({ id:'JW-3', status:'completed', taken_by:null }), false);

  const ownerCanAccess = makeAccessCheck({ email:'OWNER@example.com', role:'employer' });
  assert.equal(ownerCanAccess({ id:'JW-4', status:'pending', posted_by:'owner@example.com' }), true);
});
