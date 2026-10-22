@echo off
cd /d "%~dp0"
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
node bridge.mjs --stop
echo It stays stopped until you start it again (start.cmd or install-autostart.cmd) or log in to Windows.
timeout /t 3 >nul
