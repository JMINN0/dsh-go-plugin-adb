# dsh-go-plugin-adb

在**手机内部**给 agent 开一个真实的 adb shell。不是"电脑连手机"，是"agent 住在这台手机里，连自己"。

```bash
dsh plugin --profile web add dsh-go-plugin-adb
```

装完重启一次引擎，工具列表里会多出六个 `adb_*`。

## 为什么不是 5555 这条老路

`adb tcpip 5555` 之后 adbd 监听的是 `[::]:5555`，**整个网络栈**，不只是回环。agent 连 `127.0.0.1:5555` 走回环，所以关 WiFi、开飞行模式都不受影响——这一点和 Shizuku 同级。

但准确的说法是"监听地址包含回环"，不是"只开回了环"。**同一局域网里的其他机器也能连到这个端口**（仍需你那把 adb 私钥才进得去）。不用时 `adb usb` 或关掉无线调试就收回了。

同类项目都是 PC→手机（[droidmind](https://pypi.org/project/droidmind/)、[adb-tui](https://pkg.go.dev/github.com/alanisme/adb-tui)），这个场景没有现成对手。

## 一次性配对（只有第一次要）

```bash
apt-get update && apt-get install -y android-tools-adb     # 1. 装客户端

# 2. 手机：设置 → 开发者选项 → 无线调试 → 打开，读出「配对码 + 端口」
adb pair 127.0.0.1:<配对端口>      # 3. 输入配对码
adb connect 127.0.0.1:<调试端口>
adb tcpip 5555                     # 4. 固定到 5555，之后不再需要配对
adb connect 127.0.0.1:5555
```

配对码只能由人提供，插件不承诺"一键"，只保证配对之后不用再管。

## 端口怎么选：不硬编码 5555

`adb tcpip <port>` 会把 adbd 挪到你指定的端口。如果一个端口被占、或者上次用的是别的端口，硬写 5555 就会一直连不上。所以策略是：

1. **候选顺序**：`state.json` 里上次成功的端口 → `5555` → `6555` → `7555` → `8555` → `9555`
2. **两个阶段**：先把所有候选**直连**一遍（便宜、不动设备）；全不通才用现有连接做 `tcpip` 迁移
3. **记住结果**：成功的端口写进 `$DSH_HOME/plugin-adb/state.json`，下次直接用

> **踩过的坑**：`5554–5585` 是 adb 认作「模拟器」的端口段。连这段会凭空冒出 `emulator-55xx` 假条目，把迁移逻辑带偏。所以备选端口一律跳到这个区间之外；设备列表里的 `emulator-*` 也会被过滤掉。
>
> **第二个坑**：第一版先迁移后直连，结果把一条本来好好的 5555 连接主动挪到了过期的 5557 上。现在的顺序是「先直连、后迁移」，并且迁移只在前者全失败时发生。

## 自动恢复

插件没有常驻进程，恢复只能发生在**被调用的那一刻**。所以：

- 每个工具调用都先走 `ensure()`：缓存端口能用就直接用，不能用就重新找
- 命令级重试：`device offline` / `no devices` / `protocol fault` 这类**瞬时错误**会自动 `kill-server` 重连一次再执行；其他错误不重试（重试也还是错）
- 重启后 adbd 会回到无线调试的**随机端口**。插件会用 `adb mdns services` 读 `_adb-tls-connect._tcp` 里的端口，连上去再 `tcpip` 固定回来——**不需要用户报端口**

## 六个工具

| 工具 | 作用 |
|---|---|
| `adb_devices` | 看设备、回环状态、记住的端口 |
| `adb_reconnect` | 强制重连：kill-server → 找端口 → 验 uid 2000 |
| `adb_shell` | 跑一条命令，带重试和危险命令拦截 |
| `adb_install` | 装/重装 APK，失败时翻译成可读原因 |
| `adb_logcat` | 读日志尾巴，可先清空、可按 tag 过滤 |
| `adb_screencap` | 截图，可选顺便 pull 到本地 |

## 能力边界（2026-11-04 实测）

**能**：`pm list/path/install/uninstall`、`am start`、`logcat`、`dumpsys`（含 diskstats）、`screencap`、`pull/push`、`input`。

**不能**：读 `/data/data`、`/data/app`（SELinux 拦）；`run-as` 只对 `debuggable` 包有效；不是 root。

恢复被卸载的系统应用：`pm install-existing --user 0 <包名>`。

## 安全

这是 **uid 2000 的 shell**：能装包、能跑命令、能读大多数用户数据。

- 危险命令（`pm uninstall` / `pm clear` / 删用户数据 / `reboot`）**不传 `confirm: true` 直接拒绝**
- 卸载前先用 `aapt dump badging` 读 APK 的**真实中文名**——包名会骗人（真实案例：`com.xiaoji.egggame.redmagic` 是红魔「盖世游戏」，不是蛋仔派对）
- 端口对整个网络栈开放，靠 adb 私钥鉴权；不使用时 `adb usb` 或关掉无线调试收回
- 只在**用户本人的设备**上、得到明确同意后使用

## 排障

| 现象 | 原因 | 做法 |
|---|---|---|
| `unauthorized` | 手机没点「允许调试」 | 手机上确认授权 |
| 连不上任何端口 | 无线调试关了 / 密钥被撤销 | 重新配对 |
| 突然出现 `emulator-55xx` | 探测落在 5554–5585 段 | `adb disconnect emulator-55xx`，插件已过滤 |
| 重启后失效 | `service.adb.tcp.port` 是运行时的 | `adb_reconnect`；要扛重启只能 root 写 `persist.adb.tcp.port` |
| 命令卡住 | 目标进程无响应 | 传 `timeoutMs`，上限 120000 |

## License

MIT
