window.__ModuleLoader__.load({
  id: "dsh-shortcutter",
  factory(require) {
    const React = require("react");
    const { createPortal } = require("react-dom");
    const { closeTopModal } = require("@deepseek-ai/dsh-client-ui-primitives");
    const h = React.createElement;
    /* BUILD_CORE */
    /* BUILD_NAVIGATION */
    /* BUILD_TOOLS */
    /* BUILD_TOOL_NAVIGATION */
    /* BUILD_CSS */
    const inject = ["slots", "shortcuts", "layout", "sidebarRight", "conversation", "sessions", "uiWorkspace", "webTerminals"];

    function apply(ctx) {
      let anchor, root, layer, alive = true, revision = 0, serial = 0, pending, pendingTimer;
      let navigationObserver, navigationScope = null, manualNavigation = false;
      let navigating = false, hints = false, prefix = "", area = "conversation", target;
      let firstNavigation = true, seenSession = false, inputReset = 0, resetTimer;
      let lastSession, previousSession, notice = "", noticeTimer, returnElement;
      let raw = null, storageError = "", config = defaultConfig(), stopRecording = () => {};
      const listeners = new Set();
      const toolHistory = createToolTabHistory();
      try {
        raw = localStorage.getItem(STORAGE_KEY);
        const loaded = readConfig(raw);
        if (loaded.config) { config = loaded.config; storageError = loaded.notice || ""; }
        else storageError = loaded.error;
      } catch { storageError = "无法读取本机设置，本次使用默认键位。"; }
      let published;
      const publish = (force = false) => {
        if (!alive) return;
        const active = ctx.sidebarRight.active();
        // Targets are fresh host objects: compare their occurrence and navigation
        // identity, not the wrapper. A pending view commit can explicitly wake us.
        const next = [navigating, hints, prefix, area, navigationScope, pending, notice,
          config, raw, storageError, mounted(), active?.id, active?.kind, active?.contentId,
          ctx.sidebarRight.isExpanded(), target?.sessionId, target?.paneId, target?.host,
          target?.tabId, target?.occurrence, target?.navigationRevision];
        if (!force && published && next.every((value, index) => value === published[index])) return;
        published = next;
        revision++; for (const fn of listeners) fn();
      };
      const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
      const mounted = () => ctx.sidebarRight.mounted.getSnapshot();
      const tabs = () => ctx.sidebarRight.openTabs.getSnapshot().filter(t => t.sessionId === mounted());
      const own = element => !!element && (!!root?.contains(element) || !!layer?.contains(element));
      const visible = el => !!el?.isConnected && !!el.getClientRects().length && getComputedStyle(el).visibility !== "hidden";
      const orderedTabs = () => orderToolTabs(tabs(), [...document.querySelectorAll('[role="tab"][data-dockkit-tab]')]
        .filter(el => visible(el) && el.closest("[data-sidebar-right-session]")?.getAttribute("data-sidebar-right-session") === mounted())
        .map(el => el.getAttribute("data-dockkit-tab")));
      const rememberActiveTool = () => {
        if (ctx.sidebarRight.isExpanded()) toolHistory.remember(mounted(), ctx.sidebarRight.active()?.id, tabs());
      };
      const navigationContext = options => readNavigationContext(document, { enabled: config.autoNavigate || manualNavigation, ...options });
      // Read layout geometry only. The indicator belongs to our overlay; no
      // classes, styles, listeners or focus handlers are added to host panels.
      const columns = () => {
        const frame = root?.closest("[data-shell-overlay]")?.parentElement;
        const right = frame?.querySelector(":scope > [data-rightbar-col]");
        const conversation = right?.previousElementSibling;
        const sidebar = conversation?.previousElementSibling;
        return { frame, right, conversation, sidebar };
      };
      const returnRow = () => ctx.shortcuts.catalog.getSnapshot().find(row => row.id === RETURN_ID);
      const returnLabel = () => returnRow()?.keys?.join(" ") || "未绑定";
      const tell = text => {
        notice = text; clearTimeout(noticeTimer); publish();
        noticeTimer = setTimeout(() => { notice = ""; publish(); }, 4200);
      };
      const cancelPending = () => {
        clearTimeout(pendingTimer);
        if (!pending) return;
        pending = undefined; publish();
      };
      const rememberArea = element => {
        const focused = ctx.sidebarRight.focusedTarget(element);
        if (focused) {
          toolHistory.remember(focused.sessionId, focused.tabId, tabs());
          target = focused;
          area = tabs().find(t => t.tabId === focused.tabId)?.kind || "right";
        } else if (!own(element) && element instanceof Element) {
          const layout = columns();
          if (layout.sidebar?.contains(element)) { area = "sidebar"; target = undefined; }
          else if (layout.conversation?.contains(element)) { area = "conversation"; target = undefined; }
        }
      };
      const take = (token, infer = false) => {
        if (!alive || !anchor || (token !== undefined && pending?.id !== token)) return;
        const context = navigationContext();
        if (["menu", "modal", "inactive", "composition"].includes(context.reason)) { cancelPending(); return; }
        if (infer) rememberArea(document.activeElement);
        if (!own(document.activeElement) && visible(document.activeElement)) returnElement = document.activeElement;
        cancelPending(); prefix = ""; hints = false;
        manualNavigation = true;
        (context.scope || anchor).focus({ preventScroll: true });
        navigationObserver?.refresh();
        navigating = navigationContext().navigating;
        if (navigating) firstNavigation = false;
        publish();
      };
      const requestNavigation = (toolTarget, force = false) => {
        cancelPending();
        if ((!toolTarget && !config.autoNavigate && !force) || !document.hasFocus()) return;
        pending = { id: ++serial, session: mounted(), toolTarget, origin: document.activeElement };
        // A timeout only abandons the request. It never takes focus or retries.
        pendingTimer = setTimeout(() => {
          if (pending) { cancelPending(); tell("内容仍在准备中，可按返回导航快捷键继续。"); }
        }, 5000);
        publish();
      };
      const saveConfig = (candidate, expected) => {
        const result = validateConfig(candidate);
        if (result.error) return result.error;
        try {
          if (localStorage.getItem(STORAGE_KEY) !== expected) return "设置已在其他窗口更改，请重新打开设置后再保存。";
          const next = JSON.stringify(result.config);
          localStorage.setItem(STORAGE_KEY, next);
          raw = next; config = result.config; storageError = ""; prefix = "";
          if (!config.autoNavigate) cancelPending();
          navigationObserver?.refresh();
          publish();
        } catch { return "保存失败，原有设置仍然有效。"; }
      };
      const currentTarget = () => target && ctx.sidebarRight.isTargetCurrent(target) ? target : ctx.sidebarRight.commandTarget(null);
      const openTool = (kind, create = false) => {
        if (!mounted()) throw new Error("先打开一个会话，再打开工具面板。");
        rememberActiveTool();
        const tool = kind === "browser" || kind === "terminal";
        // Entering from another area recalls the last tool. Once there, repeat
        // the same key to advance through existing tabs in the strip's order.
        const cycle = tool && area === kind && !navigationScope && ctx.sidebarRight.isExpanded();
        const existing = !create && toolHistory[cycle ? "next" : "find"](mounted(), kind, orderedTabs(), ctx.sidebarRight.active()?.id);
        if (!create && tool && !existing) {
          const name = kind === "browser" ? "浏览器" : "终端";
          const key = config.bindings[kind === "browser" ? "newBrowser" : "newTerminal"];
          throw new Error(`还没有打开的${name}。${key ? `按 ${key} 新建。` : "请先从工具面板新建。"}`);
        }
        if (existing) {
          ctx.sidebarRight.focus(existing.tabId);
          if (!ctx.sidebarRight.isExpanded()) ctx.sidebarRight.toggleExpanded();
        } else ctx.sidebarRight.openTab(kind, {});
        area = kind; target = ctx.sidebarRight.commandTarget(null);
        rememberActiveTool();
        if (create && (!target?.tabId || ctx.sidebarRight.active()?.kind !== kind)) throw new Error("新工具尚未准备好，请点击标签进入。");
        requestNavigation(create ? target : undefined);
      };
      const closeTool = () => {
        cancelPending();
        const result = closeNavigationTool(ctx.sidebarRight, { sessionId: mounted(), area, scope: navigationScope, target });
        if (result !== "closed") throw new Error(result === "stale" ? "当前标签已变化，请重新选择后关闭。" : "先切到要关闭的工具标签。");
        const next = ctx.sidebarRight.active();
        const expanded = ctx.sidebarRight.isExpanded();
        area = expanded && next ? next.kind : "conversation";
        target = expanded && next ? ctx.sidebarRight.commandTarget(null) : undefined;
        rememberActiveTool();
        // Closing is already an explicit navigation action. Keep that mode
        // even when automatic navigation is disabled in the user's settings.
        requestNavigation(undefined, true);
      };
      const enterContent = () => {
        cancelPending(); prefix = "";
        if (navigationScope) {
          const input = [...navigationScope.querySelectorAll('input, textarea, select, [contenteditable], [role="textbox"], [role="combobox"]')]
            .find(element => visible(element) && !element.disabled && isNavigationInput(element));
          if (!input) return;
          input.focus({ preventScroll: true });
        } else if (area === "conversation") {
          const binding = ctx.sessions.binding(mounted());
          if (!binding) throw new Error("当前还没有可输入的对话。");
          ctx.conversation.input.for(binding.ctx).focus();
        } else {
          if (area === "sidebar") throw new Error("左侧栏请点击内容进入，按 Esc 返回导航。");
          const captured = currentTarget();
          if (!captured || !ctx.sidebarRight.isTargetCurrent(captured)) throw new Error("当前面板已变化，请重新选择。");
          // DSH has no public focus facade for these two components. This narrow
          // adapter only focuses an existing visible node; it never handles its keys.
          const inPane = el => visible(el)
            && el.closest("[data-dockkit-pane]")?.getAttribute("data-dockkit-pane") === captured.paneId
            && el.closest("[data-sidebar-right-session]")?.getAttribute("data-sidebar-right-session") === captured.sessionId;
          const selectors = area === "terminal" ? [".xterm textarea"]
            : area === "browser" ? ["[data-sidebar-browser-frame]", "[data-dockkit-pane] input"] : [];
          let element;
          for (const selector of selectors) {
            element = [...document.querySelectorAll(selector)].find(inPane);
            if (element) break;
          }
          if (!element) throw new Error("这个区域请点击内容进入；返回导航快捷键仍然可用。");
          element.focus({ preventScroll: true });
        }
        manualNavigation = false;
        navigationObserver?.refresh();
        navigating = navigationContext().navigating; publish();
        if (navigating) throw new Error("内容尚未准备好，请稍后再试或点击进入。");
      };
      const openSettings = () => {
        // The settings owner exposes one shared root store on its public slot
        // entry. Resolve the live owner each time so host reloads stay safe.
        const owner = ctx.slots.entriesOfSlot("sidebar.settings")
          .find(entry => entry.children?.["settings.section"]);
        const store = owner?.store;
        const actions = store && typeof store !== "function" && store.create().actions;
        if (typeof actions?.open !== "function") throw new Error("DSH 设置尚未准备好，请稍后重试。");
        cancelPending();
        actions.open();
      };
      const run = id => {
        if (!alive) return;
        try {
          prefix = ""; hints = false;
          // Leaving settings is explicit navigation, through the host's public
          // modal close helper; ordinary mode changes never close a layer.
          if (navigationScope && !["enter", "settings", "closeTab"].includes(id)) closeTopModal(document);
          if (id === "enter") enterContent();
          else if (id === "closeTab") closeTool();
          else if (id === "newSession") {
            ctx.uiWorkspace.startSession();
            area = "conversation"; target = undefined; requestNavigation();
          }
          else if (id === "sidebar") {
            const opening = columns().frame?.hasAttribute("data-sidebar-collapsed");
            ctx.layout.toggleSidebar(); area = opening ? "sidebar" : "conversation"; target = undefined; requestNavigation();
          }
          else if (id === "conversation") {
            const fullscreen = [...document.querySelectorAll('[data-sidebar-right-panel="fullscreen"]')]
              .some(el => visible(el) && el.getAttribute("data-sidebar-right-session") === mounted());
            const captured = currentTarget();
            if (fullscreen && ctx.sidebarRight.isExpanded() && captured) ctx.sidebarRight.toggleFullscreen(captured);
            ctx.layout.selectPanel(null); area = "conversation"; target = undefined; requestNavigation();
          }
          else if (id === "right") {
            if (!mounted()) throw new Error("先打开一个会话。");
            ctx.sidebarRight.toggleExpanded();
            area = ctx.sidebarRight.isExpanded() ? ctx.sidebarRight.active()?.kind || "right" : "conversation";
            target = ctx.sidebarRight.commandTarget(null); requestNavigation();
          } else if (["files", "browser", "terminal"].includes(id)) openTool(id);
          else if (id === "newBrowser" || id === "newTerminal") openTool(id === "newBrowser" ? "browser" : "terminal", true);
          else if (id === "fullscreen") {
            const captured = currentTarget();
            if (!captured || !ctx.sidebarRight.isExpanded() || captured.host === "float") throw new Error("先展开右侧面板，再放大或恢复。");
            ctx.sidebarRight.toggleFullscreen(captured);
            area = tabs().find(t => t.tabId === captured.tabId)?.kind || "right"; target = captured; requestNavigation();
          } else if (id === "previous") {
            if (!previousSession) throw new Error("还没有上一个会话。");
            area = "conversation"; target = undefined;
            ctx.uiWorkspace.openSession(previousSession); requestNavigation();
          } else if (id === "nextTab" || id === "previousTab") {
            const list = orderedTabs();
            if (list.length < 2) throw new Error("当前会话只有一个工具标签。");
            const next = list[cycleIndex(list.length, list.findIndex(t => t.tabId === ctx.sidebarRight.active()?.id), id === "nextTab" ? 1 : -1)];
            ctx.sidebarRight.focus(next.tabId);
            if (!ctx.sidebarRight.isExpanded()) ctx.sidebarRight.toggleExpanded();
            rememberActiveTool();
            area = next.kind; target = ctx.sidebarRight.commandTarget(null); requestNavigation(target, true);
          } else if (id === "settings") openSettings();
          publish();
        } catch (error) { tell(error instanceof Error ? error.message : "操作未完成，请使用原有界面重试。"); }
      };
      const keyCaps = sequence => sequence ? sequence.split(" ").map((key, i) => h("kbd", { key: i }, key === "Space" ? "space" : key)) : h("span", { className: "sc-muted" }, "未绑定");
      const areas = { sidebar: "左侧栏", conversation: "对话", terminal: "终端", browser: "浏览器", files: "文件", right: "工具面板" };

      function FocusCue() {
        const [cue, setCue] = React.useState(null);
        React.useEffect(() => {
          let frameId = 0, stopped = false, observed = [];
          const update = next => setCue(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
          const measure = () => {
            frameId = 0;
            if (stopped) return;
            if (!navigating || document.hidden || !document.hasFocus()) {
              resize.disconnect(); observed = []; update(null); return;
            }
            const layout = columns(), scope = navigationScope, right = !scope && !["conversation", "sidebar"].includes(area);
            let element = scope || layout[area];
            const captured = right && currentTarget();
            if (captured && ctx.sidebarRight.isExpanded()) {
              element = [...document.querySelectorAll("[data-dockkit-pane]")].find(el =>
                el.getAttribute("data-dockkit-pane") === captured.paneId
                && el.closest("[data-sidebar-right-session]")?.getAttribute("data-sidebar-right-session") === captured.sessionId);
            }
            const nextObserved = [...new Set([layout.frame, layout.sidebar, layout.conversation, layout.right, element].filter(Boolean))];
            if (nextObserved.length !== observed.length || nextObserved.some((el, i) => el !== observed[i])) {
              resize.disconnect(); observed = nextObserved; observed.forEach(el => resize.observe(el));
            }
            if (!navigating || document.hidden || !document.hasFocus() || !visible(element)
              || (right && !ctx.sidebarRight.isExpanded())
              || (!scope && !right && layout.frame?.hasAttribute("data-rightbar-fullscreen"))
              || (!scope && area === "sidebar" && layout.frame?.hasAttribute("data-sidebar-collapsed"))) { update(null); return; }
            const rect = element.getBoundingClientRect();
            const left = Math.max(0, rect.left), top = Math.max(0, rect.top), width = Math.min(innerWidth, rect.right) - left;
            if (width < 48 || rect.bottom <= top || top >= innerHeight) { update(null); return; }
            update({ key: `${mounted()}:${scope ? "settings" : right ? captured?.paneId : area}`, area: scope ? "settings" : area, left, top, width });
          };
          const schedule = () => { if (!stopped && !frameId) frameId = requestAnimationFrame(measure); };
          const resize = new ResizeObserver(schedule);
          const markers = 'dialog, [aria-modal="true"], [data-dockkit-pane], [data-sidebar-right-panel], [data-rightbar-col]';
          const mutations = new MutationObserver(records => {
            if (records.some(record => !own(record.target) && (record.type === "attributes"
              || [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && !own(node)
                && (node.matches(markers) || node.querySelector(markers)))))) schedule();
          });
          mutations.observe(document.body, { subtree: true, childList: true, attributes: true,
            attributeFilter: ["open", "aria-modal", "data-sidebar-collapsed", "data-rightbar-fullscreen", "data-sidebar-right-open", "data-sidebar-right-panel"] });
          const off = subscribe(schedule);
          window.addEventListener("resize", schedule);
          window.addEventListener("focus", schedule);
          window.addEventListener("blur", schedule);
          document.addEventListener("visibilitychange", schedule);
          schedule();
          return () => {
            stopped = true; cancelAnimationFrame(frameId); resize.disconnect(); mutations.disconnect(); off();
            window.removeEventListener("resize", schedule); window.removeEventListener("focus", schedule); window.removeEventListener("blur", schedule);
            document.removeEventListener("visibilitychange", schedule);
          };
        }, []);
        return navigating && cue && h("div", { key: cue.key, className: "sc-focus-cue", "aria-hidden": true, "data-sc-focus-area": cue.area,
          style: { left: cue.left, top: cue.top, width: cue.width } });
      }

      function Preferences() {
        React.useSyncExternalStore(subscribe, () => revision);
        React.useSyncExternalStore(fn => ctx.shortcuts.catalog.subscribe(fn), () => ctx.shortcuts.catalog.getSnapshot());
        const [draft, setDraft] = React.useState(() => structuredClone(config));
        const [expected, setExpected] = React.useState(raw);
        const [message, setMessage] = React.useState(storageError);
        const [recording, setRecording] = React.useState(false);
        const [candidate, setCandidate] = React.useState();
        const [nativeMessage, setNativeMessage] = React.useState("");
        const [busy, setBusy] = React.useState(false);
        const capture = React.useRef(null), recordingToken = React.useRef(0), nativeRevision = React.useRef();
        React.useEffect(() => {
          let live = true;
          const stop = () => {
            recordingToken.current++;
            if (live) setRecording(false);
            return ctx.shortcuts.recording(false).catch(() => {});
          };
          stopRecording = stop;
          return () => { live = false; stop(); stopRecording = () => {}; };
        }, []);
        React.useEffect(() => { if (recording) capture.current?.focus(); }, [recording]);
        const start = async () => {
          const token = ++recordingToken.current;
          setNativeMessage(""); setCandidate(undefined);
          nativeRevision.current = ctx.shortcuts.config.getSnapshot().revision;
          try {
            await ctx.shortcuts.recording(true);
            if (token !== recordingToken.current || !alive) { await ctx.shortcuts.recording(false); return; }
            setRecording(true);
          } catch { setNativeMessage("当前无法录制快捷键，原有快捷键保持有效。"); }
        };
        const record = event => {
          if (!recording) return;
          event.preventDefault(); event.stopPropagation();
          if (event.key === "Escape") { stopRecording(); setNativeMessage("已取消录制"); return; }
          if (event.isComposing || /^(Meta|Control|Shift|Alt)$/.test(event.key)) return;
          if (!event.metaKey && !event.ctrlKey && !event.altKey) { setNativeMessage("返回导航需要带 ⌘、Ctrl 或 Option，避免占用内容中的单键。"); return; }
          const modifiers = [];
          if (event.metaKey) modifiers.push("primary");
          if (event.ctrlKey) modifiers.push("control");
          if (event.altKey) modifiers.push("alt");
          if (event.shiftKey) modifiers.push("shift");
          try {
            const described = ctx.shortcuts.describeBinding({ code: event.code, modifiers });
            const conflicts = described.conflicts.filter(id => id !== RETURN_ID);
            if (described.issue || conflicts.length) {
              setNativeMessage(conflicts.length ? "这个组合已被 DSH 占用，请换一个。" : "这个组合不能作为返回导航快捷键。");
              return;
            }
            setCandidate(described); setNativeMessage(""); stopRecording();
          } catch { setNativeMessage("无法识别这个组合，请换一个。"); }
        };
        const saveNative = async reset => {
          if (busy || (!reset && !candidate)) return;
          setBusy(true); setNativeMessage("");
          await stopRecording();
          const operation = reset ? { type: "reset", id: RETURN_ID } : { type: "set", id: RETURN_ID, binding: candidate.binding };
          const result = await ctx.shortcuts.edit(operation, reset ? ctx.shortcuts.config.getSnapshot().revision : nativeRevision.current);
          if (!alive) return;
          setBusy(false);
          if (result.status === "saved") { setCandidate(undefined); setNativeMessage("已保存，下次启动仍然有效。"); }
          else setNativeMessage(result.status === "stale" ? "快捷键配置已变化，请重新录制。" : result.status === "conflict" ? "这个组合与其他快捷键冲突，原有键位保持有效。" : "保存失败，原有键位保持有效。");
        };
        const save = () => {
          const error = saveConfig(draft, expected);
          if (error) setMessage(error);
          else { setExpected(raw); setDraft(structuredClone(config)); setMessage("快捷键设置已保存"); }
        };
        return h("section", { className: "sc-preferences", "aria-labelledby": "sc-preferences-title" },
          h("h2", { id: "sc-preferences-title" }, "Shortcutter"),
          h("div", { className: "sc-settings-body" },
            h("section", { className: "sc-preference-section" },
              h("h3", null, "返回导航"),
              h("p", null, `左侧栏和对话中按 Esc 返回导航；终端、网页使用下面的组合键。${config.bindings.enter ? `按 ${config.bindings.enter}` : "点击"}进入内容。`),
              h("p", { className: "sc-muted" }, "弹窗、菜单和输入法优先处理 Esc。对话生成中保留双 Esc 停止输出，也可用下面的组合键返回导航。"),
              h("div", { className: "sc-native-row" }, h("span", { className: "sc-native-key", "data-sc-return": "" }, returnLabel()),
                h("button", { type: "button", onClick: start, disabled: busy || recording }, "更改"),
                h("button", { type: "button", onClick: () => saveNative(true), disabled: busy || recording }, "恢复 ⌘ J")),
              recording && h("input", { ref: capture, className: "sc-capture", readOnly: true, value: "", placeholder: "按下新组合 · Esc 取消", "aria-label": "录制返回导航快捷键", onKeyDown: record }),
              candidate && h("div", { className: "sc-native-row" }, h("span", null, "新组合：", candidate.keys.join(" ")), h("button", { type: "button", disabled: busy, onClick: () => saveNative(false) }, "保存组合")),
              h("p", { className: "sc-status", role: "status" }, nativeMessage)),
            h("section", { className: "sc-preference-section" },
              h("h3", null, "导航习惯"),
              h("label", { className: "sc-check" }, h("input", { type: "checkbox", checked: draft.autoNavigate, onChange: e => setDraft({ ...draft, autoNavigate: e.target.checked }) }), h("span", null, "默认进入导航态；输入框有焦点时退出，失焦后自动恢复")),
              h("p", null, "设置页也使用这个规则。终端、网页、菜单保留原操作。面板左上角的小点表示当前导航目标；提示仅在按下 g 等待后续键，或按 ? 主动查看时显示，执行动作后收起。")),
            h("section", { className: "sc-preference-section" },
              h("div", { className: "sc-section-heading" }, h("h3", null, "导航键位"), h("button", { type: "button", onClick: () => setDraft({ ...draft, bindings: defaultConfig().bindings }) }, "恢复默认键位")),
              h("p", null, "单键区分大小写。[ / ] 按右侧标签栏顺序切换上一个 / 下一个标签。b / t 在已打开的浏览器 / 终端间循环切换；从其他区域按下时先回到最近使用的标签。B / T 新建后保持导航态，按 i 或点击内容进入输入。组合键依次按下，例如 g a、g s。留空可取消绑定。"),
              h("div", { className: "sc-binding-list" }, COMMANDS.map(command => h("label", { className: "sc-binding-row", key: command.id }, h("span", null, command.label), h("input", { "aria-label": command.label, value: draft.bindings[command.id], placeholder: "未绑定", maxLength: 16, spellCheck: false, autoCapitalize: "off", autoComplete: "off", onChange: e => setDraft({ ...draft, bindings: { ...draft.bindings, [command.id]: e.target.value } }) })))),
              h("p", { className: "sc-muted" }, "g · 跳转，? · 提示，Esc · 返回一层。这三个入口固定保留。Space 保持原有操作。"))),
          h("footer", { className: "sc-preferences-footer" }, h("p", { role: "status", className: "sc-status" }, message), h("button", { type: "button", className: "sc-primary", onClick: save, disabled: recording || busy }, "保存设置")));
      }

      function Panel() {
        React.useSyncExternalStore(subscribe, () => revision);
        React.useSyncExternalStore(fn => ctx.shortcuts.catalog.subscribe(fn), () => ctx.shortcuts.catalog.getSnapshot());
        const token = pending?.id, sessionId = mounted(), currentTab = ctx.sidebarRight.active();
        const terminalTab = pending && currentTab?.kind === "terminal" && ctx.sidebarRight.isExpanded() ? currentTab : undefined;
        const model = React.useMemo(() => terminalTab && ctx.webTerminals.view(sessionId, terminalTab.id, terminalTab.contentId), [sessionId, terminalTab?.id, terminalTab?.contentId]);
        const state = React.useSyncExternalStore(fn => model ? model.state.subscribe(fn) : () => {}, () => model?.state.getSnapshot());
        const session = pending ? ctx.sessions.binding(sessionId)?.session : undefined;
        const subscribeSession = React.useCallback(fn => session ? session.subscribe(fn) : () => {}, [session]);
        const openState = React.useSyncExternalStore(subscribeSession, () => session?.getSnapshot().openState);
        const [committed, setCommitted] = React.useState();
        React.useEffect(() => {
          if (!pending || pending.id !== token) return;
          if (pending.session !== mounted()) { cancelPending(); return; }
          if (pending.toolTarget) {
            const context = navigationContext(), focused = ctx.sidebarRight.focusedTarget(context.active);
            // Retained terminal state can be writable before its lazy view has
            // mounted. Wait for that view, then a commit, so its own autofocus
            // finishes before this single return-to-navigation handoff.
            const contentReady = !model || [...document.querySelectorAll('.xterm textarea')].some(element => {
              const owner = ctx.sidebarRight.focusedTarget(element);
              return visible(element) && owner?.sessionId === pending.session
                && owner?.tabId === pending.toolTarget.tabId && owner?.occurrence === pending.toolTarget.occurrence;
            });
            const status = toolHandoffStatus({ request: pending.toolTarget, sessionId: mounted(), activeTabId: currentTab?.id,
              current: ctx.sidebarRight.isTargetCurrent(pending.toolTarget), reason: context.reason,
              ownsFocus: focused?.tabId === pending.toolTarget.tabId && focused?.sessionId === pending.session,
              idleFocus: context.active === document.body || own(context.active), originFocus: context.active === pending.origin,
              editingHeader: isNavigationInput(context.active) && !!context.active.closest('[data-dockkit-strip], [data-dockkit-float-grip]'),
              contentReady,
              terminalState: model ? state || { writable: false } : undefined });
            if (status === "cancel" || context.scope) { cancelPending(); return; }
            if (status === "wait") return;
          }
          if (sessionId && openState !== "open" && openState !== "error") return;
          if (model && !state?.writable && !["closed", "failed"].includes(state?.phase) && state?.info?.state !== "exited") return;
          // Wait for public readiness and one additional plugin-owned React commit.
          // There is no host focus-ready contract; never chase subsequent focus.
          if (committed !== token) { setCommitted(token); return; }
          take(token);
        }, [token, sessionId, currentTab?.id, openState, state?.writable, state?.phase, state?.info?.state, committed, revision]);
        const row = returnRow(), available = row?.binding && !row.issue && !row.conflicts?.length;
        const items = COMMANDS.filter(c => {
          const key = config.bindings[c.id];
          return prefix ? key.startsWith(prefix + " ") : key && !key.includes(" ");
        });
        const keepFocus = event => { if (event.pointerType !== "touch") event.preventDefault(); };
        const overlay = h("div", { className: "sc-root", ref: el => { layer = el; } },
          h(FocusCue),
          navigating && (hints || prefix) && h("section", { className: "sc-panel", "aria-label": "导航快捷键" },
            h("header", { className: "sc-panel-header" }, h("span", { className: "sc-panel-title" }, h("span", { className: "sc-dot", "aria-hidden": true }), prefix === "g" ? "跳转" : "导航"), h("span", { className: "sc-muted" }, navigationScope ? "设置" : areas[area] || "工具面板"),
              h("button", { type: "button", className: "sc-icon-button", "aria-label": "打开 DSH 设置", title: "打开 DSH 设置", onPointerDown: keepFocus, onClick: () => run("settings") }, "⚙")),
            h("div", { className: "sc-grid" }, items.map(c => h("button", { type: "button", className: "sc-key-row", key: c.id, "data-sc-command": c.id, onPointerDown: keepFocus, onClick: () => run(c.id) }, h("span", { className: "sc-keys" }, keyCaps(prefix ? config.bindings[c.id].split(" ")[1] : config.bindings[c.id])), h("span", null, c.label)))),
            !prefix && h("div", { className: "sc-prefix-row" }, [ ["g", "跳转"] ].map(([key, label]) => h("button", { type: "button", key, onPointerDown: keepFocus, onClick: () => { prefix = key; hints = false; (navigationScope || anchor).focus({ preventScroll: true }); publish(); } }, h("span", { className: "sc-keys" }, keyCaps(key)), label, h("span", { className: "sc-chevron", "aria-hidden": true }, "›")))),
            h("footer", { className: "sc-panel-footer" }, h("span", null, prefix ? "依次按键" : area === "sidebar" ? "侧栏内 Esc 返回" : area === "conversation" ? "对话内 Esc 返回" : `${returnLabel()} 返回导航`), h("span", null, "esc ", prefix ? "返回" : "收起"))));
        return h("div", { className: "sc-root", ref: el => { root = el; }, "data-sc-navigation": navigating ? "true" : "false", "data-sc-area": navigationScope ? "settings" : area, "data-sc-prefix": prefix },
          h("div", { id: "sc-navigation-anchor", ref: el => { anchor = el; }, className: "sc-anchor", tabIndex: -1, role: "group", "aria-label": `导航模式，问号显示快捷键，${config.bindings.enter || "点击"}进入内容` }),
          navigationScope ? createPortal(overlay, navigationScope) : overlay,
          !navigating && !available && h("button", { type: "button", className: "sc-peek", onClick: () => take(undefined, true) }, "进入导航"),
          notice && h("div", { role: "status", className: "sc-notice" }, notice));
      }

      ctx.effect(() => {
        const style = document.createElement("style"); style.dataset.shortcutter = ""; style.textContent = STYLE; document.head.append(style);
        return () => style.remove();
      }, "shortcutter.style");
      ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "shortcutter", order: 999 }, Panel)), "shortcutter.overlay");
      ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section", id: "shortcutter", order: 80, label: "Shortcutter"
      }, Preferences)), "shortcutter.settings");
      ctx.effect(() => {
        const command = {
          id: RETURN_ID, label: () => "Shortcutter · 返回导航", aliases: [],
          defaults: { "desktop:macos": { code: "KeyJ", modifiers: ["primary"] } },
          regions: ["page", "editable", "terminal"], modals: ["settings"],
          resolve: () => ["menu", "modal", "inactive", "composition"].includes(navigationContext().reason)
            ? { status: "blocked", reason: "modal" } : { status: "handled", run: () => take(undefined, true) }
        };
        try { return ctx.shortcuts.register(command); }
        catch {
          // Another plugin may have claimed the default. Keep a visible entry and
          // let the user choose a free combination in the official registry.
          try { return ctx.shortcuts.register({ ...command, defaults: {} }); }
          catch { return () => {}; }
        }
      }, "shortcutter.return");
      ctx.effect(() => ctx.shortcuts.observeFixedInput(input => {
        if (input.type === "reset") {
          // The host also resets on pointerdown/focusin. Let our own controls
          // finish those events, so the menu stays mounted until their click.
          const reset = ++inputReset;
          clearTimeout(resetTimer);
          resetTimer = setTimeout(() => {
            if (alive && reset === inputReset && (prefix || hints)) { prefix = ""; hints = false; publish(); }
          }, 0);
          return;
        }
        const { gesture: g, context: c } = input;
        if (c.target !== anchor && !own(c.target) && !g.meta && !g.control && !g.alt && !/^(Shift|Control|Meta|Alt)/.test(g.code)) {
          firstNavigation = false;
          if (pending) cancelPending();
        }
        if (g.composing || g.defaultPrevented || g.repeat || g.control || g.meta || g.alt) return;
        if (!navigating && g.code !== "Escape" && (isNavigationInput(c.target) || isNavigationContent(c.target))) return;
        const context = navigationObserver?.refresh() || navigationContext();
        if (["menu", "modal", "inactive", "composition"].includes(context.reason)) return;
        // Modal Escape belongs to the host, except when dismissing our own
        // visible which-key layer (handled before the modal's key handler).
        if (g.code === "Escape" && context.scope) return;
        // Fixed input arrives after local controls. Only unclaimed Escape in
        // the shell sidebar/conversation returns focus; tools retain their keys.
        if (!navigating && g.code === "Escape" && !g.shift && !own(c.target) && c.region !== "terminal"
          && c.target instanceof Element && c.target === document.activeElement
          && !c.target.closest('[data-approval-key], iframe, webview, .xterm, [inert]')) {
          const layout = columns();
          const from = layout.sidebar?.contains(c.target) ? "sidebar"
            : layout.conversation?.contains(c.target) ? "conversation"
            : c.target === document.body && ["sidebar", "conversation"].includes(area) ? area : undefined;
          if (from) {
            const sessionId = c.target.closest("[data-conversation-session]")?.getAttribute("data-conversation-session") || mounted();
            // Keep the host's double-Escape stop sequence even if observer
            // registration order changes after a plugin reload.
            if (from === "conversation" && ctx.sessions.binding(sessionId)?.session.getSnapshot().running) return;
            input.consume(); area = from; target = undefined; take();
            return;
          }
        }
        if (!context.navigating || c.target !== document.activeElement || nativeNavigationKey(c.target, g.code)) return;
        const result = resolveSequence(config.bindings, prefix, tokenFromGesture(g));
        if (!result.consume) return;
        inputReset++; input.consume(); prefix = result.prefix;
        hints = result.toggleHints ? !hints : false;
        if (result.command) run(result.command);
        publish();
      }), "shortcutter.local-keys");
      ctx.effect(() => {
        const changed = () => {
          const id = mounted();
          if (seenSession && id === lastSession) return;
          seenSession = true;
          if (lastSession) previousSession = lastSession;
          lastSession = id; area = "conversation"; target = undefined;
          requestNavigation();
        };
        const off = ctx.sidebarRight.mounted.subscribe(changed); changed();
        return off;
      }, "shortcutter.session");
      ctx.effect(() => {
        let timer, disposed = false, inventory;
        const read = () => {
          if (disposed) return;
          const nextInventory = ctx.sidebarRight.openTabs.getSnapshot();
          if (inventory !== nextInventory) {
            inventory = nextInventory; toolHistory.reconcile(inventory);
          }
          rememberActiveTool();
          if (!pending && !navigationContext().scope) rememberArea(document.activeElement);
          // Also lets a pending tool handoff observe its committed host pane.
          publish(!!pending);
        };
        const schedule = () => { clearTimeout(timer); timer = setTimeout(read, 0); };
        const markers = '[data-dockkit-tab], [data-dockkit-pane], [data-dockkit-float], [data-sidebar-right-tab]';
        const observer = new MutationObserver(records => {
          if (records.some(record => !own(record.target) && (record.type === "attributes"
            || pending?.toolTarget || [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element
              && (node.matches(markers) || node.querySelector(markers)))))) schedule();
        });
        observer.observe(document.body, { subtree: true, childList: true, attributes: true,
          attributeFilter: ["aria-selected", "data-dockkit-pane-active", "data-dockkit-float-active", "data-sidebar-right-open"] });
        const focused = event => {
          const captured = ctx.sidebarRight.focusedTarget(event.target);
          if (captured) toolHistory.remember(captured.sessionId, captured.tabId, tabs());
          if (pending?.toolTarget && !own(event.target) && event.target !== pending.origin
            && event.target !== document.body && captured?.tabId !== pending.toolTarget.tabId) cancelPending();
          schedule();
        };
        const off = ctx.sidebarRight.openTabs.subscribe(schedule);
        const clicked = event => {
          if (pending || event.target.closest?.('[data-sidebar-right-session]')) schedule();
        };
        document.addEventListener("focusin", focused, true);
        document.addEventListener("click", clicked, true);
        read();
        return () => { disposed = true; clearTimeout(timer); observer.disconnect(); off();
          document.removeEventListener("focusin", focused, true); document.removeEventListener("click", clicked, true); };
      }, "shortcutter.tool-history");
      ctx.effect(() => {
        navigationObserver = observeNavigationContext(document, {
          read: navigationContext,
          ignore: own,
          changed: next => {
            if (own(next.active)) inputReset++;
            if (["input", "content"].includes(next.reason)) manualNavigation = false;
            if (!next.scope && !pending) rememberArea(next.active);
            if (!next.navigating || navigationScope !== next.scope) { prefix = ""; hints = false; }
            navigationScope = next.scope;
            navigating = next.navigating;
            publish();
          }
        });
        const pointer = event => {
          if (own(event.target)) { inputReset++; return; }
          firstNavigation = false;
          cancelPending(); prefix = ""; hints = false;
          const context = navigationContext();
          if (!context.scope && !["menu", "modal"].includes(context.reason)) {
            rememberArea(event.target);
            if (columns().right?.contains(event.target) && !ctx.sidebarRight.focusedTarget(event.target)) {
              area = ctx.sidebarRight.active()?.kind || "right";
              target = ctx.sidebarRight.commandTarget(null);
            }
          }
          publish();
        };
        const modalEscape = event => {
          if (event.key !== "Escape") return;
          const context = navigationObserver.refresh();
          if (!context.scope || !context.navigating || (!prefix && !hints)
            || event.defaultPrevented || event.isComposing || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
          event.preventDefault(); event.stopPropagation();
          inputReset++; prefix = ""; hints = false; publish();
        };
        // The initial activation retains the existing one-shot handoff. Later
        // activation only observes the focused control; it never moves focus.
        const activate = () => { if (firstNavigation) requestNavigation(); else navigationObserver.refresh(); };
        const blur = () => { cancelPending(); prefix = ""; hints = false; navigating = false; publish(); };
        const storage = event => {
          if (event.key !== STORAGE_KEY || event.storageArea !== localStorage) return;
          raw = event.newValue;
          const loaded = readConfig(raw);
          if (loaded.config) { config = loaded.config; storageError = loaded.notice || ""; }
          else storageError = loaded.error;
          prefix = ""; hints = false; cancelPending(); navigationObserver.refresh(); publish();
        };
        document.addEventListener("keydown", modalEscape, true);
        document.addEventListener("pointerdown", pointer, true);
        const stopHeaderNavigation = observeToolHeaderNavigation(document, {
          enabled: () => config.autoNavigate,
          blocked: () => {
            const context = navigationObserver.refresh();
            return !!context.scope || ["menu", "modal", "inactive", "composition"].includes(context.reason);
          },
          headerFor: element => {
            const captured = ctx.sidebarRight.focusedTarget(element);
            return captured && navigationToolHeader(element, { sessionId: mounted(), kind: tabs().find(tab => tab.tabId === captured.tabId)?.kind });
          },
          capture: element => ctx.sidebarRight.focusedTarget(element),
          current: captured => !!captured.tabId && ctx.sidebarRight.active()?.id === captured.tabId && ctx.sidebarRight.isTargetCurrent(captured),
          navigate: captured => {
            target = captured;
            area = tabs().find(tab => tab.tabId === captured.tabId)?.kind || "right";
            toolHistory.remember(captured.sessionId, captured.tabId, tabs());
            requestNavigation(captured);
          }
        });
        window.addEventListener("focus", activate);
        window.addEventListener("blur", blur);
        window.addEventListener("storage", storage);
        return () => {
          alive = false; stopRecording(); stopHeaderNavigation(); navigationObserver.dispose();
          document.removeEventListener("keydown", modalEscape, true); document.removeEventListener("pointerdown", pointer, true);
          window.removeEventListener("focus", activate); window.removeEventListener("blur", blur); window.removeEventListener("storage", storage);
          clearTimeout(pendingTimer); clearTimeout(noticeTimer); clearTimeout(resetTimer); pending = undefined; listeners.clear();
          if (own(document.activeElement) && visible(returnElement)) returnElement.focus({ preventScroll: true });
        };
      }, "shortcutter.lifecycle");
    }
    return { inject, apply };
  }
});
