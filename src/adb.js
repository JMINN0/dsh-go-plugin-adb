/**
 * adb.js — 连接、挑端口、自动恢复。
 *
 * ## 为什么不是死板的 5555
 * `adb tcpip <port>` 会让 adbd 在那 个端口上监听；如果这个端口被别的进程占了，
 * 或者上次用过另一个端口，硬写 5555 就会一直连不上。所以策略是**候选列表 + 记住上次成功的**：
 * 依次试 state.port、5555、6555、7555、8555、9555，第一个能跑通 `shell id` 的就定下来并存盘。
 *
 * ## 怎么从"重启后 adbd 跑回随机端口"里自动恢复
 * Android 11+ 的无线调试会通过 mDNS 广播 `_adb-tls-connect._tcp`，端口就在里面。
 * `adb mdns services` 能读到它 —— 先连这个临时端口，再 `tcpip <候选端口>` 固定下来。
 * 这样手机重启后不需要用户报端口。
 *
 * ## 注意一个容易说错的事实
 * `adb tcpip 5555` 之后 adbd 监听 `[::]:PORT`，即整个网络栈，不只是回环。
 * 能扛住关 WiFi 是因为监听地址包含回环；同时同一局域网里别的机器也能连到该端口
 * （仍需 adb 私钥鉴权）。不用时 `adb usb` 或关无线调试即可收回。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as state from './state.js';

const pexec = promisify(execFile);
const ADB_BIN = process.env.ADB_BIN || 'adb';
const BASE_PORT = Number(process.env.ADB_BASE_PORT || 5555);
// 5554–5585 是 adb 认作「模拟器」的端口段：连这个区间会冒出 emulator-55xx 假条目，
// 把 tcpip 迁移和后续判断全搞乱。所以首选 5555（历史习惯、文档都写它），
// 备选一律跳到这个区间之外。
const FALLBACK_PORTS = [6555, 7555, 8555, 9555];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function adb(args, { timeout = 25000, target = null, maxBuffer = 32 * 1024 * 1024 } = {}) {
  const argv = target ? ['-s', target, ...args] : args;
  try {
    const { stdout, stderr } = await pexec(ADB_BIN, argv, { timeout, maxBuffer });
    return { ok: true, out: stdout ?? '', err: stderr ?? '' };
  } catch (e) {
    const out = typeof e.stdout === 'string' ? e.stdout : '';
    let err = typeof e.stderr === 'string' && e.stderr ? e.stderr : '';
    // execFile 失败时 message 形如 "Command failed: adb -s 127.0.0.1:5555 shell sleep 6"，
    // 那是**内部调用细节**，不该原样吐给用户/模型（以前确实吐了，契约文档还照着写）。
    // 这里剥掉这层噪声，只留真正的 stderr。
    if (!err) {
      const msg = String(e.message || '');
      err = msg.startsWith('Command failed:') ? '' : msg;
    }
    const timedOut = e.killed === true || e.signal === 'SIGTERM' || /timed?\s*out/i.test(String(e.message || ''));
    return { ok: false, out, err, code: e.code, timedOut };
  }
}

export async function listDevices() {
  const r = await adb(['devices']);
  if (!r.ok) return { ok: false, err: r.err, list: [] };
  // 注意：不能过滤掉 emulator-*！
  // adb 会把 5554–5585 这段当模拟器扫描区间，而我们的 adbd 恰好监听 5555，
  // 于是同一台手机在 `adb devices` 里会出现两次：`127.0.0.1:5555` 和 `emulator-5554`。
  // 早期版本把这些 emulator-* 全过滤掉，结果 adb_devices 永远显示"没有任何设备"，
  // 而 findLiveTarget 依赖这个列表，会把活连接当成不存在（复核实测到的真 bug）。
  //
  // 现在的做法：全部保留，但把带冒号的网络串排前面（那才是我们真正用的地址）。
  const list = r.out.split('\n').slice(1).map((l) => l.trim()).filter(Boolean)
    .map((l) => { const [serial, st] = l.split(/\s+/); return { serial, state: st }; })
    .sort((a, b) => {
      const netA = a.serial.includes(':') ? 0 : 1;
      const netB = b.serial.includes(':') ? 0 : 1;
      return netA - netB;
    });
  return { ok: true, list };
}

/** 这个 target 是否真的能跑 shell（uid 2000）。 */
async function usable(target) {
  const r = await adb(['shell', 'id'], { target, timeout: 8000 });
  return r.ok && /uid=2000/.test(r.out);
}

