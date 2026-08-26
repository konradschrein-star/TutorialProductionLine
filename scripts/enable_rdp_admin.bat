@echo off
:: Batch script to enable Remote Desktop and allow Firewall through Administrator privilege
echo [1/2] Enabling Remote Desktop in Registry...
reg add "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Terminal Server" /v fDenyTSConnections /t REG_DWORD /d 0 /f

echo [2/2] Enabling Windows Defender Firewall Remote Desktop Rules...
netsh advfirewall firewall set rule group="remote desktop" new enable=Yes

echo.
echo ====================================================================
echo [OK] Remote Desktop is ENABLED!
echo Local IP: 192.168.178.48
echo Username: Konrad
echo You can now connect from your second machine using mstsc.exe
echo ====================================================================
pause
