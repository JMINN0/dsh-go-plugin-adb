/**
 * guard.mjs — 危险命令拦截的回归测试。
 * 跑法：node test/guard.mjs
 *
 * 直接 import 线上那个 isDangerous()，不再从源码里抠正则 eval
 * （老做法在正则改成模板字面量后就崩了，而且测的路径和线上未必一致）。
 */
import { isDangerous } from '../src/tools.js';

const cases = [
  // ---- 必须拦 ----
  ['pm uninstall com.x', true], ['pm  uninstall com.x', true], ['pm clear com.x', true],
  ['pm "uninstall" com.x', true], ["pm 'clear' com.x", true], ['pm "disable" com.x', true],
  ['pm disable com.x', true], ['busybox pm uninstall com.x', true],
  ["su -c 'pm uninstall com.x'", true], ['cmd package uninstall com.x', true],
  ['cmd package clear com.x', true], ['cmd package disable com.x', true],
  ['cmd "package" uninstall com.x', true],
  ['rm -rf /sdcard/foo', true], ['rm -rf /data/', true], ['rm -rf /data', true], ['rm -rf /sdcard', true],
  ['echo x&&reboot', true], ['ls; reboot', true], ['reboot', true], ['reboot recovery', true],
  ['rm -rf /storage/emulated/0/x', true],
  ['find /sdcard -delete', true], ['su -c reboot', true], ['svc power reboot', true],
  ['cd /sdcard && rm -rf *', true],
  ['p""m uninstall com.x', true], ['pm un""install"" com.x', true],
  // ---- 不能误伤（这几条上一轮被误拦过，是回归用例）----
  ['echo "rm -rf /sdcard"', false],
  ['grep "pm uninstall" /sdcard/notes.txt', false],
  ['logcat -d | grep "rm -rf /data"', false],
  ['pm list packages', false], ['echo hi', false], ['dumpsys battery', false],
  ['logcat -d | grep reboot', false], ['ls /sdcard/Download', false],
  ['dumpsys diskstats', false], ['am start -n com.x/.Main', false],
  ['cat /proc/net/unix | grep devtools_remote', false],
  ['echo "device offline"', false],
];

let bad = 0;
for (const [cmd, should] of cases) {
  const hit = isDangerous(cmd);
  if (hit !== should) { bad += 1; console.log(`FAIL  ${should ? '该拦却放过' : '误拦'}: ${cmd}`); }
}
console.log(`\n对照 ${cases.length} 条，异常 ${bad} 条`);
process.exit(bad ? 1 : 0);
