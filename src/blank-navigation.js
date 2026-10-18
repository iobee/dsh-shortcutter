// Observe completed clicks without cancelling native pointer/focus behavior.
export function observeBlankNavigation(doc, { enabled, blocked, scopeFor, navigate }) {
  const win = doc.defaultView;
  const controls = 'input, textarea, select, button, a[href], label, summary, iframe, webview, canvas, audio, video, '
    + '[contenteditable]:not([contenteditable="false"]), [inert], [draggable="true"], [data-approval-key], '
    + '[role="button"], [role="link"], [role="textbox"], [role="searchbox"], [role="combobox"], '
    + '[role="checkbox"], [role="radio"], [role="switch"], [role="slider"], [role="spinbutton"], '
    + '[role="tab"], [role="menu"], [role="menuitem"], [role="listbox"], [role="option"], [role="treeitem"], '
    + '[role="separator"], .xterm, .monaco-editor, .cm-editor, [data-sidebar-browser-frame]';
  const isElement = el => el instanceof win.Element;
  const protectedElement = el => isElement(el) && (el.isContentEditable || !!el.closest(controls));
  const modified = event => event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
  const available = () => !disposed && !composing && enabled() && !blocked() && !doc.hidden && doc.hasFocus();
  const eligible = el => isElement(el) && el.isConnected && !protectedElement(el) && scopeFor(el);
  let candidate, timer, composing = false, disposed = false;
  const cancel = () => { candidate = undefined; win.clearTimeout(timer); };
  const down = event => {
    cancel();
    if (event.pointerType !== 'mouse' || event.button !== 0 || event.isPrimary === false || modified(event) || !available()) return;
    const scope = eligible(event.target);
    if (scope) candidate = { target: event.target, scope, id: event.pointerId, x: event.clientX, y: event.clientY, event };
  };
  const move = event => {
    if (candidate && (event.pointerId !== candidate.id || Math.hypot(event.clientX - candidate.x, event.clientY - candidate.y) > 5)) cancel();
  };
  const click = event => {
    const start = candidate;
    cancel();
    if (!start || event.button !== 0 || event.detail !== 1 || modified(event)
      || event.defaultPrevented || start.event.defaultPrevented
      || eligible(event.target) !== start.scope
      || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
    // Let the host finish its click handlers and normal focus/blur first.
    // This one-shot check never blurs an editor or retries taking focus.
    timer = win.setTimeout(() => {
      if (!available() || event.defaultPrevented || !start.target.isConnected
        || eligible(event.target) !== start.scope || protectedElement(doc.activeElement)
        || doc.getSelection()?.isCollapsed === false) return;
      navigate(event.target);
    }, 0);
  };
  const compositionStart = () => { composing = true; cancel(); };
  const compositionEnd = () => { composing = false; cancel(); };
  const events = [
    ['pointerdown', down, true], ['pointermove', move, true], ['click', click, false],
    ['pointercancel', cancel, true], ['dragstart', cancel, true], ['wheel', cancel, true],
    ['keydown', cancel, true], ['visibilitychange', cancel, true],
    ['compositionstart', compositionStart, true], ['compositionend', compositionEnd, true]
  ];
  for (const [type, handler, capture] of events) doc.addEventListener(type, handler, capture);
  win.addEventListener('blur', cancel);
  return () => {
    disposed = true; cancel();
    for (const [type, handler, capture] of events) doc.removeEventListener(type, handler, capture);
    win.removeEventListener('blur', cancel);
  };
}
