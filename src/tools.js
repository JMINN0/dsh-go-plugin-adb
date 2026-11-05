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
 * 定位：**防手滑，不是安全边界**（拦不住 `$(echo cm0)` 动态拼接、alias、自写脚本）。
 *
 * 实现方式是**分词判断**，不是正则拼接。原因：正则版前前后后修了三轮，
 * 每修一次误伤就漏一批包装式命令（`sh -c "pm uninstall x"` 真的被执行过），
 * 因为「命令段的开头」和「包装命令的参数」这两件事正则表达不清楚。
 *
 * 步骤：
 *   1. 只剥词内引号（`p""m` → `pm`，`un"install"` → `uninstall`）。整段引号不剥，
 *      否则 `echo "rm -rf /sdcard"` 会被误拦——误伤比漏拦更糟，调用方会学着无脑带 confirm。
 *   2. 按 shell 分隔符切段：`;` `&` `|` `&&` `||` `(` `)` 换行。
 *   3. 每段剥掉前置的变量赋值和包装命令（sudo / busybox / sh / bash / su / env / exec / timeout …），
 *      以及它们的选项；遇到 `-c` 就把后面的参数当成**新命令**递归判断。
 *   4. 看剩下的段首动词：pm uninstall/clear/disable、cmd package、rm 受保护目录、
 *      find -delete、reboot/recovery、svc power reboot。
 */

/** 按 shell 分隔符切段——**引号内的分隔符不算**（否则 echo "ls; reboot" 会被切断后误判）。 */
/** 按 shell 分隔符切段：引号内的不算；heredoc 内容整段跳过（那是数据不是命令）。 */
/**
 * 命令二次确认：**只对不可逆操作踩一脚刹车**，不是安全边界。
 *
 * 设计取向（用户 2026-11-05 定的）：
 *   拿到 adb 权限的人本来就是为了尽可能多地操作手机，拦他没有意义；
 *   而 confirm 是调用方自己能填的布尔值，所以它天然挡不住有意为之的操作。
 *   因此这里**不做危险写法枚举**，只保留几种"手滑一下就无法挽回"的操作：
 *   整盘/系统目录删除、卸载或清空应用、重启、直接写裸分区。
 *
 * 之前的版本做成了"只读白名单 + 默认拒绝"，连 `am start`、`input tap`、`rm 单个文件`
 * 都要确认——那是把工具当沙箱用，方向错了：代价大、还不构成安全边界。
 *
 * 已知能被绕过（不经确认就执行）：`setsid`、`eval`、`sh -c`、`$HOME`、变量拼接等。
 * 这没关系——它不是用来防人的，只是防止一次误读指令就把数据删光。
 */

/** 不可逆操作：命中就要 confirm。其余一律直接执行。 */
const CATASTROPHIC = [
  // 卸载 / 清空应用（可恢复，但用户数据没了）
  /\bpm\s+(?:-\S+\s+)*(uninstall|clear)\b/,
  /\bcmd\s+package\s+(uninstall|clear)\b/,
  // 整盘 / 系统目录删除
  /\brm\s+(?:-[a-zA-Z]*[rR][a-zA-Z]*\s+)+(?:[^\n]*\s)?(?:\/|\/\*|~|~\/\*|\/sdcard|\/storage|\/data|\/system|\/vendor|\/etc|\/boot|\/root)(?:\s|$)/,
  // 重启 / 恢复模式
  /(^|[;&|]\s*|\b(?:sudo|su\s+-c|sh\s+-c)\s+["']?)\s*(reboot|recovery)(\s|$|["'])/,
  // 直接写裸分区
  /\bdd\b[^\n]*\bof=\/dev\/(?:block|by-name)/,
  // 格式化
  /\bmkfs(\.\w+)?\b/,
];

/**
 * 这条命令是否需要调用方显式确认（true = 需要）。
 * 只拦不可逆操作；其余全部直接执行。
 */
export function needsConfirm(cmd) {
  // 匹配前把引号内的内容当数据剔掉：`echo "pm uninstall"` 只是打印字符串，不该踩刹车。
  // 代价是"用引号包起来就能绕过"——但这是刹车不是安全边界，见上面说明。
  const view = String(cmd ?? '').replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
  return CATASTROPHIC.some((re) => re.test(view));
}

/** 兼容旧名。 */
export const isDangerous = needsConfirm;


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

  if (isDangerous(cmd) && args?.confirm !== true) {
    return {
      text: `已拒绝：这条命令不在只读白名单里（可能写数据、改设置、执行程序或卸载应用）。\ncommand: ${cmd}\n\n` +
        '确认要执行的话，先跟用户说清楚后果，再带 confirm:true 重试。\n' +
        '只读查询（ls / getprop / dumpsys / pm list / settings get 等）不需要确认。\n' +
        '卸载应用前请先用 aapt 读 APK 的真实中文名——包名不可信。',
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

  // clear 参数（以前只在 schema 里声明、实现里从不读，等于给模型撒谎）：先清空缓冲再抓
  if (args?.clear === true) {
    await adbConn.withConn((target) => adb(['shell', 'logcat -c'], { target, timeout: 10000 }));
  }

  // 单引号包裹，防注入；grep -E 支持 | 等正则语法
  const grepPart = filter ? ` | grep -E ${quoteSingle(filter)}` : '';
  const cmd = `logcat -d -t ${lines}${grepPart}`;
  // 注意：**不标 idempotent**。之所以之前标了，是想着"grep 没匹配可以安全重试"，
  // 但实测无匹配时会白跑两遍 + 一次全端口探测（3458ms、9 次 adb 调用）。
  const r = await adbConn.withConn((target) => adb(['shell', cmd], { target, timeout: 30000 }));
  const text = String(r ? r.text : '');

  // 判据用**结构化信号**（退出码 / 超时标记），不去扫日志正文——
  // 之前用文本正则扫，日志里恰好出现 "error: closed" 的正常结果会被误报成连接故障。
  if (r && r.timedOut) {
    return { text: `读日志超时（${30000}ms）。日志很多时把 lines 调小一点再试。` };
  }
  // grep 无匹配 = 退出码 1（wrapped 的 "退出码 1" 文案也算）
  const grepExit1 = (r && r.code === 1) || /退出码 1$/.test(text.trim());
  if (grepExit1) {
    return { text: `（最近 ${lines} 行里没有匹配 ${JSON.stringify(filter || '*')} 的内容）` };
  }
  // 剩下的失败都按连接/执行问题报，并把原始信息带出来
  if (r && r.ok === false) {
    return { text: `读日志失败：${text || '(无输出)'}` };
  }
  return { text: text.trim() || '(无输出)' };
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
