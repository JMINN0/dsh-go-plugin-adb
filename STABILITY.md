# 稳定性与兼容性说明

版本：2026.1105.1908 ｜ 最后验证：2026-11-05 ｜ 验证环境：nubia REDMAGIC NX809J / Android 16 (SDK 36) / adb 34.0.4

## 一句话

核心逻辑测透了，单设备验证；跨机型、跨 adb 版本未验证。

## 已通过的测试（都是实测，不是推断）

| 项目 | 结果 |
|---|---|
| 稳定性套件 `test/stability.mjs` | **6/6 通过** |
| 工具定义校验 `test/contracts.mjs` | **6/6 通过** |
| 宿主工具契约（defineTool 编译） | **6/6 通过** |
| 真实引擎加载 | 通过（安全模式 trial：13 秒启动 + 稳定 30 秒） |

稳定性套件覆盖的十个场景：

1. 连续 ensure ×30：6/6 成功，平均 33 ms，最慢 56 ms
2. 连续 shell ×30：6/6 成功
3. `adb kill-server` ×5：6/6 自愈
4. `adb disconnect` ×3：6/6 自愈
5. 状态文件损坏：能回落
6. 错端口：能回落到 5555
7. 并发 ensure ×3：端口一致，无冲突
8. 超时：返回 `ok=false`，不挂死
9. adb 缺失：返回可读错误，**不退进程**（这一项修过一次真 bug）
10. 状态文件不可写：不崩

工具定义校验覆盖：`pm uninstall` / `pm clear` / `pm disable`、`cmd package ...`、`rm -rf /sdcard`、`reboot` / `recovery`，以及靠引号绕过的变体（`pm "uninstall"`）。

## 已适配

- Android 16 (SDK 36)
- adb 34.0.4（Debian 包 `android-tools-adb`）
- 端口自动协商：`state.port` → 5555 → 6555 → 7555 → 8555 → 9555（避开模拟器占用段）
- 断 WiFi / 飞行模式：仍然可用（走 `127.0.0.1:5555` 回环）

## 未验证（老实说）

1. **其他 Android 版本**（11–15、Android 10 及更早）
2. **其他 adb 版本**（特别是 1.0.39 以下的老版本）
3. **其他厂商的 adbd**（三星、小米、Pixel 是否同样允许 `adb tcpip` 后回环连接）
4. **Windows / macOS 主机**（本插件只针对手机内部 proot 环境）
5. **Android 重启后的自动恢复**：`adb tcpip 5555` 不是持久设置，重启后需要重新执行一次

## 已知限制

- 无 root。读不了 `/data/data`、`/data/app`（SELinux）；`run-as` 只对 debuggable 包有效
- 首次使用需要一次性配对（`adb pair`），之后靠 `~/.android/adbkey` 免配对
- 环境升级（如 dsh-go 运行时镜像换代）会清空 apt 装的 adb，需要重装

## 依赖

- 宿主：`@deepseek-ai/dsh-tools`（可选 peer，插件内有五级路径回退）
- 设备侧：`adb` 二进制（`apt-get install -y android-tools-adb`）
