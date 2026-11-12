import test from 'node:test';
import assert from 'node:assert/strict';
import {writerBidDisplayState,writerBidMessageLength,WriterBidSession} from '../assets/writer-bidding.js';
const now=Date.parse('2026-11-12T12:00:00Z');
const task={status:'pending',deadline:'2026-11-20T12:00:00Z',taken_by:null};
test('bid status distinguishes open requests, passed deadlines, closed work, and actual assignment',()=>{
  assert.equal(writerBidDisplayState(task,{status:'pending'},'writer@example.test',now).group,'pending');
  assert.equal(writerBidDisplayState({...task,deadline:'2026-11-01'},{status:'pending'},'writer@example.test',now).label,'Deadline passed');
  assert.equal(writerBidDisplayState({...task,status:'cancelled'},{status:'pending'},'writer@example.test',now).group,'closed');
  assert.equal(writerBidDisplayState({...task,taken_by:'other@example.test'},{status:'pending'},'writer@example.test',now).label,'Not selected');
  assert.equal(writerBidDisplayState({...task,taken_by:'WRITER@example.test'},{status:'selected'},'writer@example.test',now).group,'selected');
  assert.equal(writerBidDisplayState(task,{status:'declined'},'writer@example.test',now).group,'closed');
});
test('a date-only deadline remains open for the whole local date',()=>{
  const atNoon=new Date(2026,10,20,12).getTime();
  assert.equal(writerBidDisplayState({...task,deadline:'2026-11-20'},null,'writer@example.test',atNoon).group,'pending');
  assert.equal(writerBidDisplayState({...task,deadline:'2026-11-20'},null,'writer@example.test',new Date(2026,10,21,0).getTime()).group,'closed');
});
test('draft memory remains per order and resets across accounts',()=>{
  const state=new WriterBidSession();state.sync('first@example.test');
  state.drafts.set('A',{value:'Draft for A',start:4,end:7});state.drafts.set('B',{value:'Draft for B'});
  state.sync('FIRST@example.test');assert.equal(state.drafts.get('A').value,'Draft for A');assert.equal(state.drafts.get('B').value,'Draft for B');
  state.sync('second@example.test');assert.equal(state.drafts.size,0);assert.equal(state.requests.size,0);
});
test('only one request runs per order, and stale results cannot alter a new session',()=>{
  const state=new WriterBidSession();state.sync('writer@example.test');const old=state.begin('A');
  assert.equal(state.begin('A'),null);assert.ok(state.begin('B'));state.reset();assert.equal(state.current(old),false);
  state.sync('writer@example.test');const current=state.begin('A');state.finish(old);assert.equal(state.requests.get('A'),current);
  state.finish(current);assert.equal(state.requests.size,0);
});

test('message minimum matches Postgres character counting for emoji and whitespace',()=>{
  assert.equal(writerBidMessageLength('  a useful request  '),16);
  assert.equal(writerBidMessageLength('🙂'.repeat(10)),10);
  assert.equal(writerBidMessageLength('🙂'.repeat(20)),20);
});

function tabStorage() {
  const entries=new Map();
  return {get length(){return entries.size;},key:index=>[...entries.keys()][index]??null,getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,String(value)),removeItem:key=>entries.delete(key)};
}
test('tab reload restores separate order drafts and selection without restoring focus or pending sends',()=>{
  const storage=tabStorage(),before=new WriterBidSession(storage);before.sync(' WRITER@example.test ');
  before.saveDraft('A',{value:'Unsent request with emoji 🙂',start:4,end:12,scroll:40,focused:true});
  before.saveDraft('B',{value:'Another order request',start:2,end:2,scroll:0});before.begin('A');
  const after=new WriterBidSession(storage);after.sync('writer@example.test');
  assert.deepEqual(after.drafts.get('A'),{value:'Unsent request with emoji 🙂',start:4,end:12,scroll:40,focused:false});
  assert.equal(after.drafts.get('B').value,'Another order request');assert.equal(after.requests.size,0);
});
test('clearing or successfully sending a draft prevents it returning after reload',()=>{
  const storage=tabStorage(),before=new WriterBidSession(storage);before.sync('writer@example.test');
  before.saveDraft('A',{value:'A draft to clear'});before.saveDraft('B',{value:'A draft to send'});
  before.saveDraft('A',{value:''});before.deleteDraft('B');
  const after=new WriterBidSession(storage);after.sync('writer@example.test');
  assert.equal(after.drafts.size,0);assert.equal(storage.length,0);
});
test('switching accounts or signing out deletes owned drafts without changing unrelated tab storage',()=>{
  const storage=tabStorage(),state=new WriterBidSession(storage);storage.setItem('unrelated','keep');
  state.sync('first@example.test');state.saveDraft('A',{value:'Private first draft'});
  state.sync('second@example.test');assert.equal(state.drafts.size,0);assert.equal(storage.getItem(state.storageKey('first@example.test')),null);
  state.saveDraft('B',{value:'Private second draft'});state.reset();
  const reloaded=new WriterBidSession(storage);reloaded.sync('second@example.test');assert.equal(reloaded.drafts.size,0);assert.equal(storage.getItem('unrelated'),'keep');
});
test('a new account never restores another account draft from the same tab',()=>{
  const storage=tabStorage(),first=new WriterBidSession(storage);first.sync('first@example.test');first.saveDraft('A',{value:'Private first draft'});
  const second=new WriterBidSession(storage);second.sync('second@example.test');
  assert.equal(second.drafts.size,0);assert.equal(storage.getItem(first.storageKey()),null);
});
test('disabled storage and malformed saved data do not interrupt draft editing or submission guards',()=>{
  const blocked=new WriterBidSession({get length(){throw Error('Storage blocked');},getItem(){throw Error('Storage blocked');},setItem(){throw Error('Storage full');},removeItem(){throw Error('Storage blocked');}});
  assert.doesNotThrow(()=>{blocked.sync('writer@example.test');blocked.saveDraft('A',{value:'Keep in memory'});});
  assert.equal(blocked.drafts.get('A').value,'Keep in memory');assert.ok(blocked.begin('A'));assert.equal(blocked.begin('A'),null);
  const storage=tabStorage(),broken=new WriterBidSession(storage);storage.setItem(broken.storageKey('writer@example.test'),'not JSON');assert.doesNotThrow(()=>broken.sync('writer@example.test'));assert.equal(broken.drafts.size,0);
  storage.setItem(broken.storageKey('writer@example.test'),JSON.stringify([null,['bad',null],['valid',{value:'Recovered'}]]));
  const recovered=new WriterBidSession(storage);recovered.sync('writer@example.test');assert.deepEqual([...recovered.drafts.keys()],['valid']);
});
