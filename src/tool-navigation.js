// Read only the host's tool chrome. Embedded pages never enter this document;
// the browser's one outer form is its address toolbar, not web-page content.
export function navigationToolHeader(element, { sessionId, kind }) {
  if (!element?.closest || element.closest('input, textarea, select, button, a[href], label, summary, '
    + '[contenteditable]:not([contenteditable="false"]), [role="button"], [role="textbox"], [role="combobox"], '
    + '[role="menu"], [role="menuitem"], [role="listbox"], [role="option"], [role="separator"], '
    + '[inert], [hidden], iframe, webview, .xterm, [data-sidebar-browser-frame]')) return undefined;
  if (!sessionId || element.closest('[data-sidebar-right-session]')?.getAttribute('data-sidebar-right-session') !== sessionId) return undefined;
  const strip = element.closest('[data-dockkit-strip], [data-dockkit-float-grip]');
  if (strip) return strip;
  const toolbar = kind === 'browser' && element.closest('form');
  return toolbar && toolbar.closest('[data-sidebar-right-tab]') ? toolbar : undefined;
}

// Observe a completed primary click after the host has selected its tab. The
// host stops tab clicks from bubbling, so capture then defer without consuming
// the event. Dragging, renaming, menus and input controls retain their handlers.
export function observeToolHeaderNavigation(doc, { enabled, blocked, headerFor, capture, current, navigate }) {
  const win = doc.defaultView;
  let candidate, timer, disposed = false;
  const modified = event => event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
  const available = () => !disposed && enabled() && !blocked() && !doc.hidden && doc.hasFocus();
  const cancel = () => { candidate = undefined; win.clearTimeout(timer); };
  const down = event => {
    cancel();
    if (event.pointerType !== 'mouse' || event.button !== 0 || event.isPrimary === false || modified(event) || !available()) return;
    const header = headerFor(event.target);
    if (header) candidate = { header, id: event.pointerId, x: event.clientX, y: event.clientY, event };
  };
  const move = event => {
    if (candidate && (candidate.id !== event.pointerId || Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) > 4)) cancel();
  };
  const click = event => {
    const start = candidate;
    cancel();
    if (!start || event.button !== 0 || event.detail !== 1 || modified(event)
      || event.defaultPrevented || start.event.defaultPrevented || headerFor(event.target) !== start.header
      || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
    // Switching tabs can replace their chrome during the host's click handler.
    // Retain its public occurrence identity, never the soon-detached DOM node.
    const target = capture(event.target);
    if (!target) return;
    timer = win.setTimeout(() => {
      if (!available() || event.defaultPrevented || !current(target)) return;
      navigate(target);
    }, 0);
  };
  const events = [['pointerdown', down], ['pointermove', move], ['click', click],
    ...['pointercancel', 'dragstart', 'wheel', 'keydown', 'contextmenu', 'dblclick',
      'compositionstart', 'visibilitychange'].map(type => [type, cancel])];
  for (const [type, handler] of events) doc.addEventListener(type, handler, true);
  win.addEventListener('blur', cancel);
  return () => {
    disposed = true; cancel();
    for (const [type, handler] of events) doc.removeEventListener(type, handler, true);
    win.removeEventListener('blur', cancel);
  };
}
