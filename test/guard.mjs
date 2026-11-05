/**
 * guard.mjs — 不可逆操作刹车的回归测试。
 * 跑法：node test/guard.mjs
 *
 * 定位：**这不是安全边界，只是防止一次误读指令就把数据删光。**
 * 拿到 adb 权限的人本来就能做任何事，confirm 也是调用方自己填的布尔值；
 * 所以这里不枚举危险写法，只保留几种"手滑一下就无法挽回"的操作。
 * 用户 2026-11-05 明确要过：日常操作不要拦。
 */
import { needsConfirm } from '../src/tools.js';

const cases = [
  // ===== 该踩刹车（不可逆）=====
  ['pm uninstall com.x', true], ['pm clear com.x', true], ['pm -d uninstall x', true],
  ['cmd package uninstall com.x', true], ['cmd package clear com.x', true],
  ['rm -rf /sdcard', true], ['rm -rf /', true], ['rm -rf /data', true],
  ['rm -rf /system', true], ['rm -rf ~', true], ['rm -rf /storage', true],
  ['reboot', true], ['reboot recovery', true], ['ls; reboot', true],
  ['dd if=/dev/zero of=/dev/block/by-name/boot', true],
  ['mkfs.ext4 /dev/block/x', true],

  // ===== 不该拦（日常操作，用户要自由）=====
  ['am start -n com.x/.Main', false], ['am force-stop com.x', false],
  ['input tap 100 200', false], ['input text "hello"', false],
  ['settings put global x 1', false], ['settings get system x', false],
  ['rm -f /sdcard/x.txt', false], ['rm -rf /tmp/build', false], ['rm -rf ./dist', false],
  ['pm list packages', false], ['pm path com.x', false], ['pm dump com.x', false],
  ['getprop ro.build.version.release', false], ['dumpsys battery', false],
  ['logcat -d -t 10', false], ['logcat -c', false], ['ls /sdcard', false],
  ['screencap -p /sdcard/a.png', false], ['find /sdcard -name "*.apk"', false],
  ['echo "pm uninstall"', false], ['grep "rm -rf" /sdcard/x', false],
  ['curl -s http://x', false], ['sh -c "echo hi"', false], ['setsid echo hi', false],
  ['cmd package list packages', false], ['ps -A | grep chrome', false],
  // 包装命令照样能刹住（pm uninstall 只要出现在命令行里就会命中）
  ['setsid pm uninstall x', true], ['sudo pm uninstall x', true],
  ['busybox pm clear com.x', true],
  // 已知能被绕过（危险命令藏在引号里）——这是刹车不是安全边界，故意不算失败
  ['sh -c "pm uninstall x"', false], ['eval "pm uninstall x"', false],
  ['p""m uninstall x', false],
];

let bad = 0;
for (const [cmd, should] of cases) {
  const hit = needsConfirm(cmd);
  if (hit !== should) { bad += 1; console.log(`FAIL  ${should ? '该刹车却没刹' : '误拦(日常操作不该动)'}: ${JSON.stringify(cmd)}`); }
}
console.log(`\n对照 ${cases.length} 条，异常 ${bad} 条`);
process.exit(bad ? 1 : 0);
