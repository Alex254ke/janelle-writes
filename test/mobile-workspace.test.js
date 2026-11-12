import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function source(name, next) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  return html.slice(start, html.indexOf(`\nfunction ${next}(`, start));
}

test('an incoming update refreshes only the open chat and preserves its draft and cursor', () => {
  let renders = 0;
  let input = { value:'Unsent feedback', selectionStart:4, selectionEnd:10, disabled:false };
  let thread = { scrollTop:120 };
  const originalInput = input;
  const scheduled = [];
  const context = {
    _activeMessageRoomTaskId:'QA-1', _currentPage:'message-room', _activeTaskModalId:null,
    document: {
      activeElement:originalInput,
      getElementById(id) { return id === 'message-room-input' ? input : id === 'message-room-thread' ? thread : null; },
      querySelector() { return { id:'page-message-room' }; }
    },
    updateBadges() {},
    renderMessageRoomPage() {
      renders += 1;
      input = { value:'', focus() { this.focused = true; }, setSelectionRange(start, end) { this.selection = [start, end]; } };
      thread = { scrollTop:0 };
    },
    jwSetMessageComposerBusy(field, busy) { field.disabled = busy; },
    setTimeout(fn) { scheduled.push(fn); }, console
  };
  vm.createContext(context);
  vm.runInContext(source('jwRefreshMessageRoomPreservingDraft', 'renderMessageRoomPage') + source('jwRenderLiveWorkspace', 'jwSetLiveState'), context);
  context.jwRenderLiveWorkspace('OTHER-ORDER');
  assert.equal(renders, 0);
  context.jwRenderLiveWorkspace('QA-1');
  assert.equal(renders, 1);
  assert.equal(input.value, 'Unsent feedback');
  assert.equal(input.focused, true);
  assert.deepEqual(input.selection, [4, 10]);
  scheduled.forEach(fn => fn());
  assert.equal(thread.scrollTop, 120);
});

test('copyright-only text does not trigger another icon replacement mutation', () => {
  const context = { JW_VISUAL_EMOJI_RE:/\p{Extended_Pictographic}\uFE0F?/gu };
  vm.createContext(context);
  vm.runInContext(source('jwIconifyTextNode', 'jwIconifyTree'), context);
  let replaced = false;
  context.jwIconifyTextNode({ nodeValue:'© 2026 Janelle Writes', parentElement:{}, replaceWith() { replaced = true; } });
  assert.equal(replaced, false);
});

test('revision orders remain selectable when the submission list refreshes', () => {
  const select = { value:'QA-REVISION', innerHTML:'' };
  const context = {
    document:{ getElementById() { return select; } },
    currentUser:{ email:'writer@test.invalid' },
    sameEmail:(a, b) => a.toLowerCase() === b.toLowerCase(),
    tasks:[
      { id:'QA-REVISION', subject:'Revise introduction', taken_by:'writer@test.invalid', status:'revision' },
      { id:'OTHER-WRITER', subject:'Private task', taken_by:'other@test.invalid', status:'progress' },
      { id:'UNDER-REVIEW', subject:'Already submitted', taken_by:'writer@test.invalid', status:'submitted' }
    ]
  };
  vm.createContext(context);
  vm.runInContext(source('populateWriterSubmitSelect', 'toggleSubmitSection'), context);
  context.populateWriterSubmitSelect();
  assert.match(select.innerHTML, /value="QA-REVISION"/);
  assert.doesNotMatch(select.innerHTML, /OTHER-WRITER|UNDER-REVIEW/);
  assert.equal(select.value, 'QA-REVISION');
});
