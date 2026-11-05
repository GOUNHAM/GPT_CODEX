@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "runtime\node.exe" (
  echo Node runtime is missing. Extract the entire ZIP before starting.
  pause
  exit /b 1
)
"%~dp0runtime\node.exe" "%~dp0launcher.cjs"
if errorlevel 1 pause
