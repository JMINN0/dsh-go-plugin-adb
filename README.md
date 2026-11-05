# dsh-go-plugin-adb

在**手机内部**给 Agent 一个真实的 adb shell。不是"电脑连手机"，是"Agent 住在这台手机里，连自己"。

[English](README.en.md) ｜ 中文

| 项目 | 值 |
|---|---|
| 版本 | 2026.1105.1908（年.月日.时分，看到这个号就知道是哪天哪一刻发的版） |
| 验证环境 | nubia REDMAGIC NX809J / Android 16 (SDK 36) / adb 34.0.4 |
| 工具数 | 6 |
| 需要 root | **不需要** |
| 稳定性 | 10/10 稳定性套件 + 40/40 危险命令拦截 |

---

## 一、这是什么

DSH Go 跑在手机上的 proot Ubuntu 里。这个插件让它能用 `adb` 命令操作**它自己所在的这台手机**：

- 装包、卸载包、看当前装了哪些包
- 看 logcat
- 执行任意 shell 命令（uid 2000）
- 截图、拉文件、推文件
- 查系统状态（电量、显示、窗口、进程）

**它解决的问题**：以前要操作手机，得用电脑插数据线连 adb，或者用无障碍去点屏幕。这个插件让 Agent 直接在自己身体里开一个 shell。

---

## 二、端口仍是 5555，但连的是回环地址

需要说清一点：**端口仍然是 5555**，这个插件没有换端口。区别在于"连哪个地址"——常规做法连的是局域网 IP，这里连的是回环 `127.0.0.1`。

`adb tcpip 5555` 之后，adbd 监听的是 `[::]:5555`——**整个网络栈**，不只是回环。

Agent 连 `127.0.0.1:5555`，流量走回环网卡，所以：

- ✅ 关 WiFi、开飞行模式都不断
- ✅ 不依赖路由器、不依赖同一局域网
- ⚠️ 但**同一局域网内的其他机器也能连到这个端口**（仍然需要你这台机器的 adb 私钥才能进）

不用时执行 `adb usb` 或关掉无线调试就收回了。

---

## 三、前提条件

**先说清三件事，不然后面每一步都会疑惑：**

| 疑问 | 答案 |
|---|---|
| 这些命令在哪跑？ | 全部在**手机内部的 proot Ubuntu** 里跑（DSH Go 提供的终端）。不是电脑。 |
| `192.168.1.100` 是谁的 IP？ | **手机自己的**局域网 IP。因为 adb 客户端和 adbd 在同一台设备上，所以配对时填手机上显示的那个 IP。 |
| 从 GitHub 克隆下来要构建吗？ | **不用**。纯 ESM 的 JS，没有构建步骤、没有 `npm install`。`package.json` 里的 `peerDependencies` 是可选的，缺了插件会走内置回退。 |

1. **一部 Android 手机**，开了开发者选项
2. **无线调试可用**（用于一次性配对）
3. **首次配对时手机要连着 WiFi**——配对走局域网。配对成功之后就不需要了，关 WiFi 也能用（见第二节）
4. **proot 环境能装 adb 客户端**：

```bash
apt-get update && apt-get install -y android-tools-adb
```

装完验证：

```bash
adb version
# Android Debug Bridge version 1.0.41
```

> 注意：DSH Go 升级运行时镜像时，apt 装的东西会全部丢失，需要重装一次 adb。这是实测过的坑。

---

## 四、安装

### 4.1 包从哪来

`dsh plugin add` 接受**两种**目标：

**方式 A：本地目录**（从 GitHub 克隆下来的人用这个）

```bash
git clone https://github.com/JMINN0/dsh-go-plugin-adb.git
cd dsh-go-plugin-adb
dsh plugin --profile web add .
```

注意 `add` 后面那个 `.` 表示"当前目录"。**必须先进到仓库目录再执行**，否则会报找不到包。

**方式 B：已发布的包名**（如果这个包已经发到 npm registry）

```bash
dsh plugin --profile web add dsh-go-plugin-adb
```

**该选哪个？** 这个包目前**没有发布到 npm registry**，只存在于 GitHub 仓库。所以：

