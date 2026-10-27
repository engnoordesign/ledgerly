@echo off
rem Starts the Ledgerly server: the app plus encrypted sync for your devices.
rem Double-click to run. Close this window to stop it.
rem   start-server.bat                     only this computer can connect
rem   start-server.bat --host 0.0.0.0      other devices on your network can connect (they need HTTPS, see README)
rem   start-server.bat --signup invite --invite SECRETWORD    only people with the invite code can create accounts
title Ledgerly server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is needed to run the server. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8787"
node server\server.js %*
echo.
pause
