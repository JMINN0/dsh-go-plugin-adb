/**
 * adb.js — 连接、挑端口、自动恢复。
 *
 * ## 为什么不是死板的 5555
 * `adb tcpip <port>` 会让 adbd 在那 个端口上监听；如果这个端口被别的进程占了，
 * 或者上次用过另一个端口，硬写 5555 就会一直连不上。所以策略是**候选列表 + 记住上次成功的**：
 * 依次试 state.port、5555、5556…5559，第一个能跑通 `shell id` 的就定下来并存盘。
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
    const err = typeof e.stderr === 'string' && e.stderr ? e.stderr : String(e.message || e);
    return { ok: false, out, err, code: e.code };
  }
}

export async function listDevices() {
  const r = await adb(['devices']);
  if (!r.ok) return { ok: false, err: r.err, list: [] };
  // 过滤 emulator-*：adb 把 5554–5585 当模拟器段，connect 探测会凭空造出 emulator-55xx。
  // 这台手机上不可能有真模拟器，留着只会干扰判断和迁移。
  const list = r.out.split('\n').slice(1).map((l) => l.trim()).filter(Boolean)
    .map((l) => { const [serial, st] = l.split(/\s+/); return { serial, state: st }; })
    .filter((d) => !/^emulator-/.test(d.serial));
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

  if (force) await adb(['kill-server']);
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
 * 自动恢复：任何一次调用失败（device offline / not found），强制重连一次再重试。
 * 这是"断开后自己恢复"的唯一实现点——插件没有常驻进程，恢复只能发生在调用时。
 */
export async function withConn(fn, { retries = 1 } = {}) {
  let last = null;
  for (let i = 0; i <= retries; i += 1) {
    const c = await ensure({ force: i > 0 });
    if (!c.ok) { last = { ok: false, text: c.hint }; continue; }
    const r = await fn(c.target);
    const text = `${r.out || ''}${r.err ? `\n[stderr] ${r.err}` : ''}`.trim();
    if (r.ok) return { ok: true, text: text || '(无输出)', conn: c };
    last = { ok: false, text: text || '命令失败', conn: c };
    // 只认**连接层**的瞬时故障。'not found' 不能算：`nosuchcmd` 的报错就是
    // "sh: nosuchcmd: not found"，把它当连接错误重试，等于同一条命令在真机上跑两遍（实测踩过）。
    const transient = /device offline|no devices|device .*not found|protocol fault|connection reset|error: closed/i
      .test(`${r.out}${r.err}`);
    if (!transient) return last;
    await state.save({ reconnects: (await state.load()).reconnects + 1 });
  }
  return last;
}

export async function shell(command, { timeout = 30000 } = {}) {
  const r = await withConn((target) => adb(['shell', command], { target, timeout }));
  return { ok: r.ok, text: r.text };
}

export async function status() {
  const st = await state.load();
  const { list } = await listDevices();
  return { state: st, devices: list, ready: await usable(`127.0.0.1:${st.port}`) };
}
