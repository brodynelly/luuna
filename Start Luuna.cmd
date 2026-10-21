@echo off
powershell.exe -NoProfile -STA -File "%~dp0scripts\start-windows.ps1" -Native
if errorlevel 1 pause
