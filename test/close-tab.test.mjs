import test from 'node:test';
import assert from 'node:assert/strict';
import { closeNavigationTool } from '../src/tool-tabs.js';
const setup=()=>{
  const calls=[],target={sessionId:'session',paneId:'pane',tabId:'tab',host:'dock'};
  const sidebar={isExpanded:()=>true,isTargetCurrent:()=>true,active:()=>({id:'tab'}),canCloseTarget:()=>true,
    closeTarget:captured=>{calls.push(captured);return 'closed';}};
  return {calls,target,sidebar,context:{sessionId:'session',area:'browser',scope:null,target}};
};
test('close delegates exactly one current tool occurrence to the native cleanup owner',()=>{
  for(const area of ['browser','terminal','files','documentpreview','right']) {
    const {calls,target,sidebar,context}=setup();
    assert.equal(closeNavigationTool(sidebar,{...context,area}),'closed');assert.deepEqual(calls,[target]);
  }
});
test('conversation, sidebar, settings, hidden pane and absent session never close a background tab',()=>{
  for(const change of [{area:'conversation'},{area:'sidebar'},{scope:{}},{target:undefined},{sessionId:undefined},{sessionId:'other'}]) {
    const {calls,sidebar,context}=setup();assert.equal(closeNavigationTool(sidebar,{...context,...change}),'unavailable');
    assert.deepEqual(calls,[]);
  }
  const {calls,sidebar,context}=setup();sidebar.isExpanded=()=>false;
  assert.equal(closeNavigationTool(sidebar,context),'unavailable');assert.deepEqual(calls,[]);
});
test('a closed, reopened, moved or deselected occurrence cannot close another tab',()=>{
  for(const change of [{isTargetCurrent:()=>false},{active:()=>({id:'new-tab'})},{active:()=>undefined}]) {
    const {calls,sidebar,context}=setup();Object.assign(sidebar,change);
    assert.equal(closeNavigationTool(sidebar,context),'stale');assert.deepEqual(calls,[]);
  }
});
test('host close refusal and cleanup failure are preserved without fallback or retry',()=>{
  const {calls,sidebar,context}=setup();sidebar.canCloseTarget=()=>false;
  assert.equal(closeNavigationTool(sidebar,context),'unavailable');assert.deepEqual(calls,[]);
  sidebar.canCloseTarget=()=>true;sidebar.closeTarget=()=>{calls.push('cleanup');throw new Error('cleanup failed');};
  assert.throws(()=>closeNavigationTool(sidebar,context),/cleanup failed/);assert.deepEqual(calls,['cleanup']);
});
test('native last-tab/guide result is returned and never escalates to window closing',()=>{
  const {sidebar,context}=setup();let windowClosed=false;
  sidebar.closeWindow=()=>{windowClosed=true;};
  for(const result of ['closed','unavailable','stale']) {
    sidebar.closeTarget=()=>result;
    assert.equal(closeNavigationTool(sidebar,context),result);assert.equal(windowClosed,false);
  }
});
