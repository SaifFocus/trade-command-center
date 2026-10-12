@echo off
title APEX Invo Bridge (close this window to stop it)
cd /d "%~dp0"
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
node bridge.mjs
pause
