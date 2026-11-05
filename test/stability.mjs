/**
 * stability.mjs — 稳定性 + 容错测试。
 *
 * 每条用例都自己造故障、自己恢复，输出成功率/耗时/失败原因。
 * 跑法：node test/stability.mjs
 */

import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 【必须先设环境变量，再导入被测模块】——state.js 在模块加载时读 DSH_ADB_STATE_DIR。
// 不隔离的话，跑一次测试就会改掉你自己真实的 ~/.dsh/plugin-adb/state.json
// （审查实测：T1 的 30 次 ensure = 30 次写盘，把端口记忆和重连计数都搅了）。
const TEST_STATE_DIR = join(tmpdir(), `dsh-adb-test-${process.pid}-${Date.now()}`);
process.env.DSH_ADB_STATE_DIR = TEST_STATE_DIR;

const { adb, ensure, listDevices, shell, withConn } = await import('../src/adb.js');
const state = await import('../src/state.js');

const results = [];
const t0 = Date.now();
const rec = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`); };

async function timed(fn) { const s = Date.now(); const v = await fn(); return [v, Date.now() - s]; }

// T1 连续 ensure 30 次：缓存命中率与耗时
{
  let ok = 0, total = 0, max = 0;
  for (let i = 0; i < 30; i += 1) {
    const [c, ms] = await timed(() => ensure());
    total += ms; max = Math.max(max, ms);
    if (c.ok) ok += 1;
  }
  rec('T1 连续 ensure ×30', ok === 30, `成功 ${ok}/30，平均 ${Math.round(total / 30)}ms，最慢 ${max}ms`);
}

// T2 连续 shell ×30
{
  let ok = 0; const fails = [];
  for (let i = 0; i < 30; i += 1) {
    const r = await shell(`echo t2-${i}`);
    if (r.ok && r.text.includes(`t2-${i}`)) ok += 1; else fails.push(r.text.slice(0, 60));
  }
  rec('T2 连续 shell ×30', ok === 30, `成功 ${ok}/30${fails.length ? '，失败样例: ' + fails[0] : ''}`);
}

// T3 kill-server 注入 ×5
{
  let ok = 0;
  for (let i = 0; i < 5; i += 1) {
    await adb(['kill-server']);
    const r = await shell('getprop ro.product.model');
    if (r.ok && r.text.trim()) ok += 1;
  }
  rec('T3 kill-server ×5 自愈', ok === 5, `自愈 ${ok}/5`);
}

// T4 disconnect 注入 ×3
{
  let ok = 0;
  for (let i = 0; i < 3; i += 1) {
    const st = await state.load();
    await adb(['disconnect', `127.0.0.1:${st.port}`]);
    const r = await shell('echo t4');
    if (r.ok && r.text.includes('t4')) ok += 1;
  }
  rec('T4 disconnect ×3 自愈', ok === 3, `自愈 ${ok}/3`);
}

// T5 状态文件被写坏
{
  const p = state.path();
  await writeFile(p, '{ this is not json');
  const c = await ensure();
  const st = await state.load();
  rec('T5 状态文件损坏', c.ok && Number.isInteger(st.port), `ensure=${c.ok} port=${st.port}`);
}

// T6 状态里记了错端口 → 应回落到 5555
{
  await state.save({ port: 6555 });
  const c = await ensure();
  rec('T6 错端口回落', c.ok && c.port === 5555, `选中端口 ${c.port}`);
}

// T7 并发 3 路 ensure
{
  const rs = await Promise.all([ensure(), ensure(), ensure()]);
  rec('T7 并发 ensure ×3', rs.every((r) => r.ok), `端口 ${rs.map((r) => r.port).join(',')}`);
}

// T8 长命令超时处理（10s 超时 + 15s 命令）
{
  const r = await withConn((target) => adb(['shell', 'sleep 15'], { target, timeout: 10000 }));
  rec('T8 超时不挂死', r.ok === false, `返回 ok=${r.ok}（超时被正确捕获）`);
}

// T9 缺 adb 二进制的表现
{
  const old = process.env.ADB_BIN;
  process.env.ADB_BIN = '/nonexistent/adb';
  const mod = await import('../src/adb.js?bust=' + Date.now());
  const r = await mod.ensure();
  process.env.ADB_BIN = old;
  rec('T9 缺 adb 时可读报错', r.ok === false && /连不上/.test(r.hint || ''), `ok=${r.ok}`);
}

// T10 状态目录不可写时静默降级
// 注意：**不能用 /proc/nope** —— 在 proot 里 mkdir 那个路径会永久挂起（实测 11 分钟不返回）。
// 改成「拿一个普通文件当父目录」：mkdir 立刻抛 ENOTDIR，才是能验证的失败路径。
{
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'adb-state-'));
  const blocker = join(dir, 'notadir');
  await writeFile(blocker, 'x');
  const old = process.env.DSH_ADB_STATE_DIR;
  process.env.DSH_ADB_STATE_DIR = join(blocker, 'sub');
  const mod = await import('../src/state.js?bust=' + Date.now());
  let saved; let threw = null;
  try { saved = await mod.save({ port: 1234 }); } catch (e) { threw = e.message; }
  process.env.DSH_ADB_STATE_DIR = old;
  rec('T10 状态不可写不崩', threw === null && typeof saved === 'object',
    threw ? `抛异常: ${threw}` : `返回 ${JSON.stringify(saved).slice(0, 30)}`);
}

const dur = Date.now() - t0;
const pass = results.filter((r) => r.ok).length;
console.log(`\n合计 ${pass}/${results.length} 通过，用时 ${(dur / 1000).toFixed(1)}s`);
process.exit(pass === results.length ? 0 : 1);

// 收尾：删掉临时状态目录，别在 /tmp 留垃圾
try { await rm(TEST_STATE_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