- 从 GitHub 来的人 → 用**方式 A**（clone + `add .`）
- 报 `package not found` → 说明你用了方式 B，改回方式 A

### 4.1.1 如果 `add` 失败的常见原因

| 报错 | 原因 | 解法 |
|---|---|---|
| `package not found` / 找不到包 | 用了包名但没发布到 registry | 改用方式 A |
| 找不到 `package.json` | 没 `cd` 进仓库目录 | `cd` 进去后 `add .` |
| `ERR_MODULE_NOT_FOUND` | 目录不完整（比如只拷了部分文件） | 重新 clone |

### 4.2 `--profile web` 是什么意思

DSH 可以有多套 profile（配置档）。手机本机引擎用的那套就叫 `web`。

- 不加 `--profile` 会装到默认 profile，**手机 App 不会加载它**
- 必须写 `--profile web`，工具才会出现在你的手机上

**如果你的环境只有一个 profile**：先用 `dsh plugin --help` 看默认值是不是 `web`。是就照写；不是就仍然写 `--profile web`——因为手机 App 引擎加载的就是 `web` 这一套，装到别处不会生效。

### 4.3 装完要重启引擎

安装只改配置，不重载代码。**必须重启一次引擎**：

**路径：App 内 → 设置 → 引擎 → 重启引擎**

（命令行方式因版本而异，最稳的是用 App 里的按钮。）

重启后工具列表里会多出 6 个 `adb_*`。**不重启就看不到工具，这一条最容易漏。**

### 4.4 验证装好了

```bash
# ① 配置里有没有
python3 -c "
import json
d=json.load(open('$HOME/.dsh/profiles/web/package.json'))
print([b for b in d['dsh']['profile']['bundles'] if 'adb' in b])"
# 期望输出：['dsh-go-plugin-adb']

# ② 引擎有没有加载成功（没有 apply failed 就是好的）
grep -i "apply failed" ~/.dsh/dsh-app/diagnostics.md 2>/dev/null | grep adb || echo "没有加载错误 ✅"
```

两项都对、并且重启过引擎，工具才会出现。

### 4.5 最后一关：真的调一次工具（这才叫装好了）

**前面几步都只证明"配置对了"，证明不了"工具能用"。** 必须真调一次：

在 DSH Go 的对话里直接说：

```
用 adb_devices 看看现在连着哪些设备
```

Agent 会调用 `adb_devices`，期望返回：

```
127.0.0.1:5555  device
```

**看到这行才算真的装好了。** 如果 Agent 说"没有这个工具"，回到 4.3 确认重启过引擎；如果返回 `没有可用连接`，回到第五节重新配对。

> **工具怎么触发？** 这些工具是给 Agent 用的，不是给人敲的。你正常说话，Agent 自己决定调用哪个。你也可以直接点名："用 adb_shell 执行 getprop ro.product.model"。
>
> **工具列表在哪看？** 重启引擎后，DSH Go 的对话里 Agent 就能调用了。部分版本的界面上能看到可用工具清单，具体位置因版本而异——但只要能调成功，就不需要去界面上找。

---

## 五、一次性配对（只有第一次要）

这是 adb 的标准流程，不是插件特有的：

**顺序很重要，跳步会报 `no devices/emulators found`。**

```bash
# 1. 手机：开发者选项 → 无线调试 → 使用配对码配对设备
#    屏幕会显示两个东西：
#      - 配对用的 IP:端口（如 192.168.1.100:37123）
#      - 6 位配对码
#    另外「无线调试」主页面还有一个「IP 地址和端口」（如 192.168.1.100:41000），
#    这个和配对端口**不是同一个**，两个都要记下来。

# 2. 配对（用配对端口）
adb pair 192.168.1.100:37123
# 提示 Enter pairing code: 时输入 6 位码
# 成功会显示 Successfully paired to ...

# 3. 【不能跳】先连上无线调试端口，让 adb 有"已连接设备"才能执行下一步
adb connect 192.168.1.100:41000
# 成功显示 connected to 192.168.1.100:41000
# 失败检查：手机和电脑/本机是否同一网络、无线调试是否还开着

# 4. 固定端口到 5555（关键一步；没有第 3 步这里必报 no devices/emulators found）
adb tcpip 5555
# 成功显示 restarting in TCP mode port: 5555

# 5. 连回环（注意：这时连的是 127.0.0.1，不是局域网 IP）
adb connect 127.0.0.1:5555
adb -s 127.0.0.1:5555 shell id
# uid=2000(shell) gid=2000(shell) groups=... context=u:r:shell:s0
```

