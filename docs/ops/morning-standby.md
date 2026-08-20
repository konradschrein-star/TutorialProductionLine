# Morning Quiet Standby (09:00)

Goal: quiet mornings — Render Node 3 sleeps at **09:00**, the controller laptop sleeps just after.

## Status

| Machine | Task | Schedule | State |
|---|---|---|---|
| **This laptop** (`konrad_pc`, controller) | `MorningQuietStandby-ThisPC` | **Daily 09:02** | ✅ **Installed & armed** (`schtasks`, verified created) |
| **Render Node 3** (`192.168.178.48`, RDP-only) | `MorningQuietStandby` | Daily 09:00 | ⚠️ **Needs one manual step** — see below |

Laptop sleeps at **09:02** (2 min after the node) so it goes down *after* the node, per the requested order.

## Why the render node needs a manual step

The render node exposes **only RDP (3389)**. SMB (445), RPC (135) and WinRM are all closed/unreachable from the laptop (`schtasks /S` → "network path not found"; `Test-WSMan` → firewalled; no saved credentials; no PsExec). So the task **cannot** be pushed remotely — it must be created on the node itself.

### To finish the render node (30 seconds, once)

Option A — run the installer on the node:
1. RDP into `192.168.178.48` (the auto-watcher launches the session when the node is on).
2. Copy `scripts/install-render-node-standby.bat` to the node and **Run as administrator**.

Option B — paste this one line into an elevated CMD/PowerShell **on the node**:
```
schtasks /Create /TN "MorningQuietStandby" /TR "rundll32.exe powrprof.dll,SetSuspendState 0,1,0" /SC DAILY /ST 09:00 /RL HIGHEST /F
```

## Command reference

- Sleep command used: `rundll32.exe powrprof.dll,SetSuspendState 0,1,0` (suspend; if hibernation is enabled the OS may hibernate instead — still quiet/off).
- Inspect the laptop task: `schtasks /Query /TN "MorningQuietStandby-ThisPC" /V /FO LIST`
- Disable (recurring not wanted): `schtasks /Change /TN "MorningQuietStandby-ThisPC" /DISABLE`
- Delete: `schtasks /Delete /TN "MorningQuietStandby-ThisPC" /F`

> Note: both tasks are **daily/recurring** (a "cron job"). The laptop task will suspend this machine at 09:02 every day — if a long build is running it will pause when the machine sleeps. Disable/delete with the commands above if you want it off.
