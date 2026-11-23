@echo off
rem Creates a desktop icon for the blog tool (run once)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\make-shortcut.ps1"