**为什么第 5 步用 127.0.0.1**：`adb tcpip 5555` 之后 adbd 监听 `[::]:5555`（整个网络栈），所以本机连回环也能进，而且还绕过了 WiFi。

**常见失败对照**：

| 报错 | 原因 | 解法 |
|---|---|---|
| `no devices/emulators found`（第 4 步） | 跳了第 3 步 | 回去执行第 3 步 |
| `failed to authenticate` | 密钥不匹配 | 手机上撤销 USB 调试授权，重新配对 |
| `cannot connect to 127.0.0.1:5555` | tcpip 没成功 | 重做第 3、4 步 |
| `connection refused` | adbd 没在监听 5555 | 手机重启过，重做第 4 步 |

**配对成功后密钥存在 `~/.android/adbkey`**，以后不用再配对，包括重装 adb 之后。

**手机重启后** `adb tcpip` 的设置会丢失，需要重新执行一次（插件里的 `adb_reconnect` 会尝试自动处理）。

---

## 六、六个工具

### `adb_devices`

列出当前连接的设备。无参数。

```
adb_devices
→ 127.0.0.1:5555  device
```

### `adb_shell`

执行 shell 命令，这是最常用的一个。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `command` | string | ✅ | 要执行的命令 |
| `timeoutMs` | integer | | 超时毫秒，默认 30000，最大 120000 |
| `confirm` | boolean | | 危险命令必须传 `true` 才执行 |

```
adb_shell { command: "getprop ro.build.version.release" }
→ 16
```

**命令里能用管道和 `&&` 吗？能。** 命令是整串交给 `adb shell` 执行的，所以这些都合法：

```
adb_shell { command: "pm list packages | grep tencent" }
adb_shell { command: "getprop ro.product.model && getprop ro.build.version.release" }
adb_shell { command: "dumpsys battery | grep -E 'level|status'" }
```

**返回值**：`{ text: "..." }`。命令无输出时返回 `(无输出)`；连接层面失败会返回 `连不上，已试过端口：...`。注意：命令本身跑失败（比如 grep 没匹配到）**不算**连接失败，`text` 里会有内容。

**危险命令拦截名单**：下面这些必须显式传 `confirm: true`，否则直接拒绝执行（注意这是**拦截**名单，不是"白名单"——早期版本用错了术语）：

- `pm uninstall <包>` / `pm uninstall -k <包>`
- `pm clear <包>`
- `pm disable <包>` / `pm disable-user <包>`
- `pm enable` 以外的 `cmd package` 写操作（如 `cmd package uninstall`、`cmd package clear`）
- `rm -rf /sdcard` 及其变体
- `reboot` / `recovery`

**`confirm` 的语义**：只有传 `true` 才放行；传 `false` 和不传**完全等价**（都会被拒）。拦截测试 40/40 通过，包括用引号绕过的变体：

```
pm "uninstall" com.foo.bar     ← 同样被拦
pm uninstall 'com.foo.bar'     ← 同样被拦
```

**被拒之后怎么办**：先把后果跟用户说清楚，得到同意再带 `confirm: true` 重发。卸载应用前必须先用 aapt 读 APK 的真实中文名——包名不可信（这条是踩过事故的：`com.xiaoji.egggame.redmagic` 看着像游戏，实际是红魔用来跑 PC 游戏的「盖世游戏」组件）。

### `adb_install`

安装 APK。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `path` | string | ✅ | 设备上的绝对路径，如 `/sdcard/app.apk` |
| `reinstall` | boolean | | 加 `-r` 保留数据，默认 true |
| `downgrade` | boolean | | 加 `-d` 允许降级，默认 false |

