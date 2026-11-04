# v0.1.0

首个可发布版本。

## 能做什么
手机内的 agent 用 adb 连本机 adbd 的回环端口，关 WiFi 不断。六个工具：devices / reconnect / shell / install / logcat / screencap。

## 已验证
- 稳定性 10/10（连续 ensure ×30、连续 shell ×30、kill-server 自愈 ×5、disconnect 自愈 ×3、状态损坏、错端口回落、并发 ×3、超时、缺 adb、状态不可写）
- 危险命令拦截 28/28（含 `pm "uninstall"`、`cmd package uninstall`、`rm -rf /sdcard`、`echo x&&reboot`）
- 路径注入拒绝（`$(echo INJ)` 类写法）
- 工具注册 6/6

## 未验证
只测过 Android 16 / adb 34.0.4 / Node 24.22.1 一种组合。Android 11–13 和旧版 adb 没测。

## 安装
```bash
dsh plugin --profile web add git+https://github.com/<you>/dsh-plugin-adb
```
