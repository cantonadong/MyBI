param([switch]$Check, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot 'runtime\python.exe'
if (-not (Test-Path -LiteralPath $python)) { $python = Join-Path $projectRoot '.venv\Scripts\python.exe' }
$page = Join-Path $projectRoot 'frontend\dist\index.html'
if (-not (Test-Path -LiteralPath $python)) { throw 'Python runtime is missing. Use the Windows release package or create .venv first.' }
if (-not (Test-Path -LiteralPath $page)) { throw 'Web build is missing. Run npm run build in frontend first.' }
& $python -c 'import fastapi, duckdb, pyarrow, python_calamine, sqlalchemy, uvicorn'
if ($LASTEXITCODE -ne 0) { throw 'Python dependencies are incomplete.' }
if ($Check) { Write-Output 'READY'; exit 0 }
$url = 'http://127.0.0.1:8000'
$ready = $false
try { $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 2; $ready = $health.status -eq 'ok' } catch {}
if ($ready) {
    if ($health.project_root -ne $projectRoot -or -not $health.pid) { throw 'Port 8000 is occupied by an older or different server. Close that server and run this launcher again.' }
    $server = Get-Process -Id $health.pid -ErrorAction Stop
    $latestCode = Get-ChildItem -LiteralPath (Join-Path $projectRoot 'backend\app') -Recurse -Filter '*.py' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latestCode.LastWriteTime -gt $server.StartTime) {
        Write-Output 'Code changed; restarting Data Workbench...'
        Stop-Process -Id $server.Id -ErrorAction Stop
        $server.WaitForExit()
        $ready = $false
    }
}
if (-not $ready) {
    $logDirectory = Join-Path $projectRoot 'data\logs'
    New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $stdout = Join-Path $logDirectory "$stamp-out.log"
    $stderr = Join-Path $logDirectory "$stamp-error.log"
    $process = Start-Process -FilePath $python -WorkingDirectory $projectRoot -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', '8000') -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    $deadline = (Get-Date).AddSeconds(30)
    do {
        try { $ready = (Invoke-RestMethod "$url/api/health" -TimeoutSec 2).status -eq 'ok' } catch {}
        if ($ready) { break }
        $process.Refresh()
        if ($process.HasExited) { throw "Server exited. See $stderr" }
        Start-Sleep -Milliseconds 300
    } while ((Get-Date) -lt $deadline)
    if (-not $ready) { throw "Server did not start. See $stderr" }
}
if (-not $NoBrowser) { Start-Process $url }
Write-Output "Data Workbench is ready: $url"