```
adb_install { path: "/sdcard/Download/app.apk" }
→ { text: "Success" }  或失败原因（如 INSTALL_FAILED_UPDATE_INCOMPATIBLE）
```

**path 用哪种路径**：用**设备上的路径**（`/sdcard/...`），不是 proot 里的路径。proot 的 `/root/xxx` 设备看不到，要先 push 过去。

**`reinstall: false` 且已装同包**：会安装失败（包已存在）。这种场景一般用默认的 `reinstall: true` 覆盖。

**签名不一致**：失败。要么先卸载旧的（数据会丢，需用户同意后传 `confirm: true` 到 `adb_shell`），要么用同一密钥重新签名。

### `adb_logcat`

读日志尾部，不会留长驻进程。

| 参数 | 类型 | 说明 |
|---|---|---|
| `lines` | integer | 取多少行，默认 200，最大 5000 |
| `filter` | string | 过滤规则，**支持正则**（走 `grep -E`）。简单单词也是合法的正则 |

```
// 单关键词
adb_logcat { filter: "FATAL", lines: 100 }
// 正则：多个关键词或起来
adb_logcat { filter: "AndroidRuntime|FATAL|ANR", lines: 200 }
```

返回值是纯文本尾部。匹配不到时返回 `（最近 N 行里没有匹配 "X" 的内容）`，这是正常结果不是错误。

### `adb_screencap`

截图并保存。**两个参数都是可选的，`adb_screencap {}` 也合法**（会用默认路径截主屏）。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `outPath` | string | | 设备侧路径，默认 `/sdcard/dsh-screencap.png` |
| `localPath` | string | | 同时拉回到 proot 的本地路径，如 `/tmp/shot.png` |

```
// 截主屏到默认位置
adb_screencap {}

// 截到指定位置，并拉回 proot
adb_screencap { outPath: "/sdcard/a.png", localPath: "/tmp/a.png" }
→ { text: "已保存：/sdcard/a.png（拉回 /tmp/a.png）" }
```

注意：截的是**主屏**。要截虚拟屏上的内容，那是 `dsh-go-plugin-screen` 的事，不是这个插件。

### `adb_reconnect`

强制重建连接：杀本地 adb server、重启、把无线调试端口迁移到 5555、验证 uid 2000。无参数。

手机重启后、或者 `adb_devices` 显示 offline 时用。

---

## 七、能做什么、不能做什么

**能做**（都是实测过的）：

```bash
pm list packages / pm path / pm install / pm uninstall
am start / am force-stop / am broadcast
logcat / dumpsys / getprop / settings
screencap / input / cmd window / cmd notification
```

⚠️ 其中 `cmd package` 的**写操作**（uninstall / clear / disable）属于拦截名单，要 `confirm: true`；读操作（`cmd package list packages` 等）不受限。

**关于 pull / push**：这六个工具里**没有**专门的 pull/push 工具。要传文件用 `adb_shell` 执行设备侧的 `cp`、`mkdir` 等；从 proot 往设备传文件，用插件外的 `adb push`（也就是在 proot 命令行里直接敲，不走插件工具）。这是文档早期版本的一个错误表述，已更正。

**不能做**：

| 限制 | 原因 |
|---|---|
| 读 `/data/data`、`/data/app` | SELinux 拦着，uid 2000 进不去 |
| `run-as` 别的 App | 只对 debuggable 的包有效 |
| 需要 root 的命令 | 没有 root |
| 跨用户访问 | 只能操作当前用户 |

---

## 八、稳定性与兼容性

完整的测试报告在 [STABILITY.md](STABILITY.md)，摘要：

**稳定性 10/10**，逐条解释（`ensure` 是插件内部的"确保连接可用"动作，不是工具名）：

