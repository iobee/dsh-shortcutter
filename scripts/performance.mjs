// Optional developer benchmark. Uses existing browser tooling; adds no runtime
// dependencies to the plugin. See README for the toolchain and browser options.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { html, setup } from '../test/browser/host-fixture.mjs';
import { pluginChecks } from '../test/browser/plugin-checks.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i].replace(/^--/, '');
  args[key] = process.argv[i + 1]?.startsWith('--') || !process.argv[i + 1] ? true : process.argv[++i];
}
const toolchain = path.resolve(args.toolchain || process.env.DSH_PERF_TOOLCHAIN || root);
const require = createRequire(import.meta.url);
async function dependency(name) {
  try { return require.resolve(name, { paths: [toolchain] }); } catch {}
  const pnpm = path.join(toolchain, 'node_modules/.pnpm');
  const entries = (await fs.readdir(pnpm).catch(() => [])).filter(nameOnDisk => nameOnDisk.startsWith(name.replace('/', '+') + '@'))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const entry of entries) {
    try { return require.resolve(name, { paths: [path.join(pnpm, entry, 'node_modules')] }); } catch {}
  }
  throw new Error(`Missing ${name}; pass --toolchain /path/to/an/existing/developer/toolchain. Nothing is installed automatically.`);
}
const [playwright, bundler, react, reactDOM] = await Promise.all(['playwright-core', 'esbuild', 'react', 'react-dom'].map(dependency));
const playwrightModule = await import(pathToFileURL(playwright));
const { chromium } = playwrightModule.default || playwrightModule;
const esbuild = await import(pathToFileURL(bundler));
const bundle = await esbuild.build({ stdin: { contents: `import React from ${JSON.stringify(react)};import * as ReactDOM from ${JSON.stringify(reactDOM)};import {createRoot} from ${JSON.stringify(path.join(path.dirname(reactDOM), 'client.js'))};window.React=React;window.ReactDOM=ReactDOM;window.createRoot=createRoot;`, resolveDir: root },
  bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"production"' } });
const candidateRoot = path.resolve(args.candidate || root);
const baselineRoot = path.resolve(args['baseline-root'] || root);
const baselineRef = args['baseline-ref'] || 'HEAD';
const git = (...gitArgs) => execFileSync('git', ['-C', baselineRoot, ...gitArgs], { encoding: 'utf8' });
const sourceFiles = ['src/client.js', 'src/core.js', 'src/default-navigation.js', 'src/tool-tabs.js', 'src/tool-navigation.js', 'src/styles.css'];
async function assemble(read) {
  const files = await Promise.all(sourceFiles.map(read));
  let source = files[0];
  for (const [i, marker] of ['CORE', 'NAVIGATION', 'TOOLS', 'TOOL_NAVIGATION'].entries()) source = source.replace(`/* BUILD_${marker} */`, files[i + 1].replace(/^export /gm, ''));
  return source.replace('/* BUILD_CSS */', `const STYLE = ${JSON.stringify(files[5])};`);
}
const candidate = await assemble(file => fs.readFile(path.join(candidateRoot, file), 'utf8'));
const baseline = args['checks-only'] ? undefined : await assemble(file => git('show', `${baselineRef}:${file}`));
function instrument(source) {
  for (const [needle, insert] of [
    ['revision++;', 'window.count("publish"); revision++;'],
    ['const columns = () => {', 'const columns = () => { window.count("columns");'],
    ['function Panel() {', 'function Panel() { window.count("panelRender");'],
    ['function FocusCue() {', 'function FocusCue() { window.count("cueRender");'],
    ['const measure = () => {', 'const measure = () => { window.count("cueMeasure");'],
    ['const read = () => {', 'const read = () => { window.count("historyRead");'],
    ['const active = doc.activeElement;', 'window.count("navigationRead"); const active = doc.activeElement;'],
    ['const observer = new win.MutationObserver(records => {', 'const observer = new win.MutationObserver(records => { window.count("navigationMutationBatch");']
  ]) {
    assert.equal(source.split(needle).length, 2, 'Unique instrumentation target: ' + needle);
    source = source.replace(needle, insert);
  }
  return source;
}
const executablePath = args.browser || process.env.DSH_PERF_BROWSER || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : chromium.executablePath());
const browser = await chromium.launch({ executablePath, headless: true });
const errors = [];
const report = { generatedAt: new Date().toISOString(), environment: { browser: browser.version(), react: require(path.join(path.dirname(react), 'package.json')).version,
  node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, viewport: '1280x800', existingOutputNodes: 2000 },
  sources: { baselineRef: baseline ? git('rev-parse', baselineRef).trim() : undefined,
    baselineSHA256: baseline && createHash('sha256').update(baseline).digest('hex'), candidateSHA256: createHash('sha256').update(candidate).digest('hex') },
  method: { timing: 'Uninstrumented production React and plugin. CDP TaskDuration / ScriptDuration deltas in milliseconds; includes fixture event dispatch and DOM work, excludes idle waits. One warm-up pair discarded, measured pairs alternate order.',
    counts: 'Separate instrumented run; publish counts actual subscriber notifications, not attempted calls. 100 updates are separate tasks, not one synchronous batch.',
    scope: 'Isolated browser with mock public host stores and 2000 output paragraphs; not DSH end-to-end FPS, memory, power or CPU percentage.' },
  checks: [], counts: {}, timings: {}, errors };
if (args['checks-file']) {
  const validation = JSON.parse(await fs.readFile(path.resolve(args['checks-file']), 'utf8'));
  assert.equal(validation.sources.candidateSHA256, report.sources.candidateSHA256, 'Validation must match the measured source');
  assert.ok(!validation.failure && !validation.errors.length && validation.checks.length);
  report.checks = validation.checks;
}
async function fixture(source, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('http://shortcutter-review.invalid/**', route => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto('http://shortcutter-review.invalid/');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(setup, options);
  if (options.debug) source = source.replace('function apply(ctx) {', 'function apply(ctx) { window.pluginState = () => ({ pending: pending?.id, navigating, area, prefix, hints });');
  await page.addScriptTag({ content: options.instrument ? instrument(source) : source });
  await page.waitForTimeout(100);
  return page;
}
const scenarios = [
  { id: 'idle', label: '空闲 200 ms', prepare: 'ordinary', kind: 'idle' },
  { id: 'output', label: '100 次无关内容节点新增', prepare: 'ordinary', kind: 'output' },
  { id: 'typing', label: '100 次输入区普通按键', prepare: 'composer', kind: 'key', gesture: { code: 'KeyA' } },
  { id: 'repeat', label: '100 次重复按键', prepare: 'composer', kind: 'key', gesture: { code: 'KeyA', repeat: true } },
  { id: 'modifier', label: '100 次带修饰键的按键', prepare: 'composer', kind: 'key', gesture: { code: 'KeyC', meta: true } },
  { id: 'click', label: '10 次同一普通按钮点击', prepare: 'ordinary', kind: 'click' },
  { id: 'session', label: '50 次 openState 不变的会话更新', prepare: 'composer', kind: 'session' },
  { id: 'navigation', label: '20 次 g / Esc 提示开合', prepare: 'ordinary', kind: 'navigation' }
].filter(scenario => !args.scenarios || String(args.scenarios).split(',').includes(scenario.id));
assert.ok(scenarios.length, 'Select at least one known scenario');
report.scenarios = scenarios.map(({ id, label }) => ({ id, label }));
async function exercise(page, scenario) {
  await page.evaluate(async ({ kind, gesture }) => {
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    if (kind === 'idle') { await wait(200); return; }
    if (kind === 'key') { for (let i = 0; i < 100; i++) window.fixture.emitKey(gesture); return; }
    const iterations = kind === 'output' ? 100 : kind === 'session' ? 50 : kind === 'click' ? 10 : 20;
    for (let i = 0; i < iterations; i++) {
      if (kind === 'output') {
        const p = document.createElement('p'); p.textContent = 'new output ' + i; document.getElementById('log').append(p);
      } else if (kind === 'session') window.fixture.session.set({ openState: 'open', running: false, loadingOlder: !!(i % 2) });
      else if (kind === 'click') window.fixture.click('ordinary');
      else {
        window.fixture.emitKey({ code: 'KeyG' }); await wait(20);
        window.fixture.emitKey({ code: 'Escape' });
      }
      await wait(kind === 'click' || kind === 'navigation' ? 30 : 5);
    }
  }, scenario);
  await page.waitForTimeout(60);
}
const metrics = async session => Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]));
async function runScenarios(source, counted) {
  const page = await fixture(source, { instrument: counted });
  const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
  const result = {};
  try {
    for (const scenario of scenarios) {
      await page.locator('#' + scenario.prepare).focus(); await page.waitForTimeout(70);
      await page.evaluate(() => { window.counts = {}; });
      const before = await metrics(cdp); await exercise(page, scenario); const after = await metrics(cdp);
      result[scenario.id] = counted ? await page.evaluate(() => ({ ...window.counts })) : {
        taskMs: (after.TaskDuration - before.TaskDuration) * 1000,
        scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
        layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000
      };
    }
    if (counted) {
      await page.evaluate(() => window.fixture.dispose()); await page.waitForTimeout(70);
      await page.evaluate(() => { window.counts = {}; });
      await exercise(page, { kind: 'output' });
      result.afterDispose = await page.evaluate(() => ({ ...window.counts }));
      assert.deepEqual(result.afterDispose, {}, 'No work after cleanup');
    }
  } finally { await cdp.detach(); await page.close(); }
  return result;
}
try {
  if (!args['timing-only']) {
    for (const name of ['default-navigation', 'tool-navigation']) {
      const page = await browser.newPage(); page.on('pageerror', error => errors.push(String(error)));
      await page.route('http://shortcutter-review.invalid/**', async route => {
        const relative = new URL(route.request().url()).pathname.slice(1);
        const sourceRoot = relative.startsWith('src/') ? candidateRoot : root;
        assert.ok(!relative.includes('..'), 'Local fixture paths only');
        await route.fulfill({ contentType: relative.endsWith('.html') ? 'text/html' : 'text/javascript', body: await fs.readFile(path.join(sourceRoot, relative), 'utf8') });
      });
      await page.goto(`http://shortcutter-review.invalid/test/browser/${name}.html`);
      await page.locator('#run').click();
      await page.waitForFunction(() => document.getElementById('result').textContent.startsWith('{'));
      const checks = JSON.parse(await page.locator('#result').textContent());
      report.checks.push({ suite: name, ...checks }); await page.close();
      assert.equal(checks.passed, checks.total, JSON.stringify(checks.results.filter(check => !check.pass)));
    }
    const integration = await pluginChecks(options => fixture(candidate, { ...options, debug: true, instrument: true, nodes: 0 }));
    report.checks.push({ suite: 'plugin-integration', ...integration });
    assert.equal(integration.passed, integration.total, JSON.stringify(integration.results.filter(check => !check.pass)));
    console.log('Browser regression suites passed.');
  }
  if (!args['checks-only']) {
    for (const [name, source] of [['before', baseline], ['after', candidate]]) report.counts[name] = await runScenarios(source, true);
    for (const id of ['output', 'typing', 'repeat', 'modifier']) if (report.counts.after[id]) assert.equal(report.counts.after[id].navigationRead || 0, 0, id + ' avoids navigation scans');
    if (report.counts.after.session) assert.equal(report.counts.after.session.panelRender || 0, 0, 'Unrelated session updates do not render');
    if (report.counts.after.click) assert.equal(report.counts.after.click.publish || 0, 0, 'No-op clicks do not publish');
    const runs = Number(args.runs || 7); assert.ok(Number.isInteger(runs) && runs >= 1);
    report.method.measuredPairs = runs; report.timings = { before: [], after: [] };
    for (let round = -1; round < runs; round++) {
      const order = round % 2 ? ['after', 'before'] : ['before', 'after'];
      for (const name of order) {
        const measurements = await runScenarios(name === 'before' ? baseline : candidate, false);
        if (round >= 0) report.timings[name].push(measurements);
      }
      console.log(round < 0 ? 'Warm-up pair complete.' : `Measured pair ${round + 1}/${runs} complete.`);
    }
  }
  assert.deepEqual(errors, [], 'No browser errors');
} catch (error) { report.failure = String(error); process.exitCode = 1; }
finally {
  await browser.close();
  const output = path.resolve(args.output || path.join(root, 'reports/performance-results.json'));
  await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, checks: report.checks.map(({ suite, passed, total }) => ({ suite, passed, total })), failure: report.failure, errors }, null, 2));
}
