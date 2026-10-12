@echo off
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\APEX Invo Bridge.vbs" 2>nul
call "%~dp0stop.cmd"
echo The bridge is stopped and will no longer start with Windows.
pause
