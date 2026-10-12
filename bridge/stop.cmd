@echo off
cd /d "%~dp0"
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
node bridge.mjs --stop
timeout /t 3 >nul
