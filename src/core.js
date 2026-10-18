// Stable compatibility identifiers: keep existing custom return keys and
// local preferences when upgrading from dsh-magic-shortcuts to dsh-shortcutter.
export const RETURN_ID = "magic-shortcuts.navigate";
export const STORAGE_KEY = "dsh.magic-shortcuts.v1";
export const COMMANDS = [
  { id: "sidebar", label: "切换侧栏", key: "s", group: "区域" },
  { id: "conversation", label: "回到对话", key: "c", group: "区域" },
  { id: "right", label: "切换工具面板", key: "r", group: "区域" },
  { id: "files", label: "文件", key: "e", group: "区域" },
  { id: "browser", label: "切换浏览器", key: "b", group: "区域" },
  { id: "terminal", label: "切换终端", key: "t", group: "区域" },
  { id: "enter", label: "进入当前内容", key: "i", group: "操作" },
  { id: "newSession", label: "新建会话", key: "n", group: "操作" },
  { id: "newBrowser", label: "新建浏览器", key: "B", group: "操作" },
  { id: "newTerminal", label: "新建终端", key: "T", group: "操作" },
  { id: "closeTab", label: "关闭当前工具标签", key: "w", group: "操作" },
  { id: "fullscreen", label: "放大 / 恢复面板", key: "R", group: "操作" },
  { id: "previous", label: "上一个会话", key: "g a", group: "跳转" },
  { id: "nextTab", label: "下一个工具标签", key: "]", group: "跳转" },
  { id: "previousTab", label: "上一个工具标签", key: "[", group: "跳转" },
  { id: "settings", label: "打开 DSH 设置", key: "g s", group: "跳转" }
];
export function defaultConfig() {
  return { version: 3, autoNavigate: true, bindings: Object.fromEntries(COMMANDS.map(c => [c.id, c.key])) };
}
export function normalizeSequence(value) {
  return String(value).trim().split(/\s+/).map(k => k.toLowerCase() === "space" ? "Space" : k).join(" ");
}
export function validateConfig(value) {
  if (!value || ![1, 2, 3].includes(value.version) || typeof value.autoNavigate !== "boolean" || !value.bindings || typeof value.bindings !== "object" || Array.isArray(value.bindings)) return { error: "设置格式不受支持，已保留原始数据。" };
  if (value.version === 1) return migrateLegacyConfig(value);
  const config = defaultConfig(), used = new Map(), notes = [];
  config.autoNavigate = value.autoNavigate;
  for (const command of COMMANDS) {
    let binding = value.bindings[command.id];
    if (value.version === 2 && command.id === "closeTab" && binding === undefined) {
      const occupied = Object.values(value.bindings).some(key => typeof key === "string" && normalizeSequence(key) === command.key);
      binding = occupied ? "" : command.key;
      if (occupied) notes.push("w 已有自定义用途，「关闭当前工具标签」暂未绑定");
    }
    if (typeof binding !== "string") return { error: `${command.label}缺少键位。` };
    const key = normalizeSequence(binding);
    if (["g", "?"].includes(key)) return { error: "g 和 ? 保留给导航菜单。" };
    const supported = value.version === 2 ? /^(?:[a-zA-Z0-9]|g [a-zA-Z0-9?])$/ : /^(?:[a-zA-Z0-9\[\]]|g [a-zA-Z0-9?\[\]])$/;
    if (key && !supported.test(key)) return { error: `${command.label}：请使用单个字母、数字、[、]，或 g 加一个键。Space 已不再用作导航前缀。` };
    if (key && used.has(key)) return { error: `${key} 同时分配给了「${used.get(key)}」和「${command.label}」。` };
    if (key) used.set(key, command.label);
    config.bindings[command.id] = key;
  }
  // Only old defaults move. A v3 user can still deliberately assign g t / g T,
  // and custom bindings or explicit unbinding always survive an upgrade.
  if (value.version === 2) {
    if (config.bindings.nextTab === "g t") config.bindings.nextTab = "]";
    if (config.bindings.previousTab === "g T") config.bindings.previousTab = "[";
  }
  return { config, ...(notes.length ? { notice: notes.join("；") } : {}) };
}
function migrateLegacyConfig(value) {
  const legacy = COMMANDS.filter(c => !["newBrowser", "newTerminal", "closeTab"].includes(c.id)).concat([
    { id: "autoNav", label: "切换自动导航" }, { id: "help", label: "快捷键总览" }
  ]);
  const bindings = {}, used = new Set(), notes = [];
  // Validate the old schema before migrating. Never replace corrupt preferences
  // with defaults, or write storage merely because the plugin has been loaded.
  for (const command of legacy) {
    let key = value.bindings[command.id];
    if (command.id === "newSession" && key === undefined) {
      key = Object.values(value.bindings).some(k => typeof k === "string" && normalizeSequence(k) === "n") ? "" : "n";
    }
    if (typeof key !== "string") return { error: `${command.label}缺少键位。` };
    key = normalizeSequence(key);
    if (key && (!/^(?:[a-zA-Z0-9]|(?:g|Space) [a-zA-Z0-9?])$/.test(key) || ["g", "?"].includes(key))) return { error: `${command.label}的旧键位无效，已保留原始数据。` };
    if (key && used.has(key)) return { error: `${key} 同时分配给了多个动作，已保留原始数据。` };
    if (key) used.add(key);
    if (["autoNav", "help"].includes(command.id)) continue;
    bindings[command.id] = key.startsWith("Space ") ? "" : key;
    if (key.startsWith("Space ") && !(command.id === "settings" && key === "Space s")) notes.push(`「${command.label}」原 Space 组合已取消，可重新设置`);
  }
  // Existing custom keys win over newly introduced defaults, including g s.
  const addDefault = (id, key) => {
    const occupied = Object.values(bindings).includes(key);
    bindings[id] = occupied ? "" : key;
    if (occupied) notes.push(`${key} 已有自定义用途，「${COMMANDS.find(c => c.id === id).label}」暂未绑定`);
  };
  if (normalizeSequence(value.bindings.settings) === "Space s") addDefault("settings", "g s");
  addDefault("newBrowser", "B"); addDefault("newTerminal", "T"); addDefault("closeTab", "w");
  const result = validateConfig({ version: 2, autoNavigate: value.autoNavigate, bindings });
  return result.error ? result : { ...result, notice: [...notes, result.notice].filter(Boolean).join("；") };
}
export function readConfig(raw) {
  if (raw === null) return { config: defaultConfig() };
  try { return validateConfig(JSON.parse(raw)); }
  catch { return { error: "快捷键设置无法读取，已保留原始数据。" }; }
}
export function tokenFromGesture(g) {
  if (g.code === "Escape") return "Escape";
  if (g.code === "Space") return "Space";
  if (g.code === "Slash" && g.shift) return "?";
  if (g.code === "BracketLeft" && !g.shift) return "[";
  if (g.code === "BracketRight" && !g.shift) return "]";
  if (/^Key[A-Z]$/.test(g.code)) return g.shift ? g.code.slice(3) : g.code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(g.code) && !g.shift) return g.code.slice(5);
  return "";
}
export function resolveSequence(bindings, prefix, key) {
  if (key === "Escape") return { consume: true, prefix: "", dismiss: !prefix };
  if (!key) return { consume: false, prefix };
  if (prefix) {
    const command = COMMANDS.find(c => bindings[c.id] === `${prefix} ${key}`)?.id;
    return { consume: true, prefix: "", command };
  }
  if (key === "g") return { consume: true, prefix: key };
  if (key === "?") return { consume: true, prefix: "", toggleHints: true };
  const command = COMMANDS.find(c => bindings[c.id] === key)?.id;
  return { consume: !!command, prefix: "", command };
}
export function cycleIndex(length, currentIndex, direction) {
  if (!length) return -1;
  return (Math.max(0, currentIndex) + direction + length) % length;
}
