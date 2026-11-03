@echo off
setlocal
cd /d "%~dp0"
if /i "%~1"=="--check" (
  "%~dp0MyBI.exe" --check
  exit /b
)
start "" "%~dp0MyBI.exe"
exit /b 0
