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
