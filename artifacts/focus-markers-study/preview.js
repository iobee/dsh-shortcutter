(() => {
  'use strict';
  const workspace = $('workspace');
  const root = document.documentElement;
  const marker = document.createElement('div');
  marker.className = 'study-focus';
  marker.setAttribute('aria-hidden', 'true');
  marker.hidden = true;
  marker.dataset.edge = 'top';
  // The focus layer is a sibling of the host UI, never a child of a tool.
  document.body.append(marker);

  const variants = {
    dot: { name: '固定角点', spec: '5 px · 左上角' },
    short: { name: '边缘短标', spec: '2 × 20 px · 左边缘' },
    edge: { name: '单边强调', spec: '1 px · 整条边' }
  };
  const requested = new URLSearchParams(location.search).get('style');
  let variant = Object.hasOwn(variants, requested) ? requested : 'dot';
  let pendingFrame = 0;

  function currentPane() {
    return state.area === 'left' ? 'left' : ['right', 'terminal', 'address', 'browser'].includes(state.area) ? 'right' : 'chat';
  }

  function measure() {
    pendingFrame = 0;
    const target = $(currentPane());
    const rect = target.getBoundingClientRect();
    const bounds = workspace.getBoundingClientRect();
    const left = Math.max(0, bounds.left, rect.left);
    const top = Math.max(0, bounds.top, rect.top);
    const right = Math.min(innerWidth, bounds.right, rect.right);
    const bottom = Math.min(innerHeight, bounds.bottom, rect.bottom);
    marker.hidden = !readingAreas.includes(state.area) || document.hidden || !!document.querySelector('dialog[open]')
      || right - left < 48 || bottom - top < 48 || getComputedStyle(target).display === 'none';
    marker.dataset.pane = target.id;
    if (marker.hidden) return;
    Object.assign(marker.style, { left: left + 'px', top: top + 'px', width: right - left + 'px', height: bottom - top + 'px' });
  }

  function schedule() {
    if (!pendingFrame) pendingFrame = requestAnimationFrame(measure);
  }

  function updateControls() {
    const navigation = readingAreas.includes(state.area);
    const pane = currentPane();
    $('study-target').value = pane === 'right' ? panel().active : pane;
    const canEnter = pane === 'chat' || pane === 'right' && ['browser', 'terminal'].includes(panel().active);
    $('mode-toggle').disabled = navigation && !canEnter;
    $('mode-toggle').textContent = !navigation ? '返回导航' : canEnter ? '进入内容' : '无输入控件';
    $('mode-toggle').setAttribute('aria-pressed', String(!navigation));
    const dark = root.dataset.theme === 'dark';
    $('theme-toggle').innerHTML = icon(dark ? 'light' : 'dark') + '<span>' + (dark ? '亮色' : '暗色') + '</span>';
    const end = document.querySelector('.status-end > span');
    if (end) end.innerHTML = '<span class="study-spec">' + variants[variant].spec + '</span>　1 / 2 / 3 切换方案';
    schedule();
  }

  function chooseVariant(next, restoreFocus = true) {
    variant = next;
    marker.dataset.variant = next;
    document.querySelectorAll('[data-variant]').forEach(button => {
      if (button.tagName === 'BUTTON') button.setAttribute('aria-pressed', String(button.dataset.variant === next));
    });
    $('study-edge').disabled = next !== 'edge';
    if (restoreFocus) focusArea(validArea(state.area), false);
    updateControls();
  }

  const originalModeChanged = readingModeChanged;
  readingModeChanged = (previous, next) => {
    originalModeChanged(previous, next);
    updateControls();
  };
  autoKeyHints = false;
  hideWhichKey();
  clearRegionHint();

  document.querySelectorAll('.study-variants button').forEach(button => {
    button.addEventListener('click', () => chooseVariant(button.dataset.variant));
  });
  $('study-target').addEventListener('change', event => {
    const area = event.target.value;
    hideWhichKey();
    if (area === 'left') {
      state.leftOpen = true;
      state.maximized = false;
      layout();
      focusArea('left');
    } else if (area === 'chat') focusArea('chat');
    else openTool(area);
  });
  $('study-edge').addEventListener('change', event => {
    marker.dataset.edge = event.target.value;
    focusArea(validArea(state.area), false);
    schedule();
  });
  $('theme-toggle').addEventListener('click', updateControls);
  $('mode-toggle').addEventListener('click', () => {
    hideWhichKey();
    if (readingAreas.includes(state.area)) enterInput();
    else focusArea(currentPane());
  });

  function handleStudyKey(key, repeat = false) {
    if (!readingAreas.includes(state.area) || keyLayer || document.querySelector('dialog[open]')) return false;
    const next = { '1': 'dot', '2': 'short', '3': 'edge' }[key];
    if (!next && key !== '[' && key !== ']') return false;
    if (!repeat) {
      if (next) chooseVariant(next);
      else cycleTabs(key === '[' ? -1 : 1);
    }
    return true;
  }
  // The offline iframe forwards navigation keys through this host adapter.
  const originalReadingKey = handleReadingKey;
  handleReadingKey = (key, repeat) => handleStudyKey(key, repeat) || originalReadingKey(key, repeat);

  // Study-only shortcuts. Never intercept typing, IME, dialogs, or prefix keys.
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || composing || event.keyCode === 229
      || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey
      || !readingAreas.includes(state.area) || keyLayer || document.querySelector('dialog[open]')
      || event.target.matches('input, textarea, select') || event.target.isContentEditable) return;
    if (!handleStudyKey(event.key, event.repeat)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  const resize = new ResizeObserver(schedule);
  [workspace, $('left'), $('chat'), $('right')].forEach(element => resize.observe(element));
  const layoutChanges = new MutationObserver(schedule);
  layoutChanges.observe(workspace, { attributes: true, attributeFilter: ['class', 'data-focus'] });
  const dialogs = new MutationObserver(schedule);
  dialogs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  window.addEventListener('resize', schedule);
  document.addEventListener('visibilitychange', schedule);
  document.addEventListener('scroll', schedule, true);
  chooseVariant(variant, false);
})();