| 测试 | 含义 |
|---|---|
| 连续 ensure ×30 | 反复请求连接 30 次，平均 33ms，最慢 56ms |
| 连续 shell ×30 | 连续执行 30 条命令，全部成功 |
| `kill-server` ×5 自愈 | 手动杀掉 adb server 5 次，插件都能重新拉起来 |
| `disconnect` ×3 自愈 | 手动断开连接 3 次，都能自动重连 |
| 状态文件损坏能回落 | `state.json` 写坏了不影响使用，会退回默认端口 |
| 错端口能回落 | 状态文件里记的端口不通时，自动试 5555 |
| 并发 ensure ×3 | 三个请求同时要连接，不会互相踩 |
| 超时不挂死 | 命令卡住会返回错误，不会让整个插件吊死 |
| adb 缺失时不退进程 | 没装 adb 时返回可读错误，**不会把引擎进程带崩** |
| 状态文件不可写不崩 | 磁盘只读时仍然能工作 |

**兼容性**：

| 已验证 | 未验证 |
|---|---|
| Android 16 | Android 11–15、Android 10 及更早 |
| adb 34.0.4 | adb 1.0.39 以下 |
| nubia NX809J | 三星、小米、Pixel 等其他厂商 adbd |
| Linux proot | Windows / macOS 主机 |

**端口自动协商**：插件按这个顺序尝试 `state.port`（上次成功的端口）→ 5555 → 6555 → 7555 → 8555 → 9555。

候选里没有 5556、5557 这些紧邻的端口，是因为 **5554–5585 是 Android 模拟器的固定占用段**（这台设备上就有一个 `emulator-5554`），继续往上加会撞。所以第二个候选直接跳到 6555。这些端口由 adbd 在 `adb tcpip <port>` 时监听。

端口记在哪：`~/.dsh/plugin-adb/state.json`，内容形如：

```json
{ "port": 5555, "lastOkAt": 1793871234567 }
```

想知道当前用的哪个端口，直接读这个文件：

```bash
cat ~/.dsh/plugin-adb/state.json
```

---

## 九、返回值契约（实测结果，不是承诺）

所有工具都返回 `{ text: string }`，不抛异常。下面是**实测**的返回值，不是设计意图。

### `adb_shell`

| 情况 | 实际返回 text |
|---|---|
| 正常有输出 | 命令的 stdout |
| 成功无输出 | `(无输出)` |
| **超时** | `命令超时（2000ms 内没结束）。要更长时间就调大 timeoutMs。` + 命令原文 |
| **退出码非 0** | `命令失败（退出码 1）` + 命令原文（如果 stderr 有内容，会附在 `[stderr]` 行后） |
| 命中拦截名单 | `已拒绝：这条命令会改用户数据或卸载/停用应用。` + 命令原文 + 重试指引 |
| 连接失败 | `连不上，已试过端口：...` + 三步配对指引 |

**怎么判断成功**：`text` 里含 `命令超时` / `命令失败` / `已拒绝` / `连不上` 就是失败。

### `adb_devices`

返回形如：

```
adb devices:
127.0.0.1:5555	device

回环目标 127.0.0.1:5555: 已就绪（NX809J）
记住的端口: 5555 · 上次成功: 1793888292386 · 重连次数: 0
```

没设备时：第一段是 `（没有任何设备）`，后面仍会给出端口状态。

### `adb_logcat`

| 情况 | 实际返回 |
|---|---|
| 有匹配 | 匹配到的日志行 |
| **无匹配** | `（最近 20 行里没有匹配 "XXX" 的内容）`——**这是正常结果，不是错误** |
| filter 含非法字符 | `filter 含不支持的字符：...` + 允许的字符集说明 |

`filter` **走 `grep -E`，支持正则**：`"AndroidRuntime|FATAL|ANR"`、`"zygote|init"` 都可以。

### `adb_install`

| 情况 | 实际返回 |
|---|---|
| 成功 | `安装成功：<设备路径>` |
| 失败 | `Failure [INSTALL_FAILED_xxx: 原因]` |

常见失败码：`INSTALL_FAILED_UPDATE_INCOMPATIBLE`（签名不一致）、`INSTALL_FAILED_VERSION_DOWNGRADE`（需 `downgrade: true`）、`INSTALL_FAILED_INSUFFICIENT_STORAGE`（空间不足）。

### `adb_screencap`

成功返回两行：

