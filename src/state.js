/**
 * state.js — 记住上次可用的端口和最近一次成败，跨调用共享。
 *
 * 存哪里：$DSH_HOME/plugin-adb/state.json（默认 ~/.dsh/plugin-adb/state.json）。
 * 为什么写盘：端口是**会变**的（重启后 adbd 回随机端口），进程内变量活不过一次调用；
 * 而且 adb_devices 要把"上次怎么坏的"说给用户听，不能只报一句"连不上"。
 */

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DIR = process.env.DSH_ADB_STATE_DIR || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'plugin-adb');
const FILE = join(DIR, 'state.json');

const EMPTY = {
  port: 5555,
  lastOkAt: 0,
  lastErrorAt: 0,
  lastError: '',
  reconnects: 0,
  misses: 0,
};

export async function load() {
  try {
    const raw = await readFile(FILE, 'utf8');
    return { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    return { ...EMPTY };
  }
}

/**
 * 写状态。**进程内串行 + 原子替换**。
 *
 * 以前是"先 load 再整体 writeFile"，两个问题：
 *  ① 20 路并发 `reconnects++` 实测只有 1 次生效（丢 19 次更新）；
 *  ② 300 读/300 写并发里有 13 次读到**空状态**，导致"记住上次端口"被静默重置回 5555。
 * 现在：写操作排队串行；落盘用 tmp + rename（原子，读的一方永远看到完整文件）。
 */
let writeChain = Promise.resolve();

export async function save(patch) {
  writeChain = writeChain.then(async () => {
    const cur = await load();
    // 支持传函数：**整个"读-改-写"都在串行区内**，并发 ++ 才不会丢更新。
    // 传对象时是浅合并（老用法）。
    const next = typeof patch === 'function' ? { ...cur, ...patch(cur) } : { ...cur, ...patch };
    try {
      await mkdir(DIR, { recursive: true });
      const tmp = `${FILE}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(tmp, JSON.stringify(next, null, 2));
      await rename(tmp, FILE);   // 原子替换
    } catch {
      /* 状态写不进去不影响连接 */
    }
    return next;
  }).catch(() => ({ ...EMPTY, ...patch }));
  return writeChain;
}

export const path = () => FILE;

/** 原子自增一个计数字段（并发安全）。 */
export async function bump(field, delta = 1) {
  return save((cur) => ({ [field]: (Number(cur[field]) || 0) + delta }));
}
