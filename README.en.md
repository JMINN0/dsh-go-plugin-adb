# dsh-go-plugin-adb

Give an agent a real adb shell **from inside the phone**. This is not "PC connects to phone" — it is "the agent lives in this phone and connects to itself".

English ｜ [中文](README.md)

| Item | Value |
|---|---|
| Version | 2026.1105.1908 (year.monthday.hourminute — the number tells you exactly when it was built) |
| Verified on | nubia REDMAGIC NX809J / Android 16 (SDK 36) / adb 34.0.4 |
| Tools | 6 |
| Root required | **No** |
| Stability | 10/10 stability suite + 40/40 dangerous-command guard |

---

## 1. What this is

DSH Go runs inside a proot Ubuntu on an Android phone. This plugin lets it use `adb` commands to operate **the very phone it lives on**: install and uninstall packages, read logcat, run arbitrary shell commands (uid 2000), take screenshots, inspect system state.

**The problem it solves**: before this, operating the phone meant either a PC with a USB cable, or poking the screen through accessibility. This plugin gives the agent a shell inside its own body.

---

## 2. The port is still 5555 — but it connects over loopback

To be precise: **the port is still 5555**; this plugin does not change it. What changes is *which address* you connect to — a LAN IP in the usual setup, `127.0.0.1` here.

After `adb tcpip 5555`, adbd listens on `[::]:5555` — the **entire network stack**, not just loopback. The agent connects to `127.0.0.1:5555`, so traffic stays on the loopback interface:

