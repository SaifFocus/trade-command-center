@echo off
title APEX Invo Bridge - log in to Invo
cd /d "%~dp0"
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
node bridge.mjs --login
echo Starting the bridge in the background...
start "" wscript.exe "%~dp0start-hidden.vbs"
