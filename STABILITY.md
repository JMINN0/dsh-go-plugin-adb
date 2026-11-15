# 稳定性与兼容性说明

版本：2026.1105.1908 ｜ 最后验证：2026-11-06 ｜ 验证环境：nubia REDMAGIC NX809J / Android 16 (SDK 36) / adb 34.0.4 / DSH 0.2.2-rc.1

## 一句话

核心逻辑测透了，**单机型验证**；跨机型、跨 adb 版本未验证。

## 已通过的测试

| 项目 | 结果 | 说明 |
|---|---|---|
| 稳定性套件 `test/stability.mjs` | **10/10 通过** | 21 秒，含断线自愈、并发、超时、状态损坏 |
| 工具定义 `test/contracts.mjs` | **6/6 通过** | 用宿主自己的 defineTool 编译，防"能加载但对话发送报错" |
| 真实引擎加载 | 通过 | 工具可在会话里直接调用 |
| 压力测试 | 通过 | 并发 10 个命令 10/10；连续 200 次 200/200；adb server 被杀期间 20 路并发 20/20 |

### 稳定性套件覆盖的十个场景

| 测试 | 含义 |
|---|---|
| 连续 ensure ×30 | 反复请求连接 30 次，平均约 40ms，最慢约 70ms |
| 连续 shell ×30 | 连续执行 30 条命令，全部成功 |
| `kill-server` ×5 自愈 | 手动杀掉 adb server 5 次，插件都能重新拉起来 |
| `disconnect` ×3 自愈 | 手动断开 3 次，都能自动重连 |
| 状态文件损坏能回落 | `state.json` 写坏了不影响使用，退回默认端口 |
| 错端口能回落 | 状态文件记的端口不通时，自动试 5555 |
| 并发 ensure ×3 | 三个请求同时要连接，不会互相踩 |
| 超时不挂死 | 命令卡住会返回错误，不会让插件吊死 |
| **adb 缺失时不退进程** | 没装 adb 时返回可读错误，不会把引擎带崩 |
| 状态文件不可写不崩 | 磁盘只读时仍然能工作 |

## 已适配

- Android 16 (SDK 36)
- adb 34.0.4（`android-tools-adb`）
- DSH 0.2.2-rc.1（只用公开的 `defineTool`，不绑定引擎内部包版本）
- Node 24.22.1（要求 ≥22.19）
- 端口自动协商：`state.port` → 5555 → 6555 → 7555 → 8555 → 9555
- 断 WiFi / 飞行模式：仍然可用（走 `127.0.0.1:5555` 回环）

## 未验证（老实说）

1. **其他 Android 版本**（11–15、Android 10 及更早）
2. **其他 adb 版本**（特别是 1.0.39 以下）
3. **其他厂商 adbd**（三星、小米、Pixel 是否允许 `adb tcpip` 后回环连接）
4. **Windows / macOS 主机**（本插件只针对手机内部 proot）
5. **手机重启后的自动恢复**：`adb tcpip 5555` 不是持久设置，重启后要重开无线调试拿新端

   **2026-11-16 补：已经从 `services.jar` 反编译确认了机制，不是猜的。**

   `AdbService.systemReady()` 开机时做的是：
   ```java
   mIsAdbUsbEnabled  = getprop("persist.sys.usb.config") 含 "adb"
   mIsAdbWifiEnabled = getprop("persist.adb.tls_server.enable") == "1"
   putInt(adb_enabled,      mIsAdbUsbEnabled)      // settings 被属性覆盖
   putInt(adb_wifi_enabled, mIsAdbWifiEnabled)
   ```

   **方向是「属性 → 设置」，不是反过来。** 所以：

   | 属性 | 本机值 | 重启后 |
   |---|---|---|
   | `persist.sys.usb.config` | `adb` | adbd 以 **USB 模式**启动 |
   | `service.adb.tcp.port` | `5555` | **清零**（运行时属性） |
   | `persist.adb.tcp.port` | 空 | 写不进去，SELinux 拒绝 `setprop` |

   **结果：重启后 127.0.0.1:5555 不通，插件连不上，必须人工救一次。**

   补救只有两条：插 USB 线到电脑，或者手动开无线调试。

   **手改 `adb_wifi_enabled` 是无效的**（实测过）：写进去了，但
   `service.adb.tls.port` 始终为空，`dumpsys adb` 里也没有无线调试端口。
   因为这个设置只是属性的「影子」，改了影子不会驱动本体。`cmd adb` 也没有
   enable 子命令，`setprop persist.adb.tls_server.enable 1` 被 SELinux 拒。
   **无线调试的开关只能由 Settings 走 AdbManager 的服务调用打开。**

   反过来说：**只要用 UI 打开过一次无线调试，`persist.adb.tls_server.enable=1`
   会持久，下次开机会自动恢复无线调试。** 但无线调试依赖 WiFi 连着，
   WiFi 断了就没了 —— 这也是插件默认走回环的原因。口
6. **600 秒超时是否真能跑满**（只测了 3 秒命令配 300 秒超时）
7. **`reboot` 是否真能执行**（只核到权限已授予，没敢触发）

## 已知限制（不是权限问题）

| 限制 | 原因 |
|---|---|
| 输出上限 32MB | 内存保护；超出返回失败但前 32MB 仍在 |
| 没有 stdin | `adb shell` 本身不支持，交互式命令（`top`/`vi`）用不了 |
| 二进制输出会损坏 | 输出按 UTF-8 解码；要看二进制用 `od` / `base64` 转 |
| 读不了 `/data/data` | SELinux 挡着 uid 2000 |
| 每次调用多一次探测 | 约 50ms（换来断线自愈） |
| 取消工具不会杀远端命令 | 超时后设备侧可能继续跑 |

## 依赖

- 宿主：`@deepseek-ai/dsh-tools`（可选 peer，插件内有五级路径回退）
- 设备侧：`adb` 二进制（`apt-get install -y android-tools-adb`）
