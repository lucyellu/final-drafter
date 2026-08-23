@echo off
setlocal

set DIR=%~dp0

powershell -NoProfile -ExecutionPolicy Bypass -File "%DIR%scripts\launch.ps1" -Page hub.html

endlocal
