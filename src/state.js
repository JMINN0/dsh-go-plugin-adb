/**
 * state.js — 记住上次可用的端口和最近一次成败，跨调用共享。
 *
 * 存哪里：$DSH_HOME/plugin-adb/state.json（默认 ~/.dsh/plugin-adb/state.json）。
 * 为什么写盘：端口是**会变**的（重启后 adbd 回随机端口），进程内变量活不过一次调用；
 * 而且 adb_devices 要把"上次怎么坏的"说给用户听，不能只报一句"连不上"。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

export async function save(patch) {
  const cur = await load();
  const next = { ...cur, ...patch };
  try {
    await mkdir(DIR, { recursive: true });
    await writeFile(FILE, JSON.stringify(next, null, 2));
  } catch {
    /* 状态写不进去不影响连接 */
  }
  return next;
}

export const path = () => FILE;