/** 从 mDNS 里读无线调试的临时端口（重启后 adbd 就挂在这种随机端口上）。 */
async function mdnsPorts() {
  const r = await adb(['mdns', 'services'], { timeout: 12000 });
  if (!r.ok) return [];
  const ports = [];
  for (const line of r.out.split('\n')) {
    if (!/_adb-tls-connect|_adb-tls-pairing/.test(line)) continue;
    const m = line.match(/:(\d{2,5})\s*$/);
    if (m) ports.push(Number(m[1]));
  }
  return [...new Set(ports)];
}

async function candidates() {
  const st = await state.load();
  const list = [st.port, BASE_PORT, ...FALLBACK_PORTS];
  return [...new Set(list.filter((p) => Number.isInteger(p) && p > 0 && p < 65536))];
}

/**
 * 主入口：把连接弄好。
 * 返回 { ok, target, model, port, via, devices, hint }
 */
/**
 * 找一条**当前真的能用**的连接（已连上的设备，或 mDNS 广播的无线调试端口）。
 * 迁移循环每轮都要重新调用：tcpip 之后旧 serial 立刻失效。
 */
async function findLiveTarget() {
  await adb(['start-server']);
  const { list } = await listDevices();
  for (const d of list.filter((x) => x.state === 'device')) {
    if (await usable(d.serial)) return d.serial;
  }
  for (const port of await mdnsPorts()) {
    const t = `127.0.0.1:${port}`;
    await adb(['connect', t], { timeout: 8000 });
    await sleep(400);
    if (await usable(t)) return t;
  }
  return null;
}

export async function ensure({ force = false } = {}) {
  const st = await state.load();

  if (!force && await usable(`127.0.0.1:${st.port}`)) {
    await state.save({ lastOkAt: Date.now(), misses: 0 });
    return { ok: true, target: `127.0.0.1:${st.port}`, port: st.port, via: 'cached' };
  }

  // 以前 force 一上来就 kill-server，会把别人（包括并发的自己）正在用的 server 踢掉。
  // 现在先试 start-server（幂等、不会打断已有连接），真的不行才轮到 kill-server。
  if (force) {
    const started = await adb(['start-server']);
    if (!started.ok) await adb(['kill-server']);
  }
  await adb(['start-server']);

  const { list } = await listDevices();
  const cands = await candidates();

  // 阶段一：**只直连，不迁移**。
  // 这一步必须最先做、且不能碰 tcpip —— 否则一条本来好好的连接会被挪到过期端口上
  // （实测踩过：设备在 5555，state 里是 5557，第一版直接把 adbd 从 5555 挪回 5557）。
  for (const port of cands) {
    const target = `127.0.0.1:${port}`;
    await adb(['connect', target], { timeout: 8000 });
    await sleep(350);
    if (await usable(target)) {
      const model = await adb(['shell', 'getprop', 'ro.product.model'], { target, timeout: 8000 });
      await state.save({ port, lastOkAt: Date.now(), misses: 0, lastError: '' });
      return { ok: true, target, port, via: 'direct', model: model.out.trim(), devices: list };
    }
  }

  // 阶段二：直连全不通，但 mDNS 或已有条目找得到一条活连接 → 用它把端口固定下来。
  const bootTarget = await findLiveTarget();

  if (bootTarget) {
    for (const port of cands) {
      const target = `127.0.0.1:${port}`;
      // tcpip 会让 adbd 在新端口重启，**原来那条 serial 当场失效**。
      // 所以每轮都要重新找一条活连接，不能拿第一轮的 serial 一直用（否则第二轮起全是死连接）。
      const live = (await findLiveTarget()) || bootTarget;
      await adb(['-s', live, 'tcpip', String(port)], { timeout: 12000 });
      await sleep(1200);
      await adb(['connect', target], { timeout: 8000 });
      await sleep(400);
      if (await usable(target)) {
        const model = await adb(['shell', 'getprop', 'ro.product.model'], { target, timeout: 8000 });
        await state.save({ port, lastOkAt: Date.now(), misses: 0, lastError: '' });
        return { ok: true, target, port, via: 'tcpip', model: model.out.trim(), devices: list };
      }
    }
  }

  const misses = st.misses + 1;
  const hint = [
    `连不上，已试过端口：${cands.join(', ')}`,
    '',
    '一次性三步（只有第一次需要）：',
    '1. apt-get install -y android-tools-adb',
    '2. 手机：开发者选项 → 无线调试 → 打开，读出「配对码 + 端口」',
    '3. adb pair 127.0.0.1:<端口>（输入配对码）→ adb connect 127.0.0.1:<端口> → adb tcpip 5555',
  ].join('\n');
  await state.save({ misses, lastErrorAt: Date.now(), lastError: 'no usable port' });
  return { ok: false, devices: list, hint, port: null };
}

