/**
 * tool-spec.js — 六个工具的契约（不含 execute）。
 *
 * 宿主按 schema 过滤参数：handler 读了、schema 没声明的参数会被静默丢掉。
 * 所以每个工具读了哪些参数，这里必须一一对上。
 *
 * 宿主支持的子集：string / number / integer / boolean / null / array / object / json / oneOf。
 * **不支持** minimum、pattern、maxLength 这类注解，取值范围写在 description 里、由 execute 兜底。
 */

const out = (desc) => ({
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { text: { type: 'string', required: true, description: desc } },
  },
  render(_args, value) {
    return [{ type: 'text', text: value.text }];
  },
});

const CONNECT_NOTE =
  'Connects to this device\'s own adbd over loopback (127.0.0.1:5555); works with Wi-Fi off. ' +
  'First call may need a one-time pairing — see the plugin README.';

export function devicesSpec() {
  return {
    name: 'adb_devices',
    description: [
      'List adb devices and report whether the on-device loopback connection is ready.',
      CONNECT_NOTE,
      '',
      'Use it when adb suddenly stops working: the report says whether the device is gone,',
      'whether it is waiting for authorization, or whether adbd moved off port 5555 (after a reboot).',
    ].join('\n'),
    parameters: {},
    output: out('Device list plus connection status.'),
  };
}

export function reconnectSpec() {
  return {
    name: 'adb_reconnect',
    description: [
      '强制重建 adb 连接。手机重启、显示 offline、或 forward 残留时用。',
      '',
      '做的事：adb start-server → 按候选端口序列重新探测 → 探测不到才 kill-server 重来 → 验证 uid 2000。',
      '候选顺序：上次成功的端口 → 5555 → 6555 → 7555 → 8555 → 9555（跳过 5556–5585 模拟器段）。',
      '',
      '注意：手机重启后 adbd 不在 5555 时本工具救不回来——那种情况要手动重开无线调试拿新端口。',
    ].join('\n'),
    parameters: {},
    output: out('重建过程与结果，成功时含 uid 2000 验证行。'),
  };
}

export function shellSpec() {
  return {
    name: 'adb_shell',
    description: [
      '在手机上执行 shell 命令（uid 2000）。没有拦截、没有白名单、没有二次确认——写什么就执行什么。',
      '',
      '这是最常用的工具，几乎能做 uid 2000 能做的任何事：',
      'pm install/uninstall/list · am start/force-stop · input tap/text/swipe ·',
      'settings put/get · rm/cp/mv · screencap/screenrecord · dumpsys/logcat/getprop · sh/busybox 脚本',
      '',
      '实际边界：',
      '- 超时默认 60 秒，可传 timeoutMs（1000–600000，最长 10 分钟）',
      '- 输出上限 32MB，超出返回失败但前面部分仍在',
      '- 输出按 UTF-8 解码，二进制内容会损坏',
      '- 没有 stdin，交互式命令用不了',
      '- 命令退出码非 0 不算工具失败，输出照常返回',
    ].join('\n'),
    parameters: {
      command: { type: 'string', required: true, description: '要执行的 shell 命令，可含管道、重定向、&&、$()。' },
      timeoutMs: { type: 'integer', description: '超时毫秒，1000–600000，默认 60000。' },
    },
    output: out('命令的 stdout + stderr；失败时带退出码说明。'),
  };
}

export function installSpec() {
  return {
    name: 'adb_install',
    description: [
      'Install (or reinstall with -r) an APK on this phone.',
      CONNECT_NOTE,
      '',
      'Pass an absolute path that the phone can see — /sdcard/... or a path under the proot filesystem.',
      'A failed install usually means a signature mismatch: uninstall the old package first (that is',
      'destructive, so ask the user) or sign the new APK with the same key.',
    ].join('\n'),
    parameters: {
      path: { type: 'string', required: true, description: 'Absolute path to the .apk.' },
      reinstall: { type: 'boolean', description: 'Add -r to keep existing data. Default true.' },
      downgrade: { type: 'boolean', description: 'Add -d to allow version downgrade. Default false.' },
    },
    output: out('adb install result and, on failure, the parsed failure reason.'),
  };
}

export function logcatSpec() {
  return {
    name: 'adb_logcat',
    description: [
      '读 logcat 尾部（读多久由 lines 决定）。不会留长驻进程。',
      '',
      'filter 走 grep -E，**是真正则**：可以是 "FATAL"、"AndroidRuntime|ANR"、"[Ee]xception"。',
      '没有专门的 tag 过滤参数——按 tag 过滤就写正则，比如 "ActivityManager"。',
      '匹配不到不算错误，会明确告诉你"最近 N 行里没有匹配 …"。',
    ].join('\n'),
    parameters: {
      lines: { type: 'integer', description: '取多少行，1–20000，默认 200。' },
      filter: { type: 'string', description: 'grep -E 正则表达式。省略则返回全部。' },
      clear: { type: 'boolean', description: '先执行 logcat -c 清空缓冲区再读。' },
    },
    output: out('匹配到的日志行，或"没有匹配"的说明。'),
  };
}

export function screencapSpec() {
  return {
    name: 'adb_screencap',
    description: [
      'Take a screenshot on the phone and save it to a path you choose.',
      CONNECT_NOTE,
      '',
      'Useful because it does not steal focus: capture, then read the PNG yourself or hand it to a',
      'vision tool. Default path is /sdcard/dsh-screencap.png.',
    ].join('\n'),
    parameters: {
      outPath: { type: 'string', description: 'Device-side path, default /sdcard/dsh-screencap.png.' },
      localPath: { type: 'string', description: 'If set, also adb pull the file to this local path (e.g. /root/workspace/shot.png).' },
    },
    output: out('Where the screenshot landed and its size.'),
  };
}
