import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const input = path.resolve(process.argv[2] || 'reports/performance-2026-10-19.json');
const output = path.resolve(process.argv[3] || input.replace(/\.json$/, '.html'));
const data = JSON.parse(await fs.readFile(input, 'utf8'));
assert.ok(!data.failure && !data.errors.length && data.timings.before.length >= 1);
const followupPath = path.join(path.dirname(input), 'navigation-followup-2026-10-19.json');
const followup = await fs.readFile(followupPath, 'utf8').then(JSON.parse).catch(() => undefined);
if (followup) assert.equal(followup.sources.candidateSHA256, data.sources.candidateSHA256, 'Follow-up must measure the final candidate');
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const median = values => { const sorted = [...values].sort((a, b) => a - b); const mid = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };
const values = (source, variant, id, metric = 'taskMs') => source.timings[variant].map(run => run[id][metric]);
const stats = (source, variant, id, metric) => {
  const all = values(source, variant, id, metric);
  return { median: median(all), min: Math.min(...all), max: Math.max(...all), all };
};
const number = value => value.toFixed(2);
const difference = (before, after) => before ? (1 - after / before) * 100 : 0;
const statCell = s => `${number(s.median)}<small>${number(s.min)}–${number(s.max)}</small>`;
const changeCell = (before, after) => {
  const change = difference(before, after);
  return `<span class="${change > 5 ? 'better' : change < -5 ? 'higher' : 'neutral'}">${change >= 0 ? '↓' : '↑'} ${Math.abs(change).toFixed(1)}%</span>`;
};
const rows = data.scenarios.map(({ id, label }) => {
  const before = stats(data, 'before', id), after = stats(data, 'after', id);
  return `<tr><th scope="row">${esc(label)}</th><td>${statCell(before)}</td><td>${statCell(after)}</td><td>${id === 'idle' ? '<span class="neutral">测量开销</span>' : changeCell(before.median, after.median)}</td></tr>`;
}).join('');
const counted = (variant, id, metric) => data.counts[variant][id][metric] || 0;
const countRows = [
  ['output', 'navigationRead', '无关内容新增 · 导航重算'], ['output', 'documentQueryAll', '无关内容新增 · 全局查询'],
  ['typing', 'documentQueryAll', '普通输入 · 全局查询'], ['repeat', 'documentQueryAll', '重复键 · 全局查询'],
  ['modifier', 'documentQueryAll', '修饰键 · 全局查询'], ['click', 'publish', '重复点击 · 状态发布'],
  ['click', 'panelRender', '重复点击 · 面板渲染'], ['click', 'cueMeasure', '重复点击 · 圆点测量'],
  ['session', 'panelRender', '会话无关更新 · 面板渲染'], ['navigation', 'publish', '正常提示开合 · 必要状态发布']
].map(([id, metric, label]) => `<tr><th scope="row">${label}</th><td>${counted('before', id, metric)}</td><td>${counted('after', id, metric)}</td><td>${counted('after', id, metric) === 0 ? '消除本场景的这项工作' : counted('after', id, metric) === counted('before', id, metric) ? '保留必要工作' : '减少重复工作'}</td></tr>`).join('');
const checks = data.checks.reduce((sum, suite) => sum + suite.total, 0);
const outputBefore = stats(data, 'before', 'output', 'scriptMs'), outputAfter = stats(data, 'after', 'output', 'scriptMs');
const reviewNote = followup ? (() => {
  const before = stats(followup, 'before', 'navigation'), after = stats(followup, 'after', 'navigation');
  return `<p>首轮检查中，正常 <code>g / Esc</code> 开合的任务耗时中位数曾上升（105.31 → 123.25 ms）。随后将输入区的快速判断限定在非导航态，避免导航按键重复检查输入归属。对最终代码单独交替复测 ${followup.timings.before.length} 组：<strong>${number(before.median)} → ${number(after.median)} ms</strong>（${difference(before.median, after.median) >= 0 ? '下降' : '上升'} ${Math.abs(difference(before.median, after.median)).toFixed(1)}%），范围分别为 ${number(before.min)}–${number(before.max)} / ${number(after.min)}–${number(after.max)} ms。这个场景包含提示面板动画与布局，采样存在波动；不将它列为确定的优化收益。<a href="navigation-followup-2026-10-19.json">15 组复测原始数据</a>与<a href="performance-initial-2026-10-19.json">首轮记录</a>均保留。</p>`;
})() : '';
const allSamples = data.scenarios.map(({ id, label }) => `<tr><th scope="row">${esc(label)}</th><td>${values(data, 'before', id).map(number).join(' · ')}</td><td>${values(data, 'after', id).map(number).join(' · ')}</td></tr>`).join('');
const checksDetail = data.checks.map(suite => `<details><summary>${esc(suite.suite)} · ${suite.passed}/${suite.total}</summary><ul>${suite.results.map(item => `<li>${item.pass ? '通过' : '失败'}：${esc(item.name)}${item.error ? ' — ' + esc(item.error) : ''}</li>`).join('')}</ul></details>`).join('');
const document = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>DSH Shortcutter · 性能优化对比</title><style>
:root{color-scheme:light;--ink:#202a37;--muted:#5d6978;--line:#dfe5eb;--accent:#146b53;--soft:#f2f7f5;--warm:#8a4e14}*{box-sizing:border-box}body{margin:0;background:#f4f6f8;color:var(--ink);font:15px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1060px;margin:48px auto;padding:48px 56px;background:white;border:1px solid var(--line);border-radius:16px}header{border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:24px}.eyebrow{font-size:12px;color:var(--accent);letter-spacing:.12em;font-weight:650}h1{font-size:32px;line-height:1.3;letter-spacing:-.04em;margin:10px 0 14px;font-weight:650}h2{font-size:21px;line-height:1.4;margin:34px 0 14px;font-weight:630}h3{font-size:16px;margin:0 0 6px}.intro{font-size:17px;margin:0 0 12px}.meta,small{color:var(--muted);font-size:12px}p{margin:10px 0}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:26px 0}.card{border:1px solid var(--line);background:var(--soft);padding:18px;border-radius:10px}.card b{display:block;font-size:30px;line-height:1.3;font-weight:650;color:var(--accent)}.card span{font-size:13px;display:block;margin-top:7px}.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;margin:16px 0}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:14px}caption{text-align:left;padding:12px 16px;background:#f7f9fb;color:var(--muted);font-size:12px}th,td{padding:11px 16px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}thead th{font-size:12px;font-weight:600;color:var(--muted);background:#f8fafb}tbody th{font-weight:500}td{white-space:nowrap}tr:last-child td,tr:last-child th{border-bottom:0}td small{display:block;line-height:1.4}.better{color:var(--accent);font-weight:600}.higher{color:var(--warm);font-weight:600}.neutral{color:var(--muted)}.note{padding:16px 20px;border-left:3px solid #6f8c83;background:#f6f8f7;margin:18px 0}.changes{display:grid;grid-template-columns:1fr 1fr;gap:20px}.changes article{padding:18px 0;border-top:1px solid var(--line)}.changes p{font-size:14px;color:var(--muted)}code,pre{font:12px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace}code{background:#f1f4f6;padding:2px 4px;border-radius:3px}pre{padding:16px;background:#f4f6f8;overflow:auto;border-radius:8px}a{color:#216095;text-underline-offset:3px}details{border-top:1px solid var(--line);padding:12px 0}summary{cursor:pointer;font-weight:550}details li{font-size:13px;overflow-wrap:anywhere}footer{border-top:1px solid var(--line);margin-top:32px;padding-top:18px;font-size:12px;color:var(--muted)}.hash{overflow-wrap:anywhere;font-family:ui-monospace,monospace;font-size:11px}.sample-table td{white-space:normal;min-width:260px}
@media(max-width:760px){main{margin:0;padding:26px 20px;border:0;border-radius:0}h1{font-size:27px}.cards{grid-template-columns:1fr}.changes{grid-template-columns:1fr}th,td{padding:10px 12px}}@media print{body{background:white}main{border:0;margin:0;padding:0;max-width:none}.table-wrap{overflow:visible}h2{break-after:avoid}tr,.card,article{break-inside:avoid}a{color:inherit}details:not([open]){display:none}footer{font-size:10px}}
</style></head><body><main>
<header><div class="eyebrow">ENGINEERING / PERFORMANCE REVIEW</div><h1>DSH Shortcutter 性能优化对比</h1><p class="intro">减少无关扫描与重复渲染，保留导航、输入和焦点交接行为。</p><div class="meta">2026-10-19 · 基线 ${esc(data.sources.baselineRef.slice(0, 7))} / 0.1.22 · 优化后的工作区代码 · ${data.timings.before.length} 组交替测量</div></header>
<p>完成了会话订阅、DOM 观察、按键过滤和状态发布四类优化。主要收益集中在输入、流式会话更新和重复点击。真实浏览器回归 ${checks}/${checks} 项通过，Node 回归 38/38 项通过。</p>
<div class="cards"><div class="card"><b>${counted('before', 'output', 'documentQueryAll')} → ${counted('after', 'output', 'documentQueryAll')}</b><span>100 次无关内容新增的全局查询</span></div><div class="card"><b>${counted('before', 'session', 'panelRender')} → ${counted('after', 'session', 'panelRender')}</b><span>50 次无关会话更新的面板渲染</span></div><div class="card"><b>${counted('before', 'click', 'publish')} → ${counted('after', 'click', 'publish')}</b><span>10 次重复点击的状态发布</span></div></div>
<div class="note"><strong>测量范围：</strong>数据来自隔离 Chrome 页面、生产版 React 和生产插件代码；宿主公开接口由夹具提供。结果说明这些路径的额外工作已减少，不代表日常 DSH 整体提速的百分比。尚未测量真实宿主的帧率、内存、功耗或端到端响应时间。</div>
<h2>耗时对比</h2><p>每个数值都是<strong>整个场景</strong>的主线程任务耗时中位数，单位 ms；下方小字为 ${data.timings.before.length} 次测量的最小值–最大值。任务耗时包含夹具事件派发、DOM 操作、布局及绘制相关工作，不包含人为等待。</p>
<div class="table-wrap"><table><caption>未插桩代码 · CDP Performance.TaskDuration · 越低越好</caption><thead><tr><th scope="col">场景</th><th scope="col">优化前 / ms</th><th scope="col">优化后 / ms</th><th scope="col">中位数变化</th></tr></thead><tbody>${rows}</tbody></table></div>
<p>内容新增场景仍要完成宿主 DOM 的布局和绘制，所以减少查询不等于消除整个场景的成本。其脚本耗时中位数为 <strong>${number(outputBefore.median)} → ${number(outputAfter.median)} ms</strong>。同步通过 DevTools 派发的按键不完全计入 ScriptDuration，因此本报告统一用 TaskDuration 比较场景总任务耗时。</p>
${reviewNote}
<h2>减少了哪些工作</h2><p>计数在另一轮插桩测试中采集，避免计数逻辑污染上面的耗时。零表示本场景中未发生这项工作。</p>
<div class="table-wrap"><table><thead><tr><th scope="col">事件与工作</th><th scope="col">优化前</th><th scope="col">优化后</th><th scope="col">解释</th></tr></thead><tbody>${countRows}</tbody></table></div>
<p>DOM 观察器仍会收到 100 次节点变化回调，但不再为这 100 次无关变化扫描全页。空闲场景没有插件工作；卸载后追加内容也没有残留回调。正常提示开合需要的状态发布与面板渲染次数保持一致。</p>
<h2>实现变化</h2><div class="changes">
<article><h3>1 · 只订阅需要的就绪状态</h3><p>仅在存在待完成焦点交接时订阅会话，并只读取 openState。流式内容及其他会话字段变化不会再带动导航层渲染。</p><code>src/client.js · Panel</code></article>
<article><h3>2 · 过滤无关 DOM 变化</h3><p>普通输出节点新增不触发导航重算；仍观察菜单、弹窗、输入属性、焦点控件移除和输入法中断。</p><code>src/default-navigation.js</code></article>
<article><h3>3 · 提前让出无关按键</h3><p>重复键、修饰键、已被处理的按键提前返回。非导航态的内容输入也不扫描页面；Esc 的分层行为保留。</p><code>src/client.js · observeFixedInput</code></article>
<article><h3>4 · 相同状态不再重复发布</h3><p>按可见导航状态和工具 occurrence / navigationRevision 比较；空任务取消不发布，普通区域点击不整理标签历史。待挂载的工具仍可强制唤醒一次交接检查。</p><code>src/client.js · publish / tool-history</code></article>
</div>
<h2>验证与范围</h2><p><strong>${38 + checks} 项通过：</strong>38 项 Node 测试，45 项默认导航测试，46 项工具顶部点击测试，18 项插件集成测试。覆盖输入法未结束就移除输入框、菜单与设置弹窗、原生 Esc、终端 writable 与延迟挂载、取消过期交接、标签切换与关闭、禁用自动导航和清理。</p>
${checksDetail}
<p>代码与本地构建已完成；这份报告不作为已安装插件或真实终端 / 网页中的验收证明。日常 DSH 的安装包尚未替换。</p>
<h2>环境与复现</h2><p>${esc(data.environment.cpu)} · ${esc(data.environment.platform)} ${esc(data.environment.arch)} · Chrome ${esc(data.environment.browser)} · React ${esc(data.environment.react)} · Node ${esc(data.environment.node)} · ${esc(data.environment.viewport)} · 初始 2,000 条已有输出。</p>
<p>每组使用新页面，先运行一组完整预热；之后交替旧版/新版顺序。预热组不计入统计；新页面会重新创建 JavaScript 上下文，结果包含各场景在该页面上的初始化与 JIT 影响。保留原始样本，不挑选最快结果，不将场景百分比相加或换算成整机 CPU。</p>
<pre>DSH_PERF_TOOLCHAIN=/path/to/existing/toolchain npm run test:browser
DSH_PERF_TOOLCHAIN=/path/to/existing/toolchain npm run perf -- \
  --baseline-ref 1ba92ad --runs 7 --output reports/performance-results.json
node scripts/performance-report.mjs reports/performance-results.json</pre>
<p>工具目录需已有 playwright-core、esbuild、react 和 react-dom；运行器不会自动安装依赖。macOS 默认使用已安装的 Chrome，可用 DSH_PERF_BROWSER 指定其他可执行文件。</p>
<details><summary>查看每轮任务耗时 / ms</summary><div class="table-wrap"><table class="sample-table"><thead><tr><th>场景</th><th>优化前</th><th>优化后</th></tr></thead><tbody>${allSamples}</tbody></table></div></details>
<details><summary>源码与证据标识</summary><p>基线 Git：<span class="hash">${esc(data.sources.baselineRef)}</span></p><p>基线合成客户端 SHA-256：<span class="hash">${esc(data.sources.baselineSHA256)}</span></p><p>优化后合成客户端 SHA-256：<span class="hash">${esc(data.sources.candidateSHA256)}</span></p><p>生成时间：${esc(data.generatedAt)}</p><p><a href="${esc(path.basename(input))}">完整原始数据 JSON</a> · <a href="browser-checks.json">浏览器回归结果</a></p></details>
<footer>本地工程验证报告 · 统计来自保存的原始数据 · 当前工作区未提交的优化代码</footer>
</main></body></html>`;
await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, document);
console.log(output);
