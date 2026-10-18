'use strict';

// One contextual surface, shared by the reading hints and prefix sequences.
let keyLayer = null;
let autoKeyHints = true;
let findReturn = 'chat', findScope = 'chat', findMarks = [], findIndex = 0;
let commandReturn = 'chat', settingsReturn = 'chat', commandIndex = 0, filteredCommands = [];

const readingAreas = ['left', 'chat', 'right'];
const inputAreas = ['input', 'terminal', 'address', 'browser'];
function contextName() {
  if (state.area === 'left') return '侧栏';
  if (['right', 'terminal', 'address', 'browser'].includes(state.area)) return tabDetails[panel().active].title;
  return '对话';
}
function hintEntry(key, title) { return { key, title }; }
function rootHintEntries() {
  const vertical = { keys:[['j','向下'], ['k','向上']], title:'上下滚动' };
  if (state.area === 'left') return [
    { ...vertical, title:'移动候选' },
    { keys:[['h','收起分组'], ['l','展开分组']], title:'收起 / 展开' },
    hintEntry('Enter','打开会话'), hintEntry('f','搜索会话')
  ];
  if (state.area === 'right') return [
    panel().active === 'files' ? vertical : hintEntry('i',panel().active === 'terminal' ? '输入命令' : '进入输入'),
    hintEntry('f',panel().active === 'files' ? '搜索文件内容' : panel().active === 'terminal' ? '搜索输出' : '搜索网页'),
    panel().active === 'files' ? hintEntry('n','新建会话') : vertical,
    hintEntry('R',state.maximized ? '还原面板' : '放大面板')
  ];
  return [hintEntry('i','继续输入'), hintEntry('f','搜索对话'), vertical, hintEntry('n','新建会话')];
}
function prefixEntries(layer) {
  if (layer === 'g') return [hintEntry('s','设置'), hintEntry('a','上一个会话'), hintEntry('t','下一个工具标签'), hintEntry('T','上一个工具标签')];
  return [hintEntry(' ','搜索命令'), hintEntry('t','切换明暗主题'), hintEntry('?','快捷键总览')];
}
function displayKey(key) { return key === ' ' ? 'Space' : key; }
function hintMarkup(entry) {
  if (entry.keys) return `<div class="hint-binding hint-pair"><span class="hint-keys">${entry.keys.map(([key,label])=>`<button data-hint-key="${esc(key)}" aria-label="${esc(label)} ${esc(key)}"><kbd>${esc(key)}</kbd></button>`).join('')}</span><span class="hint-description">${entry.title}</span></div>`;
  return `<button class="hint-binding" data-hint-key="${esc(entry.key)}" aria-label="${esc(entry.title)} ${esc(displayKey(entry.key))}"${entry.key==='R'||entry.key==='T'?' title="Shift + '+entry.key.toLowerCase()+'"':''}><kbd>${esc(displayKey(entry.key))}</kbd><span class="hint-description">${entry.title}</span>${entry.prefix?icon('right','small'):''}</button>`;
}
function renderWhichKey() {
  const el = $('which-key');
  if (!keyLayer || !readingAreas.includes(state.area)) { el.hidden = true; return; }
  const root = keyLayer === 'root';
  const shared = [hintEntry('s',state.area==='left'?'收起侧栏':'侧栏'),hintEntry('c','回到对话'),hintEntry('r',state.area==='right'?'收起工具面板':'工具面板'),hintEntry('e','文件'),hintEntry('b','浏览器'),hintEntry('t','终端')];
  el.dataset.layer = keyLayer;
  el.setAttribute('aria-label',root ? contextName()+'阅读快捷键' : keyLayer==='g'?'前往的后续快捷键':'命令的后续快捷键');
  el.innerHTML = `<header class="hint-heading">${root?'<span class="dot"></span>':`<kbd class="hint-prefix-key">${displayKey(keyLayer==='space'?' ':keyLayer)}</kbd>`}<span class="hint-title">${root?contextName():keyLayer==='g'?'前往':'命令'}</span><span class="hint-mode">${root?'阅读':'等待下一键'}</span><button class="ib" data-dismiss-hint aria-label="收起按键提示">${icon('close','small')}</button></header>
    <div class="hint-grid">${(root?rootHintEntries():prefixEntries(keyLayer)).map(hintMarkup).join('')}</div>
    ${root?`<div class="hint-grid hint-shared">${shared.map(hintMarkup).join('')}</div><div class="hint-grid hint-prefixes">${[{key:'g',title:'前往',prefix:true},{key:' ',title:'命令',prefix:true}].map(hintMarkup).join('')}</div>`:''}
    <footer class="hint-foot"><span>${root?'按键或点击执行':'继续按键或点击选择'}</span><span><kbd>${root?'?':'Esc'}</kbd> ${root?'再次查看':'取消'}</span></footer>`;
  el.hidden = false;
}
function showWhichKey(layer='root') { keyLayer=layer; renderWhichKey(); }
function hideWhichKey() { keyLayer=null; if($('which-key')) { $('which-key').hidden=true; $('which-key').dataset.layer=''; } }
function readingModeChanged(previous, next) {
  if (!readingAreas.includes(next)) { hideWhichKey(); return; }
  if (inputAreas.includes(previous) && autoKeyHints) showWhichKey();
  else if (keyLayer) renderWhichKey();
}
function cancelPrefix() {
  if (keyLayer && keyLayer !== 'root') { hideWhichKey(); return true; }
  return false;
}
function auxiliaryDialogOpen() { return ['local-find','command-dialog','settings-dialog'].some(id=>$(id)?.open); }
function closeAuxiliaryDialog() {
  if ($('local-find').open) { closeFind(); return true; }
  if ($('command-dialog').open) { closeCommands(); return true; }
  if ($('settings-dialog').open) { closeSettings(); return true; }
  return false;
}
function previousSession() {
  const previous=state.history.find(id=>id!==state.current&&sessions.some(s=>s.id===id));
  if(previous) openSession(previous); else announce('访问另一个会话后，可以用 g a 在两个会话间往返。');
}
function executePrefix(layer,key) {
  if(layer==='g') {
    if(key==='s') openSettings();
    else if(key==='a') previousSession();
    else if(key==='t'||key==='T') cycleTabs(key==='t'?1:-1);
  } else {
    if(key===' ') openCommands();
    else if(key==='t') $('theme-toggle').click();
    else if(key==='?') openHelp();
  }
}
function handleReadingKey(key, repeat=false) {
  if (!readingAreas.includes(state.area)) return false;
  if(keyLayer && keyLayer!=='root') {
    if(repeat || ['Shift','Control','Alt','Meta'].includes(key)) return true;
    const layer=keyLayer, binding=prefixEntries(layer).find(item=>item.key===key);
    hideWhichKey();
    if(binding) { recordKey(displayKey(layer==='space'?' ':layer)+' '+displayKey(key)); executePrefix(layer,key); }
    return true; // Never reinterpret an invalid suffix as a standalone command.
  }
  if(key==='?' || key==='g' || key===' ') {
    if(!repeat) { recordKey(displayKey(key)); if(key==='?') keyLayer==='root'?hideWhichKey():showWhichKey(); else showWhichKey(key===' '?'space':'g'); }
    return true;
  }
  if(['h','j','k','l','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(key)) {
    hideWhichKey(); recordKey(key);
    if(state.area==='left') {
      if(['j','k','ArrowUp','ArrowDown'].includes(key)) moveCandidate(['j','ArrowDown'].includes(key)?1:-1);
      else setGroup(['l','ArrowRight'].includes(key));
    } else {
      const x=['h','ArrowLeft'].includes(key)?-100:['l','ArrowRight'].includes(key)?100:0;
      const y=['j','ArrowDown'].includes(key)?72:['k','ArrowUp'].includes(key)?-72:0;
      if(state.area==='right'&&panel().active==='browser') $('browser-frame')?.contentWindow.postMessage({type:'dsh-demo-scroll',x,y},'*');
      else (state.area==='chat'?$('chat-scroll'):panel().active==='terminal'?$('terminal'):$('right-content').querySelector('.document'))?.scrollBy({left:x,top:y});
    }
    return true;
  }
  if(key==='Enter'&&state.area==='left') { if(!repeat){hideWhichKey();recordKey('Enter');activateCandidate();} return true; }
  if(['s','c','r','i','e','b','t','f','n','R'].includes(key)) {
    if(!repeat){hideWhichKey();recordKey(key);action(key);} return true;
  }
  return false;
}

// Find is scoped to the region where it was invoked. It is independent of i.
function clearFindMarks(root) {
  root?.querySelectorAll('mark.dsh-find-match').forEach(mark=>{const parent=mark.parentNode;mark.replaceWith(document.createTextNode(mark.textContent));parent.normalize();});
}
function markFindText(root,query) {
  clearFindMarks(root);
  if(!query||!root)return [];
  const nodes=[],walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()) if(!walker.currentNode.parentElement.closest('input,textarea,script,style,kbd')) nodes.push(walker.currentNode);
  const marks=[],needle=query.toLocaleLowerCase();
  nodes.forEach(node=>{
    const text=node.textContent,lower=text.toLocaleLowerCase();let from=0,index=lower.indexOf(needle),fragment=document.createDocumentFragment();
    if(index<0)return;
    while(index>=0){fragment.append(document.createTextNode(text.slice(from,index)));const mark=document.createElement('mark');mark.className='dsh-find-match';mark.textContent=text.slice(index,index+query.length);fragment.append(mark);marks.push(mark);from=index+query.length;index=lower.indexOf(needle,from);}
    fragment.append(document.createTextNode(text.slice(from)));node.replaceWith(fragment);
  });
  return marks;
}
function findRoot() { return findScope==='chat'?$('messages'):findScope==='terminal'?$('terminal'):$('right-content'); }
function updateFindCount(count,index) { $('find-count').textContent=count?`${index+1} / ${count}`:$('find-input').value?'无结果':'0 / 0'; }
function runFind(delta=0) {
  const q=$('find-input').value;
  if(findScope==='browser') { $('browser-frame')?.contentWindow.postMessage({type:'dsh-demo-find',query:q,delta},'*'); return; }
  if(!delta){findMarks=markFindText(findRoot(),q);findIndex=0;} else if(findMarks.length) findIndex=(findIndex+delta+findMarks.length)%findMarks.length;
  findMarks.forEach((mark,i)=>mark.classList.toggle('current',i===findIndex));
  findMarks[findIndex]?.scrollIntoView({block:'nearest'});
  updateFindCount(findMarks.length,findIndex);
}
function openLocalFind() {
  hideWhichKey();
  if(state.area==='left'){openSearch();return;}
  findReturn=state.area;
  findScope=['right','terminal','browser','address'].includes(state.area)?panel().active:'chat';
  $('find-heading').textContent='搜索'+(findScope==='chat'?'当前对话':findScope==='terminal'?'终端输出':findScope==='browser'?'当前网页':'当前文件区域');
  $('find-input').value='';findIndex=0;findMarks=[];updateFindCount(0,0);
  $('local-find').showModal();$('find-input').focus();
}
function closeFind() {
  if(findScope==='browser') $('browser-frame')?.contentWindow.postMessage({type:'dsh-demo-find',query:'',delta:0},'*'); else clearFindMarks(findRoot());
  $('local-find').close();focusArea(validArea(findReturn),false);
}
function commandEntries() {
  return [...['s','c','r','e','b','t','f','i','n','R'].map((key,i)=>({id:key,title:['切换侧栏','回到对话','切换工具面板','打开文件','打开浏览器','打开终端','搜索当前区域','进入输入','新建会话','放大 / 还原工具面板'][i],keys:key})),
    {id:'settings',title:'打开设置',keys:'g s'}, {id:'previous',title:'回到上一个会话',keys:'g a'}, {id:'theme',title:'切换明暗主题',keys:'Space t'}, {id:'help',title:'快捷键总览',keys:'Space ?'}];
}
function renderCommands() {
  const q=$('command-input').value.trim().toLocaleLowerCase();
  filteredCommands=commandEntries().filter(c=>(c.title+' '+c.keys).toLocaleLowerCase().includes(q));
  commandIndex=Math.max(0,Math.min(commandIndex,filteredCommands.length-1));
  $('command-results').innerHTML=filteredCommands.length?filteredCommands.map((c,i)=>`<button class="command-row${i===commandIndex?' selected':''}" data-command="${c.id}" role="option" aria-selected="${i===commandIndex}"><span>${c.title}</span><kbd>${c.keys}</kbd></button>`).join(''):'<p class="hint-empty">没有匹配的命令</p>';
  $('command-results').querySelector('.selected')?.scrollIntoView({block:'nearest'});
}
function openCommands() { hideWhichKey();commandReturn=state.area;commandIndex=0;$('command-input').value='';$('command-dialog').showModal();renderCommands();$('command-input').focus(); }
function closeCommands() { $('command-dialog').close();focusArea(validArea(commandReturn),false); }
function executeCommand(id) {
  closeCommands();
  if(id==='settings')openSettings();else if(id==='previous')previousSession();else if(id==='theme')$('theme-toggle').click();else if(id==='help')openHelp();else action(id);
}
function openHelp() { hideWhichKey();helpReturn=state.area;$('help-dialog').showModal(); }
function openSettings() { hideWhichKey();settingsReturn=state.area;updateSettings();$('settings-dialog').showModal(); }
function closeSettings() { $('settings-dialog').close();focusArea(validArea(settingsReturn),false); }
function updateSettings() {
  $('auto-hints-setting').setAttribute('aria-pressed',String(autoKeyHints));
  $('auto-hints-setting').textContent=autoKeyHints?'已开启':'已关闭';
  $('theme-setting').textContent=document.documentElement.dataset.theme==='dark'?'深色':'浅色';
}
function initWhichKey() {
  $('which-key').addEventListener('pointerdown',e=>e.preventDefault());
  $('which-key').addEventListener('click',e=>{
    e.stopPropagation();
    if(e.target.closest('[data-dismiss-hint]')){hideWhichKey();return;}
    const button=e.target.closest('[data-hint-key]');if(button)handleReadingKey(button.dataset.hintKey);
  });
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('.which-key'))hideWhichKey();});
  $('workspace').addEventListener('wheel',e=>{if(!e.target.closest('.which-key'))hideWhichKey();},{passive:true});
  window.addEventListener('blur',()=>{if(keyLayer!=='root')hideWhichKey();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)hideWhichKey();});
  $('find-input').addEventListener('input',()=>runFind());
  $('find-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing&&!composing){e.preventDefault();runFind(e.shiftKey?-1:1);}});
  $('find-prev').addEventListener('click',()=>runFind(-1));$('find-next').addEventListener('click',()=>runFind(1));$('find-close').addEventListener('click',closeFind);
  $('local-find').addEventListener('cancel',e=>{e.preventDefault();closeFind();});
  $('command-input').addEventListener('input',()=>{commandIndex=0;renderCommands();});
  $('command-results').addEventListener('click',e=>{const row=e.target.closest('[data-command]');if(row)executeCommand(row.dataset.command);});
  $('command-close').addEventListener('click',closeCommands);$('command-dialog').addEventListener('cancel',e=>{e.preventDefault();closeCommands();});
  $('settings-close').addEventListener('click',closeSettings);$('settings-dialog').addEventListener('cancel',e=>{e.preventDefault();closeSettings();});
  $('auto-hints-setting').addEventListener('click',()=>{autoKeyHints=!autoKeyHints;updateSettings();});
  $('theme-setting').addEventListener('click',()=>{$('theme-toggle').click();updateSettings();});
  window.addEventListener('message',e=>{
    const frame=$('browser-frame');if(!frame||e.source!==frame.contentWindow)return;
    if(e.data?.type==='dsh-demo-find-result'&&$('local-find').open&&findScope==='browser')updateFindCount(e.data.count,e.data.index);
    if(e.data?.type==='dsh-demo-reading-action'&&state.area==='right')hideWhichKey();
  });
}
