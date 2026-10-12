@echo off
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
> "%STARTUP%\APEX Invo Bridge.vbs" echo CreateObject("WScript.Shell").Run "wscript.exe ""%~dp0start-hidden.vbs""", 0, False
echo The bridge will now start by itself when you log in to Windows.
start "" wscript.exe "%~dp0start-hidden.vbs"
echo It is also running now. Check bridge.log in this folder to see it working.
pause
