@echo off
:: ============================================================================
:: Render Node 3 — Morning Quiet Standby installer
:: RUN THIS ONCE *ON THE RENDER NODE* (192.168.178.48), elevated (Run as admin).
::
:: Why manual: the render node exposes only RDP (3389). SMB(445)/RPC(135)/WinRM
:: are closed, so the controller laptop cannot push a scheduled task to it
:: remotely. Running this file on the node installs the task locally.
::
:: Creates a DAILY task that puts the node into standby (sleep) at 09:00.
:: To remove later:  schtasks /Delete /TN "MorningQuietStandby" /F
:: ============================================================================

schtasks /Create /TN "MorningQuietStandby" /TR "rundll32.exe powrprof.dll,SetSuspendState 0,1,0" /SC DAILY /ST 09:00 /RL HIGHEST /F
if %ERRORLEVEL%==0 (
  echo(
  echo [OK] Daily 09:00 standby task installed on this render node.
) else (
  echo(
  echo [FAILED] Could not create task ^(exit %ERRORLEVEL%^). Re-run as Administrator.
)
pause