/**
 * 进程内 single-flight：同一时刻只允许一次 ensure 探测在飞。
 *
 * 为什么需要：以前 10 个并发调用会各自跑完整的探测+迁移，adb server 恰好被杀时实测
 * 只有 5/10 成功，而且它们会互相 kill-server 把对方刚拉起来的服务踢掉（外部只杀 6 次，
 * 日志里出现 16 次 kill-server）。这不是"重试"，是惊群。
 */
let inflightEnsure = null;

export async function ensureShared(opts) {
  if (inflightEnsure) return inflightEnsure;
  inflightEnsure = (async () => {
    try { return await ensure(opts); } finally { inflightEnsure = null; }
  })();
  return inflightEnsure;
}

/**
 * 自动恢复：调用失败时**只对幂等探测命令**重连重试一次。
 *
 * 关键修正：以前拿输出文本判断"是不是连接层故障"（匹配 connection reset / error: closed 等），
 * 结果业务命令的输出里只要含这些词就会被重跑一遍——实测 `curl` 报 "Connection reset by peer"、
 * `logcat | grep "device offline"` 都会触发。带副作用的命令（settings put / am start / 追加写）
 * 跑两遍是真损害。
 *
 * 现在改成：调用方显式声明 idempotent 才重试。业务命令一律不重跑。
 */
export async function withConn(fn, { retries = 1, idempotent = false } = {}) {
  let last = null;
  for (let i = 0; i <= retries; i += 1) {
    // 只有重试那一次才 force；首次永远用共享探测，避免惊群
    const c = i === 0 ? await ensureShared({}) : await ensureShared({ force: true });
    if (!c.ok) { last = { ok: false, text: c.hint }; continue; }
    const r = await fn(c.target);
    const text = `${r.out || ''}${r.err ? `\n[stderr] ${r.err}` : ''}`.trim();
    if (r.ok) return { ok: true, text: text || '(无输出)', conn: c };
    // 失败时别把信息压成"命令失败"——调用方需要知道是超时、退出码非 0、还是真的没输出。
    const reason = r.timedOut
      ? '超时'
      : (r.code !== undefined && r.code !== 0 ? `退出码 ${r.code}` : '');
    last = { ok: false, text: text || `命令失败（${reason || '无输出'}）`, conn: c, code: r.code, timedOut: r.timedOut };
    // 不是幂等命令 → 绝不重跑。宁可把错误如实返回，也不冒跑两遍的险。
    if (!idempotent) return last;
  }
  return last;
}

export async function shell(command, { timeout = 30000 } = {}) {
  // 业务命令**不重试**（idempotent 默认 false）。跑两遍的代价比一次失败大得多。
  const r = await withConn((target) => adb(['shell', command], { target, timeout }));
  return { ok: r.ok, text: r.text };
}

/** 带超时/退出码解释的 shell：给工具层用，返回人能读懂的话。 */
export async function shellDetailed(command, { timeout = 30000 } = {}) {
  const r = await withConn((target) => adb(['shell', command], { target, timeout }));
  if (r.ok) return r;
  if (r.timedOut) {
    return { ...r, text: `命令超时（${timeout}ms 内没结束）。要更长时间就调大 timeoutMs。\n命令：${command}` };
  }
  return { ...r, text: `${r.text}\n命令：${command}` };
}

export async function status() {
  const st = await state.load();
  const { list } = await listDevices();
  return { state: st, devices: list, ready: await usable(`127.0.0.1:${st.port}`) };
}
