// Per-window, per-session recency. Only public tab metadata is retained; no
// content, terminal state or host layout storage is read or modified.
export function createToolTabHistory() {
  const sessions = new Map();
  const tools = new Set(["browser", "terminal"]);
  const candidates = (sessionId, kind, tabs) => tabs.filter(tab => tab.sessionId === sessionId && tab.kind === kind);
  return {
    remember(sessionId, tabId, tabs) {
      const tab = tabs.find(item => item.sessionId === sessionId && item.tabId === tabId);
      if (!tab || !tools.has(tab.kind)) return;
      const history = sessions.get(sessionId) || new Map();
      const live = new Set(candidates(sessionId, tab.kind, tabs).map(item => item.tabId));
      history.set(tab.kind, [tabId, ...(history.get(tab.kind) || []).filter(id => id !== tabId && live.has(id))]);
      sessions.set(sessionId, history);
    },
    find(sessionId, kind, tabs, activeId) {
      const live = candidates(sessionId, kind, tabs);
      const active = live.find(tab => tab.tabId === activeId);
      if (active) return active;
      for (const id of sessions.get(sessionId)?.get(kind) || []) {
        const tab = live.find(item => item.tabId === id);
        if (tab) return tab;
      }
      return live[0];
    },
    next(sessionId, kind, tabs, activeId) {
      const live = candidates(sessionId, kind, tabs);
      if (!live.length) return undefined;
      const index = live.findIndex(tab => tab.tabId === activeId);
      return live[(index + 1) % live.length];
    },
    reconcile(tabs) {
      for (const [sessionId, history] of sessions) {
        for (const [kind, ids] of history) {
          const live = new Set(candidates(sessionId, kind, tabs).map(tab => tab.tabId));
          const kept = ids.filter(id => live.has(id));
          if (kept.length) history.set(kind, kept); else history.delete(kind);
        }
        if (!history.size) sessions.delete(sessionId);
      }
    }
  };
}

// Inventory order is creation order in DSH. Read visible tab-strip order for
// cycling; append hidden/unmounted records so they remain reachable as well.
export function orderToolTabs(tabs, visibleIds) {
  const byId = new Map(tabs.map(tab => [tab.tabId, tab])), ordered = [];
  for (const id of visibleIds) {
    if (!byId.has(id)) continue;
    ordered.push(byId.get(id)); byId.delete(id);
  }
  return ordered.concat([...byId.values()]);
}

// Use the page owner's close/cleanup operation for one captured current tab.
// This never falls through to the native command's window-close fallback.
export function closeNavigationTool(sidebar, { sessionId, area, scope, target }) {
  if (scope || ["sidebar", "conversation"].includes(area) || !target?.tabId
    || !sessionId || target.sessionId !== sessionId
    || (target.host === "dock" && !sidebar.isExpanded())) return "unavailable";
  if (!sidebar.isTargetCurrent(target) || sidebar.active()?.id !== target.tabId) return "stale";
  if (!sidebar.canCloseTarget(target)) return "unavailable";
  return sidebar.closeTarget(target);
}

// After creating/selecting a tool, return to navigation once it is ready. An
// intervening focus owner, rename, stale tab or modal cancels this one handoff.
export function toolHandoffStatus({ request, sessionId, activeTabId, current, reason, ownsFocus, idleFocus, originFocus, editingHeader, terminalState, contentReady = true }) {
  if (request.sessionId !== sessionId || request.tabId !== activeTabId || !current
    || editingHeader
    || ["menu", "modal", "inactive", "composition"].includes(reason)
    || !(ownsFocus || idleFocus || originFocus)) return "cancel";
  if (terminalState) {
    if (["closed", "failed"].includes(terminalState.phase) || terminalState.info?.state === "exited") return "cancel";
    if (!terminalState.writable) return "wait";
  }
  return contentReady ? "ready" : "wait";
}
