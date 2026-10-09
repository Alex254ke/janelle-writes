import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../supabase/migrations/20261009122306_atomic_task_messaging.sql', import.meta.url),
  'utf8'
);

test('messages append atomically without replacing another participant message', () => {
  assert.match(migration, /function public\.jw_send_task_message/);
  assert.match(migration, /where id = p_task_id\s+for update/i);
  assert.match(migration, /messages = coalesce\(messages, '\[\]'::jsonb\) \|\| jsonb_build_array\(message_row\)/);
  assert.match(migration, /existing\.message ->> 'id' = btrim\(p_client_id\)/);
  assert.match(migration, /Only task participants can send messages/);
  assert.match(migration, /grant execute on function public\.jw_send_task_message[\s\S]*to authenticated/);

  assert.match(html, /async function jwSendTaskMessageAtomic/);
  assert.ok((html.match(/await jwSendTaskMessageAtomic\(/g) || []).length >= 4);
  assert.doesNotMatch(html, /dbUpdateTask\([^\n]+\{ messages:/);
});

test('read receipts update the server message array without a stale browser overwrite', () => {
  assert.match(migration, /function public\.jw_mark_task_messages_read/);
  assert.match(migration, /jsonb_array_elements\(coalesce\(task_row\.messages/);
  assert.match(migration, /jsonb_set\([\s\S]*?'\{read_by\}'/);
  assert.match(html, /jwMarkTaskMessagesReadAtomic\(t\)\.catch/);
  assert.doesNotMatch(html, /Read receipt sync failed:[\s\S]{0,120}dbUpdateTask/);
});

test('message composers have one predictable send shortcut and recover failed drafts', () => {
  assert.match(html, /\['msg-input','admin-student-msg-input','message-room-input'\]\.includes\(target\.id\)/);
  assert.match(html, /if \(!e\.shiftKey\)/);
  assert.doesNotMatch(html, /event\.key !== 'Enter' \|\| !event\.ctrlKey/);
  assert.equal((html.match(/maxlength="5000"/g) || []).length, 3);
  assert.match(html, /input\.value = body;[\s\S]{0,180}Message was not sent/);
  assert.match(html, /jwSetMessageComposerBusy\(input, true\)/);
});

test('messages and conversations are rendered newest first by sent time', () => {
  const newestMatch = html.match(/function messagesNewestFirst\(messages\) \{([\s\S]*?)\n\}/);
  assert.ok(newestMatch, 'newest-first message sorter should exist');
  const newestFirst = new Function('messages', 'messageSentAtValue', `${newestMatch[1]}\n`);
  const sentAt = message => new Date(message.at || 0).getTime() || 0;
  const sorted = newestFirst([
    { id:'old', at:'2026-10-09T08:00:00Z' },
    { id:'new', at:'2026-10-09T10:00:00Z' },
    { id:'middle', at:'2026-10-09T09:00:00Z' }
  ], sentAt);
  assert.deepEqual(sorted.map(message => message.id), ['new', 'middle', 'old']);
  assert.match(html, /const recentDiff = messageSortValue\(b\) - messageSortValue\(a\);/);
  assert.match(html, /const messages = messagesNewestFirst\(visibleMessagesForCurrentUser\(t\)\)/);
  assert.match(html, /const visible = messagesNewestFirst\(visibleMessagesForCurrentUser\(t, msgs\)\)/);
});

test('an open task keeps a durable authorized snapshot instead of showing task not found', () => {
  assert.match(html, /function jwTaskSnapshotStorageKey\(taskId\)/);
  assert.match(html, /window\.jwReadDurableTaskSnapshot = function\(taskId\)/);
  assert.match(html, /window\.jwRecoverOpenTask = function\(taskId\)/);
  assert.match(html, /window\.__jwLastRenderedTaskSnapshot/);
  assert.match(html, /Keeping this task open while the latest details reconnect/);
  assert.doesNotMatch(html, /Task not found\. Try refreshing the task list first/);
});
