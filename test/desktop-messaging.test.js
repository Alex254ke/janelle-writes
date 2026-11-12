import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const renderStart = html.indexOf('function renderMessagesPage()');
const renderSource = html.slice(renderStart, html.indexOf('\nfunction loadMessageThread()', renderStart));
const stateStart = html.indexOf('const jwDesktopConversationState = new Map()');
const stateSource = html.slice(stateStart, html.indexOf("if (typeof loadMessageThread === 'function'", stateStart));

test('background refresh keeps the selected chat; explicit navigation wins; revoked chats close', () => {
  let value = 'QA-A';
  const select = { get value() { return value; }, set value(next) { value = next; }, set innerHTML(_) { value = ''; } };
  const context = {
    document:{ getElementById() { return select; } },
    _preselectMessageTaskId:null, list:[{ id:'QA-A' }, { id:'QA-B' }],
    messageableTasks() { return context.list; }, messageSortValue:() => 0,
    esc:value => value, messageOptionLabel:task => task.id,
    renderMessageConversationList() {}, loadMessageThread() { context.openChat = select.value; }
  };
  vm.createContext(context);
  vm.runInContext(renderSource, context);
  context.renderMessagesPage();
  assert.equal(context.openChat, 'QA-A');
  context._preselectMessageTaskId = 'QA-B';
  context.renderMessagesPage();
  assert.equal(context.openChat, 'QA-B');
  assert.equal(context._preselectMessageTaskId, null);
  context.renderMessagesPage();
  assert.equal(context.openChat, 'QA-B');
  context.list = [{ id:'QA-A' }];
  context.renderMessagesPage();
  assert.equal(context.openChat, '');
  context.renderMessagesPage();
  assert.equal(context.openChat, '', 'an unopened inbox must not select the first chat automatically');
});

function createConversationContext() {
  const select = { value:'QA-A' };
  const input = {
    value:'', selectionStart:0, selectionEnd:0, disabled:false,
    focus() { context.document.activeElement = this; },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  };
  const thread = { dataset:{}, scrollTop:0 };
  const context = {
    currentUser:{ email:'writer@test.invalid' },
    document:{ activeElement:null, getElementById:id => ({ 'msg-order-select':select, 'msg-input':input, 'msg-thread':thread })[id] },
    getTaskById:id => id ? { id } : null,
    canCurrentUserSeeTask:() => true
  };
  vm.createContext(context);
  vm.runInContext(stateSource, context);
  function refresh() {
    const previous = context.jwCaptureDesktopConversationState();
    thread.scrollTop = 0; // legacy renderer resets the thread's DOM and position
    context.jwRestoreDesktopConversationState(previous);
  }
  refresh();
  return { context, select, input, thread, refresh };
}

test('desktop refresh retains an unsent draft, selection, focus, and reading position', () => {
  const { context, input, thread, refresh } = createConversationContext();
  input.value = 'Unsent feedback';
  input.setSelectionRange(3, 7);
  context.document.activeElement = input;
  thread.scrollTop = 140;
  refresh();
  assert.equal(input.value, 'Unsent feedback');
  assert.equal(input.selectionStart, 3);
  assert.equal(input.selectionEnd, 7);
  assert.equal(context.document.activeElement, input);
  assert.equal(thread.scrollTop, 140);
});

test('drafts stay with their conversation and are cleared when the account changes', () => {
  const { context, select, input, thread, refresh } = createConversationContext();
  input.value = 'Draft for A';
  thread.scrollTop = 100;
  select.value = 'QA-B';
  refresh();
  assert.equal(input.value, '');
  input.value = 'Draft for B';
  select.value = 'QA-A';
  refresh();
  assert.equal(input.value, 'Draft for A');
  assert.equal(thread.scrollTop, 100);
  context.currentUser = { email:'different@test.invalid' };
  refresh();
  assert.equal(input.value, '');
  input.value = 'Another draft';
  context.jwClearDesktopConversationState();
  assert.equal(input.value, '');
  assert.equal(thread.dataset.conversationId, undefined);
});
