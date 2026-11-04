# dsh-plugin-adb

Give the agent a real adb shell **from inside the phone**. Not "PC controls phone" — the agent runs on the device and talks to its own adbd.

```bash
dsh plugin --profile web add git+https://github.com/<you>/dsh-plugin-adb
```

## Why it survives Wi-Fi being off

`adb tcpip <port>` puts adbd on `[::]:<port>` — the whole network stack, not just loopback. The agent connects to `127.0.0.1:<port>`, i.e. over loopback, so turning Wi-Fi off (or airplane mode) does not break it.

To be precise: it works because the listener *includes* loopback, not because loopback is the only listener. Other machines on the same LAN can reach that port too (they still need your adb private key). Revoke with `adb usb` or by turning wireless debugging off.

## One-time pairing

```bash
apt-get install -y android-tools-adb
# phone: Developer options -> Wireless debugging -> on; read the pairing code + port
adb pair 127.0.0.1:<pair-port>
adb connect 127.0.0.1:<debug-port>
adb tcpip 5555
adb connect 127.0.0.1:5555
```

The pairing code can only come from a human. The plugin does not promise one-click setup; it promises you never touch it again after pairing.

## Port selection

Candidates: last known good port (`state.json`) → 5555 → 6555 → 7555 → 8555 → 9555.
Two phases: connect to every candidate first (cheap, non-invasive); only if all fail, migrate adbd with `tcpip`.

Ports 5554–5585 are treated by adb as *emulator* ports — probing them spawns bogus `emulator-55xx` entries, so fallbacks deliberately avoid that range and such entries are filtered out.

## Auto-recovery

No daemon: recovery happens on each tool call.
- `ensure()` on every call — cached port first, full re-discovery if stale
- Transient errors only (`device offline`, `protocol fault`, …) trigger one `kill-server` + retry; command-level failures are **not** retried
- After a reboot adbd returns on a random wireless-debugging port. The plugin reads it from `adb mdns services` (`_adb-tls-connect._tcp`), connects, then pins it back — no user input needed

## Tools

`adb_devices`, `adb_reconnect`, `adb_shell`, `adb_install`, `adb_logcat`, `adb_screencap`.

## Capability boundary (tested 2026-11-04)

Works: `pm list/path/install/uninstall`, `am start`, `logcat`, `dumpsys`, `screencap`, `pull/push`, `input`.
Does not: read `/data/data` or `/data/app` (SELinux); `run-as` only on debuggable packages; no root.

Restore an uninstalled system app: `pm install-existing --user 0 <pkg>`.

## Security

This is a **uid 2000 shell**. Destructive commands (`pm uninstall` / `clear` / `disable`, `cmd package …`, deleting user data, `reboot`) are refused unless `confirm: true`. All user-supplied strings that reach a shell are whitelist-validated (injection through paths is rejected, not escaped). Uninstall only after reading the APK's real label with `aapt` — package names lie.

## Not verified

Only one device was available: Android 16, adb 34.0.4, Node 24.22.1. Behaviour on Android 11–13 and older adb builds is **untested**.

## License

MIT
