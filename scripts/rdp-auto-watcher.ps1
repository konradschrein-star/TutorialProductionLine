<#
.SYNOPSIS
  Autonomous RDP Auto-Launcher & Node Watcher for Second Computer (Laptop)
.DESCRIPTION
  Runs on the second computer. Continuously checks for the Worker Node (192.168.178.48:3389).
  As soon as the Worker Node powers on, it automatically launches the RDP connection session.
#>

param (
    [string]$WorkerIP = "192.168.178.48",
    [int]$WorkerPort = 3389,
    [int]$PollIntervalSeconds = 3
)

$ErrorActionPreference = "SilentlyContinue"
[Console]::Title = "Worker Node Auto-Connector [Target: $WorkerIP]"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host " 🛰️ WORKER NODE AUTO-CONNECTOR DAEMON" -ForegroundColor Cyan
Write-Host " Target Node IP : $WorkerIP" -ForegroundColor Yellow
Write-Host " Target Port    : $WorkerPort" -ForegroundColor Yellow
Write-Host " Status         : Waiting for Worker Node to power on..." -ForegroundColor Gray
Write-Host "=================================================================" -ForegroundColor Cyan

$isConnected = $false

while ($true) {
    # Test TCP socket on Port 3389
    $tcp = New-Object System.Net.Sockets.TcpClient
    $connect = $tcp.BeginConnect($WorkerIP, $WorkerPort, $null, $null)
    $wait = $connect.AsyncWaitHandle.WaitOne(1000, $false)

    if ($wait -and $tcp.Connected) {
        $tcp.EndConnect($connect)
        $tcp.Close()

        if (-not $isConnected) {
            Write-Host "`n[$(Get-Date -Format 'HH:mm:ss')] 🟢 Worker Node is ONLINE! Launching RDP..." -ForegroundColor Green
            
            # Play short chime
            [Console]::Beep(1000, 200)

            # Check if mstsc is already running for this IP
            $existing = Get-Process mstsc -ErrorAction SilentlyContinue
            if (-not $existing) {
                # Launch RDP
                Start-Process "mstsc.exe" -ArgumentList "/v:$WorkerIP"
            }

            $isConnected = $true
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Session active. Monitoring node heartbeat..." -ForegroundColor DarkGreen
        }
    } else {
        $tcp.Close()
        if ($isConnected) {
            Write-Host "`n[$(Get-Date -Format 'HH:mm:ss')] 🔴 Worker Node went offline. Resuming standby watch..." -ForegroundColor Red
            $isConnected = $false
        }
        Write-Host -NoNewline "."
    }

    Start-Sleep -Seconds $PollIntervalSeconds
}
