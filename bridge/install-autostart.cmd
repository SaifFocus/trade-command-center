@echo off
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
> "%STARTUP%\APEX Invo Bridge.vbs" echo CreateObject("WScript.Shell").Run "wscript.exe ""%~dp0start-hidden.vbs""", 0, False
echo The bridge will now start by itself when you log in to Windows.
schtasks /create /f /sc minute /mo 10 /tn "APEX Invo Bridge" /tr "wscript.exe \"%~dp0ensure-hidden.vbs\"" >nul
if errorlevel 1 (
  echo Could not add the 10-minute check to Task Scheduler. The bridge still restarts itself after sleep.
) else (
  echo Every 10 minutes Windows checks that the bridge is running and starts it if it is not.
)
start "" wscript.exe "%~dp0start-hidden.vbs"
echo It is also running now. Check bridge.log in this folder to see it working.
pause
