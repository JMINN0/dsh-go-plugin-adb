/**
 * guard.mjs — 危险命令拦截的回归测试。
 * 跑法：node test/guard.mjs
 */
import { readFileSync } from 'node:fs';

// 直接从源码里抠出 DANGEROUS 数组，保证测的就是线上那份
const src = readFileSync(new URL('../src/tools.js', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('const DANGEROUS = ['), src.indexOf('];', src.indexOf('const DANGEROUS = [')) + 2);
const DANGEROUS = eval(block.replace('const DANGEROUS =', '(') .replace(/;$/, '') + ')');

const cases = [
  ['pm uninstall com.x', true], ['pm  uninstall com.x', true], ['pm clear com.x', true],
  ['pm "uninstall" com.x', true], ["pm 'clear' com.x", true], ['pm \"disable\" com.x', true],
  ['pm disable com.x', true], ['busybox pm uninstall com.x', true],
  ["su -c 'pm uninstall com.x'", true], ['cmd package uninstall com.x', true],
  ['cmd package clear com.x', true], ['cmd package disable com.x', true],
  ['rm -rf /sdcard/foo', true], ['rm -rf /data/', true], ['rm -rf /data', true], ['rm -rf /sdcard', true],
  ['echo x&&reboot', true], ['ls; reboot', true],
  ['rm -rf /storage/emulated/0/x', true], ['reboot', true], ['reboot recovery', true],
  ['pm list packages', false], ['echo hi', false], ['dumpsys battery', false],
  ['logcat -d | grep reboot', false], ['ls /sdcard/Download', false],
  ['dumpsys diskstats', false], ['am start -n com.x/.Main', false],
];

let bad = 0;
for (const [cmd, should] of cases) {
  const hit = DANGEROUS.some((re) => re.test(cmd));
  if (hit !== should) { bad += 1; console.log(`FAIL  ${should ? '该拦却放过' : '误拦'}: ${cmd}`); }
}
console.log(`\n对照 ${cases.length} 条，异常 ${bad} 条`);
process.exit(bad === 0 ? 0 : 1);
