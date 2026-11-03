param([switch]$Lifecycle)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$launcher = Get-ChildItem -LiteralPath $root -Filter '*Data_Workbench.bat' | Select-Object -First 1 -ExpandProperty FullName

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
    $script = Join-Path $root 'scripts\start-workbench.ps1'
    & $script -NoBrowser
    $before = Invoke-RestMethod 'http://127.0.0.1:8000/api/health'
    & $script -NoBrowser
    $unchanged = Invoke-RestMethod 'http://127.0.0.1:8000/api/health'
    if ($before.pid -ne $unchanged.pid) { throw 'Unchanged service should be reused.' }
    $source = Get-Item -LiteralPath (Join-Path $root 'backend\app\main.py')
    $originalTime = $source.LastWriteTime
    try {
        $source.LastWriteTime = Get-Date
        & $script -NoBrowser
        $updated = Invoke-RestMethod 'http://127.0.0.1:8000/api/health'
        if ($updated.pid -eq $before.pid) { throw 'Changed backend must be restarted.' }
        if ($updated.project_root -ne $root) { throw 'Wrong project is running.' }
    } finally { $source.LastWriteTime = $originalTime }
    Write-Output 'PASS: unchanged service reused; updated backend restarted.'
}
