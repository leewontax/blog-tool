@echo off
rem Blog tool launcher - double-click to start
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\launch.ps1"
if errorlevel 1 pause
