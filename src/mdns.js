/**
 * mdns.js — 自己发 mDNS 查询，找出无线调试的 TLS 端口。
 *
 * 为什么要自己写：这台机器上 `adb mdns services` 是坏的（返回空列表，
 * 实测 3 次 × 25s 全空），而手机确实在广播 `_adb-tls-connect._tcp`。
 * 靠它做端口发现等于把"危险路径"换成"死路径"。
 *
 * 为什么不装第三方库：proot 环境干净，不想为一个查询引依赖。
 * DNS-SD 的 PTR/SRV 解析也就一百多行。
 *
 * 已知约束：mDNS 走 UDP 组播，如果 proot 的网络命名空间收不到组播就查不到。
 * 所以调用方必须准备好"查不到"的退路（让用户念端口）。
 */
import dgram from 'node:dgram';

const MDNS_ADDR = '224.0.0.251';
const MDNS_PORT = 5353;
const QUERY_TIMEOUT_MS = 2500;

function encodeName(name) {
  const parts = String(name).split('.').filter(Boolean);
  const bufs = parts.map((p) => {
    const b = Buffer.from(p, 'utf8');
    return Buffer.concat([Buffer.from([b.length]), b]);
  });
  return Buffer.concat([...bufs, Buffer.from([0])]);
}

/** 构造一个 PTR 查询包。 */
function buildPtrQuery(name) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0);   // id
  header.writeUInt16BE(0, 2);   // flags: standard query
  header.writeUInt16BE(1, 4);   // qdcount
  header.writeUInt16BE(0, 6);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);
  const qname = encodeName(name);
  const qtype = Buffer.from([0, 12]);   // PTR
  const qclass = Buffer.from([0, 1]);   // IN
  return Buffer.concat([header, qname, qtype, qclass]);
}

/** 读 DNS 名字，处理指针压缩。返回 [name, 下一个偏移]。 */
function readName(buf, off) {
  let name = '';
  let next = off;
  let jumped = false;
  for (let guard = 0; guard < 64; guard += 1) {
    if (off >= buf.length) break;
    const len = buf[off];
    if (len === 0) { off += 1; if (!jumped) next = off; break; }
    if ((len & 0xc0) === 0xc0) {
      const ptr = ((len & 0x3f) << 8) | buf[off + 1];
      if (!jumped) { next = off + 2; jumped = true; }
      off = ptr;
      continue;
    }
    off += 1;
    const label = buf.toString('utf8', off, off + len);
    name = name ? `${name}.${label}` : label;
    off += len;
    if (!jumped) next = off;
  }
  return [name, next];
}

/**
 * 解析响应包里的记录，收集 SRV 的端口。
 * 只关心 type 33（SRV）；名字里带 _adb 的优先，其他也收着（调用方自己判断）。
 */
function parseResponse(buf) {
  const out = [];
  if (buf.length < 12) return out;
  const qdcount = buf.readUInt16BE(4);
  const ancount = buf.readUInt16BE(6);
  let off = 12;
  // 跳过问题段
  for (let i = 0; i < qdcount; i += 1) {
    const [, n] = readName(buf, off);
    off = n + 4;   // qtype + qclass
    if (off > buf.length) return out;
  }
  // 遍历答案
  for (let i = 0; i < ancount; i += 1) {
    if (off >= buf.length) break;
    const [name, n1] = readName(buf, off);
    off = n1;
    if (off + 10 > buf.length) break;
    const type = buf.readUInt16BE(off);
    const rdlen = buf.readUInt16BE(off + 8);
    const rdata = off + 10;
    if (type === 33 && rdlen >= 6 && rdata + rdlen <= buf.length) {
      // SRV: priority(2) weight(2) port(2) target
      const port = buf.readUInt16BE(rdata + 4);
      const [target] = readName(buf, rdata + 6);
      out.push({ service: name, port, target });
    }
    off = rdata + rdlen;
  }
  return out;
}

/**
 * 查无线调试的 TLS 端口。
 * @returns {Promise<number[]>} 去重后的端口，按出现的先后顺序
 */
export function discoverAdbTlsPorts({ timeoutMs = QUERY_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const ports = [];
    const add = (p) => { if (Number.isInteger(p) && p > 0 && p < 65536 && !ports.includes(p)) ports.push(p); };
    let finished = false;
    let sock;
    const finish = () => {
      if (finished) return;
      finished = true;
      try { sock?.close(); } catch { /* ignore */ }
      resolve(ports);
    };
    try {
      sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    } catch {
      return resolve([]);
    }
    const timer = setTimeout(finish, timeoutMs);
    sock.on('error', () => { clearTimeout(timer); finish(); });
    sock.on('message', (msg) => {
      for (const rec of parseResponse(msg)) {
        if (!/_adb/i.test(rec.service) && !/_adb/i.test(rec.target)) continue;
        add(rec.port);
      }
    });
    sock.bind(() => {
      try { sock.addMembership(MDNS_ADDR); } catch { /* 组播加不进也不致命 */ }
      try { sock.setMulticastTTL(255); } catch { /* ignore */ }
      const send = (name) => {
        try { sock.send(buildPtrQuery(name), MDNS_PORT, MDNS_ADDR); } catch { /* ignore */ }
      };
      send('_adb-tls-connect._tcp.local');
      setTimeout(() => send('_adb._tcp.local'), 300);
      setTimeout(() => send('_adb-tls-pairing._tcp.local'), 600);
    });
  });
}

export { parseResponse as _parseResponseForTest };
