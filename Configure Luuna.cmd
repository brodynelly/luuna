@echo off
powershell.exe -NoProfile -STA -File "%~dp0scripts\set-windows-provider.ps1"
if errorlevel 1 pause
