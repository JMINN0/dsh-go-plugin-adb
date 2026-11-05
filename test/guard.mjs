/**
 * guard.mjs — 命令确认机制的回归测试。
 * 跑法：node test/guard.mjs
 *
 * 设计是**允许名单（默认拒绝）**：只有只读命令直接放行，其余一律要求 confirm:true。
 * 早期版本用"危险写法拦截名单"，五轮复核每轮都能找到新绕过（setsid / $HOME /
 * find -exec / sh -c -- / printf|sh / heredoc 喂 sh / rm -rf // …），
 * 因为 shell 的写法是无穷的。换成默认拒绝之后，绕过在构造上就不成立：
 * 认不出的东西一律要确认，不需要枚举危险。
 */
import { needsConfirm } from '../src/tools.js';

const cases = [
  // ===== 必须要求确认（写过、或认不出的东西）=====
  // 包操作
  ['pm uninstall com.x', true], ['pm clear com.x', true], ['pm disable com.x', true],
  ['pm -d uninstall x', true], ['cmd package uninstall com.x', true],
  ['cmd package clear com.x', true],
  // 删除 / 破坏
  ['rm -rf /sdcard', true], ['rm -rf /', true], ['rm -rf //', true], ['rm -rf /.', true],
  ['rm -rf $HOME', true], ['rm -rf ~/*', true], ['rm -rf /**', true],
  ['rm -rf /{sdcard,data}', true], ['rm -f /sdcard/x.txt', true], ['rm -rf /tmp/build', true],
  ['find /sdcard -delete', true], ['cd /sdcard && find . -delete', true],
  ['find /sdcard -exec sh -c "rm -rf {}" \\;', true],
  ['dd if=/dev/zero of=/dev/block/by-name/boot', true],
  // 重启
  ['reboot', true], ['reboot;', true], ['(reboot)', true], ['/system/bin/reboot', true],
  ['svc power reboot', true], ['ls; reboot', true],
  // 包装式命令（不在白名单 → 要确认）
  ['sh -c "pm uninstall x"', true], ['sh -c -- "pm uninstall x"', true],
  ['bash -c "rm -rf /sdcard"', true], ['busybox sh -c "pm clear x"', true],
  ['sudo pm uninstall x', true], ['sudo -u shell pm uninstall x', true],
  ['sudo -i pm uninstall x', true], ['sudo -n pm uninstall x', true],
  ['env pm uninstall x', true], ['env -i pm uninstall x', true],
  ['env -S "pm uninstall x"', true], ['timeout 5 pm uninstall x', true],
  ['timeout --signal=KILL 5 pm uninstall x', true],
  ['nice -n 10 pm uninstall x', true], ['ionice -c 2 pm uninstall x', true],
  ['setsid sh -c "rm -rf /sdcard"', true], ['setsid pm uninstall x', true],
  ['eval "pm uninstall x"', true], ['$X pm uninstall x', true],
  ['xargs -I{} pm uninstall', true], ['echo x | xargs pm uninstall', true],
  ['su -c "pm uninstall x"', true], ['su root -c "pm uninstall x"', true],
  ['toybox rm -rf /sdcard', true], ['adb shell pm uninstall x', true],
  ['p""m uninstall com.x', true], ['pm un"install" com.x', true], ['p\\m uninstall x', true],
  // 喂 shell 的两种形态
  ['sh <<EOF\npm uninstall x\nEOF', true],
  ['printf "pm uninstall x" | sh', true],
  // 重定向写文件（动词只读也会写）
  ['echo x > /sdcard/f', true], ['cat /sdcard/a > /sdcard/b', true],
  // 写设置 / 注入输入 / 起应用
  ['settings put global x 1', true], ['am start -n com.x/.Main', true],
  ['input tap 1 1', true], ['screencap -p /sdcard/a.png', false],
  // 认不出的命令 → 默认拒绝
  ['someunknowncmd --flag', true], ['curl http://x', true], ['wget http://x', true],

  // ===== 直接放行（只读）=====
  ['getprop ro.build.version.release', false],
  ['getprop', false],
  ['dumpsys battery', false],
  ['dumpsys activity activities | grep Resumed', false],
  ['pm list packages', false],
  ['pm path com.x', false],
  ['pm dump com.x', false],
  ['cmd package list packages', false],
  ['settings get system accelerometer_rotation', false],
  ['logcat -d -t 10', false],
  ['logcat -d | grep FATAL', false],
  ['ls /sdcard', false],
  ['ls -la /sdcard/Download', false],
  ['cat /proc/net/unix', false],
  ['grep "pm uninstall" /sdcard/notes.txt', false],
  ['echo "rm -rf /sdcard"', false],
  ['echo hello', false],
  ['printf "%s\\n" hi', false],
  ['find /sdcard -name "*.apk"', false],
  ['ps -A | grep chrome', false],
  ['df -h /data', false],
  ['du -sh /sdcard/*', false],
  ['id', false],
  ['uname -a', false],
  ['sleep 1', false],
  ['cmd window size', false],
  ['echo x > /dev/null', false],
  ['logcat -d 2>&1', false],
];

let bad = 0;
for (const [cmd, should] of cases) {
  const hit = needsConfirm(cmd);
  if (hit !== should) { bad += 1; console.log(`FAIL  ${should ? '该要确认却放行' : '该放行却要确认'}: ${JSON.stringify(cmd)}`); }
}
console.log(`\n对照 ${cases.length} 条，异常 ${bad} 条`);
process.exit(bad ? 1 : 0);
