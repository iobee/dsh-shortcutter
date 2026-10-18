import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, validateConfig, readConfig, resolveSequence, tokenFromGesture, cycleIndex } from '../src/core.js';
const v2Config=()=>{
  const c=defaultConfig();c.version=2;
  c.bindings.nextTab='g t';c.bindings.previousTab='g T';
  return c;
};
const legacyConfig=()=>{
  const c=v2Config();c.version=1;
  delete c.bindings.newBrowser;delete c.bindings.newTerminal;delete c.bindings.closeTab;
  c.bindings.settings='Space s';c.bindings.autoNav='Space n';c.bindings.help='Space ?';
  return c;
};
test('invalid suffix cancels without executing the same standalone key',()=>{
  assert.deepEqual(resolveSequence(defaultConfig().bindings,'g','i'),{consume:true,prefix:'',command:undefined});
});
test('escape is one layer at a time',()=>{
  assert.deepEqual(resolveSequence({},'g','Escape'),{consume:true,prefix:'',dismiss:false});
  assert.equal(resolveSequence({},'','Escape').dismiss,true);
});
test('prefixes and case-sensitive fullscreen binding survive configuration',()=>{
  const c=defaultConfig();assert.ok(validateConfig(c).config);
  assert.equal(resolveSequence(c.bindings,'','R').command,'fullscreen');
  assert.equal(resolveSequence(c.bindings,'','r').command,'right');
  assert.equal(resolveSequence(c.bindings,'g','a').command,'previous');
  assert.equal(tokenFromGesture({code:'Slash',shift:true}),'?');
});
test('duplicates and prefix shadowing are rejected before settings are saved',()=>{
  const c=defaultConfig();c.bindings.enter='t';assert.match(validateConfig(c).error,/同时分配/);
  c.bindings.enter='g';assert.match(validateConfig(c).error,/保留/);
});
test('malformed and future settings do not silently overwrite stored preferences',()=>{
  assert.ok(readConfig('{').error);assert.ok(readConfig(JSON.stringify({...defaultConfig(),version:4})).error);
  assert.equal(readConfig(null).config.autoNavigate,true);
});
test('legacy autoHints is retired without losing custom bindings or automatic-navigation choice',()=>{
  const legacy={...legacyConfig(),autoNavigate:false,autoHints:true};
  legacy.bindings.enter='a';legacy.bindings.previous='g p';
  const loaded=readConfig(JSON.stringify(legacy));
  assert.equal(loaded.config.autoNavigate,false);
  assert.equal(loaded.config.bindings.enter,'a');assert.equal(loaded.config.bindings.previous,'g p');
  assert.equal('autoHints' in loaded.config,false);
  assert.deepEqual(readConfig(JSON.stringify(loaded.config)).config,loaded.config);
});
test('custom sequences and explicit unbinding work',()=>{
  const c=defaultConfig();c.bindings.enter='a';c.bindings.previous='g p';c.bindings.files='';
  const v=validateConfig(c);assert.ok(v.config);
  assert.equal(resolveSequence(v.config.bindings,'','a').command,'enter');
  assert.equal(resolveSequence(v.config.bindings,'g','p').command,'previous');
  assert.equal(resolveSequence(v.config.bindings,'','e').consume,false);
  assert.equal(cycleIndex(3,0,-1),2);assert.equal(cycleIndex(0,-1,1),-1);
});
test('single keys create sessions and tools, while g only navigates and Space is unclaimed',()=>{
  const {bindings}=defaultConfig();
  assert.equal(resolveSequence(bindings,'','n').command,'newSession');
  assert.equal(resolveSequence(bindings,'','B').command,'newBrowser');
  assert.equal(resolveSequence(bindings,'','T').command,'newTerminal');
  assert.equal(resolveSequence(bindings,'','b').command,'browser');
  assert.equal(resolveSequence(bindings,'','t').command,'terminal');
  assert.equal(resolveSequence(bindings,'','w').command,'closeTab');
  assert.equal(resolveSequence(bindings,'','W').consume,false);
  assert.equal(resolveSequence(bindings,'g','s').command,'settings');
  assert.equal(resolveSequence(bindings,'','Space').consume,false);
  assert.equal(resolveSequence(bindings,'','?').toggleHints,true);
  assert.equal(resolveSequence(bindings,'g','n').command,undefined);
  assert.equal(resolveSequence(bindings,'','N').consume,false);
});
test('older settings gain new-session without resetting preferences or rewriting input',()=>{
  const legacy=legacyConfig();delete legacy.bindings.newSession;
  legacy.autoNavigate=false;legacy.bindings.enter='a';legacy.bindings.files='';
  const raw=JSON.stringify(legacy),loaded=readConfig(raw);
  assert.equal(loaded.config.bindings.newSession,'n');
  assert.equal(loaded.config.autoNavigate,false);
  for(const [id,key] of Object.entries(legacy.bindings))if(!['settings','autoNav','help','nextTab','previousTab'].includes(id))assert.equal(loaded.config.bindings[id],key);
  assert.equal(loaded.config.bindings.settings,'g s');
  assert.equal(JSON.stringify(legacy),raw);
});
test('new-session migration preserves an existing custom n and explicit unbinding',()=>{
  const legacy=legacyConfig();delete legacy.bindings.newSession;legacy.bindings.enter=' n ';
  const loaded=readConfig(JSON.stringify(legacy)).config;
  assert.equal(loaded.bindings.enter,'n');assert.equal(loaded.bindings.newSession,'');
  assert.equal(resolveSequence(loaded.bindings,'','n').command,'enter');
  assert.equal(readConfig(JSON.stringify(loaded)).config.bindings.newSession,'');
  loaded.bindings.newSession='g n';
  assert.equal(readConfig(JSON.stringify(loaded)).config.bindings.newSession,'g n');
  assert.equal(resolveSequence(loaded.bindings,'g','n').command,'newSession');
});
test('new command migration does not accept other missing or malformed bindings',()=>{
  const legacy=legacyConfig();delete legacy.bindings.newSession;delete legacy.bindings.enter;
  assert.ok(validateConfig(legacy).error);
  const invalid=defaultConfig();invalid.bindings.newSession=null;
  assert.ok(validateConfig(invalid).error);
});
test('default v1 settings migrate without mutating stored input and are stable after saving',()=>{
  const legacy=legacyConfig(),raw=JSON.stringify(legacy),loaded=readConfig(raw);
  assert.deepEqual(loaded.config,defaultConfig());assert.equal(JSON.stringify(legacy),raw);
  assert.deepEqual(readConfig(JSON.stringify(loaded.config)).config,loaded.config);
  assert.equal('autoNav' in loaded.config.bindings,false);assert.equal('help' in loaded.config.bindings,false);
});
test('migration preserves custom g s, B and T instead of stealing them for new defaults',()=>{
  const c=legacyConfig();c.bindings.previous='g s';c.bindings.files='B';c.bindings.enter='T';
  const result=validateConfig(c),b=result.config.bindings;
  assert.equal(b.previous,'g s');assert.equal(b.files,'B');assert.equal(b.enter,'T');
  assert.equal(b.settings,'');assert.equal(b.newBrowser,'');assert.equal(b.newTerminal,'');
  assert.match(result.notice,/暂未绑定/);
});
test('custom and disabled settings bindings survive, retired Space customs become unbound with a notice',()=>{
  const c=legacyConfig();c.bindings.settings='g q';c.bindings.files='Space e';c.bindings.terminal='';
  const result=validateConfig(c);
  assert.equal(result.config.bindings.settings,'g q');assert.equal(result.config.bindings.files,'');
  assert.equal(result.config.bindings.terminal,'');assert.match(result.notice,/原 Space 组合已取消/);
  c.bindings.settings='';assert.equal(validateConfig(c).config.bindings.settings,'');
});
test('v2 rejects Space combinations, missing commands and malformed legacy configurations',()=>{
  const c=v2Config();c.bindings.settings='Space s';assert.ok(validateConfig(c).error);
  c.bindings.settings='g s';delete c.bindings.newBrowser;assert.ok(validateConfig(c).error);
  const old=legacyConfig();old.bindings.files='t';assert.ok(validateConfig(old).error);
  old.bindings.files='e';old.bindings.help=null;assert.ok(validateConfig(old).error);
});
test('older v2 preferences gain w without changing existing keys or stored input',()=>{
  const old=v2Config();delete old.bindings.closeTab;old.bindings.files='f';old.autoNavigate=false;
  const raw=JSON.stringify(old),result=readConfig(raw);
  assert.equal(result.config.bindings.closeTab,'w');assert.equal(result.config.autoNavigate,false);
  for(const [id,key] of Object.entries(old.bindings))if(!['nextTab','previousTab'].includes(id))assert.equal(result.config.bindings[id],key);
  assert.equal(JSON.stringify(old),raw);
});
test('v1 and v2 migration preserve custom w, disabled close and a custom close sequence',()=>{
  for(const old of [legacyConfig(),v2Config()]) {
    delete old.bindings.closeTab;old.bindings.files=' w ';
    const result=validateConfig(old);assert.equal(result.config.bindings.files,'w');
    assert.equal(result.config.bindings.closeTab,'');assert.match(result.notice,/暂未绑定/);
  }
  const config=defaultConfig();config.bindings.closeTab='';
  assert.equal(validateConfig(config).config.bindings.closeTab,'');
  config.bindings.closeTab='g w';
  assert.equal(resolveSequence(validateConfig(config).config.bindings,'g','w').command,'closeTab');
  config.bindings.closeTab=null;assert.ok(validateConfig(config).error);
});
test('brackets switch adjacent tools directly and retire the old default g sequences',()=>{
  const {bindings}=defaultConfig();
  assert.deepEqual(resolveSequence(bindings,'',tokenFromGesture({code:'BracketLeft',shift:false})),{consume:true,prefix:'',command:'previousTab'});
  assert.deepEqual(resolveSequence(bindings,'',tokenFromGesture({code:'BracketRight',shift:false})),{consume:true,prefix:'',command:'nextTab'});
  for(const code of ['BracketLeft','BracketRight']) {
    const token=tokenFromGesture({code,shift:true});
    assert.equal(token,'');assert.equal(resolveSequence(bindings,'',token).consume,false);
  }
  for(const key of ['t','T'])assert.equal(resolveSequence(bindings,'g',key).command,undefined);
  assert.equal(cycleIndex(4,3,1),0);assert.equal(cycleIndex(4,0,-1),3);
  assert.equal(cycleIndex(1,0,1),0);assert.equal(cycleIndex(1,0,-1),0);
});
test('v2 default tab keys migrate once without rewriting storage or resetting other preferences',()=>{
  const old=v2Config();old.autoNavigate=false;old.bindings.enter='a';old.bindings.files='';
  const raw=JSON.stringify(old),loaded=readConfig(raw);
  assert.equal(loaded.config.version,3);assert.equal(loaded.config.autoNavigate,false);
  assert.equal(loaded.config.bindings.nextTab,']');assert.equal(loaded.config.bindings.previousTab,'[');
  assert.equal(loaded.config.bindings.enter,'a');assert.equal(loaded.config.bindings.files,'');
  assert.equal(JSON.stringify(old),raw);
  const saved=loaded.config;saved.bindings.nextTab='g t';saved.bindings.previousTab='g T';
  assert.deepEqual(readConfig(JSON.stringify(saved)).config,saved);
});
test('legacy custom or disabled tab bindings survive alongside newly migrated defaults',()=>{
  for(const make of [legacyConfig,v2Config]) {
    const old=make();old.bindings.nextTab='x';old.bindings.previousTab='';
    let loaded=validateConfig(old).config;
    assert.equal(loaded.bindings.nextTab,'x');assert.equal(loaded.bindings.previousTab,'');
    old.bindings.previousTab='g T';loaded=validateConfig(old).config;
    assert.equal(loaded.bindings.nextTab,'x');assert.equal(loaded.bindings.previousTab,'[');
    old.bindings.previousTab='g t';
    assert.equal(validateConfig(old).config.bindings.previousTab,'g t');
  }
});
test('bracket configuration supports reassignment, prefix suffixes and normal conflict validation',()=>{
  const c=defaultConfig();c.bindings.nextTab='';c.bindings.files=']';c.bindings.previousTab='g [';
  const result=validateConfig(c);assert.ok(result.config);
  assert.equal(resolveSequence(result.config.bindings,'',']').command,'files');
  assert.equal(resolveSequence(result.config.bindings,'g','[').command,'previousTab');
  c.bindings.nextTab=']';assert.match(validateConfig(c).error,/同时分配/);
  for(const key of ['[]','{','}','g []']) {
    const invalid=defaultConfig();invalid.bindings.nextTab=key;assert.ok(validateConfig(invalid).error);
  }
});
test('migration validates old data before replacing tab defaults and never repairs a corrupt v3',()=>{
  const invalid=v2Config();invalid.bindings.files='g t';const raw=JSON.stringify(invalid);
  assert.ok(readConfig(raw).error);assert.equal(JSON.stringify(invalid),raw);
  invalid.bindings.files='[';assert.ok(validateConfig(invalid).error);
  const current=defaultConfig();delete current.bindings.closeTab;assert.ok(validateConfig(current).error);
});