```
截图已保存：/sdcard/dsh-ct.png
-rw-rw---- 1 u0_a490 media_rw 1575442 2026-11-05 22:18 /sdcard/dsh-ct.png
```

带 `localPath` 时多一行 `已拉到本地：/tmp/xxx.png`。失败返回 `截图失败：<原因>`。

### `adb_reconnect`

返回重建过程与结果，成功包含 uid 2000 的验证行。

---

## 九点五、危险命令拦截的边界（重要）

**这是"防手滑"，不是安全边界。**

能拦住（实测 9/9）：直接写法、引号拼接（`p""m uninstall`、`pm un"install"`、`cmd "package" uninstall`）、`find /sdcard -delete`、`su -c reboot`、`svc power reboot`、`rm -rf *`。

**拦不住**：`$(echo cm0)` 这种动态拼接、alias、自己写脚本、`adb shell` 之外的路子。

真要防住，得靠系统权限（不给 shell、用受限用户）。这个插件只是降低误触概率。

---

## 十、卸载与回滚

出问题想退回原状，两步：

```bash
# 1. 从 profile 移除
dsh plugin --profile web remove dsh-go-plugin-adb

# 2. 重启引擎（App：设置 → 引擎 → 重启）
```

**验证已移除**：

```bash
python3 -c "
import json
d=json.load(open('$HOME/.dsh/profiles/web/package.json'))
print([b for b in d['dsh']['profile']['bundles'] if 'adb' in b])"
# 期望输出：[]
```

**注意**：卸载插件**不会**撤销已经做的系统改动。比如之前 `adb tcpip 5555` 开的端口还在，要收回执行：

```bash
adb usb          # 切回 USB 模式（如果连着线）
# 或者手机里关掉无线调试
```

**想完全清理**：卸载后删掉状态文件 `~/.dsh/plugin-adb/state.json`，里面只存端口和上次成功时间。

---

## 十一、排错

**装完工具没出现**

```bash
# 1. 检查 bundles 列表
python3 -c "
import json;d=json.load(open('$HOME/.dsh/profiles/web/package.json'))
print(d['dsh']['profile']['bundles'])" | grep adb

# 2. 检查引擎日志里的 apply failed
grep -i "apply failed" ~/.dsh/dsh-app/diagnostics.md | grep adb

# 3. 重启引擎
```

**`device not found`** — 按顺序试，别跳步：

```bash
# 1. 先直连
adb connect 127.0.0.1:5555
adb devices

# 2. 还不行 → 读插件记的端口，换那个再试
cat ~/.dsh/plugin-adb/state.json
adb connect 127.0.0.1:<state.json 里的 port>

# 3. 还是不行 → 多半手机重启过，adbd 不在 5555 了。
#    注意：这时直接跑 adb tcpip 5555 会失败（没有已连接设备），
#    必须先重建无线调试连接：
#      a) 手机：开发者选项 → 无线调试（重新打开）
#      b) 记下「IP 地址和端口」（每次重开都会变）
#      c) adb connect <那个 IP:端口>
#      d) adb tcpip 5555
#      e) adb connect 127.0.0.1:5555
```

**为什么 `adb_reconnect` 救不了重启后的场景**：它内部也是"先有连接才能迁移端口"。手机重启后必须走上上面第 3 条的人工链。`adb_reconnect` 只适合"连接还在但不稳定"（forward 残留、socket 卡住）。

**`unauthorized`**

密钥丢了。重新走一遍第五节的配对流程。

**`adb: command not found`**

```bash
apt-get update && apt-get install -y android-tools-adb
```

---

## 十二、原理

```
Agent (proot Ubuntu)
   ↓ adb -s 127.0.0.1:5555 shell ...
adb client (uid 2000)
   ↓ 回环 TCP 127.0.0.1:5555
adbd (手机系统)
   ↓
Android 系统服务（pm / am / dumpsys / input / screencap ...）
```

没有使用任何私有接口，全部走标准 adb 协议。所以 adb 能做的事它都能做，adb 做不了的它也做不了。

---

## 十三、许可

MIT。见 [LICENSE](LICENSE)。
