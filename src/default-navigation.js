// Navigation is an input-ownership state, independent of DOM focus. Observing
// this state must never focus/blur a host control or change its selection.
export function isNavigationInput(element) {
  if (!element?.closest) return false;
  if (element.isContentEditable || element.closest('textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"]')) return true;
  const input = element.closest('input');
  return !!input && !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'hidden'].includes(input.type);
}

export function isNavigationContent(element) {
  return !!element?.closest?.('iframe, webview, [data-sidebar-browser-frame], .xterm, .monaco-editor, .cm-editor, [data-approval-key]');
}

export function nativeNavigationKey(element, code) {
  // Space activates buttons/checks and is a prefix only on ordinary surfaces.
  if (code !== 'Space') return false;
  return !!element?.closest?.('button, input, select, a[href], summary, [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="slider"], [role="treeitem"]');
}

export function readNavigationContext(doc, { enabled = true, composing = false } = {}) {
  const active = doc.activeElement;
  const visible = element => element.isConnected && !!element.getClientRects().length
    && doc.defaultView.getComputedStyle(element).visibility !== 'hidden';
  const menus = [...doc.querySelectorAll('[role="menu"], [role="listbox"]')].filter(visible);
  const modals = [...doc.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')].filter(visible);
  const top = modals.findLast(element => element.matches('dialog:modal')) || modals.at(-1);
  const scope = top?.matches('[data-shortcut-modal="settings"], [data-sc-navigation-dialog]') ? top : null;
  const reason = doc.hidden || !doc.hasFocus() ? 'inactive'
    : menus.length ? 'menu'
    : top && !scope ? 'modal'
    : composing ? 'composition'
    : isNavigationContent(active) ? 'content'
    : isNavigationInput(active) ? 'input'
    : !enabled ? 'disabled' : 'navigation';
  return { navigating: reason === 'navigation', reason, active, scope };
}

export function observeNavigationContext(doc, { read, changed, ignore = () => false }) {
  const win = doc.defaultView;
  let disposed = false, timer, composing = false, compositionTarget, previous;
  const refresh = () => {
    if (disposed) return;
    win.clearTimeout(timer);
    // An input can disappear or lose focus without delivering compositionend
    // (including an app switch). Do not strand the next page in composition.
    if (composing && (doc.hidden || !doc.hasFocus() || !compositionTarget?.isConnected
      || !compositionTarget.contains(doc.activeElement))) composing = false;
    const next = read({ composing });
    if (!previous || ['navigating', 'reason', 'active', 'scope'].some(key => next[key] !== previous[key])) {
      previous = next; changed(next);
    }
    return next;
  };
  const schedule = () => { win.clearTimeout(timer); timer = win.setTimeout(refresh, 0); };
  const start = event => { composing = true; compositionTarget = event.target; refresh(); };
  const end = () => { composing = false; compositionTarget = undefined; schedule(); };
  const events = [['focusin', refresh], ['focusout', schedule], ['pointerup', schedule], ['click', schedule],
    ['visibilitychange', refresh], ['compositionstart', start], ['compositionend', end]];
  for (const [type, handler] of events) doc.addEventListener(type, handler, true);
  win.addEventListener('focus', refresh); win.addEventListener('blur', refresh);
  const overlays = 'dialog, [role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"]';
  const observer = new win.MutationObserver(records => {
    // Streaming output and terminal rows do not change input ownership. Keep
    // removals of the focused control and changes inside/to an overlay live.
    if (previous?.active && !previous.active.isConnected || records.some(record => !ignore(record.target)
      && (record.type === 'attributes' || record.target.closest?.(overlays)
        || [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1
          && (node.matches(overlays) || node.querySelector(overlays)))))) schedule();
  });
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['open', 'role', 'aria-modal', 'contenteditable', 'disabled', 'inert', 'data-shortcut-modal'] });
  refresh();
  return { refresh, dispose() {
    disposed = true; win.clearTimeout(timer); observer.disconnect();
    for (const [type, handler] of events) doc.removeEventListener(type, handler, true);
    win.removeEventListener('focus', refresh); win.removeEventListener('blur', refresh);
  } };
}
