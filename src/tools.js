/**
 * tools.js — 六个工具的 execute。
 *
 * 三条硬规则（都是复核时踩出来的）：
 * 1. **不许写死端口**。连接目标一律用 ensure()/withConn() 返回的 target；
 *    写死 5555 会导致端口迁移之后 install/logcat/screencap 全部发给一个死地址。
 * 2. **用户给的字串进 shell 之前必须校验**。`screencap -p "$(echo INJ)"` 在双引号里
 *    照样会展开，实测能在真机上建出注入出来的文件名。所以路径只允许安全字符，
 *    其他一律拒绝，不靠转义。
 * 3. **危险命令拦截要按"命令位"判断**，并覆盖引号包起来的子命令（`pm "uninstall" x`）
 *    和 `cmd package uninstall` 这种等价写法。
 */

import { adb } from './adb.js';
import * as adbConn from './adb.js';

/** 会改用户数据/卸应用的命令，必须显式 confirm。 */
/**
 * 危险命令拦截。
 *
 * 定位：**防手滑，不是安全边界**。真正的沙箱要靠系统权限，这里只是拦掉误触。
 * 判据是"先剥引号再匹配"，这样 `p""m uninstall`、`pm un"install"`、`cmd "package" uninstall`
 * 都会还原成正常形式被抓住（审查实测这三种原本都能过）。
 *
 * 但仍然拦不住 `$(echo cm0)` 这种动态拼接、alias、自己写脚本——所以文档里明确写"不是安全边界"。
 */
const DANGEROUS = [
  /\bpm\s+(uninstall|clear|disable)\b/,
  /\bcmd\s+package\s+(uninstall|clear|disable)\b/,
  /\brm\s+(-\S+\s+)*\/(sdcard|storage|data)(\/|\s|$)/,
  /(^|[;&|])\s*(reboot|recovery)(\s|$)/,
  // 审查点名的绕过手法
  /\bsu\s+-c\s+reboot\b/,
  /\bsvc\s+power\s+reboot\b/,
  /\bfind\s+\/(sdcard|storage|data)[^|;]*\s-delete\b/,
  /\brm\s+-\S*\s+\*\s*$/,
  /\bpm\s+list\s+packages\s+-u\b.*&&.*\bpm\s+(uninstall|clear)/,
];

