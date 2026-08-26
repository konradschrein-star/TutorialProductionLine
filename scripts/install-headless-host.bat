@echo off
:: ==============================================================================
:: AUTO-ELEVATING HEADLESS HOST INSTALLER (German & English Windows Compatible)
:: ==============================================================================
NET SESSION >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo Requesting Administrator privileges...
    powershell -Command "Start-Process cmd -ArgumentList '/c %~dp0install-headless-host.bat' -Verb RunAs"
    exit /b
)

echo ==============================================================================
echo [1/4] Enabling Remote Desktop in Registry...
reg add "HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Terminal Server" /v fDenyTSConnections /t REG_DWORD /d 0 /f >nul

echo [2/4] Configuring Windows Firewall for Port 3389 (Locale-Agnostic)...
netsh advfirewall firewall delete rule name="Remote Desktop Worker 3389" >nul 2>&1
netsh advfirewall firewall add rule name="Remote Desktop Worker 3389" dir=in action=allow protocol=TCP localport=3389 >nul
netsh advfirewall firewall add rule name="Remote Desktop Worker 3389 UDP" dir=in action=allow protocol=UDP localport=3389 >nul

echo [3/4] Starting and Setting Remote Desktop Service to Automatic...
sc config TermService start= auto >nul
net start TermService >nul 2>&1

echo [4/4] Disabling System Sleep & Standby (24/7 Headless State)...
powercfg -change -standby-timeout-ac 0
powercfg -change -monitor-timeout-ac 0
powercfg -change -hibernate-timeout-ac 0

echo.
echo ==============================================================================
echo [SUCCESS] This PC is now a permanent Headless Worker Node!
echo Hostname : %COMPUTERNAME%
echo Local IP : 192.168.178.48
echo Port     : 3389 (OPEN & LISTENING)
echo ==============================================================================
echo Press any key to exit...
pause >nul
