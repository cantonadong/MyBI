@echo off
setlocal
cd /d "%~dp0"
if /i "%~1"=="--check" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-workbench.ps1" -Check
  exit /b
)
start "" "%~dp0MyBI.exe"
exit /b 0
