param([switch]$Package)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    & npm.cmd --prefix frontend run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    Get-Process -Name MyBI -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $projectRoot 'MyBI.exe') } | Stop-Process -Force
    & cargo +stable-x86_64-pc-windows-msvc build --manifest-path desktop/Cargo.toml --release --locked
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
