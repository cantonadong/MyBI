param([switch]$Package)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    & npm.cmd --prefix frontend run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    Get-Process -Name MyBI -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $projectRoot 'MyBI.exe') } | Stop-Process -Force
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    & $compiler /nologo /target:winexe /out:MyBI.exe /win32icon:design\icon.ico /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll .\scripts\MyBI.cs
    if ($LASTEXITCODE -ne 0) { throw 'Launcher build failed.' }
    if ($Package) {
        & .\.venv\Scripts\python.exe .\scripts\package-release.py
        if ($LASTEXITCODE -ne 0) { throw 'Release packaging failed.' }
    }
}
finally { Pop-Location }
