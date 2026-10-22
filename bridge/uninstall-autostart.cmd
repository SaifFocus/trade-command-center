@echo off
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\APEX Invo Bridge.vbs" 2>nul
schtasks /delete /f /tn "APEX Invo Bridge" >nul 2>&1
call "%~dp0stop.cmd"
echo The bridge is stopped and will no longer start with Windows.
pause
