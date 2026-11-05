# 发布记录

## v2026.1105.1908

首个可发布版本。

### 包含

- 6 个工具：`adb_devices` / `adb_shell` / `adb_install` / `adb_logcat` / `adb_screencap` / `adb_reconnect`
- 手机内回环连接（`127.0.0.1:5555`），关 WiFi 也能用
- 命令确认机制（`pm uninstall` / `rm -rf /sdcard` / `reboot` 等需显式 `confirm: true`）
- 端口自动协商（5555 → 6555 → 7555 → 8555 → 9555）
- 断线自愈（`kill-server` / `disconnect` 后自动重连）

### 本版修的关键问题（发送前终审发现）

| 问题 | 影响 | 修法 |
|---|---|---|
| 业务命令可能被执行两遍 | `curl` 等命令的 stderr 含 `connection reset` 时被当成连接故障重试 | 只有调用方显式标记幂等的命令才重试；业务命令一律不重跑 |
| 并发惊群 | server 被杀时 10 路并发只有 5 路成功，且互相 `kill-server` | 加进程内 single-flight；重试先 `start-server` 不再无脑 kill |
| 状态文件丢更新 | 20 路并发 `reconnects++` 只有 1 次生效 | 写操作串行排队 + `tmp+rename` 原子替换 + `bump()` 原子自增 |
| `logcat filter` 文档与实现矛盾 | 文档示例 `"A|B"` 被安全校验拒绝，用户第一条命令就失败 | 允许正则字符并用单引号包裹防注入；`grep` 退出码 1 视为"无匹配"而非错误 |
| 返回值文案 | 超时/失败返回内部 `Command failed: adb ...` 噪声 | 剥掉内部调用细节，超时和退出码给出可读说明 |
| 测试污染真实状态 | 跑测试会改掉用户的 `~/.dsh/plugin-adb/state.json` | 测试启动前设 `DSH_ADB_STATE_DIR` 到临时目录，结束清理 |

### 验证

- 稳定性套件 10/10
- 命令确认机制 93/93
- 工具契约 6/6 通过宿主 `defineTool` 编译
- 真实引擎 trial PASS
- 从 GitHub 克隆后可正常注册 6 个工具

### 已知边界

- 只在 Android 16 + adb 34.0.4 + nubia NX809J 上验证
- 命令确认机制是"防手滑"，不是安全边界（`$(...)` 动态拼接、alias、自写脚本可绕过；`p""m` 这类拼接已能拦）
- 无 root，读不了 `/data/data`
