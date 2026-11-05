/**
 * guard.mjs — 危险命令拦截的回归测试。
 * 跑法：node test/guard.mjs
 *
 * 直接 import 线上 isDangerous()。历史教训：早期从源码里 eval 抠正则，
 * 正则一改成模板字面量测试就崩；后来又因为只测正则会话不到分词路径。
 */
import { isDangerous } from '../src/tools.js';

const cases = [
  // ===== 包操作 =====
  ['pm uninstall com.x', true], ['pm  uninstall com.x', true], ['PM UNINSTALL com.x', true],
  ['pm clear com.x', true], ['pm disable com.x', true], ['pm disable-user com.x', true],
  ['pm "uninstall" com.x', true], ["pm 'clear' com.x", true],
  ['p""m uninstall com.x', true], ['pm un"install" com.x', true], ['p\\m uninstall x', true],
  ['cmd package uninstall com.x', true], ['cmd "package" uninstall com.x', true],
  ['cmd package clear com.x', true],
  ['busybox pm uninstall com.x', true], ['toybox pm uninstall x', true],
  ["su -c 'pm uninstall com.x'", true],

  // ===== 包装式命令（第三、四轮复核点名的回归）=====
  ['sh -c "pm uninstall x"', true], ['busybox sh -c "pm clear x"', true],
  ["bash -c 'rm -rf /sdcard'", true], ['sudo sh -c "pm uninstall x"', true],
  ['sudo -u shell pm uninstall x', true], ['sudo -i pm uninstall x', true],
  ['sudo -n pm uninstall x', true], ['env rm -rf /sdcard', true], ['env -i pm uninstall x', true],
  ['sh -lc "pm uninstall x"', true], ['bash -ec "rm -rf /sdcard"', true],
  ['echo x | xargs pm uninstall', true], ['timeout 5 pm uninstall x', true],
  ['timeout 5 rm -rf /sdcard', true], ['timeout 30 reboot', true],
  ["sh -c 'rm -rf /sdcard; reboot'", true], ['sh -c "true; pm uninstall x"', true],
  ['sh -c "cd /sdcard && rm -rf *"', true],

  // ===== 删除 =====
  ['rm -rf /sdcard', true], ['rm -rf /sdcard/foo', true], ['rm -rf /data', true],
  ['rm -rf /storage/emulated/0/x', true], ['rm -rf /', true], ['rm -rf ~', true],
  ['rm -rf ./*', true], ['rm -rf /root/workspace', true], ['rm -rf /system/x', true],
  ['find /sdcard -delete', true],
  ['dd if=/dev/zero of=/dev/block/by-name/boot', true],

  // ===== 重启 =====
  ['reboot', true], ['reboot recovery', true], ['reboot;', true], ['(reboot)', true],
  ['/system/bin/reboot', true], ['ls; reboot', true], ['echo x&&reboot', true],
  ['sudo reboot', true], ['svc power reboot', true],

  // ===== 不能误伤（第一~四轮被误拦过的，全是回归用例）=====
  ['echo "rm -rf /sdcard"', false], ['echo "sudo reboot now"', false],
  ['printf "use sudo reboot or nothing"', false], ['echo "su -c reboot"', false],
  ['echo "device offline"', false],
  ['grep "pm uninstall" /sdcard/notes.txt', false],
  ['grep -E "uninstall|clear" /sdcard/x', false],
  ['cat /sdcard/notes.txt | grep reboot', false],
  ['dumpsys activity | grep -i "rm -rf"', false],
  ['logcat -d | grep "rm -rf /data"', false], ['logcat -d | grep reboot', false],
  ['rm -f /sdcard/x.txt', false], ['rm -rf /tmp/build', false], ['rm -rf ./dist', false],
  ['cat > /sdcard/x <<EOF\npm uninstall com.x\nEOF', false],
  ['pm list packages', false], ['echo hi', false], ['dumpsys battery', false],
  ['ls /sdcard/Download', false], ['dumpsys diskstats', false],
  ['am start -n com.x/.Main', false],
  ['cat /proc/net/unix | grep devtools_remote', false],
];

let bad = 0;
for (const [cmd, should] of cases) {
  const hit = isDangerous(cmd);
  if (hit !== should) { bad += 1; console.log(`FAIL  ${should ? '该拦却放过' : '误拦'}: ${JSON.stringify(cmd)}`); }
}
console.log(`\n对照 ${cases.length} 条，异常 ${bad} 条`);
process.exit(bad ? 1 : 0);
