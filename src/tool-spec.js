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
      'Force a fresh adb connection: kill the local adb server, start it again, migrate a wireless-debug',
      'port to loopback 5555 if needed, and verify the shell as uid 2000.',
      CONNECT_NOTE,
      '',
      'Call this after a phone reboot or when adb_devices shows "offline" / no device.',
      'It does NOT re-pair: if the adb key was revoked, the user must run pairing again.',
    ].join('\n'),
    parameters: {},
    output: out('What happened, ending with OK plus the device model, or the exact next step.'),
  };
}

export function shellSpec() {
  return {
    name: 'adb_shell',
    description: [
      'Run one shell command on this phone through adb (uid 2000).',
      CONNECT_NOTE,
      '',
      'Works: pm list/path/install/uninstall, am start, logcat, dumpsys, screencap, input, ls of /sdcard.',
      'Does NOT work: reading /data/data or /data/app (SELinux), run-as on non-debuggable packages, root.',
      '',
      'Destructive commands (pm uninstall / pm clear / rm on user data) are refused unless confirm:true is',
      'passed. Before uninstalling anything, resolve the package\'s real label with aapt — package names lie.',
    ].join('\n'),
    parameters: {
      command: { type: 'string', required: true, description: 'The shell command, e.g. "pm list packages | grep apex" or "dumpsys battery".' },
      timeoutMs: { type: 'integer', description: 'Timeout in milliseconds, default 30000, max 120000.' },
      confirm: { type: 'boolean', description: 'Set true only when the user approved a destructive command (uninstall/clear/rm of user data).' },
    },
    output: out('Command output, or the refusal / error with the reason.'),
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
      'Read the tail of logcat without leaving a long-running process behind.',
      CONNECT_NOTE,
      '',
      'Filter is a plain substring or a logcat tag filter. Use it to catch crashes:',
      'logcat({ filter: "FATAL|AndroidRuntime|DEBUG" }) right after a test.',
    ].join('\n'),
    parameters: {
      lines: { type: 'integer', description: 'How many trailing lines, default 200, max 5000.' },
      filter: { type: 'string', description: 'Substring or tag filter applied with grep -E on the device.' },
      clear: { type: 'boolean', description: 'Clear the buffer first, so you only see what happens next.' },
    },
    output: out('The filtered log tail.'),
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
