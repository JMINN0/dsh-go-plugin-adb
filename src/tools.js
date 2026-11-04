/**
 * tools.js — 六个工具的 execute。
 *
 * 全部返回 { text }，跟 tool-spec.js 的 output.schema 对上。
 * 任何一步失败都返回可读的原因和下一步，不抛异常——工具报错会把整轮对话打断。
 */

import { adb, ensure, listDevices, shell as adbShell, withConn } from './adb.js';

const TARGET = process.env.ADB_TARGET || '127.0.0.1:5555';

/** 这批命令会改用户数据/卸应用，必须显式确认。 */
const DANGEROUS = [
  /(^|\s)pm\s+(uninstall|clear)\b/,
  /(^|\s)pm\s+disable\b/,
  /(^|\s)rm\s+(-\S+\s+)*\/(sdcard|storage|data)\//,
  /(^|\s)(reboot|recovery)\b/,
];

function fmtDevices(list) {
  if (!list.length) return '（没有任何设备）';
  return list.map((d) => `${d.serial}\t${d.state}`).join('\n');
}

export async function devices() {
  const r = await listDevices();
  const c = await ensure();
  // 缓存命中时 ensure 只验 id、不取型号，这里补一次，免得面板上显示「?」
  if (c.ok && !c.model) {
    const m = await adb(['shell', 'getprop ro.product.model'], { target: c.target, timeout: 8000 });
    if (m.ok) c.model = m.out.trim();
  }
  const lines = [
    `adb devices:\n${fmtDevices(r.list)}`,
    '',
    `回环目标 ${TARGET}: ${c.ok ? `已就绪（${c.model || '?'}）` : '未就绪'}`,
  ];
  if (!c.ok) lines.push('', c.hint);
  return { text: lines.join('\n') };
}

export async function reconnect() {
  const c = await ensure({ force: true });
  if (!c.ok) return { text: `重连失败：${c.hint}\n\n设备列表：\n${fmtDevices(c.devices || [])}` };
  return { text: `OK ${c.target} ${c.model || ''}`.trim() };
}

export async function shell(args) {
  const cmd = String(args?.command || '').trim();
  if (!cmd) return { text: '缺少 command' };

  if (DANGEROUS.some((re) => re.test(cmd)) && args?.confirm !== true) {
    return {
      text: `已拒绝：这条命令会改用户数据或卸载应用。\ncommand: ${cmd}\n\n` +
        '确认要执行的话，先跟用户说清楚后果，再带 confirm:true 重试。\n' +
        '卸载前请先用 aapt 读 APK 的真实中文名——包名不可信。',
    };
  }

  const timeout = Math.min(Math.max(Number(args?.timeoutMs) || 30000, 1000), 120000);
  const r = await withConn((target) => adb(['shell', cmd], { target, timeout }));
  return { text: r.ok ? r.text : `没有可用连接：${r.text}` };
}

export async function install(args) {
  const path = String(args?.path || '').trim();
  if (!path) return { text: '缺少 path' };
  const c = await ensure();
  if (!c.ok) return { text: `没有可用连接：${c.hint}` };

  const flags = ['install'];
  if (args?.reinstall !== false) flags.push('-r');
  if (args?.downgrade === true) flags.push('-d');
  flags.push(path);

  const r = await adb(flags, { target: TARGET, timeout: 180000 });
  const raw = `${r.out}${r.err}`.trim();
  if (/Success/i.test(raw)) return { text: `安装成功：${path}` };

  let why = '未知';
  if (/INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match/i.test(raw)) {
    why = '签名不一致：旧包是另一个密钥签的。要么先卸载旧包（会丢数据，需用户同意），要么用同一密钥重签。';
  } else if (/INSTALL_FAILED_VERSION_DOWNGRADE/i.test(raw)) {
    why = '版本降级被拒。加 downgrade:true，或先卸载。';
  } else if (/INSTALL_FAILED_INSUFFICIENT_STORAGE/i.test(raw)) {
    why = '存储空间不足。';
  } else if (/INSTALL_FAILED_TEST_ONLY/i.test(raw)) {
    why = 'APK 带 testOnly 标记，用 -t 安装或重新打包。';
  }
  return { text: `安装失败：${why}\n\n原始输出：\n${raw}` };
}

export async function logcat(args) {
  const c = await ensure();
  if (!c.ok) return { text: `没有可用连接：${c.hint}` };

  if (args?.clear === true) await adb(['logcat', '-c'], { target: TARGET, timeout: 15000 });

  const n = Math.min(Math.max(Number(args?.lines) || 200, 10), 5000);
  const filter = String(args?.filter || '').trim();
  const cmds = [`logcat -d -t ${n}`];
  if (filter) cmds.push(`grep -E ${JSON.stringify(filter)}`);
  const cmd = cmds.join(' | ');

  const r = await adb(['shell', cmd], { target: TARGET, timeout: 60000 });
  const body = `${r.out}${r.err ? `\n[stderr] ${r.err}` : ''}`.trim();
  return { text: body || `(logcat 无输出${filter ? `，filter=${filter}` : ''})` };
}

export async function screencap(args) {
  const remote = String(args?.outPath || '/sdcard/dsh-screencap.png');
  const c = await ensure();
  if (!c.ok) return { text: `没有可用连接：${c.hint}` };

  const r = await adb(['shell', `screencap -p ${JSON.stringify(remote)}`], { target: TARGET, timeout: 40000 });
  if (!r.ok && (r.err || '').trim()) return { text: `截图失败：${(r.err || r.out).trim()}` };

  const ls = await adb(['shell', `ls -l ${JSON.stringify(remote)}`], { target: TARGET, timeout: 20000 });
  const lines = [`截图已保存：${remote}`, (ls.out || '').trim()].filter(Boolean);

  const local = String(args?.localPath || '').trim();
  if (local) {
    const p = await adb(['pull', remote, local], { target: TARGET, timeout: 60000 });
    lines.push(p.ok ? `已拉到本地：${local}` : `拉取失败：${(p.err || p.out).trim()}`);
  }
  return { text: lines.join('\n') };
}