- ✅ survives Wi-Fi off and airplane mode
- ✅ no router, no shared LAN needed
- ⚠️ but **other machines on the same LAN can also reach that port** (they still need this phone's adb private key)

Run `adb usb` or turn wireless debugging off to close it again.

---

## 3. Prerequisites

**Three things worth settling first, or every later step will confuse you:**

| Question | Answer |
|---|---|
| Where do these commands run? | Inside the **proot Ubuntu on the phone** (the terminal DSH Go provides). Not on a PC. |
| Whose IP is `192.168.1.100`? | **The phone's own** LAN address. Client and adbd are on the same device, so use the IP the phone displays. |
| Anything to build after cloning? | **No.** Plain ESM JS — no build step, no `npm install`. `peerDependencies` are optional; the plugin falls back internally. |

1. An Android phone with Developer options enabled
2. Wireless debugging available (for the one-time pairing)
3. The proot environment can install the adb client:

```bash
apt-get update && apt-get install -y android-tools-adb
adb version
# Android Debug Bridge version 1.0.41
```

> Note: upgrading the DSH Go runtime image wipes apt-installed packages, so adb must be reinstalled afterwards. This happened in practice.

---

## 4. Install

### 4.1 Where the package comes from

`dsh plugin add` accepts two kinds of target:

**Option A — a local directory** (what you want after cloning from GitHub)

```bash
git clone https://github.com/JMINN0/dsh-go-plugin-adb.git
cd dsh-go-plugin-adb
dsh plugin --profile web add .
```

The `.` means "the current directory". **You must be inside the repository directory**, or it reports that the package cannot be found.

**Option B — a published package name** (if published to an npm registry)

```bash
dsh plugin --profile web add dsh-go-plugin-adb
```

**Which one?** This package is **not published to npm** — it only lives in the GitHub repo. So:

- coming from GitHub → use **Option A** (clone + `add .`)
- got `package not found` → you used Option B; switch to Option A

### 4.1.1 Common `add` failures

| Error | Cause | Fix |
|---|---|---|
| `package not found` | used a name that is not published | use Option A |
| no `package.json` found | not inside the repo directory | `cd` in, then `add .` |
| `ERR_MODULE_NOT_FOUND` | incomplete directory (partial copy) | clone again |

### 4.2 What `--profile web` means

DSH can have several profiles. The one used by the phone's built-in engine is called `web`.

- Without `--profile`, the plugin is installed into the default profile and **the phone app will not load it**
- You must pass `--profile web` for the tools to appear on your phone

### 4.3 Restart the engine afterwards

Installing only changes configuration; it does not reload code. **Restart the engine once**:

**Path: in the app → Settings → Engine → Restart engine**

Without the restart, no `adb_*` tools appear. This is the step people miss most often.

**When are they usable?** The restart interrupts the engine for the current conversation. Once the app is accepting input again (a few to ~15 s), just talk in the **same** conversation — tools are registered globally, not per-conversation. If the agent still claims there are no tools, open a new conversation.

### 4.4 Verify the install

```bash
# 1. is it in the config?
python3 -c "
import json
d=json.load(open('$HOME/.dsh/profiles/web/package.json'))
print([b for b in d['dsh']['profile']['bundles'] if 'adb' in b])"
# expected: ['dsh-go-plugin-adb']

# 2. did the engine load it? (no 'apply failed' means good)
grep -i "apply failed" ~/.dsh/dsh-app/diagnostics.md 2>/dev/null | grep adb || echo "no load errors ✅"
```

### 4.5 The real last step: call a tool once

Everything above only proves the configuration is right — not that the tools work. Make one real call:

Say in the DSH Go conversation:

```
用 adb_devices 看看现在连着哪些设备
```

The agent calls `adb_devices` and should return:

```
127.0.0.1:5555  device
```

**Seeing that line is what "installed" means.** If the agent says the tool does not exist, go back to 4.3 and confirm the restart. If it returns `没有可用连接`, redo section 5.

> **How are the tools triggered?** They are for the agent, not for you to type. You speak normally and the agent picks a tool, or you name it: "use adb_shell to run getprop ro.product.model".
>
> **Where is the tool list?** Once the engine restarts, the agent can call them. Some app versions show an inventory; the location varies by version — if a call works, you do not need to find the list.

---

## 5. One-time pairing (first time only)

**Order matters. Skipping a step gives `no devices/emulators found`.**

```bash
# 1. Phone: Developer options → Wireless debugging → Pair device with pairing code
#    The screen shows:
#      - a pairing IP:port   (e.g. 192.168.1.100:37123)
#      - a 6-digit pairing code
#    The main Wireless debugging screen also shows an "IP address & Port"
#    (e.g. 192.168.1.100:41000) — that is NOT the pairing port. Note both.

# 2. Pair (using the pairing port)
adb pair 192.168.1.100:37123
# Enter the 6-digit code when prompted
# Success shows: Successfully paired to ...

# 3. DO NOT SKIP — connect to the wireless-debug port first.
#    adb needs a connected device before the next step can work.
adb connect 192.168.1.100:41000
# Success shows: connected to 192.168.1.100:41000

# 4. Fix the port to 5555 (this fails with "no devices/emulators found" if you skipped step 3)
adb tcpip 5555
# Success shows: restarting in TCP mode port: 5555

# 5. Connect over loopback (note: 127.0.0.1 here, not the LAN IP)
adb connect 127.0.0.1:5555
adb -s 127.0.0.1:5555 shell id
# uid=2000(shell) gid=2000(shell) groups=... context=u:r:shell:s0
```

**Why step 5 uses 127.0.0.1**: after `adb tcpip 5555`, adbd listens on `[::]:5555`, so a loopback connection works too — and bypasses Wi-Fi entirely.

After pairing, the key lives in `~/.android/adbkey`, so you never pair again, even after reinstalling adb.

**After a phone reboot** the `adb tcpip` setting is lost; redo step 4 (and step 3 first if the device is no longer connected).

| Error | Cause | Fix |
|---|---|---|
| `no devices/emulators found` at step 4 | step 3 was skipped | go back and run step 3 |
| `failed to authenticate` | key mismatch | revoke USB debugging authorisations on the phone, pair again |
| `cannot connect to 127.0.0.1:5555` | `tcpip` did not take effect | redo steps 3 and 4 |
| `connection refused` | adbd is not listening on 5555 | phone rebooted — redo step 4 |

---

## 6. The six tools

### `adb_devices`

List connected devices. No parameters.

```
adb_devices
→ 127.0.0.1:5555  device
```

### `adb_shell`

Run a shell command. The most used one.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `command` | string | ✅ | command to run |
| `timeoutMs` | integer | | timeout in ms, default 30000, max 120000 |
| `confirm` | boolean | | dangerous commands require `true` |

**Can the command use pipes and `&&`? Yes.** The whole string is handed to `adb shell`, so all of these are valid:

```
adb_shell { command: "pm list packages | grep tencent" }
adb_shell { command: "getprop ro.product.model && getprop ro.build.version.release" }
adb_shell { command: "dumpsys battery | grep -E 'level|status'" }
```

**Return value**: `{ text: "..." }`. Returns `(无输出)` when the command produces nothing, and `连不上，已试过端口：...` when the connection layer fails. A failing command (e.g. grep with no match) is **not** a connection failure — `text` still contains output.

**Dangerous-command blocklist** — these are refused unless you pass `confirm: true`. This is a **blocklist**, not an allowlist:

- `pm uninstall <pkg>`
- `pm clear <pkg>`
- `pm disable <pkg>` / `pm disable-user <pkg>`
- write operations under `cmd package` (e.g. `cmd package uninstall`)
- `rm -rf /sdcard` and variants
- `reboot` / `recovery`

**`confirm` semantics**: only `true` lets it through. `false` and omitting it are **equivalent** (both refused). The guard passes 40/40 tests, including quote-based bypasses such as `pm "uninstall" com.foo.bar`.

**After a refusal**: explain the consequence to the user, get consent, then resend with `confirm: true`. Before uninstalling anything, read the APK's real display name with aapt — package names lie.

### `adb_install`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `path` | string | ✅ | **device-side** absolute path, e.g. `/sdcard/Download/app.apk` |
| `reinstall` | boolean | | adds `-r`, keeps data, default true |
| `downgrade` | boolean | | adds `-d`, allows downgrade, default false |

```
adb_install { path: "/sdcard/Download/app.apk" }
→ Success    or    Failure [INSTALL_FAILED_...]
```

**Path namespace**: `path` must be a **device path** (`/sdcard/...`), not a proot path. The device cannot see `/root/...`; push the file first.

Common failures: `INSTALL_FAILED_UPDATE_INCOMPATIBLE` (signature mismatch — uninstall the old one first or re-sign with the same key), `INSTALL_FAILED_VERSION_DOWNGRADE` (pass `downgrade: true`), `INSTALL_FAILED_INSUFFICIENT_STORAGE`.

### `adb_logcat`

Tail the log without leaving a long-running process behind.

| Parameter | Type | Description |
|---|---|---|
| `lines` | integer | how many lines, default 200, max 5000 |
| `filter` | string | filter rule, **regex supported** (runs `grep -E`); a plain word is a valid regex |

```
adb_logcat { filter: "FATAL", lines: 100 }
adb_logcat { filter: "AndroidRuntime|FATAL|ANR", lines: 200 }
adb_logcat { clear: true, filter: "AndroidRuntime" }
```

Returns the plain-text tail. No match returns `（最近 N 行里没有匹配 "X" 的内容）` — a normal result, not an error.

### `adb_screencap`

Both parameters are optional — `adb_screencap {}` is valid and captures the main display to the default path.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `outPath` | string | | device-side path, default `/sdcard/dsh-screencap.png` |
| `localPath` | string | | also pull back to this proot path, e.g. `/tmp/shot.png` |

```
adb_screencap {}
adb_screencap { outPath: "/sdcard/a.png", localPath: "/tmp/a.png" }
```

It captures the **main display**. Capturing a virtual display is the job of `dsh-go-plugin-screen`, not this plugin.

### `adb_reconnect`

Force a fresh connection: kill the local adb server, restart it, migrate the wireless-debug port to 5555, verify uid 2000. No parameters.

Use after a phone reboot, or when `adb_devices` shows offline. If the automatic recovery fails, the returned text says which step failed — then redo section 5.

---

## 7. What it can and cannot do

**Can do** (all verified):

```bash
pm list packages / pm path / pm install / pm uninstall
am start / am force-stop / am broadcast
logcat / dumpsys / getprop / settings
screencap / input / cmd window / cmd notification
```

⚠️ write operations under `cmd package` (uninstall / clear / disable) are on the blocklist and need `confirm: true`; read operations such as `cmd package list packages` are not restricted.

**There is no dedicated pull/push tool** among the six. To move files around, use `adb_shell` with `cp` / `mkdir` on the device, or run `adb push` from the proot command line (outside the plugin).

**Cannot do**:

| Limitation | Reason |
|---|---|
| read `/data/data`, `/data/app` | blocked by SELinux for uid 2000 |
| `run-as` other apps | only works for debuggable packages |
| anything requiring root | no root |
| cross-user access | current user only |

---

## 8. Stability and compatibility

**Stability 10/10** — what each test means (`ensure` is the plugin's internal "make sure the connection works" step, not a tool):

| Test | Meaning |
|---|---|
| consecutive ensure ×30 | 30 repeat connection requests, average 33 ms, slowest 56 ms |
| consecutive shell ×30 | 30 commands in a row, all succeed |
| `kill-server` ×5 self-heal | killing the adb server 5 times, plugin restarts it each time |
| `disconnect` ×3 self-heal | manual disconnects, plugin reconnects |
| corrupt state file falls back | a broken `state.json` does not break usage |
| wrong port falls back | dead port in state file → retries 5555 |
| concurrent ensure ×3 | three simultaneous requests do not collide |
| timeout does not hang | stuck commands return an error instead of hanging the plugin |
| missing adb does not kill the process | returns a readable error, **does not crash the engine** |
| unwritable state file does not crash | still works on a read-only disk |

**Compatibility**:

| Verified | Not verified |
|---|---|
| Android 16 | Android 11–15, Android 10 and older |
| adb 34.0.4 | adb below 1.0.39 |
| nubia NX809J | Samsung / Xiaomi / Pixel adbd |
| Linux proot | Windows / macOS hosts |

Port auto-negotiation order: `state.port` → 5555 → 6555 → 7555 → 8555 → 9555.

There is no 5556/5557 in the list because **5554–5585 is the range Android emulators occupy** (this device already has an `emulator-5554`), so stepping up one by one would collide. The second candidate jumps straight to 6555. adbd listens on whichever port `adb tcpip <port>` was given. The chosen port is stored in `~/.dsh/plugin-adb/state.json`:

```json
{ "port": 5555, "lastOkAt": 1793871234567 }
```

---

## 9. Return-value contract (measured, not promised)

Every tool returns `{ text: string }` and never throws. Values below are **measured**.

### `adb_shell`

| Case | Actual `text` |
|---|---|
| normal output | the command's stdout |
| success, no output | `(无输出)` |
| **timeout** | `命令超时（2000ms 内没结束）。要更长时间就调大 timeoutMs。` plus the command |
| **non-zero exit** | `命令失败（退出码 1）` plus the command (stderr appended on a `[stderr]` line if present) |
| blocked by guard | `已拒绝：...` plus the command and retry guidance |
| connection failure | `连不上，已试过端口：...` plus pairing steps |

**Telling success from failure**: failure text contains `命令超时`, `命令失败`, `已拒绝`, or `连不上`.

### `adb_devices`

```
adb devices:
127.0.0.1:5555	device

回环目标 127.0.0.1:5555: 已就绪（NX809J）
记住的端口: 5555 · 上次成功: 1793888292386 · 重连次数: 0
```

### `adb_logcat`

| Case | Actual return |
|---|---|
| match | the matching log lines |
| **no match** | `（最近 20 行里没有匹配 "XXX" 的内容）` — **a normal result, not an error** |
| invalid filter chars | `filter 含不支持的字符：...` plus the allowed set |

`filter` runs through `grep -E` and **supports regex**: `"AndroidRuntime|FATAL|ANR"` works.

### `adb_install`

`Success`, or `Failure [INSTALL_FAILED_xxx: reason]`. Common codes: `UPDATE_INCOMPATIBLE` (signature mismatch), `VERSION_DOWNGRADE` (pass `downgrade: true`), `INSUFFICIENT_STORAGE`.

### `adb_screencap`

Two lines on success:

```
截图已保存：/sdcard/dsh-ct.png
-rw-rw---- 1 u0_a490 media_rw 1575442 2026-11-05 22:18 /sdcard/dsh-ct.png
```

With `localPath` an extra `已拉到本地：/tmp/xxx.png` line appears.

### `adb_reconnect`

Returns the rebuild steps and result, including a uid 2000 verification line on success.

---

## 9.5 Where the dangerous-command guard stops

**It prevents slips, it is not a security boundary.**

Blocked (9/9 measured): direct forms, quote concatenation (`p""m uninstall`, `pm un"install"`, `cmd "package" uninstall`), `find /sdcard -delete`, `su -c reboot`, `svc power reboot`, `rm -rf *`.

**Not blocked**: dynamic construction like `$(echo cm0)`, aliases, your own scripts, anything outside `adb shell`.

Real protection requires OS-level permissions. This guard only reduces accidental damage.

---

## 10. Uninstall and rollback

```bash
# 1. remove from the profile
dsh plugin --profile web remove dsh-go-plugin-adb

# 2. restart the engine (app → Settings → Engine → Restart)
```

Verify removal with the same command as section 4.4; the expected output is `[]`.

**Uninstalling the plugin does not undo system changes.** For example, the port opened by `adb tcpip 5555` stays. To close it, run `adb usb` (if a cable is connected) or turn wireless debugging off on the phone.

To clean up completely, delete `~/.dsh/plugin-adb/state.json` after uninstalling (it only stores the port and last success time).

---

## 11. Troubleshooting

**Tools do not appear after install** — restart the engine (section 4.3). If they still do not appear:

```bash
# check the bundle list
python3 -c "
import json;d=json.load(open('$HOME/.dsh/profiles/web/package.json'))
print(d['dsh']['profile']['bundles'])" | grep adb

# check for load errors
grep -i "apply failed" ~/.dsh/dsh-app/diagnostics.md 2>/dev/null | grep adb
```

If `diagnostics.md` does not exist, the engine has not written it yet — start the app once, or check the engine page in the app.

**`device not found`** — go in this order, do not skip:

```bash
# 1. try a direct connect
adb connect 127.0.0.1:5555
adb devices

# 2. still failing -> read the recorded port and try that
cat ~/.dsh/plugin-adb/state.json
adb connect 127.0.0.1:<port from state.json>

# 3. still failing -> the phone probably rebooted and adbd is no longer on 5555.
#    Note: `adb tcpip 5555` will now FAIL (no connected device). Rebuild the link first:
#      a) phone: Developer options -> Wireless debugging (turn it back on)
#      b) note the "IP address & Port" (it changes every time)
#      c) adb connect <that ip:port>
#      d) adb tcpip 5555
#      e) adb connect 127.0.0.1:5555
```

**Why `adb_reconnect` cannot rescue a reboot**: it also needs an existing connection before it can migrate the port. After a reboot you must take the manual path above. `adb_reconnect` suits cases where the link exists but is flaky (stale forward, stuck socket).

**`unauthorized`** — the key is gone. Revoke USB debugging authorisations on the phone and repeat section 5.

**`adb: command not found`** — `apt-get update && apt-get install -y android-tools-adb`.

**`offline`** — the port is open but adbd is not answering. Call `adb_reconnect`.

---

## 12. How it works

```
Agent (proot Ubuntu)
   ↓ adb -s 127.0.0.1:5555 shell ...
adb client (uid 2000)
   ↓ loopback TCP 127.0.0.1:5555
adbd (Android system)
   ↓
Android system services (pm / am / dumpsys / input / screencap ...)
```

No private interfaces — everything uses the standard adb protocol.

---

## License

MIT. See [LICENSE](LICENSE).
