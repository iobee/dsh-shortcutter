import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolTabHistory, orderToolTabs, toolHandoffStatus } from '../src/tool-tabs.js';
const tab=(sessionId,tabId,kind)=>({sessionId,tabId,kind});
const tabs=[tab('a','b1','browser'),tab('a','b2','browser'),tab('a','t1','terminal'),tab('a','t2','terminal'),tab('b','b3','browser')];
test('entering from another area recalls the recent tab',()=>{
  const history=createToolTabHistory();history.remember('a','b2',tabs);
  for(let i=0;i<4;i++)assert.equal(history.find('a','browser',tabs,'t1').tabId,'b2');
  history.remember('a','b1',tabs);assert.equal(history.find('a','browser',tabs,'t1').tabId,'b1');
});
test('repeated same-kind navigation cycles in supplied strip order and wraps',()=>{
  const history=createToolTabHistory();
  const ordered=orderToolTabs(tabs,['b2','t2','b1','t1','b3']);
  let active='b1';
  for(const expected of ['b2','b1','b2']) {
    active=history.next('a','browser',ordered,active).tabId;
    assert.equal(active,expected);
  }
  assert.equal(history.next('a','terminal',ordered,'t1').tabId,'t2');
  assert.equal(history.next('a','terminal',ordered,'t2').tabId,'t1');
});
test('cycling with zero or one matching tab cannot invent tabs or cross sessions',()=>{
  const history=createToolTabHistory();
  assert.equal(history.next('missing','browser',tabs,'b1'),undefined);
  assert.equal(history.next('b','terminal',tabs,'t1'),undefined);
  assert.equal(history.next('b','browser',tabs,'b3').tabId,'b3');
  assert.equal(history.next('b','browser',tabs,'b1').tabId,'b3');
});
test('mouse-selected tabs become the cycle origin and removed tabs are skipped',()=>{
  const history=createToolTabHistory();history.remember('a','b2',tabs);
  assert.equal(history.find('a','browser',tabs,'t1').tabId,'b2');
  assert.equal(history.next('a','browser',tabs,'b2').tabId,'b1');
  const remaining=tabs.filter(t=>t.tabId!=='b1');
  assert.equal(history.next('a','browser',remaining,'b2').tabId,'b2');
  assert.equal(history.next('a','browser',remaining,'b1').tabId,'b2');
});
test('mouse, keyboard and native selection share recency, scoped to kind and session',()=>{
  const history=createToolTabHistory();history.remember('a','b1',tabs);history.remember('a','t2',tabs);
  history.remember('b','b3',tabs);history.remember('a','b2',tabs);
  assert.equal(history.find('a','browser',tabs,'t1').tabId,'b2');
  assert.equal(history.find('a','terminal',tabs,'b1').tabId,'t2');
  assert.equal(history.find('b','browser',tabs,'b3').tabId,'b3');
  assert.equal(history.find('b','terminal',tabs),undefined);
  assert.equal(history.find('a','browser',tabs,'b1').tabId,'b1');
});
test('closing the most recent tab falls back to last surviving visited tab, then none',()=>{
  const history=createToolTabHistory();history.remember('a','b2',tabs);history.remember('a','b1',tabs);
  const remaining=tabs.filter(t=>t.tabId!=='b1');history.reconcile(remaining);
  assert.equal(history.find('a','browser',remaining,'t1').tabId,'b2');
  const empty=remaining.filter(t=>t.kind!=='browser');history.reconcile(empty);
  assert.equal(history.find('a','browser',empty,'t1'),undefined);
});
test('a restored session uses its selected tool and stale foreign targets cannot poison recency',()=>{
  const history=createToolTabHistory();history.remember('a','b3',tabs);history.remember('a','missing',tabs);
  assert.equal(history.find('a','browser',tabs,'b2').tabId,'b2');
  assert.equal(history.find('a','browser',tabs,'t2').tabId,'b1');
});
test('tab cycling follows rendered order, deduplicates markers, and retains hidden records',()=>{
  const current=tabs.filter(t=>t.sessionId==='a');
  assert.deepEqual(orderToolTabs(current,['t2','b2','t2','stale','b1']).map(t=>t.tabId),['t2','b2','b1','t1']);
  assert.deepEqual(orderToolTabs(current,[]),current);
});
const ready=()=>({request:{sessionId:'a',tabId:'b2'},sessionId:'a',activeTabId:'b2',current:true,reason:'navigation',ownsFocus:false,idleFocus:true,originFocus:false});
test('new tool handoff waits for a writable terminal and allows only its intended focus owner',()=>{
  assert.equal(toolHandoffStatus(ready()),'ready');
  assert.equal(toolHandoffStatus({...ready(),idleFocus:false,ownsFocus:true,reason:'input'}),'ready');
  assert.equal(toolHandoffStatus({...ready(),terminalState:{writable:false,phase:'opening'}}),'wait');
  assert.equal(toolHandoffStatus({...ready(),terminalState:{writable:true,phase:'open'}}),'ready');
});
test('a retained writable terminal must mount its lazy view before navigation takes focus',()=>{
  const retained={...ready(),terminalState:{writable:true,phase:'connected'}};
  assert.equal(toolHandoffStatus({...retained,contentReady:false}),'wait');
  assert.equal(toolHandoffStatus({...retained,contentReady:true}),'ready');
  assert.equal(toolHandoffStatus({...retained,contentReady:false,activeTabId:'another-tab'}),'cancel');
});
test('handoff is cancelled by another input, tab, session, modal, failed tool or stale occurrence',()=>{
  for(const change of [
    {idleFocus:false,reason:'input'}, {sessionId:'b'}, {activeTabId:'b1'}, {current:false},
    {editingHeader:true,ownsFocus:true,reason:'input'},
    ...['menu','modal','inactive','composition'].map(reason=>({reason})),
    {terminalState:{phase:'failed'}}, {terminalState:{writable:true,info:{state:'exited'}}}
  ])assert.equal(toolHandoffStatus({...ready(),...change}),'cancel',JSON.stringify(change));
});
