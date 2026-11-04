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

async function loadDefineTool() {
  try {
    const mod = await import('@deepseek-ai/dsh-tools');
    if (mod?.defineTool) return mod.defineTool;
  } catch {
    /* 本地开发时走环境变量 */
  }
  const override = process.env.DSH_TOOLS_PATH;
  if (override) {
    const { pathToFileURL } = await import('node:url');
    const mod = await import(pathToFileURL(override).href);
    if (mod?.defineTool) return mod.defineTool;
  }
  throw new Error('cannot resolve @deepseek-ai/dsh-tools (set DSH_TOOLS_PATH for local dev)');
}

export async function apply(ctx) {
  try {
    const defineTool = await loadDefineTool();
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
