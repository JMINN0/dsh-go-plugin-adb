/**
 * index.js — 插件入口，只做注册。
 *
 * 六个工具：
 *   adb_devices    看设备与回环连接状态
 *   adb_reconnect  kill-server 后重连，必要时把无线调试端口迁到 5555
 *   adb_shell      跑一条 shell 命令（危险命令要 confirm）
 *   adb_install    装 / 重装 APK
 *   adb_logcat     读日志尾巴
 *   adb_screencap  截图，可选拉回本地
 *
 * 设计原则：**插件坏掉也不能让应用起不来**。apply 里的异常一律吞掉、记一行日志、
 * 交回空 disposer。上一版真实事故：apply 里探测 ctx 属性抛错，整个 DSH 起不来。
 */

import {
  devicesSpec, installSpec, logcatSpec, reconnectSpec, screencapSpec, shellSpec,
} from './tool-spec.js';
import * as T from './tools.js';

export const name = 'dsh-plugin-adb';
export const inject = ['tools'];

/**
 * 解析宿主的 defineTool。
 *
 * 为什么不能只写一行 `import('@deepseek-ai/dsh-tools')`：
 * 插件装在 `$DSH_HOME/profiles/<name>/node_modules/` 下，这个目录里**没有** dsh-tools，
 * 而引擎自己的那份在 `/opt/dsh/node_modules/`。实测就是这个原因导致 apply 直接失败、
 * 六个工具一个都没注册（diagnostics.md 里能查到 `cannot resolve @deepseek-ai/dsh-tools`）。
 *
 * 所以按顺序试：裸包名 → 环境变量 → 常见引擎根目录 → 从进程参数往上找。
 */
async function loadDefineTool(ctx) {
  const tryImport = async (spec) => {
    const mod = await import(spec);
    return mod?.defineTool ? mod.defineTool : null;
  };

  // ① 宿主也许已经把 defineTool 递进来了，能不用解析就不用
  const injected = ctx?.defineTool || ctx?.tools?.defineTool;
  if (typeof injected === 'function') return injected;

  // ② 裸包名（正常情况下走这条）
  try {
    const d = await tryImport('@deepseek-ai/dsh-tools');
    if (d) return d;
  } catch { /* 继续 */ }

  // ③ 环境变量（官方给本地开发留的口子）
  const override = process.env.DSH_TOOLS_PATH;
  if (override) {
    try {
      const { pathToFileURL } = await import('node:url');
      const d = await tryImport(pathToFileURL(override).href);
      if (d) return d;
    } catch { /* 继续 */ }
  }

  // ④ 常见引擎根目录
  const roots = [
    process.env.DSH_ROOT,
    '/opt/dsh',
    '/usr/local/lib/dsh',
    '/app',
  ].filter(Boolean);
  for (const root of roots) {
    const entry = `${root}/node_modules/@deepseek-ai/dsh-tools/lib/index.js`;
    try {
      const { pathToFileURL } = await import('node:url');
      const { existsSync } = await import('node:fs');
      if (!existsSync(entry)) continue;
      const d = await tryImport(pathToFileURL(entry).href);
      if (d) return d;
    } catch { /* 继续 */ }
  }

  // ⑤ 从进程参数/cwd 往上逐层找 node_modules
  const { existsSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const seeds = [process.argv?.[1], process.cwd()].filter(Boolean);
  for (const seed of seeds) {
    let dir = dirname(seed);
    for (let i = 0; i < 8; i += 1) {
      const entry = join(dir, 'node_modules/@deepseek-ai/dsh-tools/lib/index.js');
      if (existsSync(entry)) {
        try {
          const d = await tryImport(pathToFileURL(entry).href);
          if (d) return d;
        } catch { /* 继续 */ }
      }
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }

  throw new Error('cannot resolve @deepseek-ai/dsh-tools (tried bare, DSH_TOOLS_PATH, /opt/dsh, cwd walk)');
}

export async function apply(ctx) {
  try {
    const defineTool = await loadDefineTool(ctx);
    const defs = [
      [devicesSpec, () => T.devices()],
      [reconnectSpec, () => T.reconnect()],
      [shellSpec, (args) => T.shell(args)],
      [installSpec, (args) => T.install(args)],
      [logcatSpec, (args) => T.logcat(args)],
      [screencapSpec, (args) => T.screencap(args)],
    ];
    const disposers = defs.map(([spec, exec]) => ctx.tools.register(defineTool({ ...spec(), execute: exec })));
    return () => {
      for (const d of disposers) {
        try {
          d?.();
        } catch {
          /* 卸载失败不影响进程退出 */
        }
      }
    };
  } catch (e) {
    console.error('[dsh-plugin-adb] apply failed, plugin disabled:', e?.message || e);
    return () => {};
  }
}
