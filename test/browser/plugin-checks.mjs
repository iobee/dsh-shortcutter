import assert from 'node:assert/strict';

export async function pluginChecks(createPage) {
  const results = [];
  const settle = page => page.waitForTimeout(60);
  const ready = page => page.waitForFunction(() => window.pluginState().pending === undefined && document.activeElement.id === 'sc-navigation-anchor', null, { timeout: 2500 });
  const key = (page, code, extra = {}) => page.evaluate(({ code, extra }) => window.fixture.emitKey({ code, ...extra }), { code, extra });
  async function check(name, run, options = {}) {
    const page = await createPage(options);
    try { await run(page); results.push({ name, pass: true }); }
    catch (error) { results.push({ name, pass: false, error: String(error) }); }
    finally { await page.close(); }
  }
  await check('initial ready session takes navigation once and releases the session subscription', async page => {
    await ready(page);
    assert.equal(await page.evaluate(() => window.fixture.session.listenerCount()), 0);
    await page.locator('#composer').focus(); await settle(page);
    await page.evaluate(() => window.fixture.session.set({ openState: 'open', running: true })); await settle(page);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'composer');
  });
  await check('cold session waits for openState, ignores unrelated updates, then completes the handoff', async page => {
    assert.ok(await page.evaluate(() => window.pluginState().pending));
    assert.equal(await page.evaluate(() => window.fixture.session.listenerCount()), 1);
    await page.evaluate(async () => {
      window.counts = {};
      for (let i = 0; i < 10; i++) { window.fixture.session.set({ openState: 'loading', running: false, loadingOlder: !!(i % 2) }); await new Promise(resolve => setTimeout(resolve, 5)); }
    }); await settle(page);
    assert.equal(await page.evaluate(() => window.counts.panelRender || 0), 0);
    await page.evaluate(() => window.fixture.session.set({ openState: 'open', running: false })); await ready(page);
    assert.equal(await page.evaluate(() => window.fixture.session.listenerCount()), 0);
  }, { openState: 'loading' });
  await check('session error readiness also completes the one-shot handoff', async page => {
    await page.evaluate(() => window.fixture.session.set({ openState: 'error', running: false })); await ready(page);
  }, { openState: 'loading' });
  await check('input, repeat, composing, modified and already-handled keys preserve the draft without scans', async page => {
    await ready(page); await page.locator('#composer').focus(); await settle(page);
    const result = await page.evaluate(() => {
      const input = document.getElementById('composer'); input.setSelectionRange(1, 3); window.counts = {};
      const consumed = [{}, { repeat: true }, { composing: true }, { meta: true }, { control: true }, { alt: true }, { defaultPrevented: true }]
        .map(flags => window.fixture.emitKey({ code: 'KeyG', ...flags }));
      return { consumed, reads: window.counts.navigationRead || 0, text: input.value, start: input.selectionStart, end: input.selectionEnd };
    });
    assert.deepEqual(result, { consumed: Array(7).fill(false), reads: 0, text: 'draft', start: 1, end: 3 });
  });
  await check('unclaimed Escape returns from the conversation input', async page => {
    await ready(page); await page.locator('#composer').focus(); await settle(page);
    assert.equal(await key(page, 'Escape'), true); await ready(page);
  });
  await check('running conversation retains the native double-Escape path', async page => {
    await ready(page); await page.locator('#composer').focus();
    await page.evaluate(() => window.fixture.session.set({ openState: 'open', running: true })); await settle(page);
    assert.equal(await key(page, 'Escape'), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'composer');
  });
  await check('g prefix, cancellation and help remain visible with deduplicated publication', async page => {
    await ready(page); assert.equal(await key(page, 'KeyG'), true); await settle(page);
    assert.equal(await page.locator('.sc-panel').count(), 1);
    assert.equal(await page.evaluate(() => window.pluginState().prefix), 'g');
    await key(page, 'Escape'); await settle(page); assert.equal(await page.locator('.sc-panel').count(), 0);
    await key(page, 'Slash', { shift: true }); await settle(page); assert.equal(await page.locator('.sc-panel').count(), 1);
    await key(page, 'Escape'); await settle(page); assert.equal(await page.locator('.sc-panel').count(), 0);
  });
  await check('menu insertion suspends keys without focus movement and removal resumes navigation', async page => {
    await ready(page);
    await page.evaluate(() => { const menu = document.createElement('div'); menu.id = 'menu'; menu.role = 'menu'; menu.textContent = 'native'; document.body.append(menu); }); await settle(page);
    assert.equal(await key(page, 'KeyG'), false); assert.equal(await page.evaluate(() => window.pluginState().navigating), false);
    await page.evaluate(() => document.getElementById('menu').remove()); await settle(page);
    assert.equal(await key(page, 'KeyG'), true);
  });
  await check('settings and nested native modal retain their navigation boundaries', async page => {
    await ready(page);
    await page.evaluate(() => { const dialog = document.createElement('dialog'); dialog.id = 'settings'; dialog.dataset.shortcutModal = 'settings'; dialog.innerHTML = '<button id="settings-button">OK</button><input id="settings-input">'; document.body.append(dialog); dialog.showModal(); }); await settle(page);
    assert.equal(await page.evaluate(() => window.pluginState().navigating), true);
    await page.locator('#settings-input').focus(); await settle(page); assert.equal(await key(page, 'KeyG'), false);
    await page.locator('#settings-button').focus(); await key(page, 'KeyG'); await settle(page); assert.equal(await page.locator('#settings .sc-panel').count(), 1);
    await page.keyboard.press('Escape'); await settle(page); assert.equal(await page.locator('#settings .sc-panel').count(), 0);
    assert.equal(await page.evaluate(() => document.getElementById('settings').open), true);
    await page.evaluate(() => { const dialog = document.createElement('dialog'); dialog.id = 'confirm'; dialog.textContent = 'confirm'; document.body.append(dialog); dialog.showModal(); }); await settle(page);
    assert.equal(await key(page, 'KeyG'), false);
  });
  await check('composition target removal recovers navigation without a compositionend', async page => {
    await ready(page); await page.locator('#composer').focus();
    await page.evaluate(() => { const el = document.getElementById('composer'); el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); el.remove(); }); await settle(page);
    assert.equal(await page.evaluate(() => window.pluginState().navigating), true); assert.equal(await key(page, 'KeyG'), true);
  });
  for (const autofocus of [false, true]) await check(`new terminal waits for writable state and a mounted view (autofocus=${autofocus})`, async page => {
    await ready(page); await key(page, 'KeyT', { shift: true }); await settle(page);
    assert.ok(await page.evaluate(() => window.pluginState().pending));
    await page.evaluate(() => window.fixture.terminal.set({ writable: true, phase: 'connected' })); await settle(page);
    assert.ok(await page.evaluate(() => window.pluginState().pending), 'Writable model alone must not complete');
    await page.evaluate(autofocus => window.fixture.mountTerminal(autofocus), autofocus); await ready(page);
    await page.locator('#terminal-input').focus(); await settle(page);
    assert.equal(await key(page, 'Escape'), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'terminal-input');
  });
  await check('typing in a different input cancels a pending tool handoff', async page => {
    await ready(page); await key(page, 'KeyT', { shift: true }); await settle(page);
    await page.evaluate(() => { window.fixture.click('composer'); document.getElementById('composer').focus(); });
    await page.evaluate(() => { window.fixture.terminal.set({ writable: true, phase: 'connected' }); window.fixture.mountTerminal(); }); await settle(page);
    assert.equal(await page.evaluate(() => window.pluginState().pending), undefined);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'composer');
  });
  await check('stale tool occurrence cannot complete a pending handoff', async page => {
    await ready(page); await key(page, 'KeyT', { shift: true }); await settle(page);
    await page.evaluate(() => { window.fixture.invalidateTarget(); window.fixture.terminal.set({ writable: true, phase: 'connected' }); window.fixture.mountTerminal(); }); await settle(page);
    assert.equal(await page.evaluate(() => window.pluginState().pending), undefined);
  });
  await check('bracket tab switch and close keep navigation on the remaining current tool', async page => {
    await ready(page); await key(page, 'KeyB', { shift: true }); await ready(page);
    const second = await page.evaluate(() => window.fixture.sidebarRight.active().id); assert.notEqual(second, 'b1');
    await key(page, 'BracketLeft'); await ready(page); assert.equal(await page.evaluate(() => window.fixture.sidebarRight.active().id), 'b1');
    await key(page, 'BracketRight'); await ready(page); assert.equal(await page.evaluate(() => window.fixture.sidebarRight.active().id), second);
    await key(page, 'KeyW'); await ready(page); assert.equal(await page.evaluate(() => window.fixture.sidebarRight.active().id), 'b1');
  });
  await check('disabled auto-navigation can still be entered explicitly', async page => {
    await ready(page); await page.locator('#composer').focus(); await settle(page);
    await page.evaluate(() => {
      const bindings = { sidebar: 's', conversation: 'c', right: 'r', files: 'e', browser: 'b', terminal: 't', enter: 'i', newSession: 'n', newBrowser: 'B', newTerminal: 'T', closeTab: 'w', fullscreen: 'R', previous: 'g a', nextTab: ']', previousTab: '[', settings: 'g s' };
      const value = JSON.stringify({ version: 3, autoNavigate: false, bindings });
      localStorage.setItem('dsh.magic-shortcuts.v1', value);
      window.dispatchEvent(new StorageEvent('storage', { key: 'dsh.magic-shortcuts.v1', newValue: value, storageArea: localStorage }));
      document.getElementById('ordinary').focus();
    }); await settle(page);
    assert.equal(await key(page, 'KeyG'), false);
    await page.evaluate(() => window.fixture.navigate()); await ready(page); assert.equal(await key(page, 'KeyG'), true);
  });
  await check('no-op clicks do not re-render, while entering a different area still updates the cue', async page => {
    await ready(page); await page.locator('#ordinary').focus(); await settle(page);
    await page.evaluate(() => { window.counts = {}; window.fixture.click('ordinary'); }); await settle(page);
    assert.equal(await page.evaluate(() => window.counts.publish || 0), 0);
    await page.evaluate(() => window.fixture.click('sidebar')); await settle(page);
    assert.equal(await page.evaluate(() => window.pluginState().area), 'sidebar');
    assert.equal(await page.locator('[data-sc-focus-area="sidebar"]').count(), 1);
  });
  await check('dispose removes observers, subscriptions and scheduled work', async page => {
    await ready(page); await page.evaluate(() => window.fixture.dispose()); await settle(page);
    await page.evaluate(() => { window.counts = {}; document.getElementById('log').append(document.createElement('p')); window.fixture.session.set({ openState: 'open', running: true }); window.fixture.click('ordinary'); }); await settle(page);
    assert.deepEqual(await page.evaluate(() => ({ ...window.counts })), {});
    assert.equal(await page.evaluate(() => window.fixture.session.listenerCount()), 0);
  });
  return { passed: results.filter(result => result.pass).length, total: results.length, results };
}
