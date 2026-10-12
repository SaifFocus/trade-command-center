@echo off
setlocal
title APEX Invo Bridge - setup
cd /d "%~dp0"
echo.
echo === APEX Invo Bridge setup ===
echo.
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>nul
if not errorlevel 1 goto havenode
echo Node.js is needed and is not installed.
echo It will now be installed with winget (Microsoft's installer). Answer its questions to continue.
echo.
winget install -e --id OpenJS.NodeJS.LTS
set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>nul
if not errorlevel 1 goto havenode
echo.
echo Node.js was not found after installing. Install it from https://nodejs.org (LTS), then run setup.cmd again.
pause
exit /b 1
:havenode
for /f "delims=" %%v in ('node -v') do echo Node.js %%v found.
echo.
echo Installing the bridge's one library (playwright-core, uses your Microsoft Edge)...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 (
  echo npm install failed. Check your internet connection and run setup.cmd again.
  pause
  exit /b 1
)
node bridge.mjs --init
echo Next a browser window opens. Log in to Invo there, then close that window.
pause
call "%~dp0login.cmd"
echo.
echo Setup done. Run install-autostart.cmd once so the bridge starts with Windows.
pause