/** 剥掉引号后再匹配，抓 `p""m` / `pm un"install"` 这类拼接绕过。 */
function normalizeForGuard(cmd) {
  return String(cmd).replace(/["']/g, '');
}

/** 只允许这些字符进 shell：字母数字、下划线、点、斜杠、连字符、冒号、空格、= */
const SAFE_TOKEN = /^[\w./:\-= ]+$/;

/**
 * logcat 的 filter 是正则（走 grep -E），需要允许 `|` `(` `)` `[` `]` `*` `+` `?` `^` `$`。
 * 但直接放进 shell 有注入风险，所以：① 白名单限定字符集 ② 整体用单引号包裹 ③ 转义内部单引号。
 * 以前 SAFE_TOKEN 不允许 `|`，而文档示例写着 `AndroidRuntime|FATAL` —— 用户第一条命令就被拒。
 */
const FILTER_CHARS = /^[\w./:=|()\[\]^$*+?\\ -]+$/;

function quoteSingle(str) {
  // POSIX shell：把内部单引号变成 '\'' ，整体再包一层单引号
  return `'${String(str).replace(/'/g, `'\\''`)}'`;
}

function unsafeArg(name, value) {
  const v = String(value ?? '');
  if (!SAFE_TOKEN.test(v)) {
    return `${name} 含不安全字符（只允许字母数字和 . / : - _ = 空格）：${JSON.stringify(v)}`;
  }
  return null;
}

const fmtDevices = (list) => (list?.length ? list.map((d) => `${d.serial}\t${d.state}`).join('\n') : '（没有任何设备）');

export async function devices() {
  const r = await adbConn.listDevices();
  const c = await adbConn.ensure();
  if (c.ok && !c.model) {
    const m = await adb(['shell', 'getprop ro.product.model'], { target: c.target, timeout: 8000 });
    if (m.ok) c.model = m.out.trim();
  }
  const st = await adbConn.status().catch(() => null);
  const lines = [
    `adb devices:\n${fmtDevices(r.list)}`,
    '',
    c.ok ? `回环目标 ${c.target}: 已就绪（${c.model || '?'}）` : '回环目标: 未就绪',
  ];
  if (st?.state) {
    lines.push(`记住的端口: ${st.state.port} · 上次成功: ${st.state.lastOkAt || '无'} · 重连次数: ${st.state.reconnects || 0}`);
  }
  if (!c.ok) lines.push('', c.hint);
  return { text: lines.join('\n') };
}

export async function reconnect() {
  const c = await adbConn.ensure({ force: true });
  if (!c.ok) return { text: `重连失败：${c.hint}\n\n设备列表：\n${fmtDevices(c.devices || [])}` };
  return { text: `OK ${c.target} ${c.model || ''}`.trim() };
}

export async function shell(args) {
  const cmd = String(args?.command || '').trim();
  if (!cmd) return { text: '缺少 command' };

  const normalized = normalizeForGuard(cmd);
  if (DANGEROUS.some((re) => re.test(normalized)) && args?.confirm !== true) {
    return {
      text: `已拒绝：这条命令会改用户数据或卸载/停用应用。\ncommand: ${cmd}\n\n` +
        '确认要执行的话，先跟用户说清楚后果，再带 confirm:true 重试。\n' +
        '卸载前请先用 aapt 读 APK 的真实中文名——包名不可信。',
    };
  }

  const timeout = Math.min(Math.max(Number(args?.timeoutMs) || 30000, 1000), 120000);
  const r = await adbConn.shellDetailed(cmd, { timeout });
  // withConn 的 ok=false 只代表「连接层面失败」；命令本身跑不通（比如 grep 没匹配）
  // 也是 ok=false，但输出里有内容。这两种不能混成一句话。
  if (!r.ok && !String(r.text || '').trim()) return { text: '没有可用连接：' + (r.text || '未知原因') };
  return { text: r.text || '(无输出)' };
}

export async function install(args) {
  const path = String(args?.path || '').trim();
  if (!path) return { text: '缺少 path' };
  const bad = unsafeArg('path', path);
  if (bad) return { text: bad };

  const flags = ['install'];
  if (args?.reinstall !== false) flags.push('-r');
  if (args?.downgrade === true) flags.push('-d');
  flags.push(path);

  const r = await adbConn.withConn((target) => adb(flags, { target, timeout: 180000 }));
  const raw = String(r.text || '').trim();
  if (/Success/i.test(raw)) return { text: `安装成功：${path}` };

  let why = '未知';
  if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match/i.test(raw)) {
    why = '签名不一致：旧包是另一个密钥签的。要么先卸载旧包（会丢数据，需用户同意），要么用同一密钥重签。';
  } else if (/INSTALL_FAILED_VERSION_DOWNGRADE/i.test(raw)) {
    why = '版本降级被拒。加 downgrade:true，或先卸载。';
  } else if (/INSTALL_FAILED_INSUFFICIENT_STORAGE/i.test(raw)) why = '存储空间不足。';
  else if (/INSTALL_FAILED_TEST_ONLY/i.test(raw)) why = 'APK 带 testOnly 标记，用 -t 安装或重新打包。';
  return { text: `安装失败：${why}\n\n原始输出：\n${raw}` };
}

export async function logcat(args) {
  const lines = Math.min(Math.max(Number(args?.lines) || 200, 1), 5000);
  const filter = args?.filter ? String(args.filter) : '';

  if (filter && !FILTER_CHARS.test(filter)) {
    return { text: `filter 含不支持的字符：${JSON.stringify(filter)}\n只允许字母数字、. / : = | ( ) [ ] ^ $ * + ? 空格和连字符（走 grep -E 正则）` };
  }

  // 单引号包裹，防注入；grep -E 支持 | 等正则语法
  const grepPart = filter ? ` | grep -E ${quoteSingle(filter)}` : '';
  const cmd = `logcat -d -t ${lines}${grepPart}`;
  const r = await adbConn.withConn((target) => adb(['shell', cmd], { target, timeout: 30000 }), { idempotent: true });
  // grep 无匹配时退出码是 1 —— 这是**正常结果**，不是错误。
  // 以前把它显示成"命令失败"，用户以为插件坏了（实测踩过）。
  if (r.code === 1 || /退出码 1$/.test(String(r.text || ''))) {
    return { text: `（最近 ${lines} 行里没有匹配 ${JSON.stringify(filter || '*')} 的内容）` };
  }
  return { text: String(r.text || '').trim() || '(无输出)' };
}

export async function screencap(args) {
  const remote = String(args?.outPath || '/sdcard/dsh-screencap.png').trim();
  const bad = unsafeArg('outPath', remote);
  if (bad) return { text: bad };

  const local = String(args?.localPath || '').trim();
  if (local) {
    const badLocal = unsafeArg('localPath', local);
    if (badLocal) return { text: badLocal };
  }

  const shot = await adbConn.withConn((target) => adb(['shell', `screencap -p ${remote}`], { target, timeout: 40000 }));
  if (!shot.ok) return { text: `截图失败：${shot.text}` };

  const ls = await adbConn.withConn((target) => adb(['shell', `ls -l ${remote}`], { target, timeout: 20000 }));
  const lines = [`截图已保存：${remote}`, (ls.text || '').trim()].filter(Boolean);

  if (local) {
    const p = await adbConn.withConn((target) => adb(['pull', remote, local], { target, timeout: 60000 }));
    lines.push(p.ok ? `已拉到本地：${local}` : `拉取失败：${p.text}`);
  }
  return { text: lines.join('\n') };
}
