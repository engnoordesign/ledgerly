@echo off
rem Ledgerly first-time setup. Double-click this file.
rem   run-setup.bat               set up and open the app
rem   run-setup.bat -NoLaunch     set up without opening the app
rem   run-setup.bat -Uninstall    remove the shortcuts (your data stays)
title Ledgerly setup
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1" %*
set "CODE=%errorlevel%"
echo.
if not "%CODE%"=="0" echo Setup stopped with a problem (code %CODE%).
pause
exit /b %CODE%
