param([switch]$Lifecycle)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $root 'run.bat'

if (-not (Test-Path -LiteralPath $launcher)) {
    throw 'Launcher does not exist.'
}

$output = & $launcher --check 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Launcher check failed:`n$output"
}
if (($output -join "`n") -notmatch 'READY') {
    throw "Launcher did not report READY:`n$output"
}

if ($Lifecycle) {
    if (Get-Process -Name MyBI -ErrorAction SilentlyContinue | Where-Object Path -EQ (Join-Path $root 'MyBI.exe')) {
        throw 'Close the existing manager before running the lifecycle check.'
    }
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MyBIWindow {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string className, string title);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
}
'@
    $manager = Start-Process -FilePath (Join-Path $root 'MyBI.exe') -WorkingDirectory $root -WindowStyle Hidden -PassThru
    $window = [IntPtr]::Zero
    try {
        $deadline = (Get-Date).AddSeconds(40)
        $health = $null
        do {
            try { $health = Invoke-RestMethod 'http://127.0.0.1:8000/api/health' -TimeoutSec 2 } catch {}
            if ($health) { break }
            Start-Sleep -Milliseconds 300
        } while ((Get-Date) -lt $deadline)
        if (-not $health -or $health.status -ne 'ok' -or $health.project_root -ne $root) { throw 'Expected this project to be running.' }
        [uint32]$windowPid = 0
        do {
            $window = [MyBIWindow]::FindWindow($null, 'MyBI')
            [MyBIWindow]::GetWindowThreadProcessId($window, [ref]$windowPid) | Out-Null
            if ($window -ne [IntPtr]::Zero -and $windowPid -eq $manager.Id) { break }
            Start-Sleep -Milliseconds 100
        } while ((Get-Date) -lt $deadline)
        if ($window -eq [IntPtr]::Zero -or $windowPid -ne $manager.Id) { throw 'Manager window was not created.' }
        $second = Start-Process -FilePath (Join-Path $root 'MyBI.exe') -WorkingDirectory $root -WindowStyle Hidden -PassThru
        if (-not $second.WaitForExit(10000) -or $second.ExitCode -ne 0) {
            throw 'Opening MyBI again must activate the existing window and exit without a blocking dialog.'
        }
        [MyBIWindow]::PostMessage($window, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
        if (-not $manager.WaitForExit(10000)) { throw 'Manager did not close.' }
        $after = Invoke-RestMethod 'http://127.0.0.1:8000/api/health' -TimeoutSec 2
        if ($after.pid -ne $health.pid) { throw 'Closing the manager must leave the service running.' }
    } finally {
        $manager.Refresh()
        if ($window -eq [IntPtr]::Zero) {
            $window = [MyBIWindow]::FindWindow($null, 'MyBI')
            [uint32]$cleanupPid = 0
            [MyBIWindow]::GetWindowThreadProcessId($window, [ref]$cleanupPid) | Out-Null
            if ($cleanupPid -ne $manager.Id) { $window = [IntPtr]::Zero }
        }
        if (-not $manager.HasExited -and $window -ne [IntPtr]::Zero) {
            [MyBIWindow]::PostMessage($window, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
        }
    }
    Write-Output 'PASS: native window created; service remains running after closing it.'
}
