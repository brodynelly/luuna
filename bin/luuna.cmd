@echo off
rem `luuna <command>` from cmd or PowerShell: the terminal client (packages/tui)
rem against the local runtime, through the fixed launcher. Put this folder on PATH.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\start-terminal.ps1" %*
