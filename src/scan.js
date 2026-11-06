/**
 * scan.js — 扫回环端口，找出 adbd 的无线调试 TLS 端口。
 *
 * 为什么需要它：手机重启后 `adb tcpip 5555` 失效，adbd 挂在一个**随机高位端口**上。
 * 而发现端口的两条正路在这台机器上都堵着：
 *   ① `adb mdns services` 返回空列表（实测 3×25s 全空）
 *   ② 自己发 mDNS 组播查询也收不到（proot 网络命名空间拿不到组播）
 * 所以退而求其次：直接扫。
 *
 * 为什么扫得起：连回环上没开的端口会被内核立刻拒绝（RST），单次耗时微秒级。
 * 2 万个端口、并发 400，实测一两秒就能扫完。
 *
 * 安全性：只做 TCP connect 到 127.0.0.1，不发送任何数据，不发 SYN 到外部地址。
 */
import net from 'node:net';

const DEFAULT_RANGE = [30000, 50000];

/** 测一个端口通不通（只连不写）。 */
function probe(port, timeoutMs) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
    try { sock.connect(port, '127.0.0.1'); } catch { done(false); }
  });
}

/**
 * 扫一段端口，返回开着的那些。
 * @param {object} opts
 * @param {number} [opts.from] 起始端口（含）
 * @param {number} [opts.to] 结束端口（含）
 * @param {number} [opts.concurrency] 并发数
 * @param {number} [opts.timeoutMs] 单端口超时
 * @param {number} [opts.budgetMs] 总预算，超时立刻返回已发现的结果
 */
export async function scanOpenPorts({ from = DEFAULT_RANGE[0], to = DEFAULT_RANGE[1], concurrency = 400, timeoutMs = 250, budgetMs = 8000 } = {}) {
  const open = [];
  const started = Date.now();
  let next = from;

  async function worker() {
    for (;;) {
      if (Date.now() - started > budgetMs) return;
      const p = next;
      next += 1;
      if (p > to) return;
      if (await probe(p, timeoutMs)) open.push(p);
    }
  }

  // 先试最可能的位置：无线调试常用 3xxxx–4xxxx，从高往低更快命中（新端口通常靠后）
  const workers = Array.from({ length: Math.min(concurrency, to - from + 1) }, () => worker());
  await Promise.all(workers);
  open.sort((a, b) => a - b);
  return open;
}
