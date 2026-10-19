// The production plugin and production React run against this deliberately small
// public host contract. It never loads DSH accounts, storage or embedded tools.
export const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0}#frame{display:flex;height:800px}#sidebar{width:200px}#conversation{width:600px}#right{width:400px}
#log{height:600px;overflow:auto}[data-shell-overlay]{position:fixed;inset:0;pointer-events:none}
</style><div id="frame"><aside id="sidebar">Sessions</aside><main id="conversation"><input id="composer" value="draft"><button id="ordinary">Ordinary button</button><div id="log"></div></main><aside id="right" data-rightbar-col data-sidebar-right-open="true"><div data-sidebar-right-session="s1" data-sidebar-right-panel="dock"><div data-dockkit-strip></div><div data-dockkit-pane="p1"></div></div></aside><div data-shell-overlay id="overlay"></div></div>`;

export function setup({ instrument = false, openState = 'open', nodes = 2000 } = {}) {
  window.counts = {};
  window.count = key => { window.counts[key] = (window.counts[key] || 0) + 1; };
  if (instrument) {
    const original = document.querySelectorAll.bind(document);
    document.querySelectorAll = selector => { window.count('documentQueryAll'); return original(selector); };
  }
  const log = document.getElementById('log');
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < nodes; i++) {
    const line = document.createElement('p'); line.textContent = 'Existing output ' + i; fragment.append(line);
  }
  log.append(fragment);
  function store(value) {
    const listeners = new Set();
    return { getSnapshot: () => value, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
      set: next => { value = next; for (const fn of [...listeners]) fn(); }, listenerCount: () => listeners.size };
  }
  const session = store({ openState, running: false });
  const terminal = store({ writable: false, phase: 'opening' });
  const mounted = store('s1');
  const openTabs = store([{ sessionId: 's1', tabId: 'b1', kind: 'browser' }]);
  let currentId = 'b1', expanded = true, occurrence = {}, navigationRevision = 0, serial = 1;
  const active = () => {
    const tab = openTabs.getSnapshot().find(t => t.sessionId === mounted.getSnapshot() && t.tabId === currentId);
    return tab && { id: tab.tabId, kind: tab.kind, contentId: tab.tabId };
  };
  const target = () => ({ sessionId: mounted.getSnapshot(), tabId: currentId, paneId: 'p1', host: 'dock', occurrence, navigationRevision });
  const renderTool = () => {
    const host = document.querySelector('[data-sidebar-right-session]'); host.dataset.sidebarRightSession = mounted.getSnapshot();
    const strip = host.querySelector('[data-dockkit-strip]');
    strip.replaceChildren(...openTabs.getSnapshot().filter(t => t.sessionId === mounted.getSnapshot()).map(tab => {
      const el = document.createElement('span'); el.role = 'tab'; el.dataset.dockkitTab = tab.tabId;
      el.setAttribute('aria-selected', String(tab.tabId === currentId)); el.textContent = tab.kind;
      return el;
    }));
    const pane = host.querySelector('[data-dockkit-pane]'); pane.dataset.sidebarRightTab = currentId;
    pane.innerHTML = active()?.kind === 'terminal' ? '<div class="xterm"></div>' : '<form><input id="address" value="draft"><span id="toolbar-blank">toolbar</span></form>';
  };
  renderTool();
  const cleanups = [], commands = new Map();
  const row = { id: 'magic-shortcuts.navigate', keys: ['⌘', 'J'], binding: { code: 'KeyJ' }, conflicts: [] };
  const sidebarRight = {
    mounted, openTabs, active, isExpanded: () => expanded, commandTarget: () => target(),
    isTargetCurrent: captured => captured.sessionId === mounted.getSnapshot() && captured.tabId === currentId
      && captured.occurrence === occurrence && captured.navigationRevision === navigationRevision,
    focusedTarget: element => element?.closest?.('[data-sidebar-right-session]') ? target() : undefined,
    focus(id) { currentId = id; occurrence = {}; navigationRevision++; renderTool(); },
    openTab(kind) {
      currentId = kind[0] + (++serial); occurrence = {}; navigationRevision++;
      openTabs.set([...openTabs.getSnapshot(), { sessionId: mounted.getSnapshot(), tabId: currentId, kind }]);
      renderTool();
    },
    toggleExpanded() { expanded = !expanded; document.getElementById('right').dataset.sidebarRightOpen = String(expanded); },
    canCloseTarget: () => true,
    closeTarget(captured) {
      if (!sidebarRight.isTargetCurrent(captured)) return 'stale';
      const remaining = openTabs.getSnapshot().filter(t => t.tabId !== captured.tabId);
      currentId = remaining.at(-1)?.tabId; occurrence = {}; navigationRevision++;
      openTabs.set(remaining); renderTool(); return 'closed';
    }
  };
  const ctx = {
    effect(fn) { cleanups.push(fn()); },
    slots: {
      inject(_name, fn) { return fn(); },
      register(spec, Component) {
        if (spec.name === 'shell.overlay') {
          const root = window.createRoot(document.getElementById('overlay'));
          root.render(window.React.createElement(Component)); return () => root.unmount();
        }
        return () => {};
      }
    },
    shortcuts: { catalog: store([row]), register(command) { commands.set(command.id, command); return () => commands.delete(command.id); },
      observeFixedInput(fn) { window.fixedInput = fn; return () => { window.fixedInput = undefined; }; }, recording: () => Promise.resolve() },
    sidebarRight, sessions: { binding: () => ({ session, ctx: {} }) },
    conversation: { input: { for: () => ({ focus: () => document.getElementById('composer').focus() }) } },
    layout: { selectPanel() {}, toggleSidebar() { document.getElementById('frame').toggleAttribute('data-sidebar-collapsed'); } },
    uiWorkspace: {}, webTerminals: { view: () => ({ state: terminal }) }
  };
  window.__ModuleLoader__ = { load({ factory }) {
    const plugin = factory(name => name === 'react' ? window.React : name === 'react-dom' ? window.ReactDOM
      : { closeTopModal: () => document.querySelector('dialog[open]')?.close() });
    plugin.apply(ctx);
  } };
  const emitKey = gesture => {
    let consumed = false;
    window.fixedInput?.({ type: 'keydown', gesture: { code: 'KeyA', shift: false, control: false, alt: false, meta: false,
      repeat: false, composing: false, defaultPrevented: false, ...gesture },
      context: { target: document.activeElement, region: document.activeElement.closest?.('.xterm') ? 'terminal' : 'page' },
      consume() { consumed = true; } });
    return consumed;
  };
  window.fixture = {
    session, terminal, sidebarRight, emitKey,
    navigate() { commands.get('magic-shortcuts.navigate').resolve().run?.(); },
    invalidateTarget() { occurrence = {}; navigationRevision++; },
    mountTerminal(focus = false) {
      const input = document.createElement('textarea'); input.id = 'terminal-input';
      document.querySelector('.xterm').append(input); if (focus) input.focus();
    },
    click(id) {
      const element = document.getElementById(id);
      for (const type of ['pointerdown', 'pointerup']) element.dispatchEvent(new PointerEvent(type,
        { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, clientX: 10, clientY: 10 }));
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, detail: 1, clientX: 10, clientY: 10 }));
    },
    dispose() { for (const fn of cleanups.reverse()) fn?.(); }
  };
}
