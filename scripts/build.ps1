param([switch]$Package, [string]$MyQueryRoot = (Join-Path $PSScriptRoot '..\..\MyQuery'), [string]$LlvmBin = $env:LLVM_MINGW_BIN)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    & npm.cmd --prefix frontend run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    Get-Process -Name MyBI -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $projectRoot 'MyBI.exe') } | Stop-Process -Force
    Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'python.exe' -and $_.CommandLine -like "*$projectRoot*uvicorn app.main:app*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath (Join-Path $MyQueryRoot 'build.ps1')) {
        & (Join-Path $MyQueryRoot 'build.ps1') -CoreOnly -LlvmBin $LlvmBin
        Set-Location $projectRoot
        Copy-Item -LiteralPath (Join-Path $MyQueryRoot 'myquery_core.dll') -Destination (Join-Path $projectRoot 'myquery_core.dll') -Force
    } elseif (-not (Test-Path -LiteralPath myquery_core.dll)) {
        throw 'Build MyQuery shared query core first or provide -MyQueryRoot.'
    }
    & cargo +stable-x86_64-pc-windows-gnu build --manifest-path desktop/Cargo.toml --release --locked
    if ($LASTEXITCODE -ne 0) { throw 'Launcher build failed.' }
    Copy-Item -LiteralPath desktop\target\release\MyBI.exe -Destination MyBI.exe -Force
    if (-not (Test-Path -LiteralPath MyBI.exe)) { throw 'MyBI.exe is missing. Check endpoint protection alerts.' }
    if ($Package) {
        $python = if (Test-Path -LiteralPath .\.venv\Scripts\python.exe) { '.\.venv\Scripts\python.exe' } else { '.\runtime\python.exe' }
        & $python .\scripts\package-release.py
        if ($LASTEXITCODE -ne 0) { throw 'Release packaging failed.' }
    }
}
finally { Pop-Location }
