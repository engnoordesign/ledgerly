@echo off
rem Opens Ledgerly in its own app window. No setup needed.
rem For a desktop icon, run run-setup.bat once.
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\launch.ps1"
exit /b %errorlevel%
